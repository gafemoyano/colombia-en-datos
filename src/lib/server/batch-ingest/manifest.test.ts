import { describe, expect, it } from 'vitest';
import {
	BATCH_STATUSES,
	SLICE_STATUSES,
	createBatchManifestSummary,
	isBatchStatus,
	isSliceStatus,
	requireBatchStatus,
	requireSliceStatus
} from './manifest';

describe('batch ingest manifest helpers', () => {
	it('validates supported batch and slice statuses', () => {
		expect(BATCH_STATUSES).toEqual([
			'uploaded',
			'analyzed',
			'staged',
			'publishing',
			'published',
			'failed'
		]);
		expect(SLICE_STATUSES).toEqual(['proposed', 'staged', 'publishing', 'published', 'failed']);

		expect(isBatchStatus('uploaded')).toBe(true);
		expect(isBatchStatus('publishing')).toBe(true);
		expect(isBatchStatus('draft')).toBe(false);
		expect(isBatchStatus(null)).toBe(false);

		expect(isSliceStatus('proposed')).toBe(true);
		expect(isSliceStatus('publishing')).toBe(true);
		expect(isSliceStatus('analyzed')).toBe(false);
		expect(isSliceStatus(undefined)).toBe(false);
	});

	it('throws deterministic errors for invalid statuses', () => {
		expect(() => requireBatchStatus('draft')).toThrow('Invalid batch status: draft');
		expect(() => requireSliceStatus('uploaded')).toThrow('Invalid batch slice status: uploaded');
	});

	it('returns a stable lineage summary shape without profile or mapping payloads', () => {
		const summary = createBatchManifestSummary({
			batch: {
				id: 7,
				status: 'analyzed',
				originalName: 'geih.parquet',
				checksum: 'sha256:abc',
				sourceFormat: 'parquet',
				rowCount: 30,
				createdAt: '2026-07-02T00:00:00.000Z'
			},
			slices: [
				{
					id: 2,
					indicatorCode: 'OCC',
					freq: 'M',
					status: 'published',
					indicatorId: 12,
					rowCount: 20,
					periodStart: '2024-01',
					periodEnd: '2024-02',
					releaseId: 99
				},
				{
					id: 1,
					indicatorCode: 'EMP',
					freq: 'M',
					status: 'staged',
					rowCount: 10,
					periodStart: '2024-01',
					periodEnd: '2024-02'
				}
			]
		});

		expect(summary).toEqual({
			schemaVersion: 1,
			batch: {
				id: 7,
				status: 'analyzed',
				originalName: 'geih.parquet',
				checksum: 'sha256:abc',
				sourceFormat: 'parquet',
				rowCount: 30,
				createdAt: '2026-07-02T00:00:00.000Z',
				publishedAt: null
			},
			slices: [
				{
					id: 1,
					indicatorCode: 'EMP',
					freq: 'M',
					status: 'staged',
					indicatorId: null,
					rowCount: 10,
					periodStart: '2024-01',
					periodEnd: '2024-02',
					releaseId: null
				},
				{
					id: 2,
					indicatorCode: 'OCC',
					freq: 'M',
					status: 'published',
					indicatorId: 12,
					rowCount: 20,
					periodStart: '2024-01',
					periodEnd: '2024-02',
					releaseId: 99
				}
			],
			totals: {
				sliceCount: 2,
				rowCount: 30,
				publishedSliceCount: 1,
				failedSliceCount: 0
			}
		});
		expect(summary).not.toHaveProperty('profileJson');
		expect(summary).not.toHaveProperty('mappingsJson');
	});
});
