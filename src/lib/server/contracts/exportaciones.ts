/**
 * Exportaciones source contract.
 *
 * The DANE exports product ships as two files that play different roles:
 *
 *   - `EXPORTACIONES_indicadores_SDMX_etiquetado.parquet` is authoritative for
 *     observations.
 *   - `EXPORTACIONES_correlativas_categorias.xlsx` is authoritative for category
 *     codelists (labels, official codes, methodology notes).
 *
 * This module declares what those files must look like, so the loader and the
 * tests agree on one definition instead of each re-deriving it.
 *
 * The seven breakdowns are semantic dimensions (ADUA, COD_SAL, ...), but each
 * indicator carries exactly one of them, so they all land in a single canonical
 * column. See EXPORTACIONES_CANONICAL_COLUMN.
 */

export const EXPORTACIONES_DATAFLOW = 'COL_DATOS:EXPORTACIONES_INDICATORS(1.0)';
export const EXPORTACIONES_THEME = 'Comercio exterior';
export const EXPORTACIONES_SOURCE_CODE = 'exportaciones';

/**
 * Every exportaciones indicator is broken down by exactly one semantic
 * dimension, so all seven share one physical column in the canonical store.
 * The registry (`indicator_dimensions`) is what distinguishes them per
 * indicator; the column only has to hold the code.
 */
export const EXPORTACIONES_CANONICAL_COLUMN = 'ext_2';

export interface ExportacionesDimension {
	/** Codelist dimension key, as used in the workbook and in FORMULA. */
	code: string;
	/** Spanish display name for `dimension_definitions.name`. */
	name: string;
	/** Row count declared by the workbook's VALIDACION sheet. */
	codelistSize: number;
}

/**
 * CIIU4_CLASS is published in the workbook (503 codes) but no indicator is
 * broken down by it, so it is not registered as a dimension. It is listed here
 * only so the codelist row-count check covers the whole sheet.
 */
export const EXPORTACIONES_UNUSED_CODELISTS: ExportacionesDimension[] = [
	{ code: 'CIIU4_CLASS', name: 'Clase CIIU Rev. 4 A.C. (2022)', codelistSize: 503 }
];

export const EXPORTACIONES_DIMENSIONS: ExportacionesDimension[] = [
	{ code: 'ADUA', name: 'Aduana', codelistSize: 46 },
	{ code: 'COD_SAL', name: 'Lugar de salida', codelistSize: 35 },
	{ code: 'COD_PAI4', name: 'País de destino', codelistSize: 254 },
	{ code: 'MODAD', name: 'Modalidad de exportación', codelistSize: 30 },
	{ code: 'REGIM', name: 'Régimen', codelistSize: 7 },
	{ code: 'CIIU4_SECTION', name: 'Sección CIIU Rev. 4 A.C. (2022)', codelistSize: 22 },
	{ code: 'CIIU4_DIVISION', name: 'División CIIU Rev. 4 A.C. (2022)', codelistSize: 89 }
];

export interface ExportacionesIndicator {
	code: string;
	name: string;
	/** Codelist dimension this indicator is broken down by. */
	dimension: string;
	/** Source variable summed to produce OBS_VALUE. */
	measure: 'FOBDOL' | 'PNK';
	unit: 'USD' | 'TONNE';
	/** Distinct category codes actually observed in the current parquet. */
	observedCategories: number;
	/** Rows in the current parquet. */
	rowCount: number;
}

