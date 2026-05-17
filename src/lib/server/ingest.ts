import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { and, eq, or } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	dataReleases,
	indicatorDataSources,
	indicatorDimensions,
	indicators
} from '$lib/db/schema';
import { runCanonicalQuery } from '$lib/server/duckdb';

const REQUIRED_COLUMNS = ['indicator_code', 'freq', 'ref_area', 'time_period', 'obs_value'];
const OPTIONAL_CANONICAL_COLUMNS = [
	'geo_level',
	'dept_code',
	'muni_code',
	'urban_rural',
	'sex',
	'age',
	'adjustment',
	'ext_1',
	'ext_2',
	'ext_3',
	'obs_status'
].map((column) => column.trim());

const OBSERVATION_COLUMNS = [
	'indicator_code',
	'freq',
	'ref_area',
	'time_period',
	'obs_value',
	'geo_level',
	'dept_code',
	'muni_code',
	'urban_rural',
	'sex',
	'age',
	'adjustment',
	'ext_1',
	'ext_2',
	'ext_3',
	'obs_status'
];

export interface UploadValidationResult {
	valid: boolean;
	errors: string[];
	rowCount: number;
	preview: Array<Record<string, unknown>>;
	columns: string[];
}

interface StoredUploadManifest {
	uploadId: string;
	indicatorCode: string;
	freq: string;
	filePath: string;
	originalName: string;
	checksum: string;
	rowCount: number;
	columns: string[];
	createdAt: string;
	status: 'uploaded' | 'published';
	releaseId?: number;
	publishedAt?: string;
}

export interface UploadIndicatorDataResult extends UploadValidationResult {
	uploadId?: string;
	checksum?: string;
}

export interface PublishUploadResult {
	releaseId: number;
	rowsInserted: number;
	indicatorCode: string;
	freq: string;
}

function ingestDir(): string {
	return join(process.cwd(), 'data', 'ingest', 'uploads');
}

function uploadFilePath(uploadId: string): string {
	return join(ingestDir(), `${uploadId}.parquet`);
}

function manifestPath(uploadId: string): string {
	return join(ingestDir(), `${uploadId}.json`);
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function toJsonSafe(value: unknown): unknown {
	if (typeof value === 'bigint') return Number(value);
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) => [key, toJsonSafe(nestedValue)])
		);
	}
	return value;
}

function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return 0;
}

async function readManifest(uploadId: string): Promise<StoredUploadManifest | null> {
	if (!/^[0-9a-f-]{36}$/.test(uploadId)) return null;
	const path = manifestPath(uploadId);
	if (!existsSync(path)) return null;
	return JSON.parse(await readFile(path, 'utf8')) as StoredUploadManifest;
}

