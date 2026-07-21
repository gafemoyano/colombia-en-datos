import duckdb from 'duckdb';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/db/schema';
import {
	dataReleases,
	indicatorDataSources,
	ingestBatches,
	ingestBatchSlices
} from '$lib/db/schema';

const dbClientMock = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('$lib/db/client', () => ({ getDb: () => dbClientMock.db }));
import { acquireCanonicalWriterLease } from '../canonical-writer-lease';
import { getPublishedFrequenciesByIndicator, runCanonicalQuery } from '../duckdb';
import { buildBatchPublishCandidate, publishBatch } from './publish';
import {
	readPublishJournal,
	resolvePublishCandidatePath,
	resolvePublishJournalPath
} from './publish-journal';
import {
	batchStoragePaths,
	createStagedBatchManifest,
	persistStagedBatchManifest,
	sourceIntegrity,
	stagedSliceArtifact,
	type StagedCanonicalColumn,
	type StagedSliceSummary
} from './storage';

function exec(database: duckdb.Database, sql: string): Promise<void> {
	return new Promise((resolveExec, reject) => {
		database.exec(sql, (error) => {
			if (error) reject(error);
			else resolveExec();
		});
	});
}

function all<T>(database: duckdb.Database, sql: string): Promise<T[]> {
	return new Promise((resolveRows, reject) => {
		database.all(sql, (error, rows) => {
			if (error) reject(error);
			else resolveRows(rows as T[]);
		});
	});
}

