// @vitest-environment node
//
// End-to-end check that a semantic breakdown stored in a shared canonical
// extension column survives the whole Explorer path: registry lookup ->
// ext_2 filter/split -> codelist labels.
//
// Needs both the canonical store and the registry, so it is skipped unless
// CANONICAL_DUCKDB_PATH (or the default data/observations.duckdb) exists and
// DATABASE_URL is set.

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORTACIONES_INDICATORS } from './exportaciones';

function canonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) return resolve(process.env.CANONICAL_DUCKDB_PATH);
	if (process.env.DATA_PATH) return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	return join(process.cwd(), 'data', 'observations.duckdb');
}

const ready = Boolean(process.env.DATABASE_URL) && existsSync(canonicalDbPath());

// PI_005 is exports by destination country: the widest breakdown (232 observed
// codes) and the one carrying the documented XCF / ZZZ / _U special cases.
const SUBJECT = EXPORTACIONES_INDICATORS.find((i) => i.code === 'EXPORTACIONES_PI_005')!;

describe.skipIf(!ready)('exportaciones in the Explorer', () => {
	async function model(search: string) {
		const { getExplorerPageModel } = await import('$lib/server/explorer');
		return getExplorerPageModel(new URL(`https://example.test/explore?${search}`));
	}

	it('exposes the semantic breakdown as a usable dimension', async () => {
		const result = await model(`indicator=${SUBJECT.code}&freq=M`);
		const dimension = result.dimensions.find((d) => d.code === SUBJECT.dimension);

		expect(dimension, `${SUBJECT.dimension} should be registered and mapped`).toBeDefined();
		expect(dimension!.isSplitable).toBe(true);
		expect(dimension!.values.length).toBe(SUBJECT.observedCategories);
	}, 60_000);

	it('labels category codes from the correlativas codelist', async () => {
		const result = await model(`indicator=${SUBJECT.code}&freq=M`);
		const dimension = result.dimensions.find((d) => d.code === SUBJECT.dimension)!;
		const byCode = new Map(dimension.values.map((value) => [value.code, value.label]));

		expect(byCode.get('XCF')).toBe('Zonas Francas');
		expect(byCode.get('_U')).toBe('No informado');
		// Every observed code resolves to something other than the bare code,
		// except ZZZ, which the source itself labels "ZZZ".
		const unlabelled = [...byCode.entries()].filter(([code, label]) => code === label);
		expect(unlabelled.map(([code]) => code)).toEqual(['ZZZ']);
	}, 60_000);

	it('splits a series by the breakdown', async () => {
		const result = await model(
			`indicator=${SUBJECT.code}&freq=M&by=${SUBJECT.dimension}&start=2024-01&end=2024-03`
		);

		expect(result.chart.status).toBe('chartable');
		expect(result.chart.series.length).toBeGreaterThan(1);
		for (const series of result.chart.series) {
			expect(series.points.length).toBeGreaterThan(0);
		}
	}, 60_000);

	it('filters to a single country', async () => {
		const result = await model(
			`indicator=${SUBJECT.code}&freq=M&filter.${SUBJECT.dimension}=USA&start=2024-01&end=2024-06`
		);

		expect(result.chart.status).toBe('chartable');
		expect(result.chart.series).toHaveLength(1);
		expect(result.chart.series[0].points.every((point) => (point.value ?? 0) > 0)).toBe(true);
	}, 60_000);

	it('keeps each indicator scoped to its own breakdown', async () => {
		// PI_001 is by aduana. Its dimension list must not offer COD_PAI4 just
		// because both products share the ext_2 column.
		const result = await model('indicator=EXPORTACIONES_PI_001&freq=M');
		const codes = result.dimensions.map((d) => d.code);

		expect(codes).toContain('ADUA');
		expect(codes).not.toContain('COD_PAI4');
	}, 60_000);
});
