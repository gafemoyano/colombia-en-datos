import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportRows, toCsv, downloadExport, type ExportModel } from './explorer-export';

const model: ExportModel = {
	state: {
		dataSource: '',
		selectedIndicators: ['A', 'B'],
		indicator: 'A',
		freq: 'M',
		by: 'CATEGORY',
		filters: { REF_AREA: 'CO-05' },
		start: '2024-01',
		end: '2024-02'
	},
	canonicalSearch: 'indicator=A&indicator=B&freq=M',
	metadatas: [],
	chart: {
		status: 'chartable',
		messages: [],
		series: ['A', 'B'].map((indicatorCode) => ({
			indicatorCode,
			name: 'Mismo nombre',
			splitValue: '01',
			splitLabel: 'Niñez',
			points: [
				{ time: '2024-01', value: -2.5 },
				{ time: '2024-02', value: null }
			]
		}))
	}
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Explorer export', () => {
	it('preserves identities, nulls, periods and filters without changing chart data', () => {
		const before = JSON.stringify(model);
		const rows = exportRows(model);
		expect(rows).toHaveLength(5);
		expect(rows[1].slice(0, 6)).toEqual(['A', 'A', 'Mismo nombre', '2024-01', 'M', -2.5]);
		expect(rows[2][5]).toBeNull();
		expect(rows[3][0]).toBe('B');
		expect(rows[1].slice(8, 12)).toEqual(['CATEGORY', '01', 'Niñez', '{"REF_AREA":"CO-05"}']);
		expect(JSON.stringify(model)).toBe(before);
	});
	it('escapes CSV and preserves zero and null distinctly', () => {
		expect(toCsv([['Bogotá, "niñez"\nColombia', 0, null]])).toBe(
			'\uFEFF"Bogotá, ""niñez""\nColombia","0",\r\n'
		);
	});
	it.each(['=1+1', '+SUM(A1)', '-cmd', '@SUM(A1)', '\tvalue', '\nvalue', '  =1'])(
		'neutralizes formula-like text %j',
		(text) => {
			expect(toCsv([[text]])).toBe(`\uFEFF"'${text}"\r\n`);
		}
	);
	it('leaves negative numeric values numeric', () => {
		expect(toCsv([[-3]])).toBe('\uFEFF"-3"\r\n');
	});
	it('rejects empty and unresolved exports', async () => {
		await expect(
			downloadExport(
				{ ...model, chart: { status: 'no_data', series: [], messages: [] } },
				'csv',
				'https://example.test'
			)
		).rejects.toThrow('No hay datos');
	});
	it('creates a CSV download and releases the URL', async () => {
		vi.useFakeTimers();
		const create = vi.fn(() => 'blob:test');
		const revoke = vi.fn();
		vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		await downloadExport(model, 'csv', 'https://example.test');
		expect(create.mock.calls).toHaveLength(1);
		expect(click).toHaveBeenCalledOnce();
		expect(document.querySelector('a[download]')).toBeNull();
		vi.runAllTimers();
		expect(revoke).toHaveBeenCalledWith('blob:test');
	});
});
