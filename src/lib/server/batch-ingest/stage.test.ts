import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import { ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import { stageBatch } from './stage';
import {
	batchStoragePaths,
	createAcceptedMappingManifest,
	createBatchStagingInput,
	persistAcceptedMappingArtifacts,
	persistBatchSource,
	readStagedBatchManifest,
	sourceIntegrity,
	type AcceptedBatchColumnMapping,
	type CollapsedFixedDimension
} from './storage';

interface DuckDbStatement {
	all(callback: (error: Error | null, rows: unknown[]) => void): void;
}

interface DuckDbDatabase {
	prepare(query: string): DuckDbStatement;
	close(callback?: (error: Error | null) => void): void;
}

interface DuckDbModule {
	Database: new (path: string, callback?: (error: Error | null) => void) => DuckDbDatabase;
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

function runQuery<T>(database: DuckDbDatabase, query: string): Promise<T[]> {
	return new Promise((resolve, reject) => {
		database.prepare(query).all((error, rows) => {
			if (error) reject(error);
			else resolve(rows as T[]);
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

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

async function writeParquetFixture(filePath: string, selectSql: string): Promise<void> {
	const database = await createInMemoryDuckDb();
	try {
		await runQuery(database, `COPY (${selectSql}) TO ${sqlString(filePath)} (FORMAT PARQUET)`);
	} finally {
		await closeDuckDb(database);
	}
}

async function readParquet<T>(filePath: string, projection = '*'): Promise<T[]> {
	const database = await createInMemoryDuckDb();
	try {
		return await runQuery<T>(
			database,
			`SELECT ${projection} FROM read_parquet(${sqlString(filePath)}) ORDER BY ALL`
		);
	} finally {
		await closeDuckDb(database);
	}
}

async function createTestDb(directory: string) {
	const client = createClient({ url: `file:${join(directory, 'db.sqlite')}` });
	await client.batch([
		`CREATE TABLE indicators (id integer PRIMARY KEY, code text NOT NULL UNIQUE)`,
		`CREATE TABLE indicator_frequencies (
			id integer PRIMARY KEY AUTOINCREMENT,
			indicator_id integer NOT NULL,
			freq text NOT NULL
		)`,
		`CREATE TABLE indicator_dimensions (
			id integer PRIMARY KEY AUTOINCREMENT,
			indicator_id integer NOT NULL,
			freq text NOT NULL,
			dimension_code text NOT NULL
		)`,
		`CREATE TABLE dimension_values (
			id integer PRIMARY KEY AUTOINCREMENT,
			dimension_code text NOT NULL,
			code text NOT NULL
		)`,
		`CREATE TABLE ingest_batches (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			data_source_id integer,
			original_name text,
			checksum text,
			source_format text,
			row_count integer,
			status text DEFAULT 'uploaded' NOT NULL,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			published_at text
		)`,
		`CREATE TABLE ingest_batch_slices (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			batch_id integer NOT NULL,
			indicator_code text NOT NULL,
			freq text NOT NULL,
			indicator_id integer,
			row_count integer,
			period_start text,
			period_end text,
			status text DEFAULT 'proposed' NOT NULL,
			release_id integer,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE UNIQUE INDEX ingest_batch_slices_unique ON ingest_batch_slices (batch_id, indicator_code, freq)`,
		`CREATE TABLE observations (marker text)`,
		`CREATE TABLE data_releases (marker text)`,
		`CREATE TABLE indicator_data_sources (marker text)`,
		`INSERT INTO observations VALUES ('untouched')`,
		`INSERT INTO data_releases VALUES ('untouched')`,
		`INSERT INTO indicator_data_sources VALUES ('untouched')`
	]);
	return { db: drizzle(client, { schema }), client };
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

function mapping(
	sourceColumn: string,
	canonicalField: AcceptedBatchColumnMapping['canonicalField'],
	transforms: AcceptedBatchColumnMapping['transforms'] = ['identity']
): AcceptedBatchColumnMapping {
	return { sourceColumn, canonicalField, transforms };
}

async function prepareBatch(params: {
	db: TestDb;
	storageRoot: string;
	sourcePath: string;
	mappings: AcceptedBatchColumnMapping[];
	collapsedDimensions?: CollapsedFixedDimension[];
	slices: Array<{ indicatorCode: string; freq: string }>;
}) {
	const source = await readFile(params.sourcePath);
	const integrity = sourceIntegrity(source);
	const [batch] = await params.db
		.insert(ingestBatches)
		.values({
			originalName: 'fixture.parquet',
			checksum: integrity.digest,
			sourceFormat: 'parquet',
			status: 'analyzed'
		})
		.returning({ id: ingestBatches.id });
	await params.db.insert(ingestBatchSlices).values(
		params.slices.map((slice) => ({
			batchId: batch.id,
			indicatorCode: slice.indicatorCode,
			freq: slice.freq,
			status: 'proposed' as const
		}))
	);
	const paths = batchStoragePaths(batch.id, params.storageRoot);
	await persistBatchSource(paths, source);
	const accepted = createAcceptedMappingManifest({
		batchId: batch.id,
		acceptedAt: '2026-07-13T10:00:00.000Z',
		sourceIntegrity: integrity,
		mappings: params.mappings,
		collapsedDimensions: params.collapsedDimensions || []
	});
	await persistAcceptedMappingArtifacts({
		paths,
		manifest: accepted,
		stagingInput: createBatchStagingInput(accepted, '2026-07-13T10:01:00.000Z')
	});
	return { batchId: batch.id, paths };
}

async function expectProductionTablesUntouched(client: ReturnType<typeof createClient>) {
	for (const table of ['observations', 'data_releases', 'indicator_data_sources']) {
		const result = await client.execute(`SELECT marker FROM ${table}`);
		expect(result.rows).toEqual([{ marker: 'untouched' }]);
	}
}

describe('stageBatch', () => {
	it('stages valid source-shaped slices independently and persists failed-slice diagnostics', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-stage-'));
		try {
			const { db, client } = await createTestDb(directory);
			await client.batch([
				`INSERT INTO indicators (id, code) VALUES (101, 'GOOD'), (102, 'BAD')`,
				`INSERT INTO indicator_frequencies (indicator_id, freq) VALUES (101, 'M'), (102, 'M')`,
				`INSERT INTO indicator_dimensions (indicator_id, freq, dimension_code) VALUES (102, 'M', 'SEX')`,
				`INSERT INTO dimension_values (dimension_code, code) VALUES ('SEX', 'T'), ('SEX', 'F'), ('SEX', 'M')`
			]);
			const fixturePath = join(directory, 'source-shaped.parquet');
			await writeParquetFixture(
				fixturePath,
				`SELECT * FROM (VALUES
					('GOOD', 'm', 'co', '1-2024', '10.5', 'NAT', 'T'),
					('GOOD', 'm', 'co', '2-2024', '11.5', 'NAT', 'T'),
					('BAD', 'm', 'co', '1-2024', '7.0', 'NAT', 'X'),
					('BAD', 'm', 'co', '1-2024', '8.0', 'NAT', 'X')
				) AS t(INDICADOR, FREQ, REF_AREA, PERIODO, VALOR, GEO_LEVEL, SEX)`
			);
			const mappings = [
				mapping('INDICADOR', 'indicator_code', ['trim']),
				mapping('FREQ', 'freq', ['trim', 'uppercase']),
				mapping('REF_AREA', 'ref_area', ['trim', 'uppercase']),
				mapping('PERIODO', 'time_period', ['trim', 'geih-month-year-to-iso-month']),
				mapping('VALOR', 'obs_value', ['numeric']),
				mapping('GEO_LEVEL', 'geo_level', ['trim', 'uppercase']),
				mapping('SEX', 'sex', ['trim', 'uppercase'])
			];
			const collapsedDimensions: CollapsedFixedDimension[] = [
				...['GOOD/M', 'BAD/M'].map(
					(sliceKey): CollapsedFixedDimension => ({
						sliceKey,
						sourceColumn: 'GEO_LEVEL',
						canonicalField: 'geo_level',
						dimensionCode: 'GEO_LEVEL',
						value: 'NAT'
					})
				),
				{
					sliceKey: 'GOOD/M',
					sourceColumn: 'SEX',
					canonicalField: 'sex',
					dimensionCode: 'SEX',
					value: 'T'
				}
			];
			const storageRoot = join(directory, 'data', 'ingest', 'batches');
			const prepared = await prepareBatch({
				db,
				storageRoot,
				sourcePath: fixturePath,
				mappings,
				collapsedDimensions,
				slices: [
					{ indicatorCode: 'GOOD', freq: 'M' },
					{ indicatorCode: 'BAD', freq: 'M' }
				]
			});

			const result = await stageBatch(
				{ batchId: prepared.batchId, storageRoot, maxRows: 100 },
				{ db }
			);

			expect(result.status).toBe('failed');
			const manifest = await readStagedBatchManifest(prepared.paths);
			expect(manifest).toMatchObject({
				schemaVersion: 1,
				batchId: prepared.batchId,
				validation: { valid: false },
				totals: { sliceCount: 2, rowCount: 4, validSliceCount: 1, failedSliceCount: 1 }
			});
			const good = manifest.slices.find((slice) => slice.indicatorCode === 'GOOD')!;
			const bad = manifest.slices.find((slice) => slice.indicatorCode === 'BAD')!;
			expect(good).toMatchObject({
				indicatorId: 101,
				artifact: expect.stringMatching(/^staged\/slices\/\d+\.parquet$/),
				rowCount: 2,
				periodStart: '2024-01',
				periodEnd: '2024-02',
				refAreas: [{ refArea: 'CO', rowCount: 2, periodStart: '2024-01', periodEnd: '2024-02' }],
				validation: { valid: true }
			});
			expect(good.collapsedDimensions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ dimensionCode: 'GEO_LEVEL', value: 'NAT' }),
					expect.objectContaining({ dimensionCode: 'SEX', value: 'T' })
				])
			);
			expect(good.canonicalSchema.map((column) => column.name)).toEqual([
				'indicator_code',
				'freq',
				'ref_area',
				'time_period',
				'obs_value'
			]);
			expect(good.integrity).toMatchObject({ algorithm: 'sha256', byteLength: expect.any(Number) });
			expect(bad.artifact).toBeNull();
			expect(bad.integrity).toBeNull();
			expect(bad.validation.diagnostics.map((item) => item.code)).toEqual(
				expect.arrayContaining(['dimension_value_not_allowed', 'duplicate_canonical_keys'])
			);

			const stagedRows = await readParquet<Record<string, unknown>>(
				join(prepared.paths.batchDir, good.artifact!),
				'indicator_code, freq, ref_area, time_period, obs_value'
			);
			expect(stagedRows).toEqual([
				{
					indicator_code: 'GOOD',
					freq: 'M',
					ref_area: 'CO',
					time_period: '2024-01',
					obs_value: 10.5
				},
				{
					indicator_code: 'GOOD',
					freq: 'M',
					ref_area: 'CO',
					time_period: '2024-02',
					obs_value: 11.5
				}
			]);
			const slices = await db.select().from(ingestBatchSlices);
			expect(slices).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ indicatorCode: 'GOOD', indicatorId: 101, status: 'staged' }),
					expect.objectContaining({ indicatorCode: 'BAD', indicatorId: 102, status: 'failed' })
				])
			);
			expect((await db.select().from(ingestBatches))[0].status).toBe('failed');
			await expectProductionTablesUntouched(client);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('stages canonical-shaped input reproducibly and enforces the in-memory row guard', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-canonical-stage-'));
		try {
			const { db, client } = await createTestDb(directory);
			await client.batch([
				`INSERT INTO indicators (id, code) VALUES (201, 'EMP')`,
				`INSERT INTO indicator_frequencies (indicator_id, freq) VALUES (201, 'A')`,
				`INSERT INTO indicator_dimensions (indicator_id, freq, dimension_code) VALUES (201, 'A', 'SEX')`
			]);
			const fixturePath = join(directory, 'canonical.parquet');
			await writeParquetFixture(
				fixturePath,
				`SELECT * FROM (VALUES
					('EMP', 'A', 'CO', '2023', 1.0, 'T'),
					('EMP', 'A', 'CO', '2024', 2.0, 'F')
				) AS t(indicator_code, freq, ref_area, time_period, obs_value, sex)`
			);
			const storageRoot = join(directory, 'data', 'ingest', 'batches');
			const prepared = await prepareBatch({
				db,
				storageRoot,
				sourcePath: fixturePath,
				mappings: [
					mapping('indicator_code', 'indicator_code'),
					mapping('freq', 'freq'),
					mapping('ref_area', 'ref_area'),
					mapping('time_period', 'time_period'),
					mapping('obs_value', 'obs_value'),
					mapping('sex', 'sex')
				],
				slices: [{ indicatorCode: 'EMP', freq: 'A' }]
			});

			await expect(
				stageBatch({ batchId: prepared.batchId, storageRoot, maxRows: 1 }, { db })
			).rejects.toThrow('exceeding the in-memory canonicalization limit of 1');
			const first = await stageBatch(
				{ batchId: prepared.batchId, storageRoot, maxRows: 10 },
				{ db }
			);
			const second = await stageBatch(
				{ batchId: prepared.batchId, storageRoot, maxRows: 10 },
				{ db }
			);

			expect(first.status).toBe('staged');
			expect(second.manifest).toEqual(first.manifest);
			expect(second.manifest.slices[0]).toMatchObject({
				indicatorId: 201,
				rowCount: 2,
				periodStart: '2023',
				periodEnd: '2024',
				validation: { valid: true }
			});
			expect(second.manifest.slices[0].canonicalSchema.map((column) => column.name)).toEqual([
				'indicator_code',
				'freq',
				'ref_area',
				'time_period',
				'obs_value',
				'sex'
			]);
			expect((await db.select().from(ingestBatches))[0]).toMatchObject({
				status: 'staged',
				rowCount: 2
			});
			await expectProductionTablesUntouched(client);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
