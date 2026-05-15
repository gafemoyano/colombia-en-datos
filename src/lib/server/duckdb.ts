import { getDb } from '$lib/db/client';
import { indicators, indicatorFiles, indicatorGroups, areas } from '$lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';

export interface IndicatorData {
	time: string;
	value: number;
	indicator: string;
	unit_mult?: number;
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

interface DuckDbDatabase {
	all(query: string, callback: (err: Error | null, rows: any) => void): void;
}

interface DuckDbModule {
	Database: new (path: string, callback: (err: Error | null) => void) => DuckDbDatabase;
}

let duckDbInstance: DuckDbDatabase | null = null;
let duckDbModule: DuckDbModule | null = null;

async function loadDuckDB(): Promise<DuckDbModule> {
	if (duckDbModule) return duckDbModule;

	const imported = await import('duckdb');
	duckDbModule = ((imported as any).default || imported) as DuckDbModule;
	return duckDbModule;
}

async function getDuckDB(): Promise<DuckDbDatabase> {
	if (duckDbInstance) return duckDbInstance;

	const duckdb = await loadDuckDB();
	return new Promise((resolve, reject) => {
		const db = new duckdb.Database(':memory:', (err: Error | null) => {
			if (err) {
				reject(err);
			} else {
				duckDbInstance = db;
				resolve(db);
			}
		});
	});
}

function runQuery<T = any>(db: DuckDbDatabase, query: string): Promise<T[]> {
	return new Promise((resolve, reject) => {
		db.all(query, (err: Error | null, rows: any) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows as T[]);
			}
		});
	});
}

function getDataPath(): string {
	return env.DATA_PATH || env.DUCKDB_PATH || join(process.cwd(), 'data');
}

function resolveParquetPath(filePath: string): string {
	if (!isAbsolute(filePath)) {
		return join(getDataPath(), filePath);
	}

	if (existsSync(filePath)) {
		return filePath;
	}

	// Older seeded databases may contain developer-machine absolute paths.
	// If they point somewhere under a data/ directory, re-root them to this environment's data path.
	const normalizedPath = filePath.replace(/\\/g, '/');
	const dataMarker = '/data/';
	const dataIndex = normalizedPath.lastIndexOf(dataMarker);
	if (dataIndex !== -1) {
		return join(getDataPath(), normalizedPath.slice(dataIndex + dataMarker.length));
	}

	return filePath;
}