async function writeManifest(manifest: StoredUploadManifest) {
	await writeFile(manifestPath(manifest.uploadId), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function getParquetColumns(filePath: string): Promise<string[]> {
	const rows = await runCanonicalQuery<{ column_name: string }>(
		`DESCRIBE SELECT * FROM read_parquet(${sqlString(filePath)})`
	);
	return rows.map((row) => row.column_name);
}

async function getPreview(filePath: string): Promise<Array<Record<string, unknown>>> {
	const rows = await runCanonicalQuery<Record<string, unknown>>(
		`SELECT * FROM read_parquet(${sqlString(filePath)}) LIMIT 10`
	);
	return toJsonSafe(rows) as Array<Record<string, unknown>>;
}

async function countRows(
	filePath: string,
	whereClause = '',
	...params: unknown[]
): Promise<number> {
	const rows = await runCanonicalQuery<{ count: unknown }>(
		`
			SELECT COUNT(*) AS count
			FROM read_parquet(${sqlString(filePath)})
			${whereClause ? `WHERE ${whereClause}` : ''}
		`,
		...params
	);
	return toNumber(rows[0]?.count);
}

async function getRegisteredDimensionColumns(indicatorId: number, freq: string): Promise<string[]> {
	const db = getDb();
	const dimensions = await db
		.select({ dimensionCode: indicatorDimensions.dimensionCode })
		.from(indicatorDimensions)
		.where(
			and(
				eq(indicatorDimensions.indicatorId, indicatorId),
				or(eq(indicatorDimensions.freq, freq), eq(indicatorDimensions.freq, '*'))
			)
		);

	return dimensions.map((dimension) => dimension.dimensionCode.toLowerCase());
}

async function validateUploadFile(
	filePath: string,
	indicatorCode: string,
	freq: string
): Promise<UploadValidationResult & { indicatorId?: number }> {
	const errors: string[] = [];
	let columns: string[] = [];
	let preview: Array<Record<string, unknown>> = [];
	let rowCount = 0;

	const db = getDb();
	const indicatorRows = await db
		.select({ id: indicators.id })
		.from(indicators)
		.where(eq(indicators.code, indicatorCode))
		.limit(1);

	if (indicatorRows.length === 0) {
		return {
			valid: false,
			errors: [`Indicator ${indicatorCode} does not exist`],
			rowCount,
			preview,
			columns
		};
	}

	const indicatorId = indicatorRows[0].id;
	const registeredDimensionColumns = await getRegisteredDimensionColumns(indicatorId, freq);

	try {
		columns = await getParquetColumns(filePath);
		rowCount = await countRows(filePath);
		preview = await getPreview(filePath);
	} catch (error) {
		return {
			valid: false,
			errors: [
				`Could not read uploaded file as Parquet: ${error instanceof Error ? error.message : 'unknown error'}`
			],
			rowCount,
			preview,
			columns,
			indicatorId
		};
	}

	const columnMap = new Map<string, string>();
	for (const column of columns) {
		const normalized = column.toLowerCase();
		if (columnMap.has(normalized)) {
			errors.push(`Duplicate column after case normalization: ${column}`);
		}
		columnMap.set(normalized, column);

		if (column !== normalized) {
			errors.push(
				`Column ${column} must be named ${normalized}; upload columns are case-sensitive`
			);
		}
	}

	const allowedColumns = new Set([
		...REQUIRED_COLUMNS,
		...OPTIONAL_CANONICAL_COLUMNS.filter(
			(column) => registeredDimensionColumns.includes(column) || column.startsWith('ext_')
		),
		'obs_status'
	]);

	for (const requiredColumn of REQUIRED_COLUMNS) {
		if (!columnMap.has(requiredColumn)) errors.push(`Missing required column: ${requiredColumn}`);
	}

	for (const column of columns.map((value) => value.toLowerCase())) {
		if (!allowedColumns.has(column)) {
			errors.push(
				`Column ${column} is not allowed for ${indicatorCode}/${freq}; register it in indicator_dimensions first`
			);
		}
	}

	if (rowCount === 0) errors.push('Uploaded file contains no rows');

	const hasRequiredColumns = REQUIRED_COLUMNS.every((column) => columnMap.has(column));
	if (hasRequiredColumns) {
		const indicatorColumn = quoteIdentifier(columnMap.get('indicator_code')!);
		const freqColumn = quoteIdentifier(columnMap.get('freq')!);
		const refAreaColumn = quoteIdentifier(columnMap.get('ref_area')!);
		const obsValueColumn = quoteIdentifier(columnMap.get('obs_value')!);
		const timeColumn = quoteIdentifier(columnMap.get('time_period')!);

		const mismatchedIndicatorCount = await countRows(
			filePath,
			`CAST(${indicatorColumn} AS VARCHAR) IS NULL OR CAST(${indicatorColumn} AS VARCHAR) <> ?`,
			indicatorCode
		);
		if (mismatchedIndicatorCount > 0) {
			errors.push(
				`${mismatchedIndicatorCount} row(s) have indicator_code different from ${indicatorCode}`
			);
		}

		const mismatchedFreqCount = await countRows(
			filePath,
			`CAST(${freqColumn} AS VARCHAR) IS NULL OR CAST(${freqColumn} AS VARCHAR) <> ?`,
			freq
		);
		if (mismatchedFreqCount > 0) {
			errors.push(`${mismatchedFreqCount} row(s) have freq different from ${freq}`);
		}

		const missingRefAreaCount = await countRows(filePath, `${refAreaColumn} IS NULL`);
		if (missingRefAreaCount > 0) {
			errors.push(`${missingRefAreaCount} row(s) have null ref_area`);
		}

		const missingTimeCount = await countRows(filePath, `${timeColumn} IS NULL`);
		if (missingTimeCount > 0) {
			errors.push(`${missingTimeCount} row(s) have null time_period`);
		}

		const invalidNumericCount = await countRows(
			filePath,
			`${obsValueColumn} IS NOT NULL AND TRY_CAST(${obsValueColumn} AS DOUBLE) IS NULL`
		);
		if (invalidNumericCount > 0) {
			errors.push(
				`${invalidNumericCount} row(s) have obs_value values that cannot be cast to DOUBLE`
			);
		}

		const timeRegexByFreq: Record<string, string> = {
			A: '^[0-9]{4}$',
			M: '^[0-9]{4}-(0[1-9]|1[0-2])$'
		};
		const timeRegex = timeRegexByFreq[freq];
		if (timeRegex) {
			const invalidTimeCount = await countRows(
				filePath,
				`CAST(${timeColumn} AS VARCHAR) IS NULL OR NOT regexp_full_match(CAST(${timeColumn} AS VARCHAR), ?)`,
				timeRegex
			);
			if (invalidTimeCount > 0) {
				errors.push(`${invalidTimeCount} row(s) have invalid time_period format for freq ${freq}`);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		rowCount,
		preview,
		columns,
		indicatorId
	};
}

export async function uploadIndicatorData(params: {
	file: File;
	indicatorCode: string;
	freq: string;
}): Promise<UploadIndicatorDataResult> {
	await mkdir(ingestDir(), { recursive: true });

	const uploadId = randomUUID();
	const filePath = uploadFilePath(uploadId);
	const buffer = Buffer.from(await params.file.arrayBuffer());
	const checksum = createHash('sha256').update(buffer).digest('hex');

	await writeFile(filePath, buffer);

	const indicatorCode = params.indicatorCode.trim();
	const freq = params.freq.trim().toUpperCase();
	const validation = await validateUploadFile(filePath, indicatorCode, freq);
	const { indicatorId: _indicatorId, ...publicValidation } = validation;

	if (!validation.valid) {
		await unlink(filePath).catch(() => undefined);
		return publicValidation;
	}

	const manifest: StoredUploadManifest = {
		uploadId,
		indicatorCode,
		freq,
		filePath,
		originalName: basename(params.file.name || 'upload.parquet'),
		checksum,
		rowCount: validation.rowCount,
		columns: validation.columns,
		createdAt: new Date().toISOString(),
		status: 'uploaded'
	};

	await writeManifest(manifest);

	return {
		...publicValidation,
		uploadId,
		checksum
	};
}

function buildInsertSelect(manifest: StoredUploadManifest): string {
	const availableColumns = new Set(manifest.columns.map((column) => column.toLowerCase()));
	const selectExpressions = OBSERVATION_COLUMNS.map((column) => {
		if (column === 'obs_value') {
			return availableColumns.has(column)
				? `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE) AS ${quoteIdentifier(column)}`
				: `NULL AS ${quoteIdentifier(column)}`;
		}

		if (column === 'obs_status') {
			return availableColumns.has(column)
				? `COALESCE(CAST(${quoteIdentifier(column)} AS VARCHAR), 'A') AS ${quoteIdentifier(column)}`
				: `'A' AS ${quoteIdentifier(column)}`;
		}

		return availableColumns.has(column)
			? `CAST(${quoteIdentifier(column)} AS VARCHAR) AS ${quoteIdentifier(column)}`
			: `NULL AS ${quoteIdentifier(column)}`;
	});

	return `
		INSERT INTO observations (${OBSERVATION_COLUMNS.map(quoteIdentifier).join(', ')})
		SELECT ${selectExpressions.join(', ')}
		FROM read_parquet(${sqlString(manifest.filePath)})
	`;
}

async function publishUploadNow(uploadId: string): Promise<PublishUploadResult> {
	const manifest = await readManifest(uploadId);
	if (!manifest) throw new Error(`Upload ${uploadId} not found`);
	if (manifest.status === 'published')
		throw new Error(`Upload ${uploadId} has already been published`);
	if (!existsSync(manifest.filePath)) throw new Error(`Uploaded file for ${uploadId} is missing`);

	const validation = await validateUploadFile(
		manifest.filePath,
		manifest.indicatorCode,
		manifest.freq
	);
	if (!validation.valid || !validation.indicatorId) {
		const error = new Error('Upload is no longer valid');
		(error as Error & { details?: string[] }).details = validation.errors;
		throw error;
	}

	await runCanonicalQuery('BEGIN TRANSACTION');
	try {
		await runCanonicalQuery(
			'DELETE FROM observations WHERE indicator_code = ? AND freq = ?',
			manifest.indicatorCode,
			manifest.freq
		);
		await runCanonicalQuery(buildInsertSelect(manifest));
		await runCanonicalQuery('COMMIT');
	} catch (error) {
		await runCanonicalQuery('ROLLBACK').catch(() => undefined);
		throw error;
	}

	const rows = await runCanonicalQuery<{
		rows_inserted: unknown;
		period_start: string | null;
		period_end: string | null;
	}>(
		`
			SELECT
				COUNT(*) AS rows_inserted,
				MIN(time_period) AS period_start,
				MAX(time_period) AS period_end
			FROM observations
			WHERE indicator_code = ? AND freq = ?
		`,
		manifest.indicatorCode,
		manifest.freq
	);
	const rowsInserted = toNumber(rows[0]?.rows_inserted);

	const sourceRows = await runCanonicalQuery<{
		ref_area: string;
		row_count: unknown;
		year_min: number | null;
		year_max: number | null;
	}>(
		`
			SELECT
				ref_area,
				COUNT(*) AS row_count,
				MIN(TRY_CAST(SUBSTR(time_period, 1, 4) AS INTEGER)) AS year_min,
				MAX(TRY_CAST(SUBSTR(time_period, 1, 4) AS INTEGER)) AS year_max
			FROM observations
			WHERE indicator_code = ? AND freq = ?
			GROUP BY ref_area
		`,
		manifest.indicatorCode,
		manifest.freq
	);

	const db = getDb();
	const release = await db.transaction(async (tx) => {
		const [createdRelease] = await tx
			.insert(dataReleases)
			.values({
				indicatorId: validation.indicatorId!,
				periodStart: rows[0]?.period_start || null,
				periodEnd: rows[0]?.period_end || null,
				rowCount: rowsInserted,
				sourceFormat: 'parquet',
				sourceName: manifest.originalName,
				status: 'published',
				checksum: manifest.checksum
			})
			.returning({ id: dataReleases.id });

		await tx
			.delete(indicatorDataSources)
			.where(
				and(
					eq(indicatorDataSources.indicatorId, validation.indicatorId!),
					eq(indicatorDataSources.freq, manifest.freq)
				)
			);

		if (sourceRows.length > 0) {
			await tx.insert(indicatorDataSources).values(
				sourceRows.map((row) => ({
					indicatorId: validation.indicatorId!,
					refArea: row.ref_area,
					freq: manifest.freq,
					yearMin: row.year_min,
					yearMax: row.year_max,
					rowCount: toNumber(row.row_count),
					releaseId: createdRelease.id
				}))
			);
		}

		return createdRelease;
	});

	manifest.status = 'published';
	manifest.releaseId = release.id;
	manifest.publishedAt = new Date().toISOString();
	await writeManifest(manifest);

	return {
		releaseId: release.id,
		rowsInserted,
		indicatorCode: manifest.indicatorCode,
		freq: manifest.freq
	};
}

let publishQueue: Promise<unknown> = Promise.resolve();

export function publishUpload(uploadId: string): Promise<PublishUploadResult> {
	const next = publishQueue.then(
		() => publishUploadNow(uploadId),
		() => publishUploadNow(uploadId)
	);
	publishQueue = next.catch(() => undefined);
	return next;
}
