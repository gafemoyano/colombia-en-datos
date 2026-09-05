const units: Record<string, string> = {
	COP: 'Pesos colombianos (COP)',
	COP_PER_HOUR: 'Pesos colombianos por hora',
	HOUR: 'Horas',
	INDEX: 'Índice',
	NUMBER: 'Cantidad',
	PERCENT: 'Porcentaje (%)',
	RATIO: 'Razón',
	TONNE: 'Toneladas',
	USD: 'Dólares estadounidenses (USD)',
	WEEK: 'Semanas',
	YEAR: 'Años'
};

/** Describe stored units and their SDMX power-of-ten multiplier without rescaling observations. */
export function explorerUnitLabel(unit: string | null, multiplier: number | null): string {
	if (!unit) return 'Sin unidad registrada';
	const label = units[unit] || unit;
	if (multiplier === null || multiplier === 0) return label;
	const scale = multiplier === 3 ? 'miles' : multiplier === 6 ? 'millones' : `× 10^${multiplier}`;
	return `${label} · ${scale}`;
}
