import { existsSync } from 'fs';
import { getDb } from '$lib/db/client';
import {
	indicators,
	indicatorGroups,
	dataSources,
	indicatorDimensions,
	dimensionDefinitions,
	dimensionValues,
	indicatorDataSources,
	dataReleases,
	indicatorFrequencies
} from '$lib/db/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { join, resolve } from 'path';

export const CANONICAL_SCHEMA_VERSION = 2;

export interface IndicatorData {
	time: string;
	value: number;
	indicator: string;
	[key: string]: any;
}

export interface TimeSeriesQueryParams {
	indicators: string[];
	refArea?: string;
	freq?: string;
	startDate?: string;
	endDate?: string;
	by?: string;
	urbanRural?: string;
	sex?: string;
	age?: string;
	adjustment?: string;
	geoLevel?: string;
	deptCode?: string;
	muniCode?: string;
}

interface DuckDbStatement {
	all(...args: any[]): void;
}

interface DuckDbDatabase {
	prepare(query: string): DuckDbStatement;
}

interface DuckDbModule {
	Database: new (path: string, mode?: number) => DuckDbDatabase;
	OPEN_READONLY: number;
}

let duckDbModule: DuckDbModule | null = null;
let canonicalDb: DuckDbDatabase | null = null;

async function loadDuckDB(): Promise<DuckDbModule> {
	if (duckDbModule) return duckDbModule;

	const imported = await import('duckdb');
	duckDbModule = ((imported as any).default || imported) as DuckDbModule;
	return duckDbModule;
}

export function getCanonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) {
		return resolve(process.env.CANONICAL_DUCKDB_PATH);
	}
	if (process.env.DATA_PATH) {
		return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	}
	// Local dev fallback only
	return join(process.cwd(), 'data', 'observations.duckdb');
}

async function validateCanonicalSchema(db: DuckDbDatabase): Promise<void> {
	const stmt = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'");
	const rows = await runStmt<{ value: string }>(stmt);
	if (rows.length === 0) {
		throw new Error('Canonical DuckDB missing schema_version in _meta table');
	}
	const version = parseInt(rows[0].value, 10);
	if (version !== CANONICAL_SCHEMA_VERSION) {
		throw new Error(
			`Canonical DuckDB schema version mismatch: expected ${CANONICAL_SCHEMA_VERSION}, got ${version}`
		);
	}
}

async function getCanonicalDuckDB(): Promise<DuckDbDatabase> {
	if (canonicalDb) return canonicalDb;

	const dbPath = getCanonicalDbPath();
	if (!existsSync(dbPath)) {
		throw new Error(`Canonical DuckDB not found at ${dbPath}`);
	}

	const duckdb = await loadDuckDB();
	// Read-only, because the app only ever reads. DuckDB allows a single
	// read-write process per file, so opening it read-write means a running dev
	// server locks the store against the test suite, the validator and any
	// second server -- and leaves the file writable by a process that has no
	// reason to write to it.
	canonicalDb = new duckdb.Database(dbPath, duckdb.OPEN_READONLY);
	await validateCanonicalSchema(canonicalDb);
	return canonicalDb;
}

function runStmt<T = any>(stmt: DuckDbStatement, ...params: any[]): Promise<T[]> {
	return new Promise((resolve, reject) => {
		const callback = (err: Error | null, rows: any) => {
			if (err) reject(err);
			else resolve(rows as T[]);
		};
		stmt.all(...params, callback);
	});
}

export async function runCanonicalQuery<T = any>(query: string, ...params: any[]): Promise<T[]> {
	const duckDb = await getCanonicalDuckDB();
	const stmt = duckDb.prepare(query);
	return runStmt<T>(stmt, ...params);
}

// ---------------------------------------------------------------------------
// Phase 1: Prepared-statement queries against canonical store
// ---------------------------------------------------------------------------

