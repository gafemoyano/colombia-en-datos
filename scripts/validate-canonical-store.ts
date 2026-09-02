/**
 * Validates the canonical DuckDB store against the source parquets.
 *
 * This is a differential check, not a smoke test: it re-reads data/canonical/
 * and asserts the store agrees with it. A loader that silently drops a column
 * (which is exactly how CATEGORY was lost before) passes a smoke test and
 * fails this.
 *
 *   npm run canonical:validate
 */

import duckdb from 'duckdb';
import { basename, resolve } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import {
	CANONICAL_KEY_COLUMNS,
	CANONICAL_SCHEMA_VERSION,
	OBSERVATION_ATTRIBUTES,
	OBSERVATION_DIMENSIONS
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

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = '') {
	checks++;
	if (ok) {
		console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
	} else {
		failures++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

function sqlPath(p: string) {
	return p.replace(/'/g, "''");
}

function sourceParquets(): { survey: string; path: string }[] {
	const out: { survey: string; path: string }[] = [];
	for (const entry of readdirSync(SOURCE_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		for (const f of readdirSync(resolve(SOURCE_DIR, entry.name))) {
			if (f.endsWith('.parquet') && !f.startsWith('.')) {
				out.push({ survey: entry.name, path: resolve(SOURCE_DIR, entry.name, f) });
			}
		}
	}
	return out.sort((a, b) => a.survey.localeCompare(b.survey));
}

async function main() {
	if (!existsSync(CANONICAL_PATH)) throw new Error(`Store not found: ${CANONICAL_PATH}`);

	const db = new duckdb.Database(CANONICAL_PATH);
	const conn = db.connect();
	const all = <T = any>(sql: string) =>
		new Promise<T[]>((res, rej) =>
			conn.all(sql, (e: Error | null, r: any) => (e ? rej(e) : res(r as T[])))
		);
	const one = async <T = any>(sql: string): Promise<T> => (await all<T>(sql))[0];

	console.log(`\nStore: ${CANONICAL_PATH} (${(statSync(CANONICAL_PATH).size / 1048576).toFixed(0)} MB)`);

	// -- schema -----------------------------------------------------------------
	console.log('\nSchema');
	const meta = await all<{ key: string; value: string }>('SELECT key, value FROM _meta');
	const metaMap = new Map(meta.map((m) => [m.key, m.value]));
	check(
		'schema_version',
		metaMap.get('schema_version') === String(CANONICAL_SCHEMA_VERSION),
		`expected ${CANONICAL_SCHEMA_VERSION}, got ${metaMap.get('schema_version')}`
	);
	check('no rejected source files', !metaMap.get('rejected'), metaMap.get('rejected') || 'none');

	const cols = await all<{ column_name: string }>('DESCRIBE observations');
	const colNames = cols.map((c) => c.column_name);
	for (const required of [...OBSERVATION_DIMENSIONS, ...OBSERVATION_ATTRIBUTES, 'obs_value']) {
		if (!colNames.includes(required)) check(`column ${required}`, false, 'missing');
	}
	check(
		'all dimension + attribute columns present',
		[...OBSERVATION_DIMENSIONS, ...OBSERVATION_ATTRIBUTES, 'obs_value'].every((c) =>
			colNames.includes(c)
		)
	);

	// -- per-survey differential vs source --------------------------------------
	console.log('\nRow counts vs source parquets');
	const sources = sourceParquets();
	for (const src of sources) {
		const p = sqlPath(src.path);
		const { n: srcRows } = await one<{ n: number }>(
			`SELECT count(*)::BIGINT n FROM read_parquet('${p}')`
		);
		const { n: storeRows } = await one<{ n: number }>(
			`SELECT count(*)::BIGINT n FROM observations o
			 WHERE o.indicator_code IN (SELECT DISTINCT INDICATOR FROM read_parquet('${p}'))`
		);
		check(
			`${src.survey}`,
			Number(srcRows) === Number(storeRows),
			`source ${Number(srcRows).toLocaleString()} / store ${Number(storeRows).toLocaleString()}`
		);
	}

	// -- value fidelity: full anti-join on the declared primary key -------------
	// Compares every key column and OBS_VALUE, not just counts, so a shifted or
	// dropped column is caught.
	console.log('\nValue fidelity (anti-join on primary key + obs_value)');
	const keyMap: Record<string, string> = {
		DATAFLOW: 'dataflow',
		FREQ: 'freq',
		INDICATOR: 'indicator_code',
		REF_AREA: 'ref_area',
		DEPT_CODE: 'dept_code',
		MUNI_CODE: 'muni_code',
		GEO_LEVEL: 'geo_level',
		AREA: 'area',
		DOMAIN: 'domain',
		CLASE: 'clase',
		URBAN_RURAL: 'urban_rural',
		SEX: 'sex',
		HEAD_SEX: 'head_sex',
		AGE: 'age',
		CATEGORY: 'category',
		ADJUSTMENT: 'adjustment',
		TIME_PERIOD: 'time_period'
	};
	for (const src of sources) {
		const p = sqlPath(src.path);
		const srcCols = [...CANONICAL_KEY_COLUMNS].map((c) => `"${c}"`).join(', ');
		const dstCols = [...CANONICAL_KEY_COLUMNS].map((c) => keyMap[c]).join(', ');
		const { n } = await one<{ n: number }>(`
			SELECT count(*)::BIGINT n FROM (
				SELECT ${srcCols}, OBS_VALUE FROM read_parquet('${p}')
				EXCEPT
				SELECT ${dstCols}, obs_value FROM observations
			)
		`);
		check(`${src.survey} rows round-trip`, Number(n) === 0, `${Number(n)} source rows not in store`);
	}

	// -- integrity --------------------------------------------------------------
	console.log('\nIntegrity');
	const nullCond = [...OBSERVATION_DIMENSIONS].map((d) => `${d} IS NULL`).join(' OR ');
	const { n: nulls } = await one<{ n: number }>(
		`SELECT count(*)::BIGINT n FROM observations WHERE ${nullCond}`
	);
	check('no null dimensions', Number(nulls) === 0, `${Number(nulls)} rows`);

	const dstKey = [...CANONICAL_KEY_COLUMNS].map((c) => keyMap[c]).join(', ');
	const { total } = await one<{ total: number }>(
		'SELECT count(*)::BIGINT total FROM observations'
	);
	const { distinct_keys } = await one<{ distinct_keys: number }>(
		`SELECT count(*)::BIGINT distinct_keys FROM (SELECT ${dstKey} FROM observations GROUP BY ALL)`
	);
	check(
		'primary key is unique',
		Number(total) === Number(distinct_keys),
		`${Number(total).toLocaleString()} rows / ${Number(distinct_keys).toLocaleString()} distinct keys`
	);

	// -- codelists are indicator-scoped -----------------------------------------
	console.log('\nCategory codelists');
	const { n: ambiguous } = await one<{ n: number }>(`
		SELECT count(*)::BIGINT n FROM (
			SELECT indicator_code, category FROM indicator_categories
			GROUP BY 1, 2 HAVING count(DISTINCT category_label) > 1
		)
	`);
	check('(indicator, category) -> one label', Number(ambiguous) === 0, `${Number(ambiguous)} violations`);

	const { n: collisions } = await one<{ n: number }>(`
		SELECT count(*)::BIGINT n FROM (
			SELECT category FROM indicator_categories WHERE category <> '_T'
			GROUP BY 1 HAVING count(DISTINCT category_label) > 1
		)
	`);
	check(
		'codes are reused across indicators (expected)',
		Number(collisions) > 0,
		`${Number(collisions)} codes carry >1 meaning — confirms per-indicator scoping is required`
	);

	const { n: orphans } = await one<{ n: number }>(`
		SELECT count(*)::BIGINT n FROM (
			SELECT DISTINCT indicator_code, category FROM observations
			EXCEPT
			SELECT indicator_code, category FROM indicator_categories
		)
	`);
	check('every observed category has a codelist row', Number(orphans) === 0, `${Number(orphans)} orphans`);

	// -- the cases that previously needed bespoke code ---------------------------
	console.log('\nPreviously-bespoke cases');
	const expo = await all<{ category: string; category_label: string }>(`
		SELECT category, category_label FROM indicator_categories
		WHERE indicator_code = 'EXPORTACIONES_PI_005' AND category <> '_T'
		ORDER BY category LIMIT 3
	`);
	const { n: expoCats } = await one<{ n: number }>(`
		SELECT count(*)::BIGINT n FROM indicator_categories
		WHERE indicator_code = 'EXPORTACIONES_PI_005' AND category <> '_T'
	`);
	check(
		'exportaciones country breakdown survives generic load',
		Number(expoCats) === 232,
		`${Number(expoCats)} countries, e.g. ${expo.map((r) => `${r.category}=${r.category_label}`).join(', ')}`
	);

	const geih = await all<{ indicator_code: string; category_label: string }>(`
		SELECT indicator_code, category_label FROM indicator_categories
		WHERE category = '1' AND indicator_code IN ('GEIH_PI_028','GEIH_PI_034','GEIH_PI_110')
		ORDER BY indicator_code
	`);
	check(
		'GEIH code "1" resolves per indicator',
		geih.length === 3 && new Set(geih.map((g) => g.category_label)).size === 3,
		geih.map((g) => `${g.indicator_code}=${g.category_label}`).join(', ')
	);

	// -- attributes that vary within an indicator -------------------------------
	const { n: multiAttr } = await one<{ n: number }>(`
		SELECT count(*)::BIGINT n FROM (
			SELECT indicator_code FROM observations
			GROUP BY 1 HAVING count(DISTINCT estimation_scope) > 1 OR count(DISTINCT representative) > 1
		)
	`);
	check(
		'per-observation attributes preserved',
		Number(multiAttr) > 0,
		`${Number(multiAttr)} indicators vary scope/representative across rows`
	);

	conn.close();
	db.close();

	console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`);
	if (failures > 0) process.exit(1);
}

main().catch((e) => {
	console.error('[canonical:validate] FAILED:', e);
	process.exit(1);
});
