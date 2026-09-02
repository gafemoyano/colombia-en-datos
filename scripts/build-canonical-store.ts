/**
 * Builds the canonical DuckDB store from the SDMX parquets in data/canonical/.
 *
 * This script has no per-survey branches, and it must stay that way. Every
 * file it reads is expected to satisfy the same 36-column contract (see
 * canonical-schema.ts); anything that does not is reported and skipped rather
 * than silently partially loaded.
 *
 * Replaces create-canonical-store.ts, which scanned ~35k small parquets via
 * symlink batching and had a hardcoded escape hatch for exportaciones because
 * its generic SELECT had no column for CATEGORY.
 *
 *   npm run canonical:build
 *
 * Env:
 *   CANONICAL_SOURCE_DIR  where the survey folders live (default data/canonical)
 *   CANONICAL_DUCKDB_PATH final store path (default $DATA_PATH/observations.duckdb)
 *   CANONICAL_BUILD_PATH  temp build path (default <final>.next-<ts>)
 */

import duckdb from 'duckdb';
import { basename, dirname, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs';
import {
	CANONICAL_PARQUET_COLUMNS,
	CANONICAL_SCHEMA_VERSION,
	INDICATORS_DDL,
	INDICATOR_CATEGORIES_DDL,
	OBSERVATIONS_DDL
} from '../src/lib/server/canonical-schema';

const DATA_PATH = process.env.DATA_PATH
	? resolve(process.env.DATA_PATH)
	: resolve(process.cwd(), 'data');
const SOURCE_DIR = process.env.CANONICAL_SOURCE_DIR
	? resolve(process.env.CANONICAL_SOURCE_DIR)
	: resolve(DATA_PATH, 'canonical');
const CANONICAL_PATH = process.env.CANONICAL_DUCKDB_PATH
	? resolve(process.env.CANONICAL_DUCKDB_PATH)
	: resolve(DATA_PATH, 'observations.duckdb');
const BUILD_PATH = process.env.CANONICAL_BUILD_PATH
	? resolve(process.env.CANONICAL_BUILD_PATH)
	: `${CANONICAL_PATH}.next-${Date.now()}`;

interface SourceFile {
	survey: string;
	path: string;
}

function findSourceParquets(dir: string): SourceFile[] {
	if (!existsSync(dir)) {
		throw new Error(`Canonical source directory not found: ${dir}`);
	}
	const files: SourceFile[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		if (!entry.isDirectory()) continue;
		const surveyDir = resolve(dir, entry.name);
		for (const file of readdirSync(surveyDir)) {
			if (file.startsWith('.') || !file.endsWith('.parquet')) continue;
			files.push({ survey: entry.name, path: resolve(surveyDir, file) });
		}
	}
	return files.sort((a, b) => a.survey.localeCompare(b.survey));
}

function sqlPath(p: string): string {
	return p.replace(/'/g, "''");
}

async function main() {
	const db = new duckdb.Database(BUILD_PATH);
	const conn = db.connect();
	const run = (sql: string) =>
		new Promise<void>((res, rej) => conn.run(sql, (e: Error | null) => (e ? rej(e) : res())));
	const all = <T = any>(sql: string) =>
		new Promise<T[]>((res, rej) =>
			conn.all(sql, (e: Error | null, rows: any) => (e ? rej(e) : res(rows as T[])))
		);

	console.log('[canonical] source :', SOURCE_DIR);
	console.log('[canonical] build  :', BUILD_PATH);
	console.log('[canonical] final  :', CANONICAL_PATH);

	const sources = findSourceParquets(SOURCE_DIR);
	if (sources.length === 0) throw new Error(`No parquet files found under ${SOURCE_DIR}`);
	console.log(`[canonical] found ${sources.length} survey parquets\n`);

	// --- contract check: every file, before we load any of it -----------------
	const accepted: SourceFile[] = [];
	const rejected: { file: SourceFile; reason: string }[] = [];

	for (const source of sources) {
		const cols = await all<{ column_name: string }>(
			`DESCRIBE SELECT * FROM read_parquet('${sqlPath(source.path)}')`
		);
		const actual = cols.map((c) => c.column_name);
		const expected = [...CANONICAL_PARQUET_COLUMNS];
		const missing = expected.filter((c) => !actual.includes(c));
		const extra = actual.filter((c) => !expected.includes(c as any));

		if (missing.length > 0 || extra.length > 0) {
			const reason = [
				missing.length ? `missing: ${missing.join(', ')}` : '',
				extra.length ? `unexpected: ${extra.join(', ')}` : ''
			]
				.filter(Boolean)
				.join(' | ');
			rejected.push({ file: source, reason });
			console.error(`  ✗ ${source.survey}/${basename(source.path)}`);
			console.error(`      ${reason}`);
			continue;
		}
		accepted.push(source);
		console.log(`  ✓ ${source.survey}/${basename(source.path)} — 36/36 columns`);
	}

	if (accepted.length === 0) throw new Error('No source file satisfied the canonical contract');
	console.log('');

	await run(OBSERVATIONS_DDL);
	await run(INDICATOR_CATEGORIES_DDL);
	await run(INDICATORS_DDL);

	// --- load ------------------------------------------------------------------
	// One statement per file, identical for every survey. The parquet column
	// names map 1:1 onto the table, so there is nothing to special-case.
	for (const source of accepted) {
		const p = sqlPath(source.path);
		const started = Date.now();

		await run(`
			INSERT INTO observations
			SELECT
				DATAFLOW, INDICATOR, FREQ, TIME_PERIOD, REF_AREA, DEPT_CODE, MUNI_CODE,
				GEO_LEVEL, AREA, DOMAIN, CLASE, URBAN_RURAL, SEX, HEAD_SEX, AGE,
				CATEGORY, ADJUSTMENT,
				OBS_VALUE,
				UNIT, UNIT_MULT, DECIMALS, OBS_STATUS, WEIGHT_TYPE, ESTIMATION_SCOPE,
				REPRESENTATIVE,
				YEAR, MONTH
			FROM read_parquet('${p}')
		`);

		// Codelists are keyed per indicator, never globally -- see canonical-schema.
		await run(`
			INSERT INTO indicator_categories
			SELECT INDICATOR, CATEGORY, any_value(CATEGORY_LABEL), count(*)
			FROM read_parquet('${p}')
			GROUP BY INDICATOR, CATEGORY
		`);

		// Indicator-level facts, deduplicated out of the observation rows.
		await run(`
			INSERT INTO indicator_meta
			SELECT
				INDICATOR,
				any_value(DATAFLOW),
				any_value(INDICATOR_NAME),
				any_value(THEME),
				any_value(SOURCE),
				'${sqlPath(source.survey)}',
				any_value(UNIT),
				any_value(UNIT_MULT),
				any_value(DECIMALS),
				count(*),
				min(TIME_PERIOD),
				max(TIME_PERIOD),
				string_agg(DISTINCT FREQ, ','),
				count(DISTINCT CATEGORY)
			FROM read_parquet('${p}')
			GROUP BY INDICATOR
		`);

		const [{ n }] = await all<{ n: number }>(
			`SELECT count(*)::BIGINT AS n FROM read_parquet('${p}')`
		);
		console.log(
			`[canonical] ${source.survey.padEnd(14)} ${Number(n).toLocaleString().padStart(11)} rows` +
				`  (${((Date.now() - started) / 1000).toFixed(1)}s)`
		);
	}

	// --- indexes ---------------------------------------------------------------
	console.log('\n[canonical] building indexes...');
	await run('CREATE INDEX idx_obs_indicator ON observations(indicator_code, freq, time_period)');
	await run('CREATE INDEX idx_obs_geo ON observations(ref_area, geo_level)');
	await run('CREATE INDEX idx_cat_indicator ON indicator_categories(indicator_code)');

	// --- provenance ------------------------------------------------------------
	await run('CREATE TABLE _meta (key VARCHAR PRIMARY KEY, value VARCHAR)');
	const [{ rows }] = await all<{ rows: number }>(
		'SELECT count(*)::BIGINT AS rows FROM observations'
	);
	const [{ inds }] = await all<{ inds: number }>(
		'SELECT count(*)::BIGINT AS inds FROM indicator_meta'
	);
	const meta: Record<string, string> = {
		schema_version: String(CANONICAL_SCHEMA_VERSION),
		built_at: new Date().toISOString(),
		row_count: String(rows),
		indicator_count: String(inds),
		sources: accepted.map((s) => `${s.survey}/${basename(s.path)}`).join(';'),
		rejected: rejected.map((r) => `${r.file.survey}: ${r.reason}`).join(';')
	};
	for (const [k, v] of Object.entries(meta)) {
		await run(`INSERT INTO _meta VALUES ('${k}', '${sqlPath(v)}')`);
	}

	conn.close();
	db.close();
	await new Promise((r) => setTimeout(r, 250));

	mkdirSync(dirname(CANONICAL_PATH), { recursive: true });
	if (existsSync(CANONICAL_PATH)) rmSync(CANONICAL_PATH);
	renameSync(BUILD_PATH, CANONICAL_PATH);

	const size = statSync(CANONICAL_PATH).size;
	console.log(
		`\n[canonical] done — ${Number(rows).toLocaleString()} observations, ` +
			`${Number(inds).toLocaleString()} indicators, ${(size / 1024 / 1024).toFixed(0)} MB`
	);
	if (rejected.length > 0) {
		console.warn(`[canonical] ${rejected.length} file(s) rejected — see above`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('[canonical] FAILED:', err);
	try {
		if (existsSync(BUILD_PATH)) rmSync(BUILD_PATH);
	} catch {
		/* leave the temp file for inspection */
	}
	process.exit(1);
});
