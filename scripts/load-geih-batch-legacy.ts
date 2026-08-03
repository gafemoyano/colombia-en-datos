#!/usr/bin/env tsx
// -----------------------------------------------------------------------------
// scripts/load-geih-batch-legacy.ts
//
// Fallback one-off loader for the pre-Phase-1 ("legacy master") schema:
//   areas, categories, indicators, indicator_files
//
// This script is useful when you want GEIH live on a branch that has NOT yet
// merged the Phase 1 schema changes (data_sources, indicator_groups,
// data_releases, indicator_data_sources, canonical observations.duckdb).
//
// Instead of writing to a single canonical DuckDB, it splits the multi-
// indicator Parquet into one file per indicator per year and registers each
// file in indicator_files, matching the legacy app's expectation.
//
// Usage (local development):
//   DATABASE_URL=... \
//   DATA_PATH=./data \
//   tsx scripts/load-geih-batch-legacy.ts data/geih_2021_2026_arq_ok_v2.parquet --dry-run
//
//   DATABASE_URL=... \
//   DATA_PATH=./data \
//   tsx scripts/load-geih-batch-legacy.ts data/geih_2021_2026_arq_ok_v2.parquet --publish
//
// On Fly.io the volume is mounted at /data and fly.toml sets DATA_PATH=/data,
// so run the script with DATA_PATH=/data.
//
// ⚠️  DISCLAIMER: Disposable bootstrap script. Replace once the batch ingest
// architecture (ingest_batches, staging, canonical store) lands.
// -----------------------------------------------------------------------------

import 'dotenv/config';
import duckdb from 'duckdb';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { db } from '../src/lib/db/script-client';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AREA_CODE = 'geih';
const AREA_NAME = 'Gran Encuesta Integrada de Hogares (GEIH)';
const CATEGORY_CODE = 'geih_totales';
const CATEGORY_NAME = 'GEIH - Totales';
const SOURCE = 'GEIH';

const DEFAULT_INDICATOR_NAMES: Record<string, string> = {
	pob_total: 'Población total',
	viviendas: 'Viviendas',
	hogares: 'Hogares',
	mean_personas_hogar: 'Promedio de personas por hogar',
	pet: 'Población en edad de trabajar',
	pea: 'Población económicamente activa',
	ocupados: 'Ocupados',
	desocupados: 'Desocupados',
	to: 'Tasa de ocupación',
	tgp: 'Tasa global de participación',
	tdsi: 'Tasa de desempleo'
};

