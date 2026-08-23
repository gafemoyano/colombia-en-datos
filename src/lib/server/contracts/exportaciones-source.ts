/**
 * Reads and validates the exportaciones source files against the contract in
 * `./exportaciones`.
 *
 * Kept separate from the contract itself so the contract stays a plain data
 * declaration with no duckdb dependency.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	CODELIST_RANGE,
	CODELIST_SHEET,
	EXPORTACIONES_CONSTANT_COLUMNS,
	EXPORTACIONES_DIMENSIONS,
	EXPORTACIONES_EXPECTED,
	EXPORTACIONES_INDICATORS,
	EXPORTACIONES_REQUIRED_PARQUET_COLUMNS,
	EXPORTACIONES_UNUSED_CODELISTS,
	INDICATOR_MAP_RANGE,
	INDICATOR_MAP_SHEET
} from './exportaciones';

export interface ExportacionesSourcePaths {
	parquetPath: string;
	codelistPath: string;
}

export function defaultSourcePaths(dataPath?: string): ExportacionesSourcePaths {
	const base = resolve(dataPath || process.env.DATA_PATH || 'data', 'exportaciones');
	return {
		parquetPath: resolve(base, 'EXPORTACIONES_indicadores_SDMX_etiquetado.parquet'),
		codelistPath: resolve(base, 'EXPORTACIONES_correlativas_categorias.xlsx')
	};
}

export interface SourceDb {
	query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
	close(): void;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** duckdb returns BIGINT as bigint; every count in here fits comfortably in a number. */
function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	return Number(value ?? 0);
}

/**
 * Opens an in-memory duckdb with `obs`, `codelist` and `indicator_map` views
 * over the source files. Deliberately separate from the canonical store
 * connection in `$lib/server/duckdb` — validation must never touch it.
 */
export async function openSourceDb(paths: ExportacionesSourcePaths): Promise<SourceDb> {
	for (const [label, path] of Object.entries(paths)) {
		if (!existsSync(path)) throw new Error(`Missing exportaciones source ${label}: ${path}`);
	}

	const duckdb = (await import('duckdb')).default;
	const db = new duckdb.Database(':memory:');

	const query = <T = Record<string, unknown>>(sql: string): Promise<T[]> =>
		new Promise((res, rej) => {
			db.all(sql, (err: Error | null, rows: unknown) => {
				if (err) rej(err);
				else res(rows as T[]);
			});
		});

	// The excel extension is needed to read the correlativas workbook. It is
	// bundled with recent duckdb builds; INSTALL is a no-op when already present.
	await query('INSTALL excel');
	await query('LOAD excel');

	const xlsx = (sheet: string, range: string) =>
		`read_xlsx(${sqlString(paths.codelistPath)}, sheet = ${sqlString(sheet)}, range = ${sqlString(range)}, header = true, all_varchar = true)`;

	await query(`CREATE VIEW obs AS SELECT * FROM read_parquet(${sqlString(paths.parquetPath)})`);
	await query(`CREATE VIEW codelist AS SELECT * FROM ${xlsx(CODELIST_SHEET, CODELIST_RANGE)}`);
	await query(
		`CREATE VIEW indicator_map AS SELECT * FROM ${xlsx(INDICATOR_MAP_SHEET, INDICATOR_MAP_RANGE)}`
	);

	return { query, close: () => db.close() };
}

export interface CodelistEntry {
	dimension: string;
	/** Official code, leading zeros preserved (e.g. modality "002"). */
	code: string;
	/** Code as it actually appears in the parquet's CATEGORY column (e.g. "2"). */
	matchKey: string;
	label: string;
	sourceStatus: string | null;
	methodologyNote: string | null;
}

