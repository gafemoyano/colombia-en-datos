import duckdb from 'duckdb';
import { getDb } from '$lib/db/client';
import { indicators, indicatorFiles, categories, areas } from '$lib/db/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

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

let duckDbInstance: duckdb.Database | null = null;

function getDuckDB(): Promise<duckdb.Database> {
	return new Promise((resolve, reject) => {
		if (duckDbInstance) {
			resolve(duckDbInstance);
			return;
		}

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

function runQuery<T = any>(db: duckdb.Database, query: string): Promise<T[]> {
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

	const indicatorIdToCode = new Map(indicatorRecords.map((i) => [i.id, i.code]));

	const duckDb = await getDuckDB();
	const allData: IndicatorData[] = [];

	for (const file of files) {
		const indicatorCode = indicatorIdToCode.get(file.indicatorId);
		if (!indicatorCode) continue;

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
			FROM read_parquet('${file.filePath}')
			${whereClause}
			ORDER BY TIME_PERIOD
		`;

		console.log(`[DuckDB] Executing query for ${indicatorCode}:`, query);

		try {
			const rows = await runQuery<any>(duckDb, query);
			console.log(`[DuckDB] ${indicatorCode}: Retrieved ${rows.length} rows from ${file.filePath}`);

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
			console.error(`[DuckDB] Error querying ${file.filePath}:`, error);
		}
	}

	allData.sort((a, b) => a.time.localeCompare(b.time));

	console.log(`[DuckDB] Query complete: ${allData.length} total data points returned`);

	return allData;
}

export async function getAvailableIndicators(): Promise<
	Array<{ code: string; name: string; frequency: string; area: string }>
> {
	const pgDb = getDb();
	const allIndicators = await pgDb
		.select({
			code: indicators.code,
			name: indicators.name,
			frequency: indicators.frequency,
			categoryId: indicators.categoryId
		})
		.from(indicators);

	const categoryIds = [...new Set(allIndicators.map((i) => i.categoryId))];
	const categoriesData = await pgDb
		.select({
			id: categories.id,
			areaId: categories.areaId
		})
		.from(categories)
		.where(inArray(categories.id, categoryIds));

	const categoryToAreaId = new Map(categoriesData.map((c) => [c.id, c.areaId]));

	const areaIds = [...new Set(categoriesData.map((c) => c.areaId))];
	const areasData = await pgDb
		.select({
			id: areas.id,
			name: areas.name
		})
		.from(areas)
		.where(inArray(areas.id, areaIds));

	const areaIdToName = new Map(areasData.map((a) => [a.id, a.name]));

	return allIndicators.map((i) => ({
		code: i.code,
		name: i.name,
		frequency: i.frequency,
		area: areaIdToName.get(categoryToAreaId.get(i.categoryId) || 0) || 'Unknown'
	}));
}

export async function getIndicatorsByFrequency(frequency: string): Promise<string[]> {
	const pgDb = getDb();
	const results = await pgDb.select().from(indicators).where(eq(indicators.frequency, frequency));
	return results.map((i) => i.code);
}

export async function getParquetColumns(filePath: string): Promise<string[]> {
	const duckDb = await getDuckDB();
	const query = `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${filePath}'))`;

	console.log(`[DuckDB] Getting columns from ${filePath}`);

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
	description: string | null;
	source: string | null;
	frequency: string;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
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
			description: indicator.description,
			source: indicator.source,
			frequency: indicator.frequency,
			unit: null,
			unitMult: null,
			decimals: null,
			availableDimensions: []
		};
	}

	const duckDb = await getDuckDB();
	const query = `
		SELECT
			UNIT,
			CAST(UNIT_MULT AS INTEGER) as UNIT_MULT,
			CAST(DECIMALS AS INTEGER) as DECIMALS
		FROM read_parquet('${files[0].filePath}')
		LIMIT 1
	`;

	let unit: string | null = null;
	let unitMult: number | null = null;
	let decimals: number | null = null;

	try {
		const rows = await runQuery<any>(duckDb, query);
		if (rows.length > 0) {
			unit = rows[0].UNIT || null;
			unitMult = rows[0].UNIT_MULT || null;
			decimals = rows[0].DECIMALS || null;
		}
	} catch (error) {
		console.error(`[DuckDB] Error reading unit/decimals:`, error);
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
		description: indicator.description,
		source: indicator.source,
		frequency: indicator.frequency,
		unit,
		unitMult,
		decimals,
		availableDimensions
	};
}
