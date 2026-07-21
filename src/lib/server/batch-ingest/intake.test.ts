import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import { ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import { intakeBatch } from './intake';
import { batchStoragePaths, readBatchIntakeManifest } from './storage';
import type { BatchProfile } from './types';

async function createTestDb(directory: string) {
	const client = createClient({ url: `file:${join(directory, 'db.sqlite')}` });
	await client.batch([
		`CREATE TABLE data_sources (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			code text(50) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE TABLE ingest_batches (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			data_source_id integer,
			original_name text,
			checksum text,
			source_format text(50),
			row_count integer,
			status text(50) DEFAULT 'uploaded' NOT NULL,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			published_at text
		)`,
		`CREATE TABLE ingest_batch_slices (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			batch_id integer NOT NULL,
			indicator_code text(100) NOT NULL,
			freq text(1) NOT NULL,
			indicator_id integer,
			row_count integer,
			period_start text,
			period_end text,
			status text(50) DEFAULT 'proposed' NOT NULL,
			release_id integer,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE UNIQUE INDEX ingest_batch_slices_unique ON ingest_batch_slices (batch_id, indicator_code, freq)`,
		`INSERT INTO data_sources (code, name) VALUES ('GEIH', 'GEIH')`
	]);
	return drizzle(client, { schema });
}

function analyzedProfile(filePath: string): BatchProfile {
	return {
		schemaVersion: 1,
		analyzedAt: '2026-07-13T12:00:00.000Z',
		source: { filePath, originalName: 'geih.parquet', format: 'parquet', rowCount: 2 },
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
				periodStart: '2024-01',
				periodEnd: '2024-02',
				sourcePeriodStart: '1-2024',
				sourcePeriodEnd: '2-2024',
				measurement: {
					rowCount: 2,
					nonNullCount: 2,
					nullCount: 0,
					min: 7.1,
					max: 7.2,
					average: 7.15,
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

describe('durable batch intake', () => {
	it('retains the source, persists analysis artifacts, and creates relational batch lineage', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-intake-'));
		try {
			const db = await createTestDb(directory);
			const storageRoot = join(directory, 'data', 'ingest', 'batches');
			const source = Buffer.from('durable parquet fixture');
			const result = await intakeBatch(
				{
					source,
					originalName: '../geih.parquet',
					dataSourceCode: 'GEIH',
					storageRoot
				},
				{
					db,
					analyze: async ({ filePath }) => {
						expect(await readFile(filePath)).toEqual(source);
						return analyzedProfile(filePath);
					}
				}
			);

			expect(result).toMatchObject({
				batchId: 1,
				status: 'analyzed',
				dataSourceCode: 'GEIH',
				source: {
					artifact: 'source/source.parquet',
					originalName: 'geih.parquet',
					format: 'parquet',
					integrity: { algorithm: 'sha256', byteLength: source.byteLength }
				}
			});

			const [batch] = await db.select().from(ingestBatches);
			expect(batch).toMatchObject({
				id: 1,
				dataSourceId: 1,
				originalName: 'geih.parquet',
				sourceFormat: 'parquet',
				rowCount: 2,
				status: 'analyzed',
				checksum: result.source.integrity.digest
			});
			expect(await db.select().from(ingestBatchSlices)).toEqual([
				expect.objectContaining({
					batchId: 1,
					indicatorCode: 'TD',
					freq: 'M',
					rowCount: 2,
					status: 'proposed'
				})
			]);

			const paths = batchStoragePaths(1, storageRoot);
			expect(await readFile(paths.source)).toEqual(source);
			expect(JSON.parse(await readFile(paths.profile, 'utf8'))).toMatchObject({
				schemaVersion: 1,
				source: { filePath: paths.source, rowCount: 2 }
			});
			expect(await readBatchIntakeManifest(paths)).toMatchObject({
				schemaVersion: 1,
				batchId: 1,
				dataSourceCode: 'GEIH',
				source: {
					artifact: 'source/source.parquet',
					integrity: result.source.integrity
				},
				analysis: { artifact: 'analysis/profile.v1.json', profileSchemaVersion: 1 }
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
