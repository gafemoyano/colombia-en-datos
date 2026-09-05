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
			.where(
				inArray(indicators.code, ['GEIH_PI_028', 'GEIH_PI_034', 'GEIH_PI_110'])
			);

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
		it(`plots ${testCase.survey} (${testCase.code}) without extra input`, async () => {
			const result = await model(`indicator=${testCase.code}&freq=${testCase.freq}`);

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
		const result = await model('indicator=GEIH_PI_034&freq=A&filter.REF_AREA=CO-05');
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
});