export async function queryTimeSeries(params: TimeSeriesQueryParams): Promise<IndicatorData[]> {
	const pgDb = getDb();
	const {
		indicators: indicatorCodes,
		refArea = 'CO',
		freq = 'M',
		startDate,
		endDate,
		by,
		urbanRural,
		sex,
		age,
		adjustment,
		geoLevel,
		deptCode,
		muniCode
	} = params;

	console.log('[DuckDB] Query params:', params);

	const indicatorRecords = await pgDb
		.select({ id: indicators.id, code: indicators.code })
		.from(indicators)
		.where(inArray(indicators.code, indicatorCodes));

	if (indicatorRecords.length === 0) {
		console.warn('[DuckDB] No indicators found for codes:', indicatorCodes);
		return [];
	}

	const indicatorIdToCode = new Map(indicatorRecords.map((i) => [i.id, i.code]));
	const indicatorIds = indicatorRecords.map((i) => i.id);

	const registeredDims = await pgDb
		.select({
			indicatorId: indicatorDimensions.indicatorId,
			dimensionCode: indicatorDimensions.dimensionCode,
			defaultValue: indicatorDimensions.defaultValue
		})
		.from(indicatorDimensions)
		.where(
			and(
				inArray(indicatorDimensions.indicatorId, indicatorIds),
				or(eq(indicatorDimensions.freq, freq), eq(indicatorDimensions.freq, '*'))
			)
		);

	const selectCols = ['time_period as time', 'obs_value as value', 'indicator_code as indicator'];
	const conditions: string[] = [];
	const queryParams: any[] = [];

	conditions.push('indicator_code IN (' + indicatorCodes.map(() => '?').join(', ') + ')');
	queryParams.push(...indicatorCodes);

	conditions.push('freq = ?');
	queryParams.push(freq);

	conditions.push('ref_area = ?');
	queryParams.push(refArea);

	if (startDate) {
		conditions.push('time_period >= ?');
		queryParams.push(startDate);
	}

	if (endDate) {
		conditions.push('time_period <= ?');
		queryParams.push(endDate);
	}

	const explicitFilters: Record<string, string | undefined> = {
		URBAN_RURAL: urbanRural,
		SEX: sex,
		AGE: age,
		ADJUSTMENT: adjustment,
		GEO_LEVEL: geoLevel,
		DEPT_CODE: deptCode,
		MUNI_CODE: muniCode
	};

	const byCode = by?.toUpperCase() ?? null;

	// Every registered dimension has to be pinned to a single value unless we
	// are splitting by it. The canonical store keeps one row per combination of
	// all 13 dimensions, so leaving one unpinned multiplies the result set: an
	// EMICRON indicator with SEX unpinned returns the M, F and _T rows and the
	// chart draws three overlapping series for what looks like one category.
	//
	// The pin comes from `indicator_dimensions.default_value`, which the
	// canonical registry import sets to the dimension's total ('_T', or 'NAT' /
	// 'CO' / '00' / '0000' / 'N' for the dimensions that have no '_T').
	for (const dim of registeredDims) {
		const code = dim.dimensionCode.toUpperCase();
		if (code === byCode) continue;
		// ref_area is already pinned above from the caller's refArea. Applying the
		// registry default here too would AND a second, different value onto it
		// and silently return nothing for any non-national request.
		if (code === 'REF_AREA') continue;

		const value = explicitFilters[code] ?? dim.defaultValue ?? undefined;
		if (value === undefined) continue;

		conditions.push(`${code.toLowerCase()} = ?`);
		queryParams.push(value);
	}

	if (byCode) {
		const hasBy = registeredDims.some((d) => d.dimensionCode.toUpperCase() === byCode);
		if (hasBy) {
			selectCols.push(byCode.toLowerCase());
		}
	}

	const whereClause = conditions.join(' AND ');
	const query = `
		SELECT ${selectCols.join(', ')}
		FROM observations
		WHERE ${whereClause}
		ORDER BY indicator_code, time_period
	`;

	console.log('[DuckDB] Query:', query);
	console.log('[DuckDB] Params:', queryParams);

	const duckDb = await getCanonicalDuckDB();

	try {
		const stmt = duckDb.prepare(query);
		const rows = await runStmt(stmt, ...queryParams);
		console.log(`[DuckDB] Retrieved ${rows.length} rows`);

		const result: IndicatorData[] = rows.map((row: any) => {
			const dataPoint: IndicatorData = {
				time: row.time,
				value: row.value,
				indicator: row.indicator
			};
			if (by && row[by.toLowerCase()] !== undefined) {
				dataPoint[by.toLowerCase()] = row[by.toLowerCase()];
			}
			return dataPoint;
		});

		return result;
	} catch (error) {
		console.error('[DuckDB] Query error:', error);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Dimension registry API
// ---------------------------------------------------------------------------

export async function getDimensionsForIndicator(
	indicatorCode: string,
	freq: string = 'M',
	_refArea: string = 'CO'
): Promise<
	Array<{
		code: string;
		name: string;
		isFilterable: boolean;
		isSplitable: boolean;
		values: Array<{ code: string; labelEs: string | null }>;
	}>
> {
	console.log(`[DuckDB] Getting dimensions for ${indicatorCode}, freq=${freq}`);

	const pgDb = getDb();
	const indicatorRecord = await pgDb
		.select({ id: indicators.id })
		.from(indicators)
		.where(eq(indicators.code, indicatorCode))
		.limit(1);

	if (indicatorRecord.length === 0) {
		console.warn(`[DuckDB] Indicator ${indicatorCode} not found`);
		return [];
	}

	const dims = await pgDb
		.select({
			code: indicatorDimensions.dimensionCode,
			name: dimensionDefinitions.name,
			isFilterable: indicatorDimensions.isFilterable,
			isSplitable: indicatorDimensions.isSplitable
		})
		.from(indicatorDimensions)
		.innerJoin(
			dimensionDefinitions,
			eq(indicatorDimensions.dimensionCode, dimensionDefinitions.code)
		)
		.where(
			and(
				eq(indicatorDimensions.indicatorId, indicatorRecord[0].id),
				or(eq(indicatorDimensions.freq, freq), eq(indicatorDimensions.freq, '*'))
			)
		);

	const result = [];
	for (const dim of dims) {
		const values = await pgDb
			.select({
				code: dimensionValues.code,
				labelEs: dimensionValues.labelEs
			})
			.from(dimensionValues)
			.where(eq(dimensionValues.dimensionCode, dim.code));

		result.push({
			code: dim.code,
			name: dim.name,
			isFilterable: dim.isFilterable ?? true,
			isSplitable: dim.isSplitable ?? true,
			values
		});
	}

	console.log(
		`[DuckDB] Available dimensions for ${indicatorCode}:`,
		result.map((d) => d.code)
	);
	return result;
}

// ---------------------------------------------------------------------------
// Indicator metadata (from SQLite, not parquet)
// ---------------------------------------------------------------------------

export interface IndicatorMetadata {
	code: string;
	name: string;
	shortName: string | null;
	description: string | null;
	methodology: string | null;
	sourceCitation: string | null;
	frequency: string | null;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	defaultViz: string | null;
	updated: string | null;
	availableDimensions: string[];
}

export async function getIndicatorMetadata(
	indicatorCode: string,
	freq: string = 'M',
	_refArea: string = 'CO'
): Promise<IndicatorMetadata | null> {
	console.log(`[DuckDB] Getting metadata for ${indicatorCode}, freq=${freq}`);

	const pgDb = getDb();
	const indicatorRecord = await pgDb
		.select()
		.from(indicators)
		.where(eq(indicators.code, indicatorCode))
		.limit(1);

	if (indicatorRecord.length === 0) {
		console.warn(`[DuckDB] Indicator ${indicatorCode} not found`);
		return null;
	}

	const indicator = indicatorRecord[0];

	const dims = await pgDb
		.select({ code: indicatorDimensions.dimensionCode })
		.from(indicatorDimensions)
		.where(
			and(
				eq(indicatorDimensions.indicatorId, indicator.id),
				or(eq(indicatorDimensions.freq, freq), eq(indicatorDimensions.freq, '*'))
			)
		);

	return {
		code: indicator.code,
		name: indicator.name,
		shortName: indicator.shortName,
		description: indicator.description,
		methodology: indicator.methodology,
		sourceCitation: indicator.sourceCitation,
		frequency: indicator.frequency,
		unit: indicator.unit,
		unitMult: indicator.unitMult,
		decimals: indicator.decimals,
		defaultViz: indicator.defaultViz,
		updated: indicator.updated,
		availableDimensions: dims.map((d) => d.code)
	};
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for backward compatibility during transition)
// ---------------------------------------------------------------------------

export async function getAvailableFrequenciesByIndicator(
	indicatorCodes?: string[]
): Promise<Map<string, string[]>> {
	if (indicatorCodes && indicatorCodes.length === 0) return new Map();

	try {
		const conditions: string[] = [];
		const params: string[] = [];

		if (indicatorCodes) {
			conditions.push(`indicator_code IN (${indicatorCodes.map(() => '?').join(', ')})`);
			params.push(...indicatorCodes);
		}

		const rows = await runCanonicalQuery<{ indicator_code: string; freq: string }>(
			`
				SELECT DISTINCT indicator_code, freq
				FROM observations
				${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
				ORDER BY indicator_code, freq
			`,
			...params
		);

		const frequencies = new Map<string, string[]>();
		for (const row of rows) {
			const current = frequencies.get(row.indicator_code) || [];
			if (!current.includes(row.freq)) current.push(row.freq);
			frequencies.set(row.indicator_code, current);
		}

		return frequencies;
	} catch (error) {
		console.warn('[DuckDB] Could not load available frequencies from canonical store:', error);
		return new Map();
	}
}

export async function getPublishedFrequenciesByIndicator(
	indicatorCodes?: string[]
): Promise<Map<string, string[]>> {
	if (indicatorCodes && indicatorCodes.length === 0) return new Map();

	const pgDb = getDb();
	const metadataRows = await pgDb
		.select({
			indicatorCode: indicators.code,
			freq: indicatorDataSources.freq
		})
		.from(indicatorDataSources)
		.innerJoin(indicators, eq(indicatorDataSources.indicatorId, indicators.id))
		.innerJoin(dataReleases, eq(indicatorDataSources.releaseId, dataReleases.id))
		.where(
			and(
				eq(dataReleases.status, 'published'),
				indicatorCodes ? inArray(indicators.code, indicatorCodes) : undefined
			)
		);

	if (metadataRows.length === 0) return new Map();

	const metadataPairs = new Set(
		metadataRows.map((row) => `${row.indicatorCode}\u0000${row.freq}`)
	);
	const observedFrequencies = await getAvailableFrequenciesByIndicator(
		[...new Set(metadataRows.map((row) => row.indicatorCode))]
	);
	const result = new Map<string, string[]>();

	for (const [indicatorCode, frequencies] of observedFrequencies.entries()) {
		for (const freq of frequencies) {
			if (!metadataPairs.has(`${indicatorCode}\u0000${freq}`)) continue;
			const current = result.get(indicatorCode) || [];
			if (!current.includes(freq)) current.push(freq);
			result.set(indicatorCode, current);
		}
	}

	return result;
}

export async function getAvailableIndicators(): Promise<
	Array<{
		code: string;
		name: string;
		shortName: string | null;
		frequency: string | null;
		availableFrequencies: string[];
		dataSource: string;
		group: string;
	}>
> {
	const pgDb = getDb();
	const rows = await pgDb
		.select({
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			frequency: indicators.frequency,
			group: indicatorGroups.name,
			dataSource: dataSources.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id));

	const frequencyMap = await getPublishedFrequenciesByIndicator(
		rows.map((indicator) => indicator.code)
	);

	return rows
		.map((i) => {
			const availableFrequencies = frequencyMap.get(i.code) || [];
			return {
				code: i.code,
				name: i.name,
				shortName: i.shortName,
				frequency: availableFrequencies[0] || null,
				availableFrequencies,
				dataSource: i.dataSource || 'Unknown',
				group: i.group || 'Unknown'
			};
		})
		.filter((indicator) => indicator.availableFrequencies.length > 0);
}

export async function getIndicatorsByFrequency(frequency: string): Promise<string[]> {
	const pgDb = getDb();
	const results = await pgDb
		.select({ code: indicators.code })
		.from(indicatorFrequencies)
		.innerJoin(indicators, eq(indicatorFrequencies.indicatorId, indicators.id))
		.where(eq(indicatorFrequencies.freq, frequency));
	return results.map((i) => i.code);
}

export async function getParquetColumns(_filePath: string): Promise<string[]> {
	return [];
}
