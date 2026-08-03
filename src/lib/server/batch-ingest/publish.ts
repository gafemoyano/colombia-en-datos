import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	dataReleases,
	indicatorDataSources,
	ingestBatches,
	ingestBatchSlices
} from '$lib/db/schema';
import {
	CANONICAL_SCHEMA_VERSION,
	getCanonicalDbPath,
	prepareCanonicalGeneration,
	promoteCanonicalGeneration
} from '../duckdb';
import { withCanonicalWriterLease } from '../canonical-writer-lease';
import {
	batchStoragePaths,
	readStagedBatchManifest,
	type BatchSourceIntegrity,
	type StagedBatchManifest,
	type StagedSliceSummary
} from './storage';
import {
	advancePublishJournal,
	beginPublishJournal,
	readPublishJournal,
	resolvePublishCandidatePath,
	resolvePublishJournalPath,
	type PublishJournal
} from './publish-journal';
import { CANONICAL_REQUIRED_FIELDS } from './types';

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

interface SliceStats {
	row_count: unknown;
	period_start: string | null;
	period_end: string | null;
	invalid_pair_count: unknown;
}

export interface VerifiedPublishSlice {
	sliceId: number;
	indicatorId: number;
	indicatorCode: string;
	freq: string;
	artifactPath: string;
	integrity: BatchSourceIntegrity;
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
	refAreas: StagedSliceSummary['refAreas'];
	columns: string[];
}

export interface BatchPublishCandidate {
	batchId: number;
	manifest: StagedBatchManifest;
	manifestPath: string;
	manifestIntegrity: BatchSourceIntegrity;
	canonicalPath: string;
	candidatePath: string;
	previousPath: string;
	candidateIntegrity: BatchSourceIntegrity;
	slices: VerifiedPublishSlice[];
}

export interface BuildBatchPublishCandidateInput {
	batchId: number;
	storageRoot?: string;
	canonicalPath?: string;
	candidatePath?: string;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	return Number(value || 0);
}

async function loadDuckDB(): Promise<DuckDbModule> {
	const imported = await import('duckdb');
	return ((imported as { default?: DuckDbModule }).default || imported) as DuckDbModule;
}

async function openDuckDb(path: string): Promise<DuckDbDatabase> {
	const duckdb = await loadDuckDB();
	return new Promise((resolveOpen, reject) => {
		let database: DuckDbDatabase;
		database = new duckdb.Database(path, (error: Error | null) => {
			if (error) reject(error);
			else resolveOpen(database);
		});
	});
}

function runQuery<T>(database: DuckDbDatabase, query: string, ...params: unknown[]): Promise<T[]> {
	return new Promise((resolveQuery, reject) => {
		database.prepare(query).all(...params, (error: Error | null, rows: unknown[]) => {
			if (error) reject(error);
			else resolveQuery(rows as T[]);
		});
	});
}

