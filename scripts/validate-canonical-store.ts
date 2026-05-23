import duckdb from 'duckdb';
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';

const DATA_PATH = process.env.DATA_PATH ? resolve(process.env.DATA_PATH) : resolve(process.cwd(), 'data');
const CANONICAL_PATH = process.env.CANONICAL_DUCKDB_PATH
	? resolve(process.env.CANONICAL_DUCKDB_PATH)
	: resolve(DATA_PATH, 'observations.duckdb');

const REQUIRED_COLUMNS = [
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
	'obs_status'
];

function all<T = any>(db: duckdb.Database, sql: string): Promise<T[]> {
	return new Promise((resolveRows, reject) => {
		db.all(sql, (error: Error | null, rows: any) => {
			if (error) reject(error);
			else resolveRows(rows as T[]);
		});
	});
}

async function run() {
	if (!existsSync(CANONICAL_PATH)) {
		throw new Error(`Canonical DuckDB file does not exist: ${CANONICAL_PATH}`);
	}

	const db = new duckdb.Database(CANONICAL_PATH);
	try {
		const tableRows = await all<{ table_name: string }>(
			db,
			"SELECT table_name FROM information_schema.tables WHERE table_name = 'observations'"
		);
		if (tableRows.length === 0) {
			throw new Error(`Missing observations table in ${CANONICAL_PATH}`);
		}

		const columns = await all<{ name: string }>(db, "PRAGMA table_info('observations')");
		const columnNames = new Set(columns.map((column) => column.name));
		const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnNames.has(column));
		if (missingColumns.length > 0) {
			throw new Error(`Missing observations columns: ${missingColumns.join(', ')}`);
		}

		const summary = await all<{
			row_count: bigint | number;
			indicator_count: bigint | number;
			freq_count: bigint | number;
			ref_area_count: bigint | number;
			dept_code_count: bigint | number;
			muni_code_count: bigint | number;
			min_period: string | null;
			max_period: string | null;
		}>(
			db,
			`
				SELECT
					COUNT(*) AS row_count,
					COUNT(DISTINCT indicator_code) AS indicator_count,
					COUNT(DISTINCT freq) AS freq_count,
					COUNT(DISTINCT ref_area) AS ref_area_count,
					COUNT(DISTINCT dept_code) AS dept_code_count,
					COUNT(DISTINCT muni_code) AS muni_code_count,
					MIN(time_period) AS min_period,
					MAX(time_period) AS max_period
				FROM observations
			`
		);
		const first = summary[0];
		const rowCount = Number(first?.row_count || 0);
		const indicatorCount = Number(first?.indicator_count || 0);
		if (rowCount === 0) throw new Error('observations table is empty');
		if (indicatorCount === 0) throw new Error('observations table has no indicators');

		console.log(
			JSON.stringify(
				{
					path: CANONICAL_PATH,
					sizeBytes: statSync(CANONICAL_PATH).size,
					rowCount,
					indicatorCount,
					freqCount: Number(first?.freq_count || 0),
					refAreaCount: Number(first?.ref_area_count || 0),
					deptCodeCount: Number(first?.dept_code_count || 0),
					muniCodeCount: Number(first?.muni_code_count || 0),
					minPeriod: first?.min_period || null,
					maxPeriod: first?.max_period || null
				},
				null,
				2
			)
		);
	} finally {
		db.close();
	}
}

run().catch((error) => {
	console.error('[canonical:validate] Failed:', error);
	process.exit(1);
});
