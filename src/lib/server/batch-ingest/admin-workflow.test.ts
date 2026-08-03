import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/db/schema';
import { dataSources, ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import {
	analyzeAdminBatch,
	createOrReuseAdminDataSource,
	loadAdminBatchWorkflow,
	publishAdminBatch
} from './admin-workflow';
import {
	BATCH_INTAKE_MANIFEST_SCHEMA_VERSION,
	BATCH_PROFILE_ARTIFACT,
	BATCH_SOURCE_ARTIFACT,
	batchStoragePaths,
	persistBatchAnalysisArtifacts,
	sourceIntegrity
} from './storage';
import { BATCH_PROFILE_SCHEMA_VERSION, type BatchProfile } from './types';

async function createTestDb() {
	const client = createClient({ url: ':memory:' });
	await client.batch(
		[
			`CREATE TABLE data_sources (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				code TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				description TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE ingest_batches (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				data_source_id INTEGER REFERENCES data_sources(id),
				original_name TEXT,
				checksum TEXT,
				source_format TEXT,
				row_count INTEGER,
				status TEXT NOT NULL DEFAULT 'uploaded',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				published_at TEXT
			)`,
			`CREATE TABLE ingest_batch_slices (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				batch_id INTEGER NOT NULL REFERENCES ingest_batches(id),
				indicator_code TEXT NOT NULL,
				freq TEXT NOT NULL,
				indicator_id INTEGER,
				row_count INTEGER,
				period_start TEXT,
				period_end TEXT,
				status TEXT NOT NULL DEFAULT 'proposed',
				release_id INTEGER,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(batch_id, indicator_code, freq)
			)`
		],
		'write'
	);
	return drizzle(client, { schema });
}

function profile(): BatchProfile {
	return {
		schemaVersion: BATCH_PROFILE_SCHEMA_VERSION,
		analyzedAt: '2026-08-02T12:00:00.000Z',
		source: {
			filePath: '/durable/source.parquet',
			originalName: 'geih.parquet',
			format: 'parquet',
			rowCount: 2
		},
		columns: [],
		mappings: {
			mappings: [],
			missingRequiredFields: [],
			duplicateCanonicalFields: [],
			unmappedColumns: []
		},
		uniformDimensionality: {
			compatible: true,
			flatDimensionFields: [],
			fixedTotalCandidateFields: [],
			variableDimensionFields: [],
			sliceResults: []
		},
		slices: [
			{
				key: 'TD/M',
				indicatorCode: 'TD',
				freq: 'M',
				rowCount: 2,
				periodStart: '2025-01',
				periodEnd: '2025-02',
				sourcePeriodStart: '2025-01',
				sourcePeriodEnd: '2025-02',
				measurement: {
					rowCount: 2,
					nonNullCount: 2,
					nullCount: 0,
					min: 8,
					max: 9,
					average: 8.5,
					distinctValueCount: 2,
					unitValues: [],
					unitMultValues: [],
					decimalValues: []
				},
				dimensions: [],
				duplicateKeys: { duplicateKeyCount: 0, duplicateRowCount: 0, sampleKeys: [] },
				diagnostics: []
			}
		],
		totals: { sliceCount: 1, rowCount: 2, errorCount: 0, warningCount: 0 },
		diagnostics: [],
		adminReviewQuestions: []
	};
}

const temporaryDirectories: string[] = [];
const originalDataPath = process.env.DATA_PATH;

afterEach(async () => {
	vi.restoreAllMocks();
	if (originalDataPath === undefined) delete process.env.DATA_PATH;
	else process.env.DATA_PATH = originalDataPath;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('admin batch workflow', () => {
	it('creates a normalized Data source once and reuses matching stored metadata', async () => {
		const db = await createTestDb();
		const first = await createOrReuseAdminDataSource(
			{ code: 'GEIH 2025', name: 'GEIH 2025', description: 'Monthly labor survey' },
			db
		);
		const second = await createOrReuseAdminDataSource(
			{ code: 'geih_2025', name: 'GEIH 2025', description: 'Monthly labor survey' },
			db
		);

		expect(first).toMatchObject({ code: 'geih_2025', created: true });
		expect(second).toEqual({ ...first, created: false });
		expect(await db.select().from(dataSources)).toHaveLength(1);
	});

	it('rejects conflicting metadata for an existing Data source code', async () => {
		const db = await createTestDb();
		await createOrReuseAdminDataSource({ code: 'geih', name: 'Stored GEIH' }, db);

		await expect(
			createOrReuseAdminDataSource({ code: 'geih', name: 'Replacement name' }, db)
		).rejects.toMatchObject({
			code: 'data-source-conflict',
			retryable: false
		});
	});

	it('creates or reuses the Data source before durable intake and links it by code', async () => {
		const db = await createTestDb();
		const intake = vi.fn(async (input) => ({
			batchId: 7,
			status: 'analyzed' as const,
			dataSourceCode: input.dataSourceCode || null,
			source: {
				path: '/source.parquet',
				artifact: BATCH_SOURCE_ARTIFACT as typeof BATCH_SOURCE_ARTIFACT,
				originalName: input.originalName,
				format: 'parquet' as const,
				integrity: sourceIntegrity(input.source)
			},
			artifacts: {
				intakeManifest: 'manifests/intake.v1.json' as const,
				profile: BATCH_PROFILE_ARTIFACT as typeof BATCH_PROFILE_ARTIFACT
			},
			profile: profile()
		}));

		const result = await analyzeAdminBatch(
			{
				source: Buffer.from('parquet'),
				originalName: 'geih.parquet',
				dataSource: { code: 'GEIH', name: 'GEIH' }
			},
			{ db, intake }
		);

		expect(result.dataSourceCode).toBe('geih');
		expect(intake).toHaveBeenCalledWith(
			expect.objectContaining({ dataSourceCode: 'geih', originalName: 'geih.parquet' }),
			{ db }
		);
	});

	it('reconstructs profile, generated drafts, slices, and Data source from durable state', async () => {
		const db = await createTestDb();
		const directory = await mkdtemp(join(tmpdir(), 'ced-admin-workflow-'));
		temporaryDirectories.push(directory);
		process.env.DATA_PATH = directory;
		const [dataSource] = await db
			.insert(dataSources)
			.values({ code: 'geih', name: 'GEIH' })
			.returning({ id: dataSources.id });
		const [batch] = await db
			.insert(ingestBatches)
			.values({
				dataSourceId: dataSource.id,
				originalName: 'geih.parquet',
				status: 'analyzed',
				rowCount: 2
			})
			.returning({ id: ingestBatches.id });
		await db.insert(ingestBatchSlices).values({
			batchId: batch.id,
			indicatorCode: 'TD',
			freq: 'M',
			status: 'proposed',
			rowCount: 2,
			periodStart: '2025-01',
			periodEnd: '2025-02'
		});
		const analyzed = profile();
		const integrity = sourceIntegrity(Buffer.from('source'));
		await persistBatchAnalysisArtifacts({
			paths: batchStoragePaths(batch.id),
			profile: analyzed,
			manifest: {
				schemaVersion: BATCH_INTAKE_MANIFEST_SCHEMA_VERSION,
				batchId: batch.id,
				createdAt: '2026-08-02T12:00:00.000Z',
				dataSourceCode: 'geih',
				source: {
					artifact: BATCH_SOURCE_ARTIFACT,
					originalName: 'geih.parquet',
					format: 'parquet',
					integrity
				},
				analysis: {
					artifact: BATCH_PROFILE_ARTIFACT,
					profileSchemaVersion: BATCH_PROFILE_SCHEMA_VERSION,
					analyzedAt: analyzed.analyzedAt
				}
			}
		});

		const state = await loadAdminBatchWorkflow(batch.id, { db });

		expect(state.manifest.batch).toMatchObject({ id: batch.id, status: 'analyzed' });
		expect(state.manifest.slices).toEqual([
			expect.objectContaining({ indicatorCode: 'TD', freq: 'M', rowCount: 2 })
		]);
		expect(state.dataSource).toMatchObject({ code: 'geih', name: 'GEIH' });
		expect(state.profile?.totals.sliceCount).toBe(1);
		expect(state.definitionDrafts?.drafts[0].id).toBe('TD/M');
		expect(state.acceptedMapping).toBeNull();
		expect(state.staged).toBeNull();
		expect(state.errors).toEqual([]);
	});

	it('returns a structured non-retryable loader error when expected durable analysis is missing', async () => {
		const db = await createTestDb();
		const directory = await mkdtemp(join(tmpdir(), 'ced-admin-workflow-missing-'));
		temporaryDirectories.push(directory);
		process.env.DATA_PATH = directory;
		const [batch] = await db
			.insert(ingestBatches)
			.values({ originalName: 'missing.parquet', status: 'analyzed' })
			.returning({ id: ingestBatches.id });

		const state = await loadAdminBatchWorkflow(batch.id, { db });

		expect(state.errors).toContainEqual({
			code: 'artifact-missing',
			message:
				'batch profile is missing. Start a new batch if the durable artifact cannot be restored.',
			action: 'load',
			retryable: false,
			batchId: batch.id
		});
	});

	it('requires explicit slice-replacement confirmation before publishing', async () => {
		const publish = vi.fn();

		await expect(
			publishAdminBatch({ batchId: 23, confirmed: false }, { publish })
		).rejects.toMatchObject({
			code: 'invalid-input',
			action: 'publish',
			retryable: false,
			batchId: 23
		});
		expect(publish).not.toHaveBeenCalled();
	});

	it('preserves retry context when the publish operation fails transiently', async () => {
		const publish = vi.fn(async () => {
			throw new Error('writer lease is busy');
		});

		await expect(
			publishAdminBatch({ batchId: 23, confirmed: true }, { publish })
		).rejects.toMatchObject({
			code: 'operation-failed',
			message: 'writer lease is busy',
			action: 'publish',
			retryable: true,
			batchId: 23
		});
		expect(publish).toHaveBeenCalledWith({ batchId: 23, storageRoot: undefined }, {});
	});
});
