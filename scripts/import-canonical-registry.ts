/**
 * Rebuilds the SQLite/Turso registry from the canonical survey metadata.
 *
 * Two inputs, each authoritative for different things:
 *   - data/canonical/<survey>/metadata_*.json  — titles, themes, collections,
 *     formulas, universes, declared dimensions
 *   - the canonical DuckDB store                — what is actually observed:
 *     category codelists, coverage, which dimensions really vary
 *
 * Where they disagree, the store wins: metadata_geih.json still lists 32
 * legacy indicators that have no observations, and importing those would put
 * dead entries in the catalogue.
 *
 * The script is a full rebuild, not an incremental sync -- it clears the
 * registry tables it owns and re-inserts. Running it twice is a no-op.
 *
 *   npm run registry:import                 # local (DATABASE_URL)
 *   npm run registry:import -- --prod       # Turso (TURSO_DATABASE_URL)
 */

import 'dotenv/config';
import duckdb from 'duckdb';
import { createClient, type Client } from '@libsql/client';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const USE_PROD = process.argv.includes('--prod');

const DATA_PATH = process.env.DATA_PATH
	? resolve(process.env.DATA_PATH)
	: resolve(process.cwd(), 'data');
const SOURCE_DIR = process.env.CANONICAL_SOURCE_DIR
	? resolve(process.env.CANONICAL_SOURCE_DIR)
	: resolve(DATA_PATH, 'canonical');
const STORE_PATH = process.env.CANONICAL_DUCKDB_PATH
	? resolve(process.env.CANONICAL_DUCKDB_PATH)
	: resolve(DATA_PATH, 'observations.duckdb');

/**
 * The canonical dimensions, and how each one collapses when the user has not
 * chosen a filter.
 *
 * `preference` lists the values to fall back through, best first. The default
 * is resolved per (indicator, frequency) against what is actually observed,
 * because coverage is not uniform: GEIH_PI_034 publishes NAT monthly but only
 * DEP and DEP_CLASS annually, so a fixed 'NAT' default returns nothing for its
 * annual series.
 *
 * CATEGORY has an empty preference list on purpose. 216 of the 230 indicators
 * with a category breakdown ship no '_T' row, so there is no total to collapse
 * to -- the Explorer splits by it instead.
 */
const DIMENSIONS: { code: string; name: string; preference: string[]; sort: number }[] = [
	{ code: 'GEO_LEVEL', name: 'Nivel geográfico', preference: ['NAT', 'DEP', 'CLASS', 'DEP_CLASS', 'AREA', 'MUN'], sort: 10 },
	{ code: 'REF_AREA', name: 'Departamento', preference: ['CO'], sort: 20 },
	{ code: 'MUNI_CODE', name: 'Municipio', preference: ['0000'], sort: 40 },
	{ code: 'AREA', name: 'Área metropolitana', preference: ['_T'], sort: 50 },
	{ code: 'DOMAIN', name: 'Dominio', preference: ['_T'], sort: 60 },
	{ code: 'CLASE', name: 'Clase', preference: ['_T'], sort: 70 },
	{ code: 'URBAN_RURAL', name: 'Cabecera / resto', preference: ['_T'], sort: 80 },
	{ code: 'SEX', name: 'Sexo', preference: ['_T'], sort: 90 },
	{ code: 'HEAD_SEX', name: 'Sexo del jefe/a de hogar', preference: ['_T'], sort: 100 },
	{ code: 'AGE', name: 'Grupo de edad', preference: ['_T'], sort: 110 },
	{ code: 'CATEGORY', name: 'Desagregación', preference: [], sort: 120 },
	{ code: 'ADJUSTMENT', name: 'Ajuste', preference: ['N'], sort: 130 }
];

/** Codelists that mean the same thing in every survey. */
const GLOBAL_VALUE_LABELS: Record<string, Record<string, string>> = {
	GEO_LEVEL: {
		NAT: 'Nacional',
		DEP: 'Departamental',
		CLASS: 'Cabecera / resto',
		DEP_CLASS: 'Departamental por clase',
		AREA: 'Área metropolitana',
		MUN: 'Municipal'
	},
	SEX: { M: 'Hombre', F: 'Mujer', _T: 'Total' },
	HEAD_SEX: { M: 'Hombre', F: 'Mujer', _T: 'Total' },
	URBAN_RURAL: { U: 'Cabecera', R: 'Centros poblados y rural disperso', _T: 'Total' },
	CLASE: { '1': 'Cabecera', '2': 'Centros poblados y rural disperso', _T: 'Total' },
	ADJUSTMENT: { N: 'Sin ajuste estacional', Y: 'Ajustada estacionalmente' },
	MUNI_CODE: { '0000': 'Todos los municipios' }
};

