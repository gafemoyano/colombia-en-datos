import { getDb } from '$lib/db/client';
import {
	indicators,
	indicatorGroups,
	areas,
	indicatorDataSources,
	indicatorDimensions,
	dimensionDefinitions,
	dimensionValues
} from '$lib/db/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { join } from 'path';

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
	Database: new (path: string) => DuckDbDatabase;
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
	return join(process.cwd(), 'data', 'observations.duckdb');
}

async function getCanonicalDuckDB(): Promise<DuckDbDatabase> {
	if (canonicalDb) return canonicalDb;

	const duckdb = await loadDuckDB();
	canonicalDb = new duckdb.Database(getCanonicalDbPath());
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

	const dimFilters: Record<string, string | undefined> = {
		urban_rural: urbanRural,
		sex: sex,
		age: age,
		adjustment: adjustment,
		geo_level: geoLevel,
		dept_code: deptCode,
		muni_code: muniCode
	};

	for (const [dim, val] of Object.entries(dimFilters)) {
		if (val !== undefined) {
			const hasDim = registeredDims.some(
				(d) => d.dimensionCode.toUpperCase() === dim.toUpperCase()
			);
			if (hasDim) {
				conditions.push(`${dim} = ?`);
				queryParams.push(val);
			}
		}
	}

	if (by) {
		const byLower = by.toLowerCase();
		const hasBy = registeredDims.some((d) => d.dimensionCode.toUpperCase() === by.toUpperCase());
		if (hasBy) {
			selectCols.push(byLower);
		}
	} else {
		const hasUrbanRural = registeredDims.some(
			(d) => d.dimensionCode.toUpperCase() === 'URBAN_RURAL'
		);
		if (hasUrbanRural && urbanRural === undefined) {
			conditions.push("urban_rural = 'T'");
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
	source: string | null;
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
		source: indicator.source,
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

		const observedFrequencies = new Map<string, string[]>();
		for (const row of rows) {
			const current = observedFrequencies.get(row.indicator_code) || [];
			if (!current.includes(row.freq)) current.push(row.freq);
			observedFrequencies.set(row.indicator_code, current);
		}

		return filterFrequenciesToPublishedLineage(observedFrequencies);
	} catch (error) {
		console.warn('[DuckDB] Could not load available frequencies from canonical store:', error);
		return new Map();
	}
}

async function filterFrequenciesToPublishedLineage(
	observedFrequencies: Map<string, string[]>
): Promise<Map<string, string[]>> {
	const codes = Array.from(observedFrequencies.keys());
	if (codes.length === 0) return new Map();

	const db = getDb();
	const lineageRows = await db
		.select({ code: indicators.code, freq: indicatorDataSources.freq })
		.from(indicatorDataSources)
		.innerJoin(indicators, eq(indicatorDataSources.indicatorId, indicators.id))
		.where(inArray(indicators.code, codes));

	const lineageFrequencies = new Map<string, Set<string>>();
	for (const row of lineageRows) {
		const frequencies = lineageFrequencies.get(row.code) || new Set<string>();
		frequencies.add(row.freq);
		lineageFrequencies.set(row.code, frequencies);
	}

	const visibleFrequencies = new Map<string, string[]>();
	for (const [code, frequencies] of observedFrequencies.entries()) {
		const published = lineageFrequencies.get(code) || new Set<string>();
		const visible = frequencies.filter((freq) => published.has(freq));
		if (visible.length > 0) visibleFrequencies.set(code, visible);
	}

	return visibleFrequencies;
}

export interface AvailableIndicatorCatalogRow {
	code: string;
	name: string;
	shortName: string | null;
	frequency: string | null;
	group: string;
	area: string;
}

export interface AvailableIndicatorCatalogItem extends AvailableIndicatorCatalogRow {
	availableFrequencies: string[];
	frequency: string | null;
}

export function buildAvailableIndicatorCatalog(
	rows: AvailableIndicatorCatalogRow[],
	frequencyMap: Map<string, string[]>
): AvailableIndicatorCatalogItem[] {
	return rows
		.map((indicator) => {
			const availableFrequencies = frequencyMap.get(indicator.code) || [];
			return {
				code: indicator.code,
				name: indicator.name,
				shortName: indicator.shortName,
				frequency: availableFrequencies[0] || null,
				availableFrequencies,
				area: indicator.area || 'Unknown',
				group: indicator.group || 'Unknown'
			};
		})
		.filter((indicator) => indicator.availableFrequencies.length > 0);
}

export async function getAvailableIndicators(): Promise<AvailableIndicatorCatalogItem[]> {
	const pgDb = getDb();
	const rows = await pgDb
		.select({
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			frequency: indicators.frequency,
			group: indicatorGroups.name,
			area: areas.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(areas, eq(indicatorGroups.areaId, areas.id));

	const frequencyMap = await getAvailableFrequenciesByIndicator(
		rows.map((indicator) => indicator.code)
	);

	return buildAvailableIndicatorCatalog(rows, frequencyMap);
}

export async function getIndicatorsByFrequency(frequency: string): Promise<string[]> {
	const pgDb = getDb();
	const results = await pgDb.select().from(indicators).where(eq(indicators.frequency, frequency));
	return results.map((i) => i.code);
}

export async function getParquetColumns(_filePath: string): Promise<string[]> {
	return [];
}