function closeDuckDb(database: DuckDbDatabase): Promise<void> {
	return new Promise((resolveClose, reject) => {
		database.close((error) => {
			if (error) reject(error);
			else resolveClose();
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

function artifactPath(batchDir: string, artifact: string): string {
	const path = resolve(batchDir, artifact);
	const relativePath = relative(batchDir, path);
	if (relativePath.startsWith('..') || relativePath === '') {
		throw new Error(`Staged slice artifact escapes its batch directory: ${artifact}`);
	}
	return path;
}

async function verifyRelationalPublishState(params: {
	db: BatchDb;
	batchId: number;
	manifest: StagedBatchManifest;
}): Promise<Map<number, { indicatorId: number }>> {
	const [batch] = await params.db
		.select({ id: ingestBatches.id, status: ingestBatches.status })
		.from(ingestBatches)
		.where(eq(ingestBatches.id, params.batchId))
		.limit(1);
	if (!batch) throw new Error(`Ingest batch ${params.batchId} does not exist.`);
	if (!['staged', 'publishing', 'published'].includes(batch.status)) {
		throw new Error(`Ingest batch ${params.batchId} is not staged for publishing.`);
	}

	const rows = await params.db
		.select({
			id: ingestBatchSlices.id,
			indicatorId: ingestBatchSlices.indicatorId,
			indicatorCode: ingestBatchSlices.indicatorCode,
			freq: ingestBatchSlices.freq,
			status: ingestBatchSlices.status
		})
		.from(ingestBatchSlices)
		.where(eq(ingestBatchSlices.batchId, params.batchId));
	if (rows.length !== params.manifest.slices.length) {
		throw new Error('Staged manifest slices do not match the relational batch slices.');
	}

	const byId = new Map(rows.map((row) => [row.id, row]));
	const verified = new Map<number, { indicatorId: number }>();
	for (const slice of params.manifest.slices) {
		const row = byId.get(slice.sliceId);
		if (
			!row ||
			row.indicatorId === null ||
			row.indicatorId !== slice.indicatorId ||
			row.indicatorCode !== slice.indicatorCode ||
			row.freq !== slice.freq ||
			!['staged', 'publishing', 'published'].includes(row.status)
		) {
			throw new Error(
				`Staged manifest slice ${slice.sliceId} does not match its relational lineage record.`
			);
		}
		verified.set(slice.sliceId, { indicatorId: row.indicatorId });
	}
	return verified;
}

async function verifyStagedSlice(params: {
	database: DuckDbDatabase;
	batchDir: string;
	slice: StagedSliceSummary;
	indicatorId: number;
}): Promise<VerifiedPublishSlice> {
	const { slice } = params;
	const sliceKey = `${slice.indicatorCode}/${slice.freq}`;
	if (!slice.validation.valid || !slice.artifact || !slice.integrity) {
		throw new Error(`Staged slice ${slice.sliceId} is not valid and publishable.`);
	}
	if (slice.rowCount < 1) {
		throw new Error(`Staged slice ${slice.sliceId} contains no observations.`);
	}
	const path = artifactPath(params.batchDir, slice.artifact);
	const integrity = await fileIntegrity(path);
	if (!sameIntegrity(integrity, slice.integrity)) {
		throw new Error(`Staged slice checksum mismatch for ${sliceKey}.`);
	}

	const described = await runQuery<{ column_name: string; column_type: string }>(
		params.database,
		`DESCRIBE SELECT * FROM read_parquet(${sqlString(path)})`
	);
	const columns = described.map((column) => column.column_name);
	const manifestColumns = slice.canonicalSchema.map((column) => column.name);
	if (
		columns.length !== manifestColumns.length ||
		columns.some((column, index) => column !== manifestColumns[index])
	) {
		throw new Error(`Staged slice schema mismatch for ${sliceKey}.`);
	}
	for (const required of CANONICAL_REQUIRED_FIELDS) {
		if (!columns.includes(required)) {
			throw new Error(`Staged slice ${slice.sliceId} is missing canonical column ${required}.`);
		}
	}

	const [stats] = await runQuery<SliceStats>(
		params.database,
		`SELECT
			COUNT(*) AS row_count,
			MIN(time_period) AS period_start,
			MAX(time_period) AS period_end,
			COUNT(*) FILTER (
				WHERE indicator_code IS NULL OR freq IS NULL OR indicator_code <> ? OR freq <> ?
			) AS invalid_pair_count
		 FROM read_parquet(${sqlString(path)})`,
		slice.indicatorCode,
		slice.freq
	);
	if (
		toNumber(stats?.row_count) !== slice.rowCount ||
		(stats?.period_start ?? null) !== slice.periodStart ||
		(stats?.period_end ?? null) !== slice.periodEnd ||
		toNumber(stats?.invalid_pair_count) !== 0
	) {
		throw new Error(`Staged slice contents do not match its manifest for ${sliceKey}.`);
	}
	const refAreas = await runQuery<{
		ref_area: string;
		row_count: unknown;
		period_start: string | null;
		period_end: string | null;
	}>(
		params.database,
		`SELECT ref_area, COUNT(*) AS row_count, MIN(time_period) AS period_start,
			MAX(time_period) AS period_end
		 FROM read_parquet(${sqlString(path)}) GROUP BY ref_area ORDER BY ref_area`
	);
	const expectedRefAreas = [...slice.refAreas].sort((left, right) =>
		left.refArea.localeCompare(right.refArea)
	);
	if (
		refAreas.length !== expectedRefAreas.length ||
		refAreas.some((summary, index) => {
			const expected = expectedRefAreas[index];
			return (
				summary.ref_area !== expected.refArea ||
				toNumber(summary.row_count) !== expected.rowCount ||
				(summary.period_start ?? null) !== expected.periodStart ||
				(summary.period_end ?? null) !== expected.periodEnd
			);
		})
	) {
		throw new Error(`Staged reference-area summary mismatch for ${sliceKey}.`);
	}

	return {
		sliceId: slice.sliceId,
		indicatorId: params.indicatorId,
		indicatorCode: slice.indicatorCode,
		freq: slice.freq,
		artifactPath: path,
		integrity,
		rowCount: slice.rowCount,
		periodStart: slice.periodStart,
		periodEnd: slice.periodEnd,
		refAreas: slice.refAreas,
		columns
	};
}

async function validateCandidate(database: DuckDbDatabase, slices: VerifiedPublishSlice[]) {
	const [metadata] = await runQuery<{ value: string }>(
		database,
		"SELECT value FROM _meta WHERE key = 'schema_version'"
	);
	if (Number(metadata?.value) !== CANONICAL_SCHEMA_VERSION) {
		throw new Error('Canonical DuckDB candidate has an unsupported schema version.');
	}
	for (const slice of slices) {
		const [stats] = await runQuery<SliceStats>(
			database,
			`SELECT COUNT(*) AS row_count, MIN(time_period) AS period_start,
				MAX(time_period) AS period_end, 0 AS invalid_pair_count
			 FROM observations WHERE indicator_code = ? AND freq = ?`,
			slice.indicatorCode,
			slice.freq
		);
		if (
			toNumber(stats?.row_count) !== slice.rowCount ||
			(stats?.period_start ?? null) !== slice.periodStart ||
			(stats?.period_end ?? null) !== slice.periodEnd
		) {
			throw new Error(
				`Canonical candidate validation failed for ${slice.indicatorCode}/${slice.freq}.`
			);
		}
	}
}

interface PublishAuthority {
	manifest: StagedBatchManifest;
	manifestPath: string;
	manifestIntegrity: BatchSourceIntegrity;
	slices: VerifiedPublishSlice[];
}

async function loadPublishAuthority(params: {
	batchId: number;
	storageRoot?: string;
	db: BatchDb;
}): Promise<PublishAuthority> {
	const paths = batchStoragePaths(params.batchId, params.storageRoot);
	const manifest = await readStagedBatchManifest(paths);
	if (
		manifest.batchId !== params.batchId ||
		!manifest.validation.valid ||
		manifest.slices.length === 0 ||
		manifest.totals.validSliceCount !== manifest.slices.length
	) {
		throw new Error(`Staged manifest for batch ${params.batchId} is not publishable.`);
	}
	const [manifestIntegrity, relationalSlices] = await Promise.all([
		fileIntegrity(paths.stagedManifest),
		verifyRelationalPublishState({ db: params.db, batchId: params.batchId, manifest })
	]);
	const database = await openDuckDb(':memory:');
	try {
		const slices: VerifiedPublishSlice[] = [];
		for (const slice of manifest.slices) {
			slices.push(
				await verifyStagedSlice({
					database,
					batchDir: paths.batchDir,
					slice,
					indicatorId: relationalSlices.get(slice.sliceId)!.indicatorId
				})
			);
		}
		return { manifest, manifestPath: paths.stagedManifest, manifestIntegrity, slices };
	} finally {
		await closeDuckDb(database);
	}
}

export async function buildBatchPublishCandidate(
	input: BuildBatchPublishCandidateInput,
	dependencies: { db?: BatchDb } = {}
): Promise<BatchPublishCandidate> {
	if (!Number.isSafeInteger(input.batchId) || input.batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(input.batchId)}`);
	}
	const db = dependencies.db || getDb();
	const authority = await loadPublishAuthority({
		batchId: input.batchId,
		storageRoot: input.storageRoot,
		db
	});
	const canonicalPath = resolve(input.canonicalPath || getCanonicalDbPath());
	const candidatePath = resolve(
		input.candidatePath || resolvePublishCandidatePath(input.batchId, canonicalPath)
	);
	const generation = await prepareCanonicalGeneration(candidatePath);
	await copyFile(canonicalPath, candidatePath);

	let database: DuckDbDatabase | null = null;
	try {
		database = await openDuckDb(candidatePath);
		await runQuery(database, 'BEGIN TRANSACTION');
		try {
			for (const slice of authority.slices) {
				await runQuery(
					database,
					'DELETE FROM observations WHERE indicator_code = ? AND freq = ?',
					slice.indicatorCode,
					slice.freq
				);
				const projection = slice.columns.map(quoteIdentifier).join(', ');
				await runQuery(
					database,
					`INSERT INTO observations (${projection}) SELECT ${projection}
					 FROM read_parquet(${sqlString(slice.artifactPath)})`
				);
			}
			await validateCandidate(database, authority.slices);
			await runQuery(database, 'COMMIT');
			await runQuery(database, 'CHECKPOINT');
		} catch (error) {
			await runQuery(database, 'ROLLBACK').catch(() => undefined);
			throw error;
		}
		await closeDuckDb(database);
		database = null;
		const candidateIntegrity = await fileIntegrity(candidatePath);
		return {
			batchId: input.batchId,
			manifest: authority.manifest,
			manifestPath: authority.manifestPath,
			manifestIntegrity: authority.manifestIntegrity,
			canonicalPath: generation.canonicalPath,
			candidatePath: generation.candidatePath,
			previousPath: generation.previousPath,
			candidateIntegrity,
			slices: authority.slices
		};
	} catch (error) {
		if (database) await closeDuckDb(database).catch(() => undefined);
		throw error;
	}
}

export interface PublishedBatchSlice {
	sliceId: number;
	indicatorCode: string;
	freq: string;
	releaseId: number;
	rowCount: number;
}

export interface PublishBatchResult {
	batchId: number;
	status: 'published';
	publishedAt: string;
	slices: PublishedBatchSlice[];
}

export interface PublishBatchInput {
	batchId: number;
	storageRoot?: string;
	canonicalPath?: string;
	leasePath?: string;
	now?: () => Date;
}

type CommitLineage = (params: {
	db: BatchDb;
	batchId: number;
	authority: PublishAuthority;
	now: Date;
}) => Promise<PublishBatchResult>;

interface PublishBatchDependencies {
	db?: BatchDb;
	commitLineage?: CommitLineage;
}

function yearFromPeriod(period: string | null): number | null {
	if (!period || !/^\d{4}/.test(period)) return null;
	return Number(period.slice(0, 4));
}

export const commitBatchPublishLineage: CommitLineage = async ({ db, batchId, authority, now }) => {
	const publishedAt = now.toISOString();
	return db.transaction(async (tx) => {
		const [batch] = await tx
			.select({
				id: ingestBatches.id,
				originalName: ingestBatches.originalName,
				checksum: ingestBatches.checksum,
				sourceFormat: ingestBatches.sourceFormat,
				publishedAt: ingestBatches.publishedAt
			})
			.from(ingestBatches)
			.where(eq(ingestBatches.id, batchId))
			.limit(1);
		if (!batch) throw new Error(`Ingest batch ${batchId} does not exist.`);

		const relationalSlices = await tx
			.select({
				id: ingestBatchSlices.id,
				indicatorId: ingestBatchSlices.indicatorId,
				indicatorCode: ingestBatchSlices.indicatorCode,
				freq: ingestBatchSlices.freq,
				releaseId: ingestBatchSlices.releaseId
			})
			.from(ingestBatchSlices)
			.where(eq(ingestBatchSlices.batchId, batchId));
		const sliceById = new Map(relationalSlices.map((slice) => [slice.id, slice]));
		const publishedSlices: PublishedBatchSlice[] = [];

		for (const slice of authority.slices) {
			const relational = sliceById.get(slice.sliceId);
			if (
				!relational ||
				relational.indicatorId !== slice.indicatorId ||
				relational.indicatorCode !== slice.indicatorCode ||
				relational.freq !== slice.freq
			) {
				throw new Error(`Relational lineage changed for staged slice ${slice.sliceId}.`);
			}

			let releaseId = relational.releaseId;
			if (releaseId !== null) {
				const [existingRelease] = await tx
					.select({
						id: dataReleases.id,
						indicatorId: dataReleases.indicatorId,
						ingestBatchId: dataReleases.ingestBatchId
					})
					.from(dataReleases)
					.where(eq(dataReleases.id, releaseId))
					.limit(1);
				if (
					!existingRelease ||
					existingRelease.indicatorId !== slice.indicatorId ||
					existingRelease.ingestBatchId !== batchId
				) {
					throw new Error(
						`Existing release ${releaseId} does not belong to staged slice ${slice.sliceId}.`
					);
				}
			} else {
				const [release] = await tx
					.insert(dataReleases)
					.values({
						indicatorId: slice.indicatorId,
						ingestBatchId: batchId,
						periodStart: slice.periodStart,
						periodEnd: slice.periodEnd,
						rowCount: slice.rowCount,
						sourceFormat: batch.sourceFormat || 'parquet',
						sourceName: batch.originalName,
						status: 'published',
						checksum: batch.checksum
					})
					.returning({ id: dataReleases.id });
				releaseId = release.id;
			}

			await tx
				.delete(indicatorDataSources)
				.where(
					and(
						eq(indicatorDataSources.indicatorId, slice.indicatorId),
						eq(indicatorDataSources.freq, slice.freq)
					)
				);
			if (slice.refAreas.length > 0) {
				await tx.insert(indicatorDataSources).values(
					slice.refAreas.map((summary) => ({
						indicatorId: slice.indicatorId,
						refArea: summary.refArea,
						freq: slice.freq,
						yearMin: yearFromPeriod(summary.periodStart),
						yearMax: yearFromPeriod(summary.periodEnd),
						rowCount: summary.rowCount,
						releaseId
					}))
				);
			}
			await tx
				.update(ingestBatchSlices)
				.set({ releaseId, status: 'published', updatedAt: publishedAt })
				.where(
					and(eq(ingestBatchSlices.batchId, batchId), eq(ingestBatchSlices.id, slice.sliceId))
				);
			publishedSlices.push({
				sliceId: slice.sliceId,
				indicatorCode: slice.indicatorCode,
				freq: slice.freq,
				releaseId,
				rowCount: slice.rowCount
			});
		}

		const finalPublishedAt = batch.publishedAt || publishedAt;
		await tx
			.update(ingestBatches)
			.set({ status: 'published', publishedAt: finalPublishedAt, updatedAt: publishedAt })
			.where(eq(ingestBatches.id, batchId));
		return {
			batchId,
			status: 'published' as const,
			publishedAt: finalPublishedAt,
			slices: publishedSlices.sort((left, right) => left.sliceId - right.sliceId)
		};
	});
};

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

async function markBatchPublishing(db: BatchDb, batchId: number, now: Date): Promise<void> {
	const at = now.toISOString();
	await db.transaction(async (tx) => {
		const [batch] = await tx
			.select({ status: ingestBatches.status })
			.from(ingestBatches)
			.where(eq(ingestBatches.id, batchId))
			.limit(1);
		if (!batch) throw new Error(`Ingest batch ${batchId} does not exist.`);
		if (batch.status === 'published') return;
		await tx
			.update(ingestBatchSlices)
			.set({ status: 'publishing', updatedAt: at })
			.where(eq(ingestBatchSlices.batchId, batchId));
		await tx
			.update(ingestBatches)
			.set({ status: 'publishing', updatedAt: at })
			.where(eq(ingestBatches.id, batchId));
	});
}

async function readPublishedResult(db: BatchDb, batchId: number): Promise<PublishBatchResult> {
	const [batch] = await db
		.select({ status: ingestBatches.status, publishedAt: ingestBatches.publishedAt })
		.from(ingestBatches)
		.where(eq(ingestBatches.id, batchId))
		.limit(1);
	if (!batch || batch.status !== 'published' || !batch.publishedAt) {
		throw new Error(`Ingest batch ${batchId} has no finalized publish result.`);
	}
	const slices = await db
		.select({
			sliceId: ingestBatchSlices.id,
			indicatorCode: ingestBatchSlices.indicatorCode,
			freq: ingestBatchSlices.freq,
			releaseId: ingestBatchSlices.releaseId,
			rowCount: ingestBatchSlices.rowCount
		})
		.from(ingestBatchSlices)
		.where(eq(ingestBatchSlices.batchId, batchId));
	return {
		batchId,
		status: 'published',
		publishedAt: batch.publishedAt,
		slices: slices
			.map((slice) => {
				if (slice.releaseId === null) {
					throw new Error(`Published slice ${slice.sliceId} has no release id.`);
				}
				return {
					sliceId: slice.sliceId,
					indicatorCode: slice.indicatorCode,
					freq: slice.freq,
					releaseId: slice.releaseId,
					rowCount: slice.rowCount || 0
				};
			})
			.sort((left, right) => left.sliceId - right.sliceId)
	};
}

async function advancePromotedJournal(
	journalPath: string,
	journal: PublishJournal
): Promise<PublishJournal> {
	let updated = journal;
	if (updated.checkpoint === 'candidate-built') {
		updated = await advancePublishJournal({ journalPath, checkpoint: 'backup-created' });
	}
	if (updated.checkpoint === 'backup-created') {
		updated = await advancePublishJournal({ journalPath, checkpoint: 'canonical-promoted' });
	}
	return updated;
}

export async function publishBatch(
	input: PublishBatchInput,
	dependencies: PublishBatchDependencies = {}
): Promise<PublishBatchResult> {
	if (!Number.isSafeInteger(input.batchId) || input.batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(input.batchId)}`);
	}
	const db = dependencies.db || getDb();
	const now = input.now || (() => new Date());
	const canonicalPath = resolve(input.canonicalPath || getCanonicalDbPath());
	const candidatePath = resolvePublishCandidatePath(input.batchId, canonicalPath);
	const previousPath = `${canonicalPath}.previous`;
	const journalPath = resolvePublishJournalPath(input.batchId, input.storageRoot);

	return withCanonicalWriterLease({
		operation: 'batch-publish',
		operationId: String(input.batchId),
		leasePath: input.leasePath,
		run: async () => {
			let authority = await loadPublishAuthority({
				batchId: input.batchId,
				storageRoot: input.storageRoot,
				db
			});
			let journal = await beginPublishJournal({
				batchId: input.batchId,
				journalPath,
				stagedManifestPath: authority.manifestPath,
				stagedManifestIntegrity: authority.manifestIntegrity,
				canonicalPath,
				candidatePath,
				previousPath,
				now: now()
			});
			if (journal.checkpoint === 'manifest-finalized') {
				return readPublishedResult(db, input.batchId);
			}
			await markBatchPublishing(db, input.batchId, now());

			if (journal.checkpoint === 'publishing') {
				const candidate = await buildBatchPublishCandidate(
					{
						batchId: input.batchId,
						storageRoot: input.storageRoot,
						canonicalPath,
						candidatePath
					},
					{ db }
				);
				authority = {
					manifest: candidate.manifest,
					manifestPath: candidate.manifestPath,
					manifestIntegrity: candidate.manifestIntegrity,
					slices: candidate.slices
				};
				journal = await advancePublishJournal({
					journalPath,
					checkpoint: 'candidate-built',
					candidateIntegrity: candidate.candidateIntegrity,
					now: now()
				});
			}

			if (journal.checkpoint === 'candidate-built' || journal.checkpoint === 'backup-created') {
				const [candidateExists, canonicalExists, previousExists] = await Promise.all([
					pathExists(candidatePath),
					pathExists(canonicalPath),
					pathExists(previousPath)
				]);
				if (candidateExists) {
					if (!journal.generation.candidateIntegrity) {
						throw new Error('Publish journal is missing candidate integrity.');
					}
					const integrity = await fileIntegrity(candidatePath);
					if (!sameIntegrity(integrity, journal.generation.candidateIntegrity)) {
						throw new Error('Canonical publish candidate checksum mismatch.');
					}
					if (journal.checkpoint === 'candidate-built') {
						journal = await advancePublishJournal({
							journalPath,
							checkpoint: 'backup-created',
							now: now()
						});
					}
					await promoteCanonicalGeneration(candidatePath);
					journal = await advancePublishJournal({
						journalPath,
						checkpoint: 'canonical-promoted',
						now: now()
					});
				} else if (canonicalExists && previousExists) {
					journal = await advancePromotedJournal(journalPath, journal);
				} else {
					throw new Error('Publish generation state requires manual recovery.');
				}
			}

			let result: PublishBatchResult;
			if (journal.checkpoint === 'canonical-promoted') {
				result = await (dependencies.commitLineage || commitBatchPublishLineage)({
					db,
					batchId: input.batchId,
					authority,
					now: now()
				});
				journal = await advancePublishJournal({
					journalPath,
					checkpoint: 'lineage-committed',
					now: now()
				});
			} else {
				result = await readPublishedResult(db, input.batchId);
			}
			if (journal.checkpoint === 'lineage-committed') {
				await advancePublishJournal({
					journalPath,
					checkpoint: 'manifest-finalized',
					now: now()
				});
			}
			return result;
		}
	});
}
