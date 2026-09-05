// @vitest-environment node
//
// The canonical contract, checked end to end.
//
// Replaces the exportaciones-specific tests that used to live here. Those
// existed because exportaciones was the one survey whose breakdown needed
// bespoke loading; the point of these is that no survey does any more, so
// every assertion is made against all four rather than a named one.
//
// Needs the canonical store and the registry, so it skips unless both exist.

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function canonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) return resolve(process.env.CANONICAL_DUCKDB_PATH);
	if (process.env.DATA_PATH) return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	return join(process.cwd(), 'data', 'observations.duckdb');
}

const ready = Boolean(process.env.DATABASE_URL) && existsSync(canonicalDbPath());

const SURVEYS = ['GEIH', 'ECV', 'EMICRON', 'Exportaciones'] as const;

describe.skipIf(!ready)('canonical store', () => {
	it('carries every survey through one schema', async () => {
		const { runCanonicalQuery } = await import('$lib/server/duckdb');
		const rows = await runCanonicalQuery<{ survey: string; n: number }>(
			'SELECT survey, count(*)::INT AS n FROM indicator_meta GROUP BY survey'
		);
		const bySurvey = new Map(rows.map((r) => [r.survey, Number(r.n)]));
		for (const survey of SURVEYS) {
			expect(bySurvey.get(survey), `${survey} missing from the store`).toBeGreaterThan(0);
		}
	});

	it('keeps the declared primary key unique', async () => {
		const { runCanonicalQuery } = await import('$lib/server/duckdb');
		const [row] = await runCanonicalQuery<{ total: number; keys: number }>(`
			SELECT
				(SELECT count(*) FROM observations) AS total,
				(SELECT count(*) FROM (
					SELECT dataflow, freq, indicator_code, ref_area, dept_code, muni_code, geo_level,
						area, domain, clase, urban_rural, sex, head_sex, age, category, adjustment, time_period
					FROM observations GROUP BY ALL
				)) AS keys
		`);
		expect(Number(row.keys)).toBe(Number(row.total));
	});

	// The bug this guards: leaving a dimension unpinned does not mean "all", it
	// returns the total row and each part, so one series is drawn several times.
	it('returns exactly one row per period when all dimensions are pinned', async () => {
		const { runCanonicalQuery } = await import('$lib/server/duckdb');
		const [row] = await runCanonicalQuery<{ n: number }>(`
			SELECT count(*)::INT AS n FROM (
				SELECT time_period FROM observations
				WHERE indicator_code = 'EMICRON_PI_006' AND freq = 'A' AND geo_level = 'NAT'
					AND ref_area = 'CO' AND dept_code = '00' AND muni_code = '0000'
					AND area = '_T' AND domain = '_T' AND clase = '_T' AND urban_rural = '_T'
					AND sex = '_T' AND head_sex = '_T' AND age = '_T' AND adjustment = 'N'
					AND category = '04' AND time_period = '2024'
			)
		`);
		expect(Number(row.n)).toBe(1);
	});
});

describe.skipIf(!ready)('category codelists', () => {
	it('are scoped to one indicator', async () => {
		const { getDb } = await import('$lib/db/client');
		const { indicatorCategories, indicators } = await import('$lib/db/schema');
		const { eq, inArray } = await import('drizzle-orm');
		const db = getDb();

		const rows = await db
			.select({ indicator: indicators.code, label: indicatorCategories.labelEs })
			.from(indicatorCategories)
			.innerJoin(indicators, eq(indicatorCategories.indicatorId, indicators.id))
			.where(inArray(indicators.code, ['GEIH_PI_028', 'GEIH_PI_034', 'GEIH_PI_110']));

		// The same code '1' means three different things across these indicators,
		// which is why the codelist cannot be keyed on the code alone.
		const forCode1 = rows.filter((r) => r.label);
		expect(new Set(forCode1.map((r) => r.indicator)).size).toBe(3);
	});

	it('cover every category observed in the store', async () => {
		const { runCanonicalQuery } = await import('$lib/server/duckdb');
		const [row] = await runCanonicalQuery<{ n: number }>(`
			SELECT count(*)::INT AS n FROM (
				SELECT DISTINCT indicator_code, category FROM observations
				EXCEPT
				SELECT indicator_code, category FROM indicator_categories
			)
		`);
		expect(Number(row.n)).toBe(0);
	});
});