export async function queryTimeSeries(params: TimeSeriesQueryParams): Promise<IndicatorData[]> {
	const pgDb = getDb();
	const {
		indicators: indicatorCodes,
		refArea = 'CO',
		freq,
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
		.select()
		.from(indicators)
		.where(inArray(indicators.code, indicatorCodes));

	console.log(`[DuckDB] Found ${indicatorRecords.length} indicators in database`);

	if (indicatorRecords.length === 0) {
		console.warn('[DuckDB] No indicators found for codes:', indicatorCodes);
		return [];
	}

	const indicatorIds = indicatorRecords.map((i) => i.id);

	const conditions: any[] = [
		inArray(indicatorFiles.indicatorId, indicatorIds),
		eq(indicatorFiles.refArea, refArea)
	];

	if (startDate) {
		const startYear = parseInt(startDate.substring(0, 4));
		conditions.push(gte(indicatorFiles.year, startYear));
	}

	if (endDate) {
		const endYear = parseInt(endDate.substring(0, 4));
		conditions.push(lte(indicatorFiles.year, endYear));
	}

	const files = await pgDb
		.select()
		.from(indicatorFiles)
		.where(and(...conditions));

	console.log(`[DuckDB] Found ${files.length} parquet files to query`);

	if (files.length === 0) {
		console.warn('[DuckDB] No parquet files found for query');
		return [];
	}

	const uniqueFilesByResolvedPath = new Map<string, (typeof files)[number]>();
	for (const file of files) {
		uniqueFilesByResolvedPath.set(
			`${file.indicatorId}|${file.refArea}|${file.year}|${resolveParquetPath(file.filePath)}`,
			file
		);
	}
	const filesToQuery = Array.from(uniqueFilesByResolvedPath.values());

	const indicatorIdToCode = new Map(indicatorRecords.map((i) => [i.id, i.code]));

	const duckDb = await getDuckDB();
	const allData: IndicatorData[] = [];

	for (const file of filesToQuery) {
		const indicatorCode = indicatorIdToCode.get(file.indicatorId);
		if (!indicatorCode) continue;

		const resolvedFilePath = resolveParquetPath(file.filePath);
		const cols = await getParquetColumns(file.filePath);
		const colsUpper = new Set(cols.map((c) => c.toUpperCase()));

		const rawFilters: Record<string, string | undefined> = {
			URBAN_RURAL: urbanRural,
			SEX: sex,
			AGE: age,
			ADJUSTMENT: adjustment,
			GEO_LEVEL: geoLevel,
			DEPT_CODE: deptCode,
			MUNI_CODE: muniCode
		};

		const selectCols = ['TIME_PERIOD as time', 'OBS_VALUE as value'];
		const whereConditions: string[] = [];

		if (by && colsUpper.has(by.toUpperCase())) {
			selectCols.push(by.toUpperCase());
		}

		if (startDate) {
			whereConditions.push(`TIME_PERIOD >= '${startDate}'`);
		}

		if (endDate) {
			whereConditions.push(`TIME_PERIOD <= '${endDate}'`);
		}

		for (const [col, val] of Object.entries(rawFilters)) {
			if (val !== undefined && colsUpper.has(col)) {
				whereConditions.push(`${col} = '${val}'`);
			}
		}

		if (!by && colsUpper.has('URBAN_RURAL')) {
			whereConditions.push(`URBAN_RURAL = 'T'`);
		}

		const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(' AND ')}` : '';
		const query = `
			SELECT ${selectCols.join(', ')}
			FROM read_parquet('${resolvedFilePath}')
			${whereClause}
			ORDER BY TIME_PERIOD
		`;

		console.log(`[DuckDB] Executing query for ${indicatorCode}:`, query);

		try {
			const rows = await runQuery<any>(duckDb, query);
			console.log(
				`[DuckDB] ${indicatorCode}: Retrieved ${rows.length} rows from ${resolvedFilePath}`
			);

			for (const row of rows) {
				const dataPoint: IndicatorData = {
					time: row.time,
					value: row.value,
					indicator: indicatorCode
				};

				if (by && row[by.toUpperCase()]) {
					dataPoint[by.toLowerCase()] = row[by.toUpperCase()];
				}

				allData.push(dataPoint);
			}
		} catch (error) {
			console.error(`[DuckDB] Error querying ${resolvedFilePath}:`, error);
		}
	}

	allData.sort((a, b) => a.time.localeCompare(b.time));

	console.log(`[DuckDB] Query complete: ${allData.length} total data points returned`);

	return allData;
}

export async function getAvailableIndicators(): Promise<
	Array<{
		code: string;
		name: string;
		shortName: string | null;
		frequency: string;
		area: string;
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
			area: areas.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(areas, eq(indicatorGroups.areaId, areas.id));

	return rows.map((i) => ({
		code: i.code,
		name: i.name,
		shortName: i.shortName,
		frequency: i.frequency,
		area: i.area || 'Unknown',
		group: i.group || 'Unknown'
	}));
}

export async function getIndicatorsByFrequency(frequency: string): Promise<string[]> {
	const pgDb = getDb();
	const results = await pgDb.select().from(indicators).where(eq(indicators.frequency, frequency));
	return results.map((i) => i.code);
}

export async function getParquetColumns(filePath: string): Promise<string[]> {
	const resolvedFilePath = resolveParquetPath(filePath);
	const duckDb = await getDuckDB();
	const query = `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${resolvedFilePath}'))`;

	console.log(`[DuckDB] Getting columns from ${resolvedFilePath}`);

	return new Promise((resolve, reject) => {
		duckDb.all(query, (err: Error | null, rows: any) => {
			if (err) {
				console.error(`[DuckDB] Error getting columns:`, err);
				reject(err);
			} else {
				const columns = rows.map((r: any) => r.column_name);
				console.log(`[DuckDB] Found columns:`, columns);
				resolve(columns);
			}
		});
	});
}

export async function getDimensionsForIndicator(
	indicatorCode: string,
	freq: string = 'M',
	refArea: string = 'CO'
): Promise<string[]> {
	console.log(`[DuckDB] Getting dimensions for ${indicatorCode}, freq=${freq}, refArea=${refArea}`);

	const pgDb = getDb();
	const indicatorRecord = await pgDb
		.select()
		.from(indicators)
		.where(eq(indicators.code, indicatorCode))
		.limit(1);

	if (indicatorRecord.length === 0) {
		console.warn(`[DuckDB] Indicator ${indicatorCode} not found`);
		return [];
	}

	const files = await pgDb
		.select()
		.from(indicatorFiles)
		.where(
			and(
				eq(indicatorFiles.indicatorId, indicatorRecord[0].id),
				eq(indicatorFiles.refArea, refArea)
			)
		)
		.limit(1);

	if (files.length === 0) {
		console.warn(`[DuckDB] No files found for ${indicatorCode}`);
		return [];
	}

	const columns = await getParquetColumns(files[0].filePath);
	const baseCols = new Set([
		'REF_AREA',
		'TIME_PERIOD',
		'FREQ',
		'OBS_VALUE',
		'UNIT',
		'UNIT_MULT',
		'INDICATOR',
		'OBS_STATUS',
		'DECIMALS'
	]);
	const dims = columns.filter((c) => !baseCols.has(c.toUpperCase()));

	console.log(`[DuckDB] Available dimensions for ${indicatorCode}:`, dims);
	return dims;
}

export interface IndicatorMetadata {
	code: string;
	name: string;
	shortName: string | null;
	description: string | null;
	methodology: string | null;
	source: string | null;
	frequency: string;
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
	refArea: string = 'CO'
): Promise<IndicatorMetadata | null> {
	console.log(`[DuckDB] Getting metadata for ${indicatorCode}, freq=${freq}, refArea=${refArea}`);

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

	const files = await pgDb
		.select()
		.from(indicatorFiles)
		.where(and(eq(indicatorFiles.indicatorId, indicator.id), eq(indicatorFiles.refArea, refArea)))
		.limit(1);

	if (files.length === 0) {
		console.warn(`[DuckDB] No files found for ${indicatorCode}`);
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
			availableDimensions: []
		};
	}

	const columns = await getParquetColumns(files[0].filePath);
	const baseCols = new Set([
		'REF_AREA',
		'TIME_PERIOD',
		'FREQ',
		'OBS_VALUE',
		'UNIT',
		'UNIT_MULT',
		'INDICATOR',
		'OBS_STATUS',
		'DECIMALS'
	]);
	const availableDimensions = columns.filter((c) => !baseCols.has(c.toUpperCase()));

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
		availableDimensions
	};
}
