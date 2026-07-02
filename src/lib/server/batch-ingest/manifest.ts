export const BATCH_STATUSES = ['uploaded', 'analyzed', 'staged', 'published', 'failed'] as const;
export const SLICE_STATUSES = ['proposed', 'staged', 'published', 'failed'] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type SliceStatus = (typeof SLICE_STATUSES)[number];

export interface BatchManifestBatchInput {
	id: number;
	status: BatchStatus;
	originalName?: string | null;
	checksum?: string | null;
	sourceFormat?: string | null;
	rowCount?: number | null;
	createdAt?: string | null;
	publishedAt?: string | null;
}

export interface BatchManifestSliceInput {
	id?: number | null;
	indicatorCode: string;
	freq: string;
	status: SliceStatus;
	indicatorId?: number | null;
	rowCount?: number | null;
	periodStart?: string | null;
	periodEnd?: string | null;
	releaseId?: number | null;
}

export interface BatchManifestSummaryInput {
	batch: BatchManifestBatchInput;
	slices: BatchManifestSliceInput[];
}

export interface BatchManifestSliceSummary {
	id: number | null;
	indicatorCode: string;
	freq: string;
	status: SliceStatus;
	indicatorId: number | null;
	rowCount: number | null;
	periodStart: string | null;
	periodEnd: string | null;
	releaseId: number | null;
}

export interface BatchManifestSummary {
	schemaVersion: 1;
	batch: {
		id: number;
		status: BatchStatus;
		originalName: string | null;
		checksum: string | null;
		sourceFormat: string | null;
		rowCount: number | null;
		createdAt: string | null;
		publishedAt: string | null;
	};
	slices: BatchManifestSliceSummary[];
	totals: {
		sliceCount: number;
		rowCount: number | null;
		publishedSliceCount: number;
		failedSliceCount: number;
	};
}

const batchStatusSet = new Set<string>(BATCH_STATUSES);
const sliceStatusSet = new Set<string>(SLICE_STATUSES);

export function isBatchStatus(value: unknown): value is BatchStatus {
	return typeof value === 'string' && batchStatusSet.has(value);
}

export function isSliceStatus(value: unknown): value is SliceStatus {
	return typeof value === 'string' && sliceStatusSet.has(value);
}

export function requireBatchStatus(value: unknown): BatchStatus {
	if (!isBatchStatus(value)) {
		throw new Error(`Invalid batch status: ${String(value)}`);
	}

	return value;
}

export function requireSliceStatus(value: unknown): SliceStatus {
	if (!isSliceStatus(value)) {
		throw new Error(`Invalid batch slice status: ${String(value)}`);
	}

	return value;
}

export function createBatchManifestSummary(input: BatchManifestSummaryInput): BatchManifestSummary {
	const slices = input.slices.map(toSliceSummary).sort(compareSliceSummaries);
	const rowCount = slices.reduce<number | null>((total, slice) => {
		if (total === null || slice.rowCount === null) return null;
		return total + slice.rowCount;
	}, 0);

	return {
		schemaVersion: 1,
		batch: {
			id: input.batch.id,
			status: requireBatchStatus(input.batch.status),
			originalName: input.batch.originalName ?? null,
			checksum: input.batch.checksum ?? null,
			sourceFormat: input.batch.sourceFormat ?? null,
			rowCount: input.batch.rowCount ?? null,
			createdAt: input.batch.createdAt ?? null,
			publishedAt: input.batch.publishedAt ?? null
		},
		slices,
		totals: {
			sliceCount: slices.length,
			rowCount,
			publishedSliceCount: slices.filter((slice) => slice.status === 'published').length,
			failedSliceCount: slices.filter((slice) => slice.status === 'failed').length
		}
	};
}

function toSliceSummary(slice: BatchManifestSliceInput): BatchManifestSliceSummary {
	return {
		id: slice.id ?? null,
		indicatorCode: slice.indicatorCode,
		freq: slice.freq,
		status: requireSliceStatus(slice.status),
		indicatorId: slice.indicatorId ?? null,
		rowCount: slice.rowCount ?? null,
		periodStart: slice.periodStart ?? null,
		periodEnd: slice.periodEnd ?? null,
		releaseId: slice.releaseId ?? null
	};
}

function compareSliceSummaries(a: BatchManifestSliceSummary, b: BatchManifestSliceSummary): number {
	return (
		a.indicatorCode.localeCompare(b.indicatorCode) ||
		a.freq.localeCompare(b.freq) ||
		(a.id ?? 0) - (b.id ?? 0)
	);
}