function close(database: duckdb.Database): Promise<void> {
	return new Promise((resolveClose, reject) => {
		database.close((error) => {
			if (error) reject(error);
			else resolveClose();
		});
	});
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

async function createCanonical(path: string) {
	const database = new duckdb.Database(path);
	try {
		await exec(
			database,
			`CREATE TABLE _meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL);
			 INSERT INTO _meta VALUES ('schema_version', '1');
			 CREATE TABLE observations (
				indicator_code VARCHAR NOT NULL,
				freq VARCHAR NOT NULL,
				ref_area VARCHAR NOT NULL,
				time_period VARCHAR NOT NULL,
				obs_value DOUBLE,
				sex VARCHAR
			 );
			 INSERT INTO observations VALUES
				('EMP', 'M', 'CO', '2025-01', 1, 'T'),
				('ABSENT', 'A', 'CO', '2024', 99, NULL);`
		);
	} finally {
		await close(database);
	}
}

async function writeParquet(path: string, selectSql: string) {
	const database = new duckdb.Database(':memory:');
	try {
		await exec(database, `COPY (${selectSql}) TO ${sqlString(path)} (FORMAT PARQUET)`);
	} finally {
		await close(database);
	}
}

async function createTestDb(directory: string) {
	const client = createClient({ url: `file:${join(directory, 'lineage.sqlite')}` });
	await client.batch([
		`CREATE TABLE indicators (
			id integer PRIMARY KEY NOT NULL,
			code text NOT NULL
		)`,
		`CREATE TABLE ingest_batches (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			data_source_id integer,
			original_name text,
			checksum text,
			source_format text,
			row_count integer,
			status text NOT NULL,
			created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
			updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
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
			status text NOT NULL,
			release_id integer,
			created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
			updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
		)`,
		`CREATE TABLE data_releases (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_id integer NOT NULL,
			ingest_batch_id integer,
			release_date text DEFAULT CURRENT_TIMESTAMP,
			period_start text,
			period_end text,
			row_count integer,
			source_format text,
			source_name text,
			uploaded_by text,
			status text DEFAULT 'published',
			checksum text
		)`,
		`CREATE TABLE indicator_data_sources (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_id integer NOT NULL,
			ref_area text NOT NULL,
			freq text NOT NULL,
			year_min integer,
			year_max integer,
			row_count integer,
			release_id integer
		)`,
		`CREATE UNIQUE INDEX indicator_data_sources_unique
		 ON indicator_data_sources (indicator_id, ref_area, freq)`
	]);
	return { client, db: drizzle(client, { schema }) };
}

const originalCanonicalPath = process.env.CANONICAL_DUCKDB_PATH;

afterEach(() => {
	dbClientMock.db = undefined;
	if (originalCanonicalPath === undefined) delete process.env.CANONICAL_DUCKDB_PATH;
	else process.env.CANONICAL_DUCKDB_PATH = originalCanonicalPath;
});

const canonicalSchema: StagedCanonicalColumn[] = [
	{ name: 'indicator_code', type: 'VARCHAR', nullable: true },
	{ name: 'freq', type: 'VARCHAR', nullable: true },
	{ name: 'ref_area', type: 'VARCHAR', nullable: true },
	{ name: 'time_period', type: 'VARCHAR', nullable: true },
	{ name: 'obs_value', type: 'DOUBLE', nullable: true },
	{ name: 'sex', type: 'VARCHAR', nullable: true }
];

async function prepareStagedBatch(params: {
	directory: string;
	db: Awaited<ReturnType<typeof createTestDb>>['db'];
	rateHasUnsupportedColumn?: boolean;
}) {
	const storageRoot = join(params.directory, 'ingest', 'batches');
	const [batch] = await params.db
		.insert(ingestBatches)
		.values({
			originalName: 'batch.parquet',
			checksum: 'source-checksum',
			sourceFormat: 'parquet',
			rowCount: 3,
			status: 'staged'
		})
		.returning({ id: ingestBatches.id });
	const sliceRows = await params.db
		.insert(ingestBatchSlices)
		.values([
			{
				batchId: batch.id,
				indicatorCode: 'EMP',
				freq: 'M',
				indicatorId: 101,
				rowCount: 2,
				periodStart: '2026-01',
				periodEnd: '2026-02',
				status: 'staged'
			},
			{
				batchId: batch.id,
				indicatorCode: 'RATE',
				freq: 'A',
				indicatorId: 102,
				rowCount: 1,
				periodStart: '2025',
				periodEnd: '2025',
				status: 'staged'
			}
		])
		.returning({ id: ingestBatchSlices.id, indicatorCode: ingestBatchSlices.indicatorCode });
	const paths = batchStoragePaths(batch.id, storageRoot);
	const summaries: StagedSliceSummary[] = [];
	for (const row of sliceRows) {
		const artifact = stagedSliceArtifact(row.id);
		const path = join(paths.batchDir, artifact);
		await mkdir(join(paths.batchDir, 'staged', 'slices'), { recursive: true });
		if (row.indicatorCode === 'EMP') {
			await writeParquet(
				path,
				`SELECT * FROM (VALUES
					('EMP', 'M', 'CO', '2026-01', 10::DOUBLE, 'F'),
					('EMP', 'M', 'CO', '2026-02', 20::DOUBLE, 'M')
				) t(indicator_code, freq, ref_area, time_period, obs_value, sex)`
			);
		} else if (params.rateHasUnsupportedColumn) {
			await writeParquet(
				path,
				`SELECT * FROM (VALUES ('RATE', 'A', 'CO', '2025', 30::DOUBLE, NULL::VARCHAR, 'Y15T64'))
				 t(indicator_code, freq, ref_area, time_period, obs_value, sex, age)`
			);
		} else {
			await writeParquet(
				path,
				`SELECT * FROM (VALUES ('RATE', 'A', 'CO', '2025', 30::DOUBLE, NULL::VARCHAR))
				 t(indicator_code, freq, ref_area, time_period, obs_value, sex)`
			);
		}
		const integrity = sourceIntegrity(await readFile(path));
		const isEmp = row.indicatorCode === 'EMP';
		summaries.push({
			sliceId: row.id,
			indicatorCode: row.indicatorCode,
			freq: isEmp ? 'M' : 'A',
			indicatorId: isEmp ? 101 : 102,
			artifact,
			integrity,
			canonicalSchema:
				!isEmp && params.rateHasUnsupportedColumn
					? [...canonicalSchema, { name: 'age', type: 'VARCHAR', nullable: true }]
					: canonicalSchema,
			rowCount: isEmp ? 2 : 1,
			periodStart: isEmp ? '2026-01' : '2025',
			periodEnd: isEmp ? '2026-02' : '2025',
			refAreas: [
				{
					refArea: 'CO',
					rowCount: isEmp ? 2 : 1,
					periodStart: isEmp ? '2026-01' : '2025',
					periodEnd: isEmp ? '2026-02' : '2025'
				}
			],
			collapsedDimensions: [],
			validation: { valid: true, errorCount: 0, warningCount: 0, diagnostics: [] }
		});
	}
	await persistStagedBatchManifest(
		paths,
		createStagedBatchManifest({
			batchId: batch.id,
			stagedAt: '2026-07-19T10:00:00.000Z',
			sourceIntegrity: { algorithm: 'sha256', digest: 'source', byteLength: 1 },
			acceptedMappingIntegrity: { algorithm: 'sha256', digest: 'mapping', byteLength: 1 },
			validation: { valid: true, errorCount: 0, warningCount: 0, diagnostics: [] },
			slices: summaries
		})
	);
	return { batchId: batch.id, paths, summaries, storageRoot };
}

describe('buildBatchPublishCandidate', () => {
	it('replaces every staged pair while retaining observations for absent slices', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-candidate-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			const staged = await prepareStagedBatch({ directory, db });

			const result = await buildBatchPublishCandidate(
				{ batchId: staged.batchId, storageRoot: staged.storageRoot, canonicalPath },
				{ db }
			);
			expect(result.slices.map((slice) => `${slice.indicatorCode}/${slice.freq}`)).toEqual([
				'EMP/M',
				'RATE/A'
			]);
			expect(result.candidateIntegrity.byteLength).toBeGreaterThan(0);

			const candidate = new duckdb.Database(result.candidatePath, { access_mode: 'READ_ONLY' });
			try {
				expect(
					await all<{ indicator_code: string; obs_value: number }>(
						candidate,
						'SELECT indicator_code, obs_value FROM observations ORDER BY indicator_code, time_period'
					)
				).toEqual([
					{ indicator_code: 'ABSENT', obs_value: 99 },
					{ indicator_code: 'EMP', obs_value: 10 },
					{ indicator_code: 'EMP', obs_value: 20 },
					{ indicator_code: 'RATE', obs_value: 30 }
				]);
			} finally {
				await close(candidate);
			}
			const active = new duckdb.Database(canonicalPath, { access_mode: 'READ_ONLY' });
			try {
				expect(
					await all<{ count: bigint }>(active, 'SELECT COUNT(*) AS count FROM observations')
				).toEqual([{ count: 2n }]);
			} finally {
				await close(active);
			}
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it('rejects a changed staged artifact without mutating the active canonical store', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-integrity-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			const staged = await prepareStagedBatch({ directory, db });
			await writeFile(join(staged.paths.batchDir, staged.summaries[0].artifact!), 'tampered');

			await expect(
				buildBatchPublishCandidate(
					{ batchId: staged.batchId, storageRoot: staged.storageRoot, canonicalPath },
					{ db }
				)
			).rejects.toThrow('checksum mismatch');
			const active = new duckdb.Database(canonicalPath, { access_mode: 'READ_ONLY' });
			try {
				expect(
					await all<{ count: bigint }>(active, 'SELECT COUNT(*) AS count FROM observations')
				).toEqual([{ count: 2n }]);
			} finally {
				await close(active);
			}
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it('rolls back every candidate slice when a later staged projection cannot be inserted', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-rollback-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			const staged = await prepareStagedBatch({
				directory,
				db,
				rateHasUnsupportedColumn: true
			});

			await expect(
				buildBatchPublishCandidate(
					{ batchId: staged.batchId, storageRoot: staged.storageRoot, canonicalPath },
					{ db }
				)
			).rejects.toThrow();

			const candidate = new duckdb.Database(
				resolvePublishCandidatePath(staged.batchId, canonicalPath),
				{
					access_mode: 'READ_ONLY'
				}
			);
			try {
				expect(
					await all<{ indicator_code: string; obs_value: number }>(
						candidate,
						'SELECT indicator_code, obs_value FROM observations ORDER BY indicator_code'
					)
				).toEqual([
					{ indicator_code: 'ABSENT', obs_value: 99 },
					{ indicator_code: 'EMP', obs_value: 1 }
				]);
			} finally {
				await close(candidate);
			}
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});

describe('publishBatch', () => {
	it('fans one batch out to idempotent per-slice releases and finalizes workflow state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-publish-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			const staged = await prepareStagedBatch({ directory, db });
			const leasePath = join(directory, 'writer-lease.json');
			const now = () => new Date('2026-07-19T12:00:00.000Z');

			const first = await publishBatch(
				{
					batchId: staged.batchId,
					storageRoot: staged.storageRoot,
					canonicalPath,
					leasePath,
					now
				},
				{ db }
			);
			expect(first).toMatchObject({
				batchId: staged.batchId,
				status: 'published',
				publishedAt: '2026-07-19T12:00:00.000Z'
			});
			expect(first.slices).toHaveLength(2);
			expect(
				(await db.select().from(dataReleases)).map((release) => release.ingestBatchId)
			).toEqual([staged.batchId, staged.batchId]);
			expect(await db.select().from(indicatorDataSources)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						indicatorId: 101,
						freq: 'M',
						refArea: 'CO',
						yearMin: 2026,
						yearMax: 2026,
						rowCount: 2
					}),
					expect.objectContaining({
						indicatorId: 102,
						freq: 'A',
						refArea: 'CO',
						yearMin: 2025,
						yearMax: 2025,
						rowCount: 1
					})
				])
			);
			expect((await db.select().from(ingestBatches))[0]).toMatchObject({
				status: 'published',
				publishedAt: '2026-07-19T12:00:00.000Z'
			});
			expect((await db.select().from(ingestBatchSlices)).map((slice) => slice.status)).toEqual([
				'published',
				'published'
			]);
			expect(
				await readPublishJournal(resolvePublishJournalPath(staged.batchId, staged.storageRoot))
			).toMatchObject({ checkpoint: 'manifest-finalized', publishId: String(staged.batchId) });

			const second = await publishBatch(
				{
					batchId: staged.batchId,
					storageRoot: staged.storageRoot,
					canonicalPath,
					leasePath,
					now
				},
				{ db }
			);
			expect(second).toEqual(first);
			expect(await db.select().from(dataReleases)).toHaveLength(2);
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it('rejects a concurrent publish while the shared writer lease is held', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-publish-lock-'));
		const canonicalPath = join(directory, 'observations.duckdb');
		const leasePath = join(directory, 'writer-lease.json');
		process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
		await createCanonical(canonicalPath);
		const { db, client } = await createTestDb(directory);
		const staged = await prepareStagedBatch({ directory, db });
		const lease = await acquireCanonicalWriterLease({
			operation: 'canonical-rebuild',
			operationId: 'rebuild-in-progress',
			leasePath
		});

		try {
			await expect(
				publishBatch(
					{
						batchId: staged.batchId,
						storageRoot: staged.storageRoot,
						canonicalPath,
						leasePath
					},
					{ db }
				)
			).rejects.toMatchObject({ name: 'CanonicalWriterLeaseBusyError' });
			expect((await db.select().from(ingestBatches))[0].status).toBe('staged');
			const active = new duckdb.Database(canonicalPath, { access_mode: 'READ_ONLY' });
			try {
				expect(
					await all<{ count: bigint }>(active, 'SELECT COUNT(*) AS count FROM observations')
				).toEqual([{ count: 2n }]);
			} finally {
				await close(active);
			}
		} finally {
			await lease.release();
			client.close();
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it('keeps public frequencies at the intersection of published lineage and observations', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-publish-visibility-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			await client.batch([
				"INSERT INTO indicators (id, code) VALUES (101, 'EMP')",
				"INSERT INTO indicators (id, code) VALUES (102, 'RATE')",
				"INSERT INTO indicators (id, code) VALUES (103, 'NOOBS')",
				"INSERT INTO indicators (id, code) VALUES (104, 'ABSENT')"
			]);
			const staged = await prepareStagedBatch({ directory, db });
			await publishBatch(
				{
					batchId: staged.batchId,
					storageRoot: staged.storageRoot,
					canonicalPath,
					leasePath: join(directory, 'writer-lease.json')
				},
				{ db }
			);
			const [lineageOnlyRelease] = await db
				.insert(dataReleases)
				.values({ indicatorId: 103, status: 'published' })
				.returning({ id: dataReleases.id });
			await db.insert(indicatorDataSources).values({
				indicatorId: 103,
				refArea: 'CO',
				freq: 'A',
				releaseId: lineageOnlyRelease.id
			});
			dbClientMock.db = db;

			expect(
				Object.fromEntries(
					await getPublishedFrequenciesByIndicator(['EMP', 'RATE', 'NOOBS', 'ABSENT'])
				)
			).toEqual({ EMP: ['M'], RATE: ['A'] });
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);

	it('leaves a recoverable publishing checkpoint after handled lineage failure and resumes safely', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-publish-recovery-'));
		try {
			const canonicalPath = join(directory, 'observations.duckdb');
			process.env.CANONICAL_DUCKDB_PATH = canonicalPath;
			await createCanonical(canonicalPath);
			const { db, client } = await createTestDb(directory);
			const staged = await prepareStagedBatch({ directory, db });
			const leasePath = join(directory, 'writer-lease.json');
			const input = {
				batchId: staged.batchId,
				storageRoot: staged.storageRoot,
				canonicalPath,
				leasePath,
				now: () => new Date('2026-07-19T13:00:00.000Z')
			};

			await expect(
				publishBatch(input, {
					db,
					commitLineage: async () => {
						throw new Error('simulated lineage outage');
					}
				})
			).rejects.toThrow('simulated lineage outage');
			expect((await db.select().from(ingestBatches))[0].status).toBe('publishing');
			expect(await db.select().from(dataReleases)).toEqual([]);
			expect(
				await readPublishJournal(resolvePublishJournalPath(staged.batchId, staged.storageRoot))
			).toMatchObject({ checkpoint: 'canonical-promoted' });
			expect(
				await runCanonicalQuery<{ indicator_code: string }>(
					'SELECT DISTINCT indicator_code FROM observations ORDER BY indicator_code'
				)
			).toEqual([
				{ indicator_code: 'ABSENT' },
				{ indicator_code: 'EMP' },
				{ indicator_code: 'RATE' }
			]);

			const recovered = await publishBatch(input, { db });
			expect(recovered.status).toBe('published');
			expect(recovered.slices).toHaveLength(2);
			expect(await db.select().from(dataReleases)).toHaveLength(2);
			expect(
				await readPublishJournal(resolvePublishJournalPath(staged.batchId, staged.storageRoot))
			).toMatchObject({ checkpoint: 'manifest-finalized' });
			client.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