export async function readCodelists(db: SourceDb): Promise<CodelistEntry[]> {
	const rows = await db.query<{
		DIMENSION: string;
		CODE: string;
		MATCH_KEY: string;
		CATEGORY_LABEL: string;
		SOURCE_STATUS: string | null;
		METHODOLOGY_NOTE: string | null;
	}>(
		`SELECT DIMENSION, CODE, MATCH_KEY, CATEGORY_LABEL, SOURCE_STATUS, METHODOLOGY_NOTE
		 FROM codelist ORDER BY DIMENSION, MATCH_KEY`
	);

	return rows.map((row) => ({
		dimension: row.DIMENSION,
		code: row.CODE,
		matchKey: row.MATCH_KEY,
		label: row.CATEGORY_LABEL,
		sourceStatus: row.SOURCE_STATUS,
		methodologyNote: row.METHODOLOGY_NOTE
	}));
}

export interface ExportacionesValidation {
	ok: boolean;
	errors: string[];
	stats: {
		rowCount: number;
		indicatorCount: number;
		periodStart: string;
		periodEnd: string;
		codelistRows: number;
	};
}

/**
 * Runs every contract check against the source files and collects all failures
 * rather than throwing on the first, so one run tells you everything that
 * drifted.
 */
export async function validateExportacionesSource(
	paths: ExportacionesSourcePaths = defaultSourcePaths()
): Promise<ExportacionesValidation> {
	const db = await openSourceDb(paths);
	const errors: string[] = [];

	try {
		const columns = (
			await db.query<{ column_name: string }>('DESCRIBE SELECT * FROM obs')
		).map((row) => row.column_name);
		for (const required of EXPORTACIONES_REQUIRED_PARQUET_COLUMNS) {
			if (!columns.includes(required)) errors.push(`Parquet is missing column ${required}`);
		}

		const [totals] = await db.query<{
			n: unknown;
			inds: unknown;
			t0: string;
			t1: string;
			null_values: unknown;
			null_categories: unknown;
			null_periods: unknown;
		}>(`
			SELECT
				COUNT(*) AS n,
				COUNT(DISTINCT INDICATOR) AS inds,
				MIN(TIME_PERIOD) AS t0,
				MAX(TIME_PERIOD) AS t1,
				COUNT(*) FILTER (WHERE OBS_VALUE IS NULL) AS null_values,
				COUNT(*) FILTER (WHERE CATEGORY IS NULL OR CATEGORY_LABEL IS NULL) AS null_categories,
				COUNT(*) FILTER (WHERE TIME_PERIOD IS NULL) AS null_periods
			FROM obs
		`);

		const rowCount = toNumber(totals?.n);
		const indicatorCount = toNumber(totals?.inds);

		if (rowCount !== EXPORTACIONES_EXPECTED.rowCount) {
			errors.push(`Expected ${EXPORTACIONES_EXPECTED.rowCount} observations, found ${rowCount}`);
		}
		if (indicatorCount !== EXPORTACIONES_EXPECTED.indicatorCount) {
			errors.push(
				`Expected ${EXPORTACIONES_EXPECTED.indicatorCount} indicators, found ${indicatorCount}`
			);
		}
		if (totals?.t0 !== EXPORTACIONES_EXPECTED.periodStart) {
			errors.push(`Expected first period ${EXPORTACIONES_EXPECTED.periodStart}, found ${totals?.t0}`);
		}
		if (totals?.t1 !== EXPORTACIONES_EXPECTED.periodEnd) {
			errors.push(`Expected last period ${EXPORTACIONES_EXPECTED.periodEnd}, found ${totals?.t1}`);
		}
		if (toNumber(totals?.null_values) > 0) {
			errors.push(`${toNumber(totals.null_values)} row(s) have a null OBS_VALUE`);
		}
		if (toNumber(totals?.null_categories) > 0) {
			errors.push(`${toNumber(totals.null_categories)} row(s) have a null CATEGORY or label`);
		}
		if (toNumber(totals?.null_periods) > 0) {
			errors.push(`${toNumber(totals.null_periods)} row(s) have a null TIME_PERIOD`);
		}

		// Constant columns. A new value appearing here means the product gained a
		// real dimension and the contract needs revisiting, not a silent load.
		for (const [column, expected] of Object.entries(EXPORTACIONES_CONSTANT_COLUMNS)) {
			if (!columns.includes(column)) continue;
			const found = await db.query<{ value: unknown }>(
				`SELECT DISTINCT CAST(${column} AS VARCHAR) AS value FROM obs ORDER BY 1`
			);
			const values = found.map((row) => String(row.value));
			if (values.length !== 1 || values[0] !== expected) {
				errors.push(
					`Column ${column} should be constant ${expected}, found [${values.slice(0, 5).join(', ')}]${values.length > 5 ? ` (+${values.length - 5} more)` : ''}`
				);
			}
		}

		const [dupes] = await db.query<{ n: unknown }>(`
			SELECT COUNT(*) AS n FROM (
				SELECT INDICATOR, TIME_PERIOD, CATEGORY FROM obs
				GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
			)
		`);
		if (toNumber(dupes?.n) > 0) {
			errors.push(`${toNumber(dupes.n)} duplicate (indicator, period, category) key(s)`);
		}

		// Per-indicator shape, including the breakdown declared in FORMULA.
		const perIndicator = await db.query<{
			INDICATOR: string;
			INDICATOR_NAME: string;
			UNIT: string;
			n: unknown;
			cats: unknown;
			dim: string | null;
			meas: string | null;
		}>(`
			SELECT
				INDICATOR,
				ANY_VALUE(INDICATOR_NAME) AS INDICATOR_NAME,
				ANY_VALUE(UNIT) AS UNIT,
				COUNT(*) AS n,
				COUNT(DISTINCT CATEGORY) AS cats,
				ANY_VALUE(json_extract_string(replace(FORMULA, 'RULE_JSON:', ''), '$.dimension')) AS dim,
				ANY_VALUE(json_extract_string(replace(FORMULA, 'RULE_JSON:', ''), '$.measure')) AS meas
			FROM obs GROUP BY INDICATOR ORDER BY INDICATOR
		`);

		const seen = new Set(perIndicator.map((row) => row.INDICATOR));
		for (const expected of EXPORTACIONES_INDICATORS) {
			if (!seen.has(expected.code)) {
				errors.push(`Indicator ${expected.code} is missing from the parquet`);
			}
		}

		for (const row of perIndicator) {
			const expected = EXPORTACIONES_INDICATORS.find((item) => item.code === row.INDICATOR);
			if (!expected) {
				errors.push(`Parquet contains unexpected indicator ${row.INDICATOR}`);
				continue;
			}
			if (row.INDICATOR_NAME !== expected.name) {
				errors.push(`${row.INDICATOR}: name is "${row.INDICATOR_NAME}", expected "${expected.name}"`);
			}
			if (row.UNIT !== expected.unit) {
				errors.push(`${row.INDICATOR}: unit is ${row.UNIT}, expected ${expected.unit}`);
			}
			if (row.dim !== expected.dimension) {
				errors.push(`${row.INDICATOR}: FORMULA dimension is ${row.dim}, expected ${expected.dimension}`);
			}
			if (row.meas !== expected.measure) {
				errors.push(`${row.INDICATOR}: FORMULA measure is ${row.meas}, expected ${expected.measure}`);
			}
			if (toNumber(row.n) !== expected.rowCount) {
				errors.push(`${row.INDICATOR}: ${toNumber(row.n)} rows, expected ${expected.rowCount}`);
			}
			if (toNumber(row.cats) !== expected.observedCategories) {
				errors.push(
					`${row.INDICATOR}: ${toNumber(row.cats)} distinct categories, expected ${expected.observedCategories}`
				);
			}
		}

		// Codelist sizes, per the workbook's own VALIDACION sheet.
		const codelistCounts = await db.query<{ DIMENSION: string; n: unknown }>(
			'SELECT DIMENSION, COUNT(*) AS n FROM codelist GROUP BY 1 ORDER BY 1'
		);
		const countByDimension = new Map(
			codelistCounts.map((row) => [row.DIMENSION, toNumber(row.n)] as const)
		);
		for (const dimension of [...EXPORTACIONES_DIMENSIONS, ...EXPORTACIONES_UNUSED_CODELISTS]) {
			const found = countByDimension.get(dimension.code);
			if (found === undefined) {
				errors.push(`Codelist is missing dimension ${dimension.code}`);
			} else if (found !== dimension.codelistSize) {
				errors.push(
					`Codelist ${dimension.code} has ${found} codes, expected ${dimension.codelistSize}`
				);
			}
		}

		const [duplicateKeys] = await db.query<{ n: unknown }>(`
			SELECT COUNT(*) AS n FROM (
				SELECT DIMENSION, MATCH_KEY FROM codelist GROUP BY 1, 2 HAVING COUNT(*) > 1
			)
		`);
		if (toNumber(duplicateKeys?.n) > 0) {
			errors.push(`${toNumber(duplicateKeys.n)} duplicate (dimension, match_key) codelist entries`);
		}

		// The workbook's INDICATOR_MAP must agree with the contract and with FORMULA.
		const indicatorMap = await db.query<{ INDICATOR: string; DIMENSION: string; MEASURE: string }>(
			'SELECT INDICATOR, DIMENSION, MEASURE FROM indicator_map ORDER BY INDICATOR'
		);
		for (const row of indicatorMap) {
			const expected = EXPORTACIONES_INDICATORS.find((item) => item.code === row.INDICATOR);
			if (!expected) {
				errors.push(`INDICATOR_MAP references unknown indicator ${row.INDICATOR}`);
				continue;
			}
			if (row.DIMENSION !== expected.dimension || row.MEASURE !== expected.measure) {
				errors.push(
					`INDICATOR_MAP says ${row.INDICATOR} is ${row.DIMENSION}/${row.MEASURE}, contract says ${expected.dimension}/${expected.measure}`
				);
			}
		}

		// The check that actually matters for labelling: every observed category
		// must resolve in the codelist for its indicator's dimension.
		const unmatched = await db.query<{ DIMENSION: string; CATEGORY: string; n: unknown }>(`
			SELECT m.DIMENSION, o.CATEGORY, COUNT(*) AS n
			FROM obs o
			JOIN indicator_map m ON m.INDICATOR = o.INDICATOR
			LEFT JOIN codelist c ON c.DIMENSION = m.DIMENSION AND c.MATCH_KEY = o.CATEGORY
			WHERE c.MATCH_KEY IS NULL
			GROUP BY 1, 2 ORDER BY 1, 2
		`);
		for (const row of unmatched) {
			errors.push(
				`Category ${row.CATEGORY} (${row.DIMENSION}) has no codelist entry; ${toNumber(row.n)} row(s) affected`
			);
		}

		const mismatchedLabels = await db.query<{
			DIMENSION: string;
			CATEGORY: string;
			parquet_label: string;
			codelist_label: string;
		}>(`
			SELECT m.DIMENSION, o.CATEGORY,
				ANY_VALUE(o.CATEGORY_LABEL) AS parquet_label,
				ANY_VALUE(c.CATEGORY_LABEL) AS codelist_label
			FROM obs o
			JOIN indicator_map m ON m.INDICATOR = o.INDICATOR
			JOIN codelist c ON c.DIMENSION = m.DIMENSION AND c.MATCH_KEY = o.CATEGORY
			WHERE o.CATEGORY_LABEL IS DISTINCT FROM c.CATEGORY_LABEL
			GROUP BY 1, 2 ORDER BY 1, 2
		`);
		for (const row of mismatchedLabels) {
			errors.push(
				`Label mismatch for ${row.CATEGORY} (${row.DIMENSION}): parquet "${row.parquet_label}" vs codelist "${row.codelist_label}"`
			);
		}

		const [codelistRows] = await db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM codelist');

		return {
			ok: errors.length === 0,
			errors,
			stats: {
				rowCount,
				indicatorCount,
				periodStart: totals?.t0,
				periodEnd: totals?.t1,
				codelistRows: toNumber(codelistRows?.n)
			}
		};
	} finally {
		db.close();
	}
}
