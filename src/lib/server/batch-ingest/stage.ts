import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import { ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import {
	canonicalizeBatchParquet,
	loadSavedSliceContracts,
	type CanonicalizedBatchSlice
} from './canonicalize';
import {
	batchStoragePaths,
	createStagedBatchManifest,
	persistStagedBatchManifest,
	readAcceptedMappingManifest,
	readBatchStagingInput,
	stagedSliceArtifact,
	type BatchSourceIntegrity,
	type StagedBatchManifest,
	type StagedCanonicalColumn,
	type StagedRefAreaSummary,
	type StagedSliceSummary
} from './storage';

export const DEFAULT_STAGE_MAX_ROWS = 250_000;

type BatchDb = ReturnType<typeof getDb>;

interface DuckDbStatement {
	all(...args: unknown[]): void;
}

interface DuckDbDatabase {
	prepare(query: string): DuckDbStatement;
	close(callback?: (error: Error | null) => void): void;
}

interface DuckDbModule {
	Database: new (path: string, callback?: (error: Error | null) => void) => DuckDbDatabase;
}

export interface StageBatchInput {
	batchId: number;
	storageRoot?: string;
	maxRows?: number;
}

export interface StageBatchResult {
	batchId: number;
	status: 'staged' | 'failed';
	manifest: StagedBatchManifest;
	manifestPath: string;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

async function loadDuckDB(): Promise<DuckDbModule> {
	const imported = await import('duckdb');
	return ((imported as { default?: DuckDbModule }).default || imported) as DuckDbModule;
}

async function createInMemoryDuckDb(): Promise<DuckDbDatabase> {
	const duckdb = await loadDuckDB();
	return new Promise((resolve, reject) => {
		let instance: DuckDbDatabase;
		instance = new duckdb.Database(':memory:', (error: Error | null) => {
			if (error) reject(error);
			else resolve(instance);
		});
	});
}

function runQuery(database: DuckDbDatabase, query: string): Promise<void> {
	return new Promise((resolve, reject) => {
		database.prepare(query).all((error: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function closeDuckDb(database: DuckDbDatabase): Promise<void> {
	return new Promise((resolve, reject) => {
		database.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function fileIntegrity(path: string): Promise<BatchSourceIntegrity> {
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const chunk of createReadStream(path)) {
		const bytes = Buffer.from(chunk);
		hash.update(bytes);
		byteLength += bytes.byteLength;
	}
	return { algorithm: 'sha256', digest: hash.digest('hex'), byteLength };
}

function sameIntegrity(left: BatchSourceIntegrity, right: BatchSourceIntegrity): boolean {
	return (
		left.algorithm === right.algorithm &&
		left.digest === right.digest &&
		left.byteLength === right.byteLength
	);
}

async function installImmutableFile(
	temporaryPath: string,
	finalPath: string
): Promise<BatchSourceIntegrity> {
	await mkdir(dirname(finalPath), { recursive: true });
	const integrity = await fileIntegrity(temporaryPath);
	try {
		await link(temporaryPath, finalPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		const existingIntegrity = await fileIntegrity(finalPath);
		if (!sameIntegrity(existingIntegrity, integrity)) {
			throw new Error(
				`Immutable staged artifact already exists with different content: ${finalPath}`
			);
		}
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
	return integrity;
}

function canonicalSchema(slice: CanonicalizedBatchSlice): StagedCanonicalColumn[] {
	return slice.columns.map((name) => ({
		name,
		type: name === 'obs_value' ? 'DOUBLE' : 'VARCHAR',
		nullable: true
	}));
}

function refAreaSummaries(slice: CanonicalizedBatchSlice): StagedRefAreaSummary[] {
	const summaries = new Map<string, { rowCount: number; periods: string[] }>();
	for (const row of slice.rows) {
		if (row.ref_area === null) continue;
		const summary = summaries.get(row.ref_area) || { rowCount: 0, periods: [] };
		summary.rowCount += 1;
		if (row.time_period !== null) summary.periods.push(row.time_period);
		summaries.set(row.ref_area, summary);
	}
	return [...summaries.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([refArea, summary]) => {
			const periods = summary.periods.sort();
			return {
				refArea,
				rowCount: summary.rowCount,
				periodStart: periods[0] ?? null,
				periodEnd: periods.at(-1) ?? null
			};
		});
}

async function writeSliceParquet(
	batchDir: string,
	sliceId: number,
	slice: CanonicalizedBatchSlice
): Promise<{ artifact: ReturnType<typeof stagedSliceArtifact>; integrity: BatchSourceIntegrity }> {
	const artifact = stagedSliceArtifact(sliceId);
	const finalPath = join(batchDir, artifact);
	const token = randomUUID();
	const ndjsonPath = join(batchDir, 'staged', `.slice-${sliceId}-${token}.ndjson`);
	const parquetPath = join(batchDir, 'staged', `.slice-${sliceId}-${token}.parquet`);
	await mkdir(dirname(ndjsonPath), { recursive: true });
	const handle = await open(ndjsonPath, 'wx');
	try {
		for (const row of slice.rows) await handle.write(`${JSON.stringify(row)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}

	let database: DuckDbDatabase | null = null;
	try {
		database = await createInMemoryDuckDb();
		const projection = slice.columns
			.map((column) => {
				const type = column === 'obs_value' ? 'DOUBLE' : 'VARCHAR';
				return `CAST(${quoteIdentifier(column)} AS ${type}) AS ${quoteIdentifier(column)}`;
			})
			.join(', ');
		await runQuery(
			database,
			`COPY (SELECT ${projection} FROM read_ndjson_auto(${sqlString(ndjsonPath)}) ORDER BY ALL) TO ${sqlString(parquetPath)} (FORMAT PARQUET)`
		);
	} finally {
		if (database) await closeDuckDb(database).catch(() => undefined);
		await unlink(ndjsonPath).catch(() => undefined);
	}

	try {
		return { artifact, integrity: await installImmutableFile(parquetPath, finalPath) };
	} finally {
		await unlink(parquetPath).catch(() => undefined);
	}
}

function configuredMaxRows(input: StageBatchInput): number {
	if (input.maxRows !== undefined) return input.maxRows;
	const configured = process.env.BATCH_STAGE_MAX_ROWS;
	if (!configured) return DEFAULT_STAGE_MAX_ROWS;
	const parsed = Number(configured);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`Invalid BATCH_STAGE_MAX_ROWS: ${configured}`);
	}
	return parsed;
}

export async function stageBatch(
	input: StageBatchInput,
	dependencies: { db?: BatchDb } = {}
): Promise<StageBatchResult> {
	if (!Number.isSafeInteger(input.batchId) || input.batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(input.batchId)}`);
	}
	const db = dependencies.db || getDb();
	const paths = batchStoragePaths(input.batchId, input.storageRoot);

	try {
		const [batch] = await db
			.select({ id: ingestBatches.id })
			.from(ingestBatches)
			.where(eq(ingestBatches.id, input.batchId))
			.limit(1);
		if (!batch) throw new Error(`Ingest batch ${input.batchId} does not exist.`);

		const [stagingInput, acceptedMapping, actualSourceIntegrity, acceptedMappingIntegrity] =
			await Promise.all([
				readBatchStagingInput(paths),
				readAcceptedMappingManifest(paths),
				fileIntegrity(paths.source),
				fileIntegrity(paths.acceptedMappingManifest)
			]);
		if (stagingInput.batchId !== input.batchId || acceptedMapping.batchId !== input.batchId) {
			throw new Error('Staging artifacts do not belong to the requested ingest batch.');
		}
		if (
			!sameIntegrity(actualSourceIntegrity, stagingInput.source.integrity) ||
			!sameIntegrity(actualSourceIntegrity, acceptedMapping.sourceIntegrity)
		) {
			throw new Error('Durable batch source integrity does not match the accepted staging input.');
		}

		const canonicalized = await canonicalizeBatchParquet({
			filePath: paths.source,
			acceptedMapping,
			maxRows: configuredMaxRows(input),
			contractLoader: (slices) => loadSavedSliceContracts(slices, db)
		});
		const sliceRows = await db
			.select({
				id: ingestBatchSlices.id,
				indicatorCode: ingestBatchSlices.indicatorCode,
				freq: ingestBatchSlices.freq
			})
			.from(ingestBatchSlices)
			.where(eq(ingestBatchSlices.batchId, input.batchId));
		const sliceIdByKey = new Map(
			sliceRows.map((slice) => [`${slice.indicatorCode}/${slice.freq}`, slice.id])
		);
		for (const slice of canonicalized.slices) {
			if (!sliceIdByKey.has(slice.key)) {
				throw new Error(`Derived slice ${slice.key} has no ingest_batch_slices record.`);
			}
		}

		const summaries: StagedSliceSummary[] = [];
		for (const slice of canonicalized.slices) {
			const sliceId = sliceIdByKey.get(slice.key)!;
			const persisted = slice.valid
				? await writeSliceParquet(paths.batchDir, sliceId, slice)
				: { artifact: null, integrity: null };
			summaries.push({
				sliceId,
				indicatorCode: slice.indicatorCode,
				freq: slice.freq,
				indicatorId: slice.indicatorId,
				artifact: persisted.artifact,
				integrity: persisted.integrity,
				canonicalSchema: canonicalSchema(slice),
				rowCount: slice.rowCount,
				periodStart: slice.periodStart,
				periodEnd: slice.periodEnd,
				refAreas: refAreaSummaries(slice),
				collapsedDimensions: acceptedMapping.collapsedDimensions.filter(
					(dimension) => dimension.sliceKey === slice.key
				),
				validation: {
					valid: slice.valid,
					errorCount: slice.diagnostics.filter((item) => item.severity === 'error').length,
					warningCount: slice.diagnostics.filter((item) => item.severity === 'warning').length,
					diagnostics: slice.diagnostics
				}
			});
		}

		const manifest = createStagedBatchManifest({
			batchId: input.batchId,
			stagedAt: stagingInput.createdAt,
			sourceIntegrity: actualSourceIntegrity,
			acceptedMappingIntegrity,
			validation: {
				valid: canonicalized.valid,
				errorCount: canonicalized.diagnostics.filter((item) => item.severity === 'error').length,
				warningCount: canonicalized.diagnostics.filter((item) => item.severity === 'warning')
					.length,
				diagnostics: canonicalized.diagnostics
			},
			slices: summaries
		});
		await persistStagedBatchManifest(paths, manifest);

		const now = new Date().toISOString();
		const status = canonicalized.valid ? 'staged' : 'failed';
		await db.transaction(async (tx) => {
			for (const summary of summaries) {
				await tx
					.update(ingestBatchSlices)
					.set({
						indicatorId: summary.indicatorId,
						rowCount: summary.rowCount,
						periodStart: summary.periodStart,
						periodEnd: summary.periodEnd,
						status: summary.validation.valid ? 'staged' : 'failed',
						updatedAt: now
					})
					.where(
						and(
							eq(ingestBatchSlices.batchId, input.batchId),
							eq(ingestBatchSlices.id, summary.sliceId)
						)
					);
			}
			await tx
				.update(ingestBatches)
				.set({ status, rowCount: canonicalized.rowCount, updatedAt: now })
				.where(eq(ingestBatches.id, input.batchId));
		});

		return { batchId: input.batchId, status, manifest, manifestPath: paths.stagedManifest };
	} catch (error) {
		await db
			.update(ingestBatches)
			.set({ status: 'failed', updatedAt: new Date().toISOString() })
			.where(eq(ingestBatches.id, input.batchId))
			.catch(() => undefined);
		throw error;
	}
}
