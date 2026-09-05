// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { explorerUnitLabel } from './explorer-format';

describe('explorerUnitLabel', () => {
	it('translates count, percentage and currency units', () => {
		expect(explorerUnitLabel('NUMBER', 0)).toBe('Cantidad');
		expect(explorerUnitLabel('PERCENT', 0)).toBe('Porcentaje (%)');
		expect(explorerUnitLabel('COP', 0)).toBe('Pesos colombianos (COP)');
	});
	it('preserves the stored scale, including uncommon and negative multipliers', () => {
		expect(explorerUnitLabel('COP', 3)).toBe('Pesos colombianos (COP) · miles');
		expect(explorerUnitLabel('NUMBER', 6)).toBe('Cantidad · millones');
		expect(explorerUnitLabel('USD', -2)).toBe('Dólares estadounidenses (USD) · × 10^-2');
	});
	it('keeps unknown codes visible and handles missing metadata', () => {
		expect(explorerUnitLabel('CUSTOM', null)).toBe('CUSTOM');
		expect(explorerUnitLabel(null, 3)).toBe('Sin unidad registrada');
	});
});