interface MetaIndicator {
	code?: string;
	title?: string;
	survey?: string;
	theme?: string;
	subcategory?: string;
	collection?: string;
	collections?: string[];
	dims?: string[];
	dimensions_total_only?: string[];
	default_viz?: string;
	unit?: string;
	unit_mult?: number;
	decimals?: number;
	formula?: string;
	universe?: string;
	source?: string;
	source_variables?: string;
	dataflow?: string;
	freq?: string[];
	codelists?: { CATEGORY?: { code: string; labels: string[] }[] };
	methodology_notes_by_geo_level?: Record<string, unknown>;
}

interface MetaCollection {
	title?: string;
	members?: string[];
	filter_whitelist?: string[];
	survey?: string;
	theme?: string;
}

function loadMetadata(): {
	survey: string;
	indicators: Record<string, MetaIndicator>;
	collections: Record<string, MetaCollection>;
}[] {
	const out = [];
	for (const entry of readdirSync(SOURCE_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		const dir = resolve(SOURCE_DIR, entry.name);
		const file = readdirSync(dir).find((f) => f.startsWith('metadata_') && f.endsWith('.json'));
		if (!file) {
			console.warn(`  ! ${entry.name}: no metadata_*.json, skipping`);
			continue;
		}
		const json = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
		out.push({
			survey: entry.name,
			indicators: json.indicators || {},
			collections: json.collections || {}
		});
	}
	return out.sort((a, b) => a.survey.localeCompare(b.survey));
}

function duck() {
	const db = new duckdb.Database(STORE_PATH, duckdb.OPEN_READONLY);
	const conn = db.connect();
	return {
		all: <T = any>(sql: string) =>
			new Promise<T[]>((res, rej) =>
				conn.all(sql, (e: Error | null, r: any) => (e ? rej(e) : res(r as T[])))
			),
		close: () => {
			conn.close();
			db.close();
		}
	};
}

function slug(s: string) {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

async function main() {
	const url = USE_PROD ? process.env.TURSO_DATABASE_URL : process.env.DATABASE_URL;
	const authToken = USE_PROD ? process.env.TURSO_AUTH_TOKEN : undefined;
	if (!url) throw new Error(USE_PROD ? 'TURSO_DATABASE_URL is not set' : 'DATABASE_URL is not set');
	if (!existsSync(STORE_PATH)) throw new Error(`Canonical store not found: ${STORE_PATH}`);

	console.log(`\nTarget : ${USE_PROD ? 'PRODUCTION TURSO' : 'local'} — ${url.replace(/\?.*/, '')}`);
	console.log(`Store  : ${STORE_PATH}`);
	console.log(`Metadata: ${SOURCE_DIR}\n`);

	const db: Client = createClient({ url, authToken });
	const store = duck();

	// -- observed truth from the canonical store --------------------------------
	const observedIndicators = await store.all<{
		indicator_code: string;
		survey: string;
		indicator_name: string;
		theme: string;
		source: string;
		dataflow: string;
		unit: string;
		unit_mult: number;
		decimals: number;
		time_min: string;
		time_max: string;
		freqs: string;
		obs_count: number;
	}>(`SELECT * FROM indicator_meta ORDER BY indicator_code`);

	const observedCategories = await store.all<{
		indicator_code: string;
		category: string;
		category_label: string;
		obs_count: number;
	}>(
		`SELECT indicator_code, category, category_label, obs_count
		 FROM indicator_categories ORDER BY indicator_code, category`
	);

	// Observed values per (indicator, frequency, dimension). Both facts we need
	// come from here: whether a dimension varies at all (a dimension that only
	// ever holds '_T' is not a control, just a dead dropdown) and which value it
	// should collapse to, which depends on what that indicator actually
	// publishes at that frequency.
	const observedValues = new Map<string, Set<string>>();
	const key = (indicator: string, freq: string, dim: string) => `${indicator}\u0000${freq}\u0000${dim}`;

	for (const dimension of DIMENSIONS) {
		const column = dimension.code.toLowerCase();
		const rows = await store.all<{ indicator_code: string; freq: string; v: string }>(
			`SELECT indicator_code, freq, ${column} AS v FROM observations GROUP BY 1, 2, 3`
		);
		for (const row of rows) {
			const k = key(row.indicator_code, row.freq, dimension.code);
			const set = observedValues.get(k) ?? new Set<string>();
			set.add(String(row.v));
			observedValues.set(k, set);
		}
	}

	/** Best available collapse value, or null when the dimension has no total. */
	function resolveDefault(dimension: { preference: string[] }, values: Set<string>): string | null {
		for (const candidate of dimension.preference) {
			if (values.has(candidate)) return candidate;
		}
		return null;
	}

	// Observed coverage per (indicator, freq, ref_area) for indicator_data_sources.
	const coverage = await store.all<{
		indicator_code: string;
		freq: string;
		ref_area: string;
		year_min: number;
		year_max: number;
		row_count: number;
	}>(`
		SELECT indicator_code, freq, ref_area,
			min(year)::INT AS year_min, max(year)::INT AS year_max, count(*)::BIGINT AS row_count
		FROM observations GROUP BY 1, 2, 3
	`);

	// Observed values of the global dimensions, for dimension_values.
	const globalValues: { dim: string; code: string }[] = [];
	for (const d of DIMENSIONS) {
		if (d.code === 'CATEGORY' || d.code === 'REF_AREA' || d.code === 'DEPT_CODE') continue;
		const rows = await store.all<{ v: string }>(
			`SELECT DISTINCT ${d.code.toLowerCase()} AS v FROM observations ORDER BY 1`
		);
		for (const r of rows) globalValues.push({ dim: d.code, code: String(r.v) });
	}

	store.close();

	const metas = loadMetadata();
	const metaByCode = new Map<string, { survey: string; meta: MetaIndicator }>();
	for (const m of metas) {
		for (const [code, ind] of Object.entries(m.indicators)) {
			metaByCode.set(code, { survey: m.survey, meta: ind });
		}
	}

	console.log(`Observed : ${observedIndicators.length} indicators, ${observedCategories.length} category rows`);
	const metaOnly = [...metaByCode.keys()].filter(
		(c) => !observedIndicators.some((o) => o.indicator_code === c)
	);
	console.log(`Metadata : ${metaByCode.size} entries (${metaOnly.length} with no observations — skipped)\n`);

	// -- clear the tables this script owns --------------------------------------
	// Ordered children-first so foreign keys stay satisfied.
	console.log('Clearing registry tables...');
	for (const table of [
		'indicator_categories',
		'indicator_dimensions',
		'indicator_frequencies',
		'indicator_data_sources',
		'indicator_files',
		'data_releases',
		'dimension_values',
		'dimension_definitions',
		'indicators',
		'indicator_groups',
		'data_sources'
	]) {
		try {
			const r = await db.execute(`DELETE FROM ${table}`);
			console.log(`  ${table.padEnd(24)} ${r.rowsAffected} rows removed`);
		} catch (e) {
			console.log(`  ${table.padEnd(24)} skipped (${String(e).split('\n')[0].slice(0, 60)})`);
		}
	}

	const batch: { sql: string; args: any[] }[] = [];
	const push = (sql: string, args: any[]) => batch.push({ sql, args });
	async function flush(label: string) {
		if (batch.length === 0) return;
		const chunkSize = 500;
		for (let i = 0; i < batch.length; i += chunkSize) {
			await db.batch(batch.slice(i, i + chunkSize), 'write');
		}
		console.log(`  ${label.padEnd(24)} ${batch.length} statements`);
		batch.length = 0;
	}

	console.log('\nWriting...');

	// -- dimension definitions + global codelists -------------------------------
	for (const d of DIMENSIONS) {
		push(
			'INSERT INTO dimension_definitions (code, name, sort_order, is_standard) VALUES (?, ?, ?, 1)',
			[d.code, d.name, d.sort]
		);
	}
	await flush('dimension_definitions');

	for (const { dim, code } of globalValues) {
		const label = GLOBAL_VALUE_LABELS[dim]?.[code] ?? (code === '_T' ? 'Total' : code);
		push('INSERT INTO dimension_values (dimension_code, code, label_es) VALUES (?, ?, ?)', [
			dim,
			code,
			label
		]);
	}
	await flush('dimension_values');

	// -- data sources ------------------------------------------------------------
	const surveys = [...new Set(observedIndicators.map((i) => i.survey))].sort();
	const sourceIdBySurvey = new Map<string, number>();
	for (const survey of surveys) {
		const sample = observedIndicators.find((i) => i.survey === survey);
		const r = await db.execute({
			sql: 'INSERT INTO data_sources (code, name, description) VALUES (?, ?, ?) RETURNING id',
			args: [slug(survey), survey, sample?.source ?? null]
		});
		sourceIdBySurvey.set(survey, Number(r.rows[0].id));
	}
	console.log(`  ${'data_sources'.padEnd(24)} ${surveys.length} rows`);

	// -- indicator groups, from the metadata collections -------------------------
	const groupIdByCode = new Map<string, number>();
	const groupCodeByIndicator = new Map<string, string>();
	for (const m of metas) {
		const dataSourceId = sourceIdBySurvey.get(m.survey);
		if (!dataSourceId) continue;
		for (const [code, collection] of Object.entries(m.collections)) {
			// GEIH ships a collection literally keyed "nan" holding its 32 legacy
			// indicators, none of which have observations.
			if (code === 'nan' || !collection.title) continue;
			const r = await db.execute({
				sql: `INSERT INTO indicator_groups (data_source_id, code, name, description, source_type, filter_whitelist)
				      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
				args: [
					dataSourceId,
					code,
					collection.title,
					collection.theme ?? null,
					m.survey,
					JSON.stringify(collection.filter_whitelist ?? [])
				]
			});
			groupIdByCode.set(code, Number(r.rows[0].id));
			for (const member of collection.members ?? []) {
				groupCodeByIndicator.set(String(member).replace(/^"|"$/g, ''), code);
			}
		}
	}
	console.log(`  ${'indicator_groups'.padEnd(24)} ${groupIdByCode.size} rows`);

	// A fallback group per survey, for indicators no collection claims.
	const fallbackGroupId = new Map<string, number>();
	for (const survey of surveys) {
		const r = await db.execute({
			sql: `INSERT INTO indicator_groups (data_source_id, code, name, source_type, filter_whitelist)
			      VALUES (?, ?, ?, ?, ?) RETURNING id`,
			args: [
				sourceIdBySurvey.get(survey)!,
				`${slug(survey).toUpperCase()}_OTROS`,
				`${survey} — otros indicadores`,
				survey,
				JSON.stringify([])
			]
		});
		fallbackGroupId.set(survey, Number(r.rows[0].id));
	}

	// -- indicators ---------------------------------------------------------------
	const indicatorIdByCode = new Map<string, number>();
	for (const obs of observedIndicators) {
		const entry = metaByCode.get(obs.indicator_code);
		const meta = entry?.meta ?? {};
		const groupCode = groupCodeByIndicator.get(obs.indicator_code) ?? meta.collection;
		const groupId =
			(groupCode ? groupIdByCode.get(groupCode) : undefined) ?? fallbackGroupId.get(obs.survey)!;

		const r = await db.execute({
			sql: `INSERT INTO indicators
			      (indicator_group_id, code, name, short_name, methodology, source_citation,
			       unit, unit_mult, decimals, default_viz,
			       survey, dataflow, theme, universe, formula, source_variables, time_min, time_max)
			      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
			args: [
				groupId,
				obs.indicator_code,
				meta.title ?? obs.indicator_name ?? obs.indicator_code,
				meta.title ?? obs.indicator_name ?? null,
				meta.methodology_notes_by_geo_level &&
				Object.keys(meta.methodology_notes_by_geo_level).length > 0
					? JSON.stringify(meta.methodology_notes_by_geo_level)
					: null,
				obs.source ?? null,
				obs.unit ?? null,
				obs.unit_mult ?? null,
				obs.decimals ?? null,
				meta.default_viz ?? 'time_series',
				obs.survey,
				obs.dataflow ?? null,
				obs.theme ?? null,
				meta.universe ?? null,
				meta.formula ?? null,
				meta.source_variables ?? null,
				obs.time_min ?? null,
				obs.time_max ?? null
			]
		});
		indicatorIdByCode.set(obs.indicator_code, Number(r.rows[0].id));
	}
	console.log(`  ${'indicators'.padEnd(24)} ${indicatorIdByCode.size} rows`);

	// -- frequencies ---------------------------------------------------------------
	for (const obs of observedIndicators) {
		const id = indicatorIdByCode.get(obs.indicator_code)!;
		for (const freq of String(obs.freqs).split(',').filter(Boolean)) {
			push('INSERT INTO indicator_frequencies (indicator_id, freq) VALUES (?, ?)', [id, freq]);
		}
	}
	await flush('indicator_frequencies');

	// -- dimensions per indicator and frequency --------------------------------------
	// Registered per frequency rather than with the '*' wildcard, because an
	// indicator's coverage differs between its monthly and annual series.
	let dimRows = 0;
	const unpinnable: string[] = [];
	for (const obs of observedIndicators) {
		const id = indicatorIdByCode.get(obs.indicator_code)!;
		for (const freq of String(obs.freqs).split(',').filter(Boolean)) {
			for (const d of DIMENSIONS) {
				const values = observedValues.get(key(obs.indicator_code, freq, d.code));
				if (!values || values.size <= 1) continue;

				const defaultValue = resolveDefault(d, values);
				if (defaultValue === null && d.code !== 'CATEGORY' && d.code !== 'REF_AREA') {
					// Would leave the Explorer unable to collapse this dimension, so
					// surface it rather than shipping a chart that silently multiplies.
					unpinnable.push(`${obs.indicator_code}/${freq}/${d.code}`);
				}
				push(
					`INSERT INTO indicator_dimensions
					 (indicator_id, freq, dimension_code, default_value, is_filterable, is_splitable)
					 VALUES (?, ?, ?, ?, 1, 1)`,
					[id, freq, d.code, defaultValue]
				);
				dimRows++;
			}
		}
	}
	await flush('indicator_dimensions');
	if (unpinnable.length > 0) {
		console.warn(
			`  ! ${unpinnable.length} dimension(s) have no value to collapse to, e.g. ${unpinnable
				.slice(0, 5)
				.join(', ')}`
		);
	}

	// -- per-indicator category codelists ---------------------------------------------
	let catRows = 0;
	for (const cat of observedCategories) {
		const id = indicatorIdByCode.get(cat.indicator_code);
		if (!id) continue;
		// Prefer the label the metadata publishes; fall back to the observed one.
		const metaList = metaByCode.get(cat.indicator_code)?.meta.codelists?.CATEGORY;
		const metaLabel = metaList?.find((c) => c.code === cat.category)?.labels?.[0];
		push(
			'INSERT INTO indicator_categories (indicator_id, code, label_es, sort_order, obs_count) VALUES (?, ?, ?, ?, ?)',
			[
				id,
				cat.category,
				metaLabel ?? cat.category_label ?? cat.category,
				metaList?.findIndex((c) => c.code === cat.category) ?? null,
				Number(cat.obs_count)
			]
		);
		catRows++;
	}
	await flush('indicator_categories');

	// -- releases -------------------------------------------------------------------------
	// The catalogue only lists an indicator whose coverage points at a published
	// release (getPublishedFrequenciesByIndicator inner-joins data_releases), so
	// every indicator needs one or it silently disappears from the Explorer.
	for (const obs of observedIndicators) {
		push(
			`INSERT INTO data_releases
			 (indicator_id, period_start, period_end, row_count, source_format, source_name, status)
			 VALUES (?, ?, ?, ?, 'parquet', ?, 'published')`,
			[
				indicatorIdByCode.get(obs.indicator_code)!,
				obs.time_min ?? null,
				obs.time_max ?? null,
				Number(obs.obs_count),
				`canonical/${obs.survey}`
			]
		);
	}
	await flush('data_releases');

	const releaseRows = await db.execute(
		'SELECT id, indicator_id FROM data_releases WHERE status = \'published\''
	);
	const releaseIdByIndicator = new Map<number, number>();
	for (const row of releaseRows.rows) {
		releaseIdByIndicator.set(Number(row.indicator_id), Number(row.id));
	}

	// -- observed coverage --------------------------------------------------------------
	for (const cov of coverage) {
		const id = indicatorIdByCode.get(cov.indicator_code);
		if (!id) continue;
		push(
			`INSERT INTO indicator_data_sources (indicator_id, ref_area, freq, year_min, year_max, row_count, release_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				cov.ref_area,
				cov.freq,
				cov.year_min,
				cov.year_max,
				Number(cov.row_count),
				releaseIdByIndicator.get(id) ?? null
			]
		);
	}
	await flush('indicator_data_sources');

	console.log(
		`\nDone — ${indicatorIdByCode.size} indicators, ${dimRows} dimension registrations, ` +
			`${catRows} category codes, ${coverage.length} coverage rows\n`
	);
	db.close();
}

main().catch((e) => {
	console.error('[registry:import] FAILED:', e);
	process.exit(1);
});
