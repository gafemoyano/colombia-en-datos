// @vitest-environment node
import { existsSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
	EXPORTACIONES_CANONICAL_COLUMN,
	EXPORTACIONES_DIMENSIONS,
	EXPORTACIONES_EXPECTED,
	EXPORTACIONES_INDICATORS,
	EXPORTACIONES_UNUSED_CODELISTS
} from './exportaciones';
import {
	defaultSourcePaths,
	openSourceDb,
	readCodelists,
	validateExportacionesSource,
	type SourceDb
} from './exportaciones-source';

const paths = defaultSourcePaths();
const sourcesPresent = existsSync(paths.parquetPath) && existsSync(paths.codelistPath);

// The contract itself is pure data and always testable; the checks that read
// the 900KB parquet and the workbook only run where those files are checked out.
describe('exportaciones contract', () => {
	it('declares 14 indicators across 7 breakdowns in 2 measures', () => {
		expect(EXPORTACIONES_INDICATORS).toHaveLength(14);
		expect(new Set(EXPORTACIONES_INDICATORS.map((i) => i.code)).size).toBe(14);

		for (const dimension of EXPORTACIONES_DIMENSIONS) {
			const forDimension = EXPORTACIONES_INDICATORS.filter((i) => i.dimension === dimension.code);
			expect(forDimension.map((i) => i.measure).sort()).toEqual(['FOBDOL', 'PNK']);
		}
	});

	it('pairs each measure with its unit consistently', () => {
		for (const indicator of EXPORTACIONES_INDICATORS) {
			expect(indicator.unit).toBe(indicator.measure === 'FOBDOL' ? 'USD' : 'TONNE');
		}
	});

	it('gives the FOB and tonnage halves of a breakdown the same shape', () => {
		for (const dimension of EXPORTACIONES_DIMENSIONS) {
			const [fob, tonnes] = EXPORTACIONES_INDICATORS.filter(
				(i) => i.dimension === dimension.code
			).sort((a, b) => a.code.localeCompare(b.code));
			expect(fob.rowCount).toBe(tonnes.rowCount);
			expect(fob.observedCategories).toBe(tonnes.observedCategories);
		}
	});

	it('accounts for every declared row in the per-indicator counts', () => {
		const summed = EXPORTACIONES_INDICATORS.reduce((total, i) => total + i.rowCount, 0);
		expect(summed).toBe(EXPORTACIONES_EXPECTED.rowCount);
	});

	it('records the drift against the indicator workbook rather than hiding it', () => {
		expect(EXPORTACIONES_EXPECTED.rowCount - EXPORTACIONES_EXPECTED.workbookReportedRowCount).toBe(
			514
		);
	});

	it('targets a canonical extension column, not a standard dimension', () => {
		expect(EXPORTACIONES_CANONICAL_COLUMN).toMatch(/^ext_[123]$/);
	});

	it('does not register a breakdown that no indicator uses', () => {
		const registered = new Set(EXPORTACIONES_DIMENSIONS.map((d) => d.code));
		for (const unused of EXPORTACIONES_UNUSED_CODELISTS) {
			expect(registered.has(unused.code)).toBe(false);
			expect(EXPORTACIONES_INDICATORS.some((i) => i.dimension === unused.code)).toBe(false);
		}
	});
});

describe.skipIf(!sourcesPresent)('exportaciones source files', () => {
	it('satisfies the contract end to end', async () => {
		const result = await validateExportacionesSource(paths);
		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.stats.rowCount).toBe(EXPORTACIONES_EXPECTED.rowCount);
		expect(result.stats.periodEnd).toBe(EXPORTACIONES_EXPECTED.periodEnd);
	}, 120_000);
});

describe.skipIf(!sourcesPresent)('exportaciones codelists', () => {
	let db: SourceDb;

	beforeAll(async () => {
		db = await openSourceDb(paths);
	}, 60_000);

	afterAll(() => db?.close());

	it('is the authoritative label source for all seven breakdowns', async () => {
		const entries = await readCodelists(db);
		const byDimension = new Map<string, number>();
		for (const entry of entries) {
			byDimension.set(entry.dimension, (byDimension.get(entry.dimension) ?? 0) + 1);
		}

		for (const dimension of EXPORTACIONES_DIMENSIONS) {
			expect(byDimension.get(dimension.code)).toBe(dimension.codelistSize);
		}
	});

	it('preserves leading zeros in CODE while MATCH_KEY tracks the parquet', async () => {
		const entries = await readCodelists(db);
		const stripped = entries.filter((entry) => entry.code !== entry.matchKey);

		// Documented edge case: official modality 002 is stored as 2 in the parquet.
		expect(stripped.length).toBeGreaterThan(0);
		for (const entry of stripped) {
			expect(entry.code.replace(/^0+/, '')).toBe(entry.matchKey);
		}
	});

	it('carries the reserved and special codes the metadata calls out', async () => {
		const entries = await readCodelists(db);
		const find = (dimension: string, matchKey: string) =>
			entries.find((entry) => entry.dimension === dimension && entry.matchKey === matchKey);

		// Missing values are published as _U so totals still reconcile.
		for (const dimension of EXPORTACIONES_DIMENSIONS) {
			expect(find(dimension.code, '_U')).toBeDefined();
		}

		expect(find('COD_PAI4', 'XCF')?.label).toBe('Zonas Francas');
		// ZZZ is intentionally retained for special or undeclared territories.
		expect(find('COD_PAI4', 'ZZZ')).toBeDefined();
	});

	it('leaves undocumented historical codes unmapped instead of inventing labels', async () => {
		const entries = await readCodelists(db);
		const historical = entries.filter((entry) => /Código histórico/i.test(entry.label ?? ''));

		expect(historical.map((entry) => entry.matchKey).sort()).toEqual(['0', '169', 'MA']);
	});
});
