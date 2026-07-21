import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	batchStoragePaths,
	createAcceptedMappingManifest,
	createBatchStagingInput,
	createStagedBatchManifest,
	persistAcceptedMappingArtifacts,
	persistStagedBatchManifest,
	readAcceptedMappingManifest,
	readBatchStagingInput,
	readStagedBatchManifest,
	resolveBatchStorageRoot,
	sourceIntegrity,
	stagedSliceArtifact
} from './storage';

describe('batch artifact storage contracts', () => {
	it('resolves the Fly DATA_PATH layout and the local data fallback', () => {
		expect(resolveBatchStorageRoot({ dataPath: '/data' })).toBe('/data/ingest/batches');
		expect(resolveBatchStorageRoot({ dataPath: null, cwd: '/workspace/app' })).toBe(
			resolve('/workspace/app/data/ingest/batches')
		);
		expect(batchStoragePaths(42, '/data/ingest/batches')).toMatchObject({
			batchDir: '/data/ingest/batches/42',
			source: '/data/ingest/batches/42/source/source.parquet',
			acceptedMappingManifest: '/data/ingest/batches/42/manifests/accepted-mapping.v1.json',
			stagedManifest: '/data/ingest/batches/42/staged/manifest.v1.json'
		});
	});

	it('persists immutable accepted mappings, collapsed dimensions, and reproducible staging input', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-batch-storage-'));
		try {
			const paths = batchStoragePaths(7, directory);
			const integrity = sourceIntegrity(Buffer.from('source parquet'));
			const manifest = createAcceptedMappingManifest({
				batchId: 7,
				acceptedAt: '2026-07-13T13:00:00.000Z',
				sourceIntegrity: integrity,
				mappings: [
					{
						sourceColumn: 'TIME_PERIOD',
						canonicalField: 'time_period',
						transforms: ['trim', 'geih-month-year-to-iso-month']
					},
					{
						sourceColumn: 'INDICADOR',
						canonicalField: 'indicator_code',
						transforms: ['trim']
					},
					{ sourceColumn: 'YEAR', canonicalField: null, transforms: [] }
				],
				collapsedDimensions: [
					{
						sliceKey: 'TD/M',
						sourceColumn: 'SEX',
						canonicalField: 'sex',
						dimensionCode: 'SEX',
						value: 'T'
					}
				]
			});
			const stagingInput = createBatchStagingInput(manifest, '2026-07-13T13:01:00.000Z');

			await persistAcceptedMappingArtifacts({ paths, manifest, stagingInput });
			await persistAcceptedMappingArtifacts({ paths, manifest, stagingInput });

			expect(await readAcceptedMappingManifest(paths)).toEqual({
				schemaVersion: 1,
				batchId: 7,
				acceptedAt: '2026-07-13T13:00:00.000Z',
				sourceIntegrity: integrity,
				mappings: [
					{
						sourceColumn: 'INDICADOR',
						canonicalField: 'indicator_code',
						transforms: ['trim']
					},
					{
						sourceColumn: 'TIME_PERIOD',
						canonicalField: 'time_period',
						transforms: ['trim', 'geih-month-year-to-iso-month']
					},
					{ sourceColumn: 'YEAR', canonicalField: null, transforms: [] }
				],
				collapsedDimensions: [
					{
						sliceKey: 'TD/M',
						sourceColumn: 'SEX',
						canonicalField: 'sex',
						dimensionCode: 'SEX',
						value: 'T'
					}
				]
			});
			expect(await readBatchStagingInput(paths)).toEqual({
				schemaVersion: 1,
				batchId: 7,
				createdAt: '2026-07-13T13:01:00.000Z',
				source: { artifact: 'source/source.parquet', integrity },
				acceptedMapping: {
					artifact: 'manifests/accepted-mapping.v1.json',
					schemaVersion: 1
				}
			});

			const changedManifest = { ...manifest, acceptedAt: '2026-07-13T14:00:00.000Z' };
			await expect(
				persistAcceptedMappingArtifacts({ paths, manifest: changedManifest, stagingInput })
			).rejects.toThrow('Immutable batch artifact already exists with different content');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('creates and persists stable staged slice summaries without writing slice data', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-staged-manifest-'));
		try {
			const paths = batchStoragePaths(9, directory);
			const integrity = sourceIntegrity(Buffer.from('source'));
			const staged = createStagedBatchManifest({
				batchId: 9,
				stagedAt: '2026-07-13T15:00:00.000Z',
				sourceIntegrity: integrity,
				acceptedMappingIntegrity: sourceIntegrity(Buffer.from('mapping')),
				validation: { valid: false, errorCount: 1, warningCount: 0, diagnostics: [] },
				slices: [
					{
						sliceId: 12,
						indicatorCode: 'TD',
						freq: 'M',
						indicatorId: 2,
						artifact: stagedSliceArtifact(12),
						integrity: sourceIntegrity(Buffer.from('td slice')),
						canonicalSchema: [],
						rowCount: 3,
						periodStart: '2024-01',
						periodEnd: '2024-03',
						refAreas: [],
						collapsedDimensions: [],
						validation: {
							valid: false,
							errorCount: 1,
							warningCount: 0,
							diagnostics: [
								{ severity: 'error', code: 'invalid_period', message: 'Invalid period.' }
							]
						}
					},
					{
						sliceId: 11,
						indicatorCode: 'OCU',
						freq: 'M',
						indicatorId: 1,
						artifact: stagedSliceArtifact(11),
						integrity: sourceIntegrity(Buffer.from('ocu slice')),
						canonicalSchema: [],
						rowCount: 2,
						periodStart: '2024-01',
						periodEnd: '2024-02',
						refAreas: [],
						collapsedDimensions: [],
						validation: {
							valid: true,
							errorCount: 0,
							warningCount: 0,
							diagnostics: []
						}
					}
				]
			});

			await persistStagedBatchManifest(paths, staged);
			expect(await readStagedBatchManifest(paths)).toMatchObject({
				schemaVersion: 1,
				batchId: 9,
				slices: [
					{ sliceId: 11, indicatorCode: 'OCU', artifact: 'staged/slices/11.parquet' },
					{ sliceId: 12, indicatorCode: 'TD', artifact: 'staged/slices/12.parquet' }
				],
				totals: {
					sliceCount: 2,
					rowCount: 5,
					validSliceCount: 1,
					failedSliceCount: 1
				}
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