interface SourceSlice {
	indicatorCode: string;
	freq: string;
	refArea: string;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	years: number[];
	periodStart: string;
	periodEnd: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const filePath = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const publish = args.includes('--publish');

function printUsage() {
	console.log(`
Usage:
  tsx scripts/load-geih-batch-legacy.ts <parquet-file> --dry-run
  tsx scripts/load-geih-batch-legacy.ts <parquet-file> --publish

Environment:
  DATABASE_URL       Metadata database URL (required)
  TURSO_AUTH_TOKEN   Turso auth token (required for remote libsql URLs)
  DATA_PATH          Root directory for output parquet files (default: ./data)
                     On Fly.io this should match the mounted volume path (/data).
  DUCKDB_PATH        Deprecated alias for DATA_PATH.
`);
}

if (!filePath) {
	console.error('Error: Parquet file path is required.');
	printUsage();
	process.exit(1);
}

if (!dryRun && !publish) {
	console.error('Error: Specify exactly one of --dry-run or --publish.');
	printUsage();
	process.exit(1);
}

if (dryRun && publish) {
	console.error('Error: --dry-run and --publish are mutually exclusive.');
	printUsage();
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dataPath(): string {
	if (process.env.DATA_PATH) {
		return resolve(process.env.DATA_PATH);
	}
	if (process.env.DUCKDB_PATH) {
		return resolve(process.env.DUCKDB_PATH);
	}
	return resolve(process.cwd(), 'data');
}

function escapeSqlString(value: string): string {
	return value.replace(/'/g, "''");
}

function sha256File(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(path);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function runDuckDb(database: duckdb.Database, sql: string, ...params: unknown[]): Promise<void> {
	return new Promise((resolve, reject) => {
		database.run(sql, ...params, (error: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function queryDuckDb<T>(
	database: duckdb.Database,
	sql: string,
	...params: unknown[]
): Promise<T[]> {
	return new Promise((resolve, reject) => {
		database.all(sql, ...params, (error: Error | null, rows: T[]) => {
			if (error) reject(error);
			else resolve(rows);
		});
	});
}

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function indicatorName(code: string): string {
	return DEFAULT_INDICATOR_NAMES[code] || code;
}

// Raw SQL helper. We bypass Drizzle's relational API because this script targets
// the legacy schema and we do not want a hard dependency on the current branch's
// schema exports.
const rawClient = (db as any).$client as {
	execute: (sql: string) => Promise<{
		columns: string[];
		rows: unknown[][];
		rowsAffected: number;
		lastInsertRowid: number | bigint | null;
	}>;
};

async function runSql(
	sql: string
): Promise<{ rows: unknown[][]; columns: string[]; lastInsertRowid: number | null }> {
	const result = await rawClient.execute(sql);
	const lastInsertRowid =
		result.lastInsertRowid === null
			? null
			: typeof result.lastInsertRowid === 'bigint'
				? Number(result.lastInsertRowid)
				: result.lastInsertRowid;
	return { rows: result.rows, columns: result.columns, lastInsertRowid };
}

function rowObject(row: unknown[], columns: string[]): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	for (let i = 0; i < columns.length; i++) {
		obj[columns[i]] = row[i];
	}
	return obj;
}

async function runSqlSingle(sql: string): Promise<Record<string, unknown> | undefined> {
	const { rows, columns } = await runSql(sql);
	if (rows.length === 0) return undefined;
	return rowObject(rows[0], columns);
}

async function assertLegacySchema(): Promise<void> {
	const { rows } = await runSql(
		"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('areas','categories','indicators','indicator_files')"
	);
	const found = new Set(rows.map((r: any) => (Array.isArray(r) ? r[0] : r.name)));
	const missing = ['areas', 'categories', 'indicators', 'indicator_files'].filter(
		(t) => !found.has(t)
	);
	if (missing.length > 0) {
		throw new Error(
			`Legacy schema tables missing: ${missing.join(', ')}. ` +
				'This script is for the pre-Phase-1 schema. Use scripts/load-geih-batch.ts for the Phase 1 schema.'
		);
	}
}

function indicatorDirectory(basePath: string, indicatorCode: string): string {
	return join(
		basePath,
		AREA_CODE,
		CATEGORY_CODE,
		`FREQ=M`,
		`INDICATOR=${indicatorCode}`,
		'REF_AREA=CO'
	);
}

function indicatorFilePath(basePath: string, indicatorCode: string, year: number): string {
	return join(indicatorDirectory(basePath, indicatorCode), `part-${year}.parquet`);
}

function cleanIndicatorOutput(basePath: string, indicatorCode: string): void {
	const dir = indicatorDirectory(basePath, indicatorCode);
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (entry.endsWith('.parquet')) {
			unlinkSync(join(dir, entry));
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const parquetPath = resolve(filePath!);
	const outputBasePath = dataPath();
	const sourceName = basename(parquetPath);

	console.log('[load-geih-legacy] Parquet file:', parquetPath);
	console.log('[load-geih-legacy] Output data path:', outputBasePath);
	console.log('[load-geih-legacy] Mode:', dryRun ? 'DRY RUN' : 'PUBLISH');

	const checksum = await sha256File(parquetPath);
	console.log('[load-geih-legacy] Source checksum:', checksum);

	await assertLegacySchema();

	// Profile the file in an in-memory DuckDB instance.
	const profileDb = new duckdb.Database(':memory:');
	const escapedPath = escapeSqlString(parquetPath);
	const profileSql = `
		SELECT
			INDICADOR AS indicator_code,
			FREQ AS freq,
			REF_AREA AS ref_area,
			ANY_VALUE(UNIT) AS unit,
			ANY_VALUE(UNIT_MULT) AS unit_mult,
			ANY_VALUE(DECIMALS) AS decimals,
			ARRAY_AGG(DISTINCT YEAR ORDER BY YEAR) AS years,
			MIN(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_start,
			MAX(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_end
		FROM read_parquet('${escapedPath}')
		GROUP BY INDICADOR, FREQ, REF_AREA
		ORDER BY INDICADOR
	`;

	const rawSlices = await queryDuckDb<{
		indicator_code: string;
		freq: string;
		ref_area: string;
		unit: string | null;
		unit_mult: number | bigint | null;
		decimals: number | bigint | null;
		years: number[];
		period_start: string;
		period_end: string;
	}>(profileDb, profileSql);

	const slices: SourceSlice[] = rawSlices.map((row) => ({
		indicatorCode: row.indicator_code,
		freq: row.freq,
		refArea: row.ref_area,
		unit: row.unit,
		unitMult: toNumber(row.unit_mult),
		decimals: toNumber(row.decimals),
		years: Array.isArray(row.years) ? row.years : [],
		periodStart: row.period_start,
		periodEnd: row.period_end
	}));

	console.log(`[load-geih-legacy] Derived ${slices.length} slice(s) from file`);
	for (const slice of slices) {
		console.log(
			`  - ${slice.indicatorCode}/${slice.freq} (${slice.refArea}): ${slice.years.length} years, ${slice.periodStart}..${slice.periodEnd}`
		);
	}

	if (dryRun) {
		console.log('[load-geih-legacy] Dry run complete. No changes were made.');
		profileDb.close();
		return;
	}

	// -----------------------------------------------------------------------
	// Publish: metadata upserts + per-year parquet files + indicator_files
	// -----------------------------------------------------------------------

	// Upsert area.
	let areaRow = await runSqlSingle(
		`SELECT id FROM areas WHERE code = '${escapeSqlString(AREA_CODE)}' LIMIT 1`
	);
	if (!areaRow) {
		await runSql(
			`INSERT INTO areas (code, name, description) VALUES ('${escapeSqlString(AREA_CODE)}', '${escapeSqlString(AREA_NAME)}', NULL)`
		);
		areaRow = await runSqlSingle(
			`SELECT id FROM areas WHERE code = '${escapeSqlString(AREA_CODE)}' LIMIT 1`
		);
		console.log(`[load-geih-legacy] Created area: ${AREA_CODE}`);
	} else {
		console.log(`[load-geih-legacy] Using existing area: ${AREA_CODE}`);
	}
	const areaId = (areaRow as any).id as number;

	// Upsert category.
	let categoryRow = await runSqlSingle(
		`SELECT id FROM categories WHERE area_id = ${areaId} AND code = '${escapeSqlString(CATEGORY_CODE)}' LIMIT 1`
	);
	if (!categoryRow) {
		await runSql(
			`INSERT INTO categories (area_id, code, name, description) VALUES (${areaId}, '${escapeSqlString(CATEGORY_CODE)}', '${escapeSqlString(CATEGORY_NAME)}', NULL)`
		);
		categoryRow = await runSqlSingle(
			`SELECT id FROM categories WHERE area_id = ${areaId} AND code = '${escapeSqlString(CATEGORY_CODE)}' LIMIT 1`
		);
		console.log(`[load-geih-legacy] Created category: ${CATEGORY_CODE}`);
	} else {
		console.log(`[load-geih-legacy] Using existing category: ${CATEGORY_CODE}`);
	}
	const categoryId = (categoryRow as any).id as number;

	// Preload existing indicators for the codes we will publish.
	const codeList = slices.map((s) => `'${escapeSqlString(s.indicatorCode)}'`).join(',');
	const { rows: existingIndicatorRows, columns: indicatorColumns } = await runSql(
		`SELECT id, code, frequency, source, metadata FROM indicators WHERE code IN (${codeList})`
	);
	const existingIndicators = new Map<string, Record<string, unknown>>();
	for (const row of existingIndicatorRows) {
		const obj = rowObject(row, indicatorColumns);
		existingIndicators.set(String(obj.code), obj);
	}

	for (const slice of slices) {
		console.log(`[load-geih-legacy] Publishing ${slice.indicatorCode}/${slice.freq}...`);

		// Upsert indicator row.
		let indicator = existingIndicators.get(slice.indicatorCode);
		const metadata = JSON.stringify({
			unit: slice.unit,
			unit_mult: slice.unitMult,
			decimals: slice.decimals,
			source_checksum: checksum
		});

		if (!indicator) {
			await runSql(
				`INSERT INTO indicators (category_id, code, name, description, frequency, source, metadata) ` +
					`VALUES (${categoryId}, '${escapeSqlString(slice.indicatorCode)}', '${escapeSqlString(indicatorName(slice.indicatorCode))}', NULL, '${escapeSqlString(slice.freq)}', '${escapeSqlString(SOURCE)}', '${escapeSqlString(metadata)}')`
			);
			indicator = await runSqlSingle(
				`SELECT id, code, frequency, source, metadata FROM indicators WHERE code = '${escapeSqlString(slice.indicatorCode)}' LIMIT 1`
			);
			console.log(`[load-geih-legacy]   Created indicator: ${slice.indicatorCode}`);
		} else {
			// Preserve existing name/description; only fill in missing metadata.
			const updates: string[] = [];
			if (!indicator.frequency) updates.push(`frequency = '${escapeSqlString(slice.freq)}'`);
			if (!indicator.source) updates.push(`source = '${escapeSqlString(SOURCE)}'`);
			if (!indicator.metadata) updates.push(`metadata = '${escapeSqlString(metadata)}'`);

			if (updates.length > 0) {
				await runSql(`UPDATE indicators SET ${updates.join(', ')} WHERE id = ${indicator.id}`);
				console.log(`[load-geih-legacy]   Updated indicator metadata: ${slice.indicatorCode}`);
			}
		}
		const indicatorId = (indicator as any).id as number;

		// Remove stale indicator_files rows and parquet files for this indicator.
		await runSql(
			`DELETE FROM indicator_files WHERE indicator_id = ${indicatorId} AND ref_area = '${escapeSqlString(slice.refArea)}'`
		);
		cleanIndicatorOutput(outputBasePath, slice.indicatorCode);

		// Write one parquet file per year for this indicator.
		for (const year of slice.years) {
			const outPath = indicatorFilePath(outputBasePath, slice.indicatorCode, year);
			mkdirSync(dirname(outPath), { recursive: true });

			const copySql = `
				COPY (
					SELECT
						INDICADOR AS INDICATOR,
						FREQ,
						REF_AREA,
						PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER)) AS TIME_PERIOD,
						OBS_VALUE,
						UNIT,
						UNIT_MULT,
						DECIMALS,
						COALESCE(OBS_STATUS, 'A') AS OBS_STATUS
					FROM read_parquet('${escapedPath}')
					WHERE INDICADOR = '${escapeSqlString(slice.indicatorCode)}'
					  AND FREQ = '${escapeSqlString(slice.freq)}'
					  AND YEAR = ${year}
				) TO '${escapeSqlString(outPath)}' (FORMAT PARQUET)
			`;
			await runDuckDb(profileDb, copySql);

			const storedPath = outPath;
			await runSql(
				`INSERT INTO indicator_files (indicator_id, ref_area, year, file_path) ` +
					`VALUES (${indicatorId}, '${escapeSqlString(slice.refArea)}', ${year}, '${escapeSqlString(storedPath)}')`
			);
			console.log(`[load-geih-legacy]   Wrote ${storedPath}`);
		}
	}

	profileDb.close();
	console.log('[load-geih-legacy] Done.');
}

main().catch((error) => {
	console.error('[load-geih-legacy] Failed:', error);
	process.exit(1);
});