describe.skipIf(!ready)('the Explorer, for every survey', () => {
	async function model(search: string) {
		const { getExplorerPageModel } = await import('$lib/server/explorer');
		return getExplorerPageModel(new URL(`https://example.test/explore?${search}`));
	}

	// One case per survey, including the two that previously needed contract
	// files or had no breakdown support at all.
	const CASES: { code: string; freq: string; survey: string }[] = [
		{ code: 'EXPORTACIONES_PI_005', freq: 'M', survey: 'Exportaciones' },
		// GEIH monthly, not annual: its annual series are department-level by
		// construction (they use FEX_DPTO weights and publish no national row),
		// which the department-only case below covers instead.
		{ code: 'GEIH_PI_034', freq: 'M', survey: 'GEIH' },
		{ code: 'EMICRON_PI_006', freq: 'A', survey: 'EMICRON' },
		{ code: 'ECV_PI_024', freq: 'A', survey: 'ECV' }
	];

	for (const testCase of CASES) {
		it(`plots ${testCase.survey} (${testCase.code}) with an explicit category split`, async () => {
			const result = await model(`indicator=${testCase.code}&freq=${testCase.freq}&by=CATEGORY`);

			// Nothing should be left for the user to resolve: every dimension
			// either collapses to its default or becomes the split.
			expect(result.unresolvedDimensions.map((d) => d.code)).toEqual([]);
			expect(result.chart.status).toBe('chartable');
			expect(result.chart.series.length).toBeGreaterThan(0);
			expect(result.metadata?.formula).toBeTruthy();
			expect(result.metadata?.sourceVariables).toBeTruthy();
			expect(result.metadata?.sourceCitation).toBeTruthy();
		});

		it(`labels ${testCase.survey} breakdown values in Spanish`, async () => {
			const result = await model(`indicator=${testCase.code}&freq=${testCase.freq}`);
			const category = result.dimensions.find((d) => d.code === 'CATEGORY');
			expect(category, 'CATEGORY should be registered').toBeTruthy();
			expect(category!.values.length).toBeGreaterThan(1);
			// A label that is just the code back again means the codelist did not
			// resolve.
			const labelled = category!.values.filter((v) => v.label && v.label !== v.code);
			expect(labelled.length).toBeGreaterThan(0);
		});
	}

	// GEIH's annual estimates exist only per department, so there is no national
	// total to collapse to and picking one is a real choice. The Explorer should
	// say so rather than quietly charting the wrong thing.
	it('asks for a department when an indicator has no national series', async () => {
		const result = await model('indicator=GEIH_PI_034&freq=A');
		const pending = result.unresolvedDimensions.map((d) => d.code);
		expect(pending).toContain('REF_AREA');
		expect(result.chart.status).toBe('needs_resolution');
	});

	it('charts that same indicator once a department is chosen', async () => {
		const result = await model('indicator=GEIH_PI_034&freq=A&by=CATEGORY&filter.REF_AREA=CO-05');
		expect(result.unresolvedDimensions.map((d) => d.code)).toEqual([]);
		expect(result.chart.status).toBe('chartable');
		expect(result.chart.series.length).toBeGreaterThan(0);
	});

	it('maps themes into the catalog and applies them to indicator discovery', async () => {
		const result = await model('theme=Salud&indicator=GEIH_PI_034');

		expect(result.themes).toContain('Salud');
		expect(
			result.indicators.filter((indicator) => indicator.theme === 'Salud').length
		).toBeGreaterThan(0);
		expect(result.state.theme).toBe('Salud');
		expect(result.selectedIndicators).toEqual([]);
		expect(result.canonicalSearch).toBe('theme=Salud');
	});

	it('shows values hidden by correlated defaults in legacy Explorer URLs', async () => {
		const result = await model(
			'data_source=emicron&indicator=EMICRON_PI_109&freq=A&by=CATEGORY&filter.AREA=_T&filter.CLASE=_T&filter.GEO_LEVEL=NAT&filter.HEAD_SEX=_T&filter.REF_AREA=CO&filter.SEX=_T&filter.URBAN_RURAL=_T'
		);
		const values = (code: string) =>
			result.dimensions
				.find((dimension) => dimension.code === code)
				?.values.map((value) => value.code) || [];

		expect(values('SEX')).toEqual(['F', 'M', '_T']);
		expect(values('HEAD_SEX')).toEqual(['F', 'M', '_T']);
		expect(values('CLASE')).toEqual(['1', '2', '_T']);
		expect(values('URBAN_RURAL')).toEqual(['R', 'U', '_T']);
		expect(values('REF_AREA')).toContain('CO-05');
		expect(values('AREA')).toContain('05');
		expect(values('GEO_LEVEL')).toContain('NAT');
		expect(values('REF_AREA')).toContain('CO-97');
		expect(result.dimensions.find((dimension) => dimension.code === 'SEX')?.state).toBe('filtered');
		expect(result.state.filters.SEX).toBe('_T');
		expect(result.canonicalSearch).toContain('filter.SEX=_T');
		expect(result.chart.status).toBe('chartable');
	});

	it.each([
		['SEX', 'F', 'HEAD_SEX', '_T'],
		['CLASE', '1', 'URBAN_RURAL', '_T'],
		['REF_AREA', 'CO-05', 'GEO_LEVEL', 'NAT']
	])(
		'preserves independent filters instead of guessing a matching population for %s',
		async (filterCode, filterValue, correlatedCode, correlatedValue) => {
			const result = await model(
				`indicator=EMICRON_PI_109&freq=A&by=CATEGORY&filter.${filterCode}=${filterValue}`
			);
			const filtered = result.dimensions.find((dimension) => dimension.code === filterCode);
			const correlated = result.dimensions.find((dimension) => dimension.code === correlatedCode);

			expect(filtered?.values.map((value) => value.code)).toContain(filterValue);
			expect(filtered?.selectedValue).toBe(filterValue);
			expect(correlated?.selectedValue).toBe(correlatedValue);
			expect(result.unresolvedDimensions).toEqual([]);
			expect(result.chart.status).toBe('no_data');
			expect(result.chart.series).toEqual([]);
		}
	);

	it('honors explicit totals before split selection', async () => {
		const result = await model(
			'indicator=EMICRON_PI_109&freq=A&by=SEX&filter.CATEGORY=SERVICIO_01&filter.SEX=_T'
		);

		expect(result.chart.status).toBe('chartable');
		expect(result.state.by).toBeNull();
		expect(result.state.filters.SEX).toBe('_T');
		expect(result.chart.series).toHaveLength(1);
	});

	it('keeps options stable for a valid but unavailable demographic cross-tab', async () => {
		const base = await model('indicator=EMICRON_PI_109&freq=A');
		const result = await model(
			'indicator=EMICRON_PI_109&freq=A&by=CATEGORY&filter.SEX=F&filter.HEAD_SEX=M'
		);
		expect(result.state.filters).toEqual({ SEX: 'F', HEAD_SEX: 'M' });
		expect(result.chart.status).toBe('no_data');
		expect(result.chart.debugQuery?.parameters).toEqual(expect.arrayContaining(['F', 'M']));
		expect(result.dimensions.map((d) => d.values)).toEqual(base.dimensions.map((d) => d.values));
		const available = await model(
			'indicator=EMICRON_PI_109&freq=A&by=CATEGORY&filter.SEX=F&filter.HEAD_SEX=F'
		);
		expect(available.chart.status).toBe('chartable');
	});

	it('distinguishes unobserved departments from invalid codes', async () => {
		const absent = await model(
			'indicator=EMICRON_PI_109&freq=A&by=CATEGORY&filter.REF_AREA=CO-97&filter.GEO_LEVEL=DEP'
		);
		expect(absent.chart.status).toBe('no_data');
		const invalid = await model('indicator=EMICRON_PI_109&freq=A&filter.SEX=UNKNOWN');
		expect(invalid.chart.status).toBe('invalid');
		expect(invalid.state.filters.SEX).toBe('UNKNOWN');
	});

	it('keeps no split selected and explains the pending category filter', async () => {
		const result = await model('indicator=EMICRON_PI_109&freq=A');
		expect(result.state.by).toBeNull();
		expect(result.canonicalSearch).not.toContain('by=');
		expect(result.chart.status).toBe('needs_resolution');
		expect(result.unresolvedDimensions.map((d) => d.code)).toEqual(['CATEGORY']);
		expect(result.chart.debugQuery).toBeUndefined();
	});

	it.each([
		'',
		'&filter.SEX=F&filter.HEAD_SEX=F',
		'&filter.REF_AREA=CO-05&filter.GEO_LEVEL=DEP',
		'&filter.CLASE=1&filter.URBAN_RURAL=U&filter.GEO_LEVEL=CLASS'
	])('charts normal filters without any split: %s', async (filters) => {
		const result = await model(
			`indicator=EMICRON_PI_109&freq=A&filter.CATEGORY=SERVICIO_01${filters}&start=2022&end=2024`
		);
		expect(result.state.by).toBeNull();
		expect(result.chart.status).toBe('chartable');
		expect(result.chart.series).toHaveLength(1);
		const query = result.chart.debugQuery!;
		expect(query.sql).toContain('category = ?');
		expect(query.sql).not.toContain('SERVICIO_01');
		expect(query.parameters).toContain('SERVICIO_01');
		expect(query.parameters.slice(-2)).toEqual(['2022', '2024']);
		const { runCanonicalQuery } = await import('$lib/server/duckdb');
		const rows = await runCanonicalQuery(query.sql, ...query.parameters);
		expect(rows.length).toBe(result.chart.series[0].points.length);
	});

	it('resolves comparisons independently of indicator order', async () => {
		const first = await model('indicator=ECV_PI_001&indicator=GEIH_PI_001&freq=A');
		const second = await model('indicator=GEIH_PI_001&indicator=ECV_PI_001&freq=A');
		expect(first.chart.status).toBe('needs_resolution');
		expect(second.chart.status).toBe(first.chart.status);
		expect(first.unresolvedDimensions.map((d) => d.code)).toContain('REF_AREA');
	});
});