export const EXPORTACIONES_INDICATORS: ExportacionesIndicator[] = [
	{
		code: 'EXPORTACIONES_PI_001',
		name: 'Valor FOB de las exportaciones por aduana',
		dimension: 'ADUA',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 24,
		rowCount: 3404
	},
	{
		code: 'EXPORTACIONES_PI_002',
		name: 'Toneladas métricas exportadas por aduana',
		dimension: 'ADUA',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 24,
		rowCount: 3404
	},
	{
		code: 'EXPORTACIONES_PI_003',
		name: 'Valor FOB de las exportaciones por lugar de salida',
		dimension: 'COD_SAL',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 31,
		rowCount: 3553
	},
	{
		code: 'EXPORTACIONES_PI_004',
		name: 'Toneladas métricas exportadas por lugar de salida',
		dimension: 'COD_SAL',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 31,
		rowCount: 3553
	},
	{
		code: 'EXPORTACIONES_PI_005',
		name: 'Valor FOB de las exportaciones por país de destino',
		dimension: 'COD_PAI4',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 232,
		rowCount: 26582
	},
	{
		code: 'EXPORTACIONES_PI_006',
		name: 'Toneladas métricas exportadas por país de destino',
		dimension: 'COD_PAI4',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 232,
		rowCount: 26582
	},
	{
		code: 'EXPORTACIONES_PI_007',
		name: 'Valor FOB de las exportaciones por modalidad',
		dimension: 'MODAD',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 15,
		rowCount: 1952
	},
	{
		code: 'EXPORTACIONES_PI_008',
		name: 'Toneladas métricas exportadas por modalidad',
		dimension: 'MODAD',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 15,
		rowCount: 1952
	},
	{
		code: 'EXPORTACIONES_PI_009',
		name: 'Valor FOB de las exportaciones por régimen',
		dimension: 'REGIM',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 7,
		rowCount: 672
	},
	{
		code: 'EXPORTACIONES_PI_010',
		name: 'Toneladas métricas exportadas por régimen',
		dimension: 'REGIM',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 7,
		rowCount: 672
	},
	{
		code: 'EXPORTACIONES_PI_011',
		name: 'Valor FOB de las exportaciones por sección CIIU Rev. 4 A.C. (2022)',
		dimension: 'CIIU4_SECTION',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 11,
		rowCount: 1835
	},
	{
		code: 'EXPORTACIONES_PI_012',
		name: 'Toneladas métricas exportadas por sección CIIU Rev. 4 A.C. (2022)',
		dimension: 'CIIU4_SECTION',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 11,
		rowCount: 1835
	},
	{
		code: 'EXPORTACIONES_PI_013',
		name: 'Valor FOB de las exportaciones por división CIIU Rev. 4 A.C. (2022)',
		dimension: 'CIIU4_DIVISION',
		measure: 'FOBDOL',
		unit: 'USD',
		observedCategories: 43,
		rowCount: 7067
	},
	{
		code: 'EXPORTACIONES_PI_014',
		name: 'Toneladas métricas exportadas por división CIIU Rev. 4 A.C. (2022)',
		dimension: 'CIIU4_DIVISION',
		measure: 'PNK',
		unit: 'TONNE',
		observedCategories: 43,
		rowCount: 7067
	}
];

/**
 * Dimensions that are present in the parquet but carry a single constant value
 * across all 90,130 rows. They are asserted, not registered: a dimension with
 * one value is not a filter, and registering it would put a dead selector in
 * the Explorer.
 */
export const EXPORTACIONES_CONSTANT_COLUMNS: Record<string, string> = {
	DATAFLOW: EXPORTACIONES_DATAFLOW,
	THEME: EXPORTACIONES_THEME,
	FREQ: 'M',
	REF_AREA: 'CO',
	GEO_LEVEL: 'NAT',
	DEPT_CODE: '00',
	MUNI_CODE: '0000',
	AREA: '_T',
	DOMAIN: '_T',
	CLASE: '_T',
	URBAN_RURAL: '_T',
	SEX: '_T',
	HEAD_SEX: '_T',
	AGE: '_T',
	ADJUSTMENT: 'N',
	UNIT_MULT: '0',
	DECIMALS: '2',
	OBS_STATUS: 'A',
	WEIGHT_TYPE: 'NONE',
	ESTIMATION_SCOPE: 'CUSTOMS_RECORDS_MONTHLY'
};

/**
 * Expected shape of the current parquet.
 *
 * `rowCount` is 90,130. The indicator workbook records 89,616 — a stale count
 * from an earlier generation of the file. The workbook's own SDMX_OBSERVATIONS
 * sheet is only a 3,000-row sample and cannot corroborate either figure, so the
 * parquet is authoritative and this number is asserted against it. When the
 * parquet is regenerated, update this and the per-indicator `rowCount` values
 * together.
 */
export const EXPORTACIONES_EXPECTED = {
	rowCount: 90130,
	indicatorCount: 14,
	periodStart: '2011-01',
	periodEnd: '2026-06',
	freq: 'M',
	refArea: 'CO',
	/** Row count recorded in the indicator workbook; see note above. */
	workbookReportedRowCount: 89616
} as const;

/** Columns the loader reads out of the parquet. */
export const EXPORTACIONES_REQUIRED_PARQUET_COLUMNS = [
	'DATAFLOW',
	'FREQ',
	'INDICATOR',
	'INDICATOR_NAME',
	'THEME',
	'REF_AREA',
	'DEPT_CODE',
	'MUNI_CODE',
	'GEO_LEVEL',
	'URBAN_RURAL',
	'SEX',
	'AGE',
	'CATEGORY',
	'CATEGORY_LABEL',
	'ADJUSTMENT',
	'TIME_PERIOD',
	'OBS_VALUE',
	'UNIT',
	'UNIT_MULT',
	'OBS_STATUS',
	'DECIMALS',
	'FORMULA',
	'SOURCE'
];

/** Cell range of the codelist table in the correlativas workbook. */
export const CODELIST_SHEET = 'CATEGORY_CODELISTS';
export const CODELIST_RANGE = 'A3:J989';
export const INDICATOR_MAP_SHEET = 'INDICATOR_MAP';
export const INDICATOR_MAP_RANGE = 'A3:D17';

export function indicatorByCode(code: string): ExportacionesIndicator | undefined {
	return EXPORTACIONES_INDICATORS.find((indicator) => indicator.code === code);
}

export function dimensionByCode(code: string): ExportacionesDimension | undefined {
	return EXPORTACIONES_DIMENSIONS.find((dimension) => dimension.code === code);
}
