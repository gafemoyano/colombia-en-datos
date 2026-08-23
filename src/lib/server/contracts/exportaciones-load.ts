/**
 * Canonical-store mapping for the exportaciones parquet.
 *
 * The generic loader in `scripts/create-canonical-store.ts` assumes a parquet
 * whose dimensions are all standard SDMX columns. Exportaciones is not that: its
 * one meaningful breakdown lives in `CATEGORY`, which has no standard canonical
 * column, so it needs its own SELECT. Keeping that SELECT here means the full
 * rebuild and any incremental reload produce byte-identical rows.
 */

import { EXPORTACIONES_CANONICAL_COLUMN, EXPORTACIONES_INDICATORS } from './exportaciones';

/** Canonical `observations` columns, in table order. */
export const CANONICAL_OBSERVATION_COLUMNS = [
	'indicator_code',
	'freq',
	'ref_area',
	'time_period',
	'obs_value',
	'geo_level',
	'dept_code',
	'muni_code',
	'urban_rural',
	'sex',
	'age',
	'adjustment',
	'ext_1',
	'ext_2',
	'ext_3',
	'obs_status'
];

/** Basename of the parquet, used to keep it out of the generic file scan. */
export const EXPORTACIONES_PARQUET_BASENAME = 'EXPORTACIONES_indicadores_SDMX_etiquetado.parquet';

export const EXPORTACIONES_INDICATOR_CODES = EXPORTACIONES_INDICATORS.map(
	(indicator) => indicator.code
);

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SELECT that reshapes the exportaciones parquet into canonical columns.
 *
 * The standard dimension columns are copied through rather than defaulted: the
 * contract already asserts each is a single expected constant, so copying keeps
 * this mapping honest if the source ever gains real variation.
 */
export function exportacionesSelect(parquetPath: string): string {
	const file = `read_parquet(${sqlString(parquetPath)})`;

	const projections: Record<string, string> = {
		indicator_code: 'INDICATOR',
		freq: 'FREQ',
		ref_area: 'REF_AREA',
		time_period: 'TIME_PERIOD',
		obs_value: 'TRY_CAST(OBS_VALUE AS DOUBLE)',
		geo_level: 'GEO_LEVEL',
		dept_code: 'DEPT_CODE',
		muni_code: 'MUNI_CODE',
		urban_rural: 'URBAN_RURAL',
		sex: 'SEX',
		age: 'AGE',
		adjustment: 'ADJUSTMENT',
		ext_1: 'NULL',
		ext_2: 'NULL',
		ext_3: 'NULL',
		obs_status: "COALESCE(OBS_STATUS, 'A')"
	};

	// The breakdown code, e.g. an ADUA or COD_PAI4 value. Which semantic
	// dimension it belongs to is recorded per indicator in `indicator_dimensions`.
	projections[EXPORTACIONES_CANONICAL_COLUMN] = 'CATEGORY';

	const selectList = CANONICAL_OBSERVATION_COLUMNS.map(
		(column) => `${projections[column]} AS ${column}`
	).join(',\n\t\t\t');

	return `SELECT\n\t\t\t${selectList}\n\t\tFROM ${file}`;
}

export function exportacionesInsert(parquetPath: string): string {
	return `INSERT INTO observations (${CANONICAL_OBSERVATION_COLUMNS.join(', ')})\n\t\t${exportacionesSelect(parquetPath)}`;
}

/** Removes any previously loaded exportaciones observations, so reloads are idempotent. */
export function exportacionesDelete(): string {
	const codes = EXPORTACIONES_INDICATOR_CODES.map(sqlString).join(', ');
	return `DELETE FROM observations WHERE indicator_code IN (${codes})`;
}
