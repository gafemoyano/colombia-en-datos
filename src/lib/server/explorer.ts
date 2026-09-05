import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	dataSources,
	departamentos,
	dimensionDefinitions,
	dimensionValues,
	indicatorCategories,
	indicatorDimensions,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { getPublishedFrequenciesByIndicator, runCanonicalQuery } from '$lib/server/duckdb';

// Dimension code -> canonical observations column.
//
// One dimension, one column, the same for every survey. Each canonical parquet
// ships the same 36 columns, so there is nothing to remap per product -- the
// generic extension columns and the exportaciones-specific mapping that used
// to live here are gone with them.
const DIMENSION_COLUMNS = new Map<string, string>([
	['GEO_LEVEL', 'geo_level'],
	['REF_AREA', 'ref_area'],
	['DEPT_CODE', 'dept_code'],
	['MUNI_CODE', 'muni_code'],
	['AREA', 'area'],
	['DOMAIN', 'domain'],
	['CLASE', 'clase'],
	['URBAN_RURAL', 'urban_rural'],
	['SEX', 'sex'],
	['HEAD_SEX', 'head_sex'],
	['AGE', 'age'],
	['CATEGORY', 'category'],
	['ADJUSTMENT', 'adjustment']
]);

export interface ExplorerCatalogIndicator {
	code: string;
	name: string;
	shortName: string | null;
	dataSource: string;
	dataSourceCode: string;
	theme: string;
	group: string;
	availableFrequencies: string[];
}

export interface ExplorerDimensionValue {
	code: string;
	label: string;
}

export type ExplorerDimensionState = 'filtered' | 'split' | 'fixed' | 'unresolved' | 'empty';

export interface ExplorerDimension {
	code: string;
	name: string;
	isFilterable: boolean;
	isSplitable: boolean;
	state: ExplorerDimensionState;
	selectedValue: string | null;
	/** Value the server falls back to when the dimension is neither filtered nor split. */
	defaultValue: string | null;
	values: ExplorerDimensionValue[];
}

export interface ExplorerSeriesPoint {
	time: string;
	value: number | null;
}

export interface ExplorerSeries {
	name: string;
	points: ExplorerSeriesPoint[];
}

export type ExplorerChartStatus =
	| 'needs_indicator'
	| 'needs_frequency'
	| 'needs_resolution'
	| 'chartable'
	| 'no_data'
	| 'invalid';

export interface ExplorerChartModel {
	status: ExplorerChartStatus;
	series: ExplorerSeries[];
	messages: string[];
}

export type ExplorerTimeGranularity = 'year' | 'month' | 'quarter' | 'day' | 'unknown';

export interface ExplorerTimePeriod {
	value: string;
	label: string;
}

export interface ExplorerTimeAxis {
	freq: string | null;
	granularity: ExplorerTimeGranularity;
	periods: ExplorerTimePeriod[];
	start: string | null;
	end: string | null;
}

export interface ExplorerState {
	dataSource: string;
	theme: string;
	selectedIndicators: string[];
	indicator: string | null;
	freq: string | null;
	by: string | null;
	filters: Record<string, string>;
	start: string;
	end: string;
}

export interface ExplorerMetadata {
	code: string;
	name: string;
	shortName: string | null;
	description: string | null;
	methodology: string | null;
	formula: string | null;
	sourceVariables: string | null;
	sourceCitation: string | null;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	updated: string | null;
}

export interface ExplorerMeasurementCompatibility {
	compatible: boolean;
	unit: string | null;
	unitMult: number | null;
	message: string | null;
}

export interface ExplorerPageModel {
	state: ExplorerState;
	dataSources: Array<{ code: string; name: string }>;
	themes: string[];
	indicators: ExplorerCatalogIndicator[];
	selectedIndicator: ExplorerCatalogIndicator | null;
	selectedIndicators: ExplorerCatalogIndicator[];
	commonFrequencies: string[];
	metadata: ExplorerMetadata | null;
	metadatas: ExplorerMetadata[];
	measurementCompatibility: ExplorerMeasurementCompatibility;
	dimensions: ExplorerDimension[];
	unresolvedDimensions: ExplorerDimension[];
	fixedDimensions: ExplorerDimension[];
	timeAxis: ExplorerTimeAxis;
	chart: ExplorerChartModel;
	warnings: string[];
	canonicalSearch: string;
}

interface RegisteredDimension {
	code: string;
	name: string;
	isFilterable: boolean;
	isSplitable: boolean;
	/**
	 * Value this dimension collapses to when the user has not filtered or split
	 * on it. Null means there is no sensible total -- CATEGORY is the only such
	 * dimension, because 216 of the 230 indicators with a breakdown ship no
	 * '_T' category row.
	 */
	defaultValue: string | null;
}

function asNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return 0;
}

function errorSummary(error: unknown): string {
	const cause = (error as { cause?: unknown } | null)?.cause;
	const causeMessage = cause instanceof Error ? cause.message : '';
	if (causeMessage) return causeMessage;
	if (error instanceof Error) return error.message.split('\n')[0];
	return 'unknown error';
}

function normalizeDimensionCode(value: string | null): string | null {
	const normalized = value?.trim().toUpperCase();
	return normalized && DIMENSION_COLUMNS.has(normalized) ? normalized : null;
}

function dimensionColumn(code: string): string {
	const column = DIMENSION_COLUMNS.get(code);
	if (!column) throw new Error(`Unsupported dimension code: ${code}`);
	return column;
}

function emptyTimeAxis(freq: string | null = null): ExplorerTimeAxis {
	return {
		freq,
		granularity: freqToGranularity(freq),
		periods: [],
		start: null,
		end: null
	};
}

function freqToGranularity(freq: string | null): ExplorerTimeGranularity {
	if (freq === 'A') return 'year';
	if (freq === 'M') return 'month';
	if (freq === 'Q') return 'quarter';
	if (freq === 'D') return 'day';
	return 'unknown';
}

function formatTimePeriod(value: string, freq: string): string {
	if (freq === 'A') return value;

	if (freq === 'M') {
		const monthNames = [
			'Ene',
			'Feb',
			'Mar',
			'Abr',
			'May',
			'Jun',
			'Jul',
			'Ago',
			'Sep',
			'Oct',
			'Nov',
			'Dic'
		];
		const match = /^(\d{4})-(\d{2})$/.exec(value);
		if (!match) return value;
		const month = Number(match[2]);
		return `${monthNames[month - 1] || match[2]} ${match[1]}`;
	}

	if (freq === 'Q') {
		const match = /^(\d{4})-Q([1-4])$/.exec(value);
		if (!match) return value;
		return `T${match[2]} ${match[1]}`;
	}

	return value;
}

function parseState(url: URL): ExplorerState {
	const selectedIndicators = Array.from(
		new Set(
			url.searchParams
				.getAll('indicator')
				.map((value) => value.trim())
				.filter(Boolean)
		)
	).slice(0, 5);

	const filters: Record<string, string> = {};
	for (const [key, value] of url.searchParams.entries()) {
		if (!key.startsWith('filter.')) continue;
		const code = normalizeDimensionCode(key.slice('filter.'.length));
		if (code && value.trim()) filters[code] = value.trim();
	}

	return {
		dataSource:
			url.searchParams.get('data_source')?.trim() || url.searchParams.get('area')?.trim() || '',
		theme: url.searchParams.get('theme')?.trim() || '',
		selectedIndicators,
		indicator: selectedIndicators[0] || null,
		freq: url.searchParams.get('freq')?.trim().toUpperCase() || null,
		by: normalizeDimensionCode(url.searchParams.get('by')),
		filters,
		start: url.searchParams.get('start')?.trim() || '',
		end: url.searchParams.get('end')?.trim() || ''
	};
}

function buildCanonicalSearch(state: ExplorerState): string {
	const params = new URLSearchParams();
	if (state.dataSource) params.set('data_source', state.dataSource);
	if (state.theme) params.set('theme', state.theme);
	for (const indicator of state.selectedIndicators) params.append('indicator', indicator);
	if (state.freq) params.set('freq', state.freq);
	if (state.by) params.set('by', state.by);
	for (const [code, value] of Object.entries(state.filters).sort(([a], [b]) =>
		a.localeCompare(b)
	)) {
		params.set(`filter.${code}`, value);
	}
	if (state.start) params.set('start', state.start);
	if (state.end) params.set('end', state.end);
	return params.toString();
}

async function loadCatalog(): Promise<{
	dataSources: Array<{ code: string; name: string }>;
	themes: string[];
	indicators: ExplorerCatalogIndicator[];
}> {
	const db = getDb();
	const rows = await db
		.select({
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			dataSource: dataSources.name,
			dataSourceCode: dataSources.code,
			theme: indicators.theme,
			group: indicatorGroups.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id));

	const frequencyMap = await getPublishedFrequenciesByIndicator(rows.map((row) => row.code));
	const catalog = rows
		.map((row) => ({
			code: row.code,
			name: row.name,
			shortName: row.shortName,
			dataSource: row.dataSource || 'Sin fuente de datos',
			dataSourceCode: row.dataSourceCode,
			theme: row.theme?.trim() || 'Sin tema',
			group: row.group || 'Sin grupo',
			availableFrequencies: frequencyMap.get(row.code) || []
		}))
		.filter((indicator) => indicator.availableFrequencies.length > 0)
		.sort(
			(a, b) =>
				a.dataSource.localeCompare(b.dataSource) ||
				a.group.localeCompare(b.group) ||
				a.name.localeCompare(b.name)
		);

	const dataSourceOptions = [
		...new Map(catalog.map((indicator) => [indicator.dataSourceCode, indicator.dataSource])).entries()
	]
		.map(([code, name]) => ({ code, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const themeOptions = [...new Set(catalog.map((indicator) => indicator.theme))].sort((a, b) =>
		a.localeCompare(b)
	);

	return { dataSources: dataSourceOptions, themes: themeOptions, indicators: catalog };
}

function emptyMeasurementCompatibility(): ExplorerMeasurementCompatibility {
	return {
		compatible: true,
		unit: null,
		unitMult: null,
		message: null
	};
}

function resolveMeasurementCompatibility(
	metadatas: ExplorerMetadata[]
): ExplorerMeasurementCompatibility {
	if (metadatas.length === 0) return emptyMeasurementCompatibility();

	const first = metadatas[0];
	const incompatible = metadatas.some(
		(metadata) => metadata.unit !== first.unit || metadata.unitMult !== first.unitMult
	);

	return {
		compatible: !incompatible,
		unit: first.unit,
		unitMult: first.unitMult,
		message: incompatible
			? 'Estos indicadores usan unidades o multiplicadores distintos. La comparación directa todavía no está soportada.'
			: null
	};
}

function intersectArrays<T>(arrays: T[][]): T[] {
	if (arrays.length === 0) return [];
	return arrays[0].filter((value) => arrays.every((array) => array.includes(value)));
}

async function loadMetadata(indicatorCode: string): Promise<ExplorerMetadata | null> {
	const db = getDb();
	const rows = await db
		.select({
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			description: indicators.description,
			methodology: indicators.methodology,
			formula: indicators.formula,
			sourceVariables: indicators.sourceVariables,
			sourceCitation: indicators.sourceCitation,
			unit: indicators.unit,
			unitMult: indicators.unitMult,
			decimals: indicators.decimals,
			updated: indicators.updated
		})
		.from(indicators)
		.where(eq(indicators.code, indicatorCode))
		.limit(1);

	return rows[0] || null;
}

async function loadRegisteredDimensions(
	indicatorCode: string,
	freq: string
): Promise<{ dimensions: RegisteredDimension[]; warning: string | null }> {
	const db = getDb();

	try {
		const indicatorRows = await db
			.select({ id: indicators.id })
			.from(indicators)
			.where(eq(indicators.code, indicatorCode))
			.limit(1);

		if (indicatorRows.length === 0) return { dimensions: [], warning: null };

		const rows = await db
			.select({
				code: indicatorDimensions.dimensionCode,
				name: dimensionDefinitions.name,
				isFilterable: indicatorDimensions.isFilterable,
				isSplitable: indicatorDimensions.isSplitable,
				defaultValue: indicatorDimensions.defaultValue
			})
			.from(indicatorDimensions)
			.innerJoin(
				dimensionDefinitions,
				eq(indicatorDimensions.dimensionCode, dimensionDefinitions.code)
			)
			.where(
				and(
					eq(indicatorDimensions.indicatorId, indicatorRows[0].id),
					or(eq(indicatorDimensions.freq, freq), eq(indicatorDimensions.freq, '*'))
				)
			);

		return {
			dimensions: rows
				.map((row) => ({
					code: row.code.toUpperCase(),
					name: row.name,
					isFilterable: row.isFilterable ?? true,
					isSplitable: row.isSplitable ?? true,
					defaultValue: row.defaultValue ?? null
				}))
				.filter((dimension) => DIMENSION_COLUMNS.has(dimension.code))
				.sort((a, b) => a.name.localeCompare(b.name)),
			warning: null
		};
	} catch (error) {
		console.warn(`[Explorer] Dimension registry unavailable: ${errorSummary(error)}`);
		return {
			dimensions: [],
			warning:
				'No se pudo leer el registro de dimensiones. Revisa que las migraciones de Phase 1 estén aplicadas.'
		};
	}
}

async function loadValueLabels(
	dimensionCodes: string[],
	indicatorCodes: string[] = [],
	warnings: string[] = []
): Promise<Map<string, Map<string, string>>> {
	if (dimensionCodes.length === 0) return new Map();

	try {
		const db = getDb();
		const rows = await db
			.select({
				dimensionCode: dimensionValues.dimensionCode,
				code: dimensionValues.code,
				labelEs: dimensionValues.labelEs
			})
			.from(dimensionValues)
			.where(inArray(dimensionValues.dimensionCode, dimensionCodes));

		const labels = new Map<string, Map<string, string>>();
		function setLabel(dimensionCode: string, code: string, label: string) {
			const dimensionLabels = labels.get(dimensionCode) || new Map<string, string>();
			dimensionLabels.set(code, label);
			labels.set(dimensionCode, dimensionLabels);
		}

		for (const row of rows) {
			setLabel(row.dimensionCode, row.code, row.labelEs || row.code);
		}

		if (dimensionCodes.includes('GEO_LEVEL')) {
			setLabel('GEO_LEVEL', 'NAT', 'Nacional');
			setLabel('GEO_LEVEL', 'DEP', 'Departamental');
			setLabel('GEO_LEVEL', 'MUN', 'Municipal');
		}

		if (dimensionCodes.includes('DEPT_CODE')) {
			setLabel('DEPT_CODE', '00', 'Colombia');
			const departmentRows = await db
				.select({ code: departamentos.code, name: departamentos.name })
				.from(departamentos);
			for (const row of departmentRows) {
				setLabel('DEPT_CODE', row.code, row.name);
			}
		}

		if (dimensionCodes.includes('MUNI_CODE')) {
			setLabel('MUNI_CODE', '0000', 'Todos los municipios');
		}

		// CATEGORY codes are scoped to one indicator: '1' is "Hombre" in
		// GEIH_PI_028 and "Contributivo" in GEIH_PI_034. They therefore live in
		// indicator_categories rather than dimension_values, and are resolved
		// against the indicators actually selected.
		if (dimensionCodes.includes('CATEGORY') && indicatorCodes.length > 0) {
			const categoryRows = await db
				.select({
					indicatorCode: indicators.code,
					code: indicatorCategories.code,
					labelEs: indicatorCategories.labelEs
				})
				.from(indicatorCategories)
				.innerJoin(indicators, eq(indicatorCategories.indicatorId, indicators.id))
				.where(inArray(indicators.code, indicatorCodes));

			// Comparing two indicators whose codelists disagree on a code would
			// silently mislabel one of them, so say so rather than pick a winner.
			const seen = new Map<string, string>();
			const conflicting = new Set<string>();
			for (const row of categoryRows) {
				const label = row.labelEs || row.code;
				const previous = seen.get(row.code);
				if (previous !== undefined && previous !== label) conflicting.add(row.code);
				seen.set(row.code, label);
				setLabel('CATEGORY', row.code, label);
			}
			if (conflicting.size > 0 && indicatorCodes.length > 1) {
				warnings.push(
					`Los indicadores seleccionados usan el mismo código de desagregación con distinto significado (${[
						...conflicting
					]
						.slice(0, 5)
						.join(', ')}). Compáralos por separado.`
				);
			}
		}

		return labels;
	} catch (error) {
		console.warn(`[Explorer] Could not load dimension value labels: ${errorSummary(error)}`);
		return new Map();
	}
}

function buildWhereForObservationQueries(params: {
	indicatorCode: string;
	freq: string;
	filters: Record<string, string>;
	excludeDimension?: string;
	includeDateRange?: boolean;
	start?: string;
	end?: string;
}): { conditions: string[]; values: unknown[] } {
	const conditions = ['indicator_code = ?', 'freq = ?'];
	const values: unknown[] = [params.indicatorCode, params.freq];

	for (const [code, value] of Object.entries(params.filters)) {
		if (code === params.excludeDimension) continue;
		conditions.push(`${dimensionColumn(code)} = ?`);
		values.push(value);
	}

	if (params.includeDateRange) {
		if (params.start) {
			conditions.push('time_period >= ?');
			values.push(params.start);
		}
		if (params.end) {
			conditions.push('time_period <= ?');
			values.push(params.end);
		}
	}

	return { conditions, values };
}

async function loadTimeAxis(params: {
	indicatorCodes: string[];
	freq: string;
	start: string;
	end: string;
	warnings: string[];
}): Promise<ExplorerTimeAxis> {
	if (params.indicatorCodes.length === 0) return emptyTimeAxis(params.freq);

	const rows = await runCanonicalQuery<{ time_period: string }>(
		`
			SELECT DISTINCT time_period
			FROM observations
			WHERE indicator_code IN (${params.indicatorCodes.map(() => '?').join(', ')})
				AND freq = ?
				AND time_period IS NOT NULL
			ORDER BY time_period
		`,
		...params.indicatorCodes,
		params.freq
	);
	const periods = rows.map((row) => String(row.time_period)).filter(Boolean);
	const periodSet = new Set(periods);
	const periodIndex = new Map(periods.map((period, index) => [period, index] as const));
	let start = params.start;
	let end = params.end;

	if (start && !periodSet.has(start)) {
		params.warnings.push(`Se ignoró el inicio ${start} porque no existe para esta frecuencia.`);
		start = '';
	}

	if (end && !periodSet.has(end)) {
		params.warnings.push(`Se ignoró el fin ${end} porque no existe para esta frecuencia.`);
		end = '';
	}

	if (start && end && (periodIndex.get(start) ?? 0) > (periodIndex.get(end) ?? 0)) {
		params.warnings.push('Se ajustó el rango de fechas para que el inicio sea anterior al fin.');
		[start, end] = [end, start];
	}

	return {
		freq: params.freq,
		granularity: freqToGranularity(params.freq),
		periods: periods.map((period) => ({
			value: period,
			label: formatTimePeriod(period, params.freq)
		})),
		start: start || null,
		end: end || null
	};
}

async function loadAvailableValues(params: {
	indicatorCode: string;
	freq: string;
	dimensions: RegisteredDimension[];
	filters: Record<string, string>;
}): Promise<Map<string, string[]>> {
	const valuesByDimension = new Map<string, string[]>();

	for (const dimension of params.dimensions) {
		const column = dimensionColumn(dimension.code);
		const where = buildWhereForObservationQueries({
			indicatorCode: params.indicatorCode,
			freq: params.freq,
			filters: params.filters,
			excludeDimension: dimension.code,
			includeDateRange: false
		});

		const rows = await runCanonicalQuery<{ value: string }>(
			`
				SELECT DISTINCT ${column} AS value
				FROM observations
				WHERE ${where.conditions.join(' AND ')} AND ${column} IS NOT NULL
				ORDER BY ${column}
				LIMIT 500
			`,
			...where.values
		);
		valuesByDimension.set(dimension.code, rows.map((row) => String(row.value)).filter(Boolean));
	}

	return valuesByDimension;
}

function intersectValueMaps(maps: Map<string, string[]>[], dimensionCodes: string[]): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const code of dimensionCodes) {
		const values = intersectArrays(maps.map((map) => map.get(code) || []));
		result.set(code, values);
	}
	return result;
}

function prefixDimensionForIndicator(
	dimension: ExplorerDimension,
	indicator: ExplorerCatalogIndicator
): ExplorerDimension {
	return {
		...dimension,
		code: `${indicator.code}:${dimension.code}`,
		name: `${indicator.shortName || indicator.code} · ${dimension.name}`
	};
}

function resolveDimensions(params: {
	registeredDimensions: RegisteredDimension[];
	availableValues: Map<string, string[]>;
	valueLabels: Map<string, Map<string, string>>;
	filters: Record<string, string>;
	by: string | null;
}): ExplorerDimension[] {
	return params.registeredDimensions.map((dimension) => {
		const rawValues = params.availableValues.get(dimension.code) || [];
		const labels = params.valueLabels.get(dimension.code) || new Map<string, string>();
		const values = rawValues.map((value) => ({ code: value, label: labels.get(value) || value }));
		const selectedValue = params.filters[dimension.code] || null;
		let state: ExplorerDimensionState = 'unresolved';

		if (selectedValue) state = 'filtered';
		else if (params.by === dimension.code) state = 'split';
		else if (values.length <= 1) state = values.length === 0 ? 'empty' : 'fixed';

		return {
			...dimension,
			state,
			selectedValue,
			values
		};
	});
}

async function queryChart(params: {
	indicators: ExplorerCatalogIndicator[];
	freq: string;
	by: string | null;
	filters: Record<string, string>;
	start: string;
	end: string;
	dimensions: ExplorerDimension[];
}): Promise<ExplorerChartModel> {
	const conditions = [
		`indicator_code IN (${params.indicators.map(() => '?').join(', ')})`,
		'freq = ?'
	];
	const values: unknown[] = [
		...params.indicators.map((indicator) => indicator.code),
		params.freq
	];

	for (const [code, value] of Object.entries(params.filters)) {
		conditions.push(`${dimensionColumn(code)} = ?`);
		values.push(value);
	}

	if (params.start) {
		conditions.push('time_period >= ?');
		values.push(params.start);
	}
	if (params.end) {
		conditions.push('time_period <= ?');
		values.push(params.end);
	}

	const byColumn = params.by ? dimensionColumn(params.by) : null;
	const rows = await runCanonicalQuery<Record<string, unknown>>(
		`
			SELECT indicator_code AS indicator_code, time_period AS time, obs_value AS value${byColumn ? `, ${byColumn} AS split_value` : ''}
			FROM observations
			WHERE ${conditions.join(' AND ')}
			ORDER BY indicator_code, time_period${byColumn ? ', split_value' : ''}
		`,
		...values
	);

	if (rows.length === 0) {
		return {
			status: 'no_data',
			series: [],
			messages: ['No hay observaciones para la selección actual.']
		};
	}

	const seen = new Set<string>();
	for (const row of rows) {
		const key = params.by
			? `${row.indicator_code}|${row.time}|${row.split_value}`
			: `${row.indicator_code}|${row.time}`;
		if (seen.has(key)) {
			return {
				status: 'invalid',
				series: [],
				messages: [
					'La selección todavía produce más de una observación para el mismo punto. Agrega filtros adicionales o revisa el registro de dimensiones.'
				]
			};
		}
		seen.add(key);
	}

	const splitDimension = params.by
		? params.dimensions.find((dimension) => dimension.code === params.by)
		: null;
	const splitLabels = new Map(
		splitDimension?.values.map((value) => [value.code, value.label] as const) || []
	);
	const seriesByName = new Map<string, ExplorerSeriesPoint[]>();

	const indicatorLabels = new Map(
		params.indicators.map(
			(indicator) => [indicator.code, indicator.shortName || indicator.name] as const
		)
	);

	for (const row of rows) {
		const indicatorCode = String(row.indicator_code);
		const indicatorName = indicatorLabels.get(indicatorCode) || indicatorCode;
		const splitValue = params.by ? String(row.split_value || 'Sin valor') : '';
		const name = params.by
			? `${indicatorName} · ${splitDimension?.name || params.by}: ${splitLabels.get(splitValue) || splitValue}`
			: indicatorName;
		const points = seriesByName.get(name) || [];
		points.push({
			time: String(row.time),
			value: row.value === null || row.value === undefined ? null : asNumber(row.value)
		});
		seriesByName.set(name, points);
	}

	return {
		status: 'chartable',
		series: Array.from(seriesByName.entries()).map(([name, points]) => ({ name, points })),
		messages: []
	};
}

export async function getExplorerPageModel(url: URL): Promise<ExplorerPageModel> {
	const state = parseState(url);
	const warnings: string[] = [];
	const {
		dataSources: dataSourceOptions,
		themes: themeOptions,
		indicators: catalog
	} = await loadCatalog();

	if (state.dataSource && !dataSourceOptions.some((option) => option.code === state.dataSource)) {
		warnings.push('Se ignoró la fuente de datos porque no existe en el catálogo.');
		state.dataSource = '';
	}

	const availableThemes = state.dataSource
		? new Set(
				catalog
					.filter((indicator) => indicator.dataSourceCode === state.dataSource)
					.map((indicator) => indicator.theme)
			)
		: new Set(themeOptions);
	if (state.theme && !availableThemes.has(state.theme)) {
		warnings.push(
			'Se ignoró el tema porque no está disponible para la fuente de datos seleccionada.'
		);
		state.theme = '';
	}

	const existingIndicators = state.selectedIndicators
		.map((code) => catalog.find((indicator) => indicator.code === code) || null)
		.filter((indicator): indicator is ExplorerCatalogIndicator => Boolean(indicator));

	if (existingIndicators.length !== state.selectedIndicators.length) {
		warnings.push('Se ignoraron indicadores de la URL que no existen en el catálogo.');
	}

	const selectedIndicators = existingIndicators.filter(
		(indicator) =>
			(!state.dataSource || indicator.dataSourceCode === state.dataSource) &&
			(!state.theme || indicator.theme === state.theme)
	);
	if (selectedIndicators.length !== existingIndicators.length) {
		warnings.push('Se ignoraron indicadores que no coinciden con la fuente de datos y el tema.');
	}
	state.selectedIndicators = selectedIndicators.map((indicator) => indicator.code);
	state.indicator = state.selectedIndicators[0] || null;

	const selectedIndicator = selectedIndicators[0] || null;
	const metadatas = (
		await Promise.all(selectedIndicators.map((indicator) => loadMetadata(indicator.code)))
	).filter((metadata): metadata is ExplorerMetadata => Boolean(metadata));
	const metadata = metadatas[0] || null;
	const measurementCompatibility = resolveMeasurementCompatibility(metadatas);
	const commonFrequencies = selectedIndicators.length
		? intersectArrays(selectedIndicators.map((indicator) => indicator.availableFrequencies))
		: [];

	if (!state.indicator || selectedIndicators.length === 0) {
		return {
			state,
			dataSources: dataSourceOptions,
			themes: themeOptions,
			indicators: catalog,
			selectedIndicator: null,
			selectedIndicators: [],
			commonFrequencies: [],
			metadata: null,
			metadatas: [],
			measurementCompatibility: emptyMeasurementCompatibility(),
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis: emptyTimeAxis(state.freq),
			chart: {
				status: 'needs_indicator',
				series: [],
				messages: ['Elige uno o más indicadores para comenzar.']
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	if (!state.freq && commonFrequencies.length === 1) {
		state.freq = commonFrequencies[0];
	}

	if (!state.freq || !commonFrequencies.includes(state.freq)) {
		if (state.freq && !commonFrequencies.includes(state.freq)) {
			warnings.push('Se ignoró la frecuencia porque no está disponible para todos los indicadores.');
			state.freq = null;
		}

		return {
			state,
			dataSources: dataSourceOptions,
			themes: themeOptions,
			indicators: catalog,
			selectedIndicator,
			selectedIndicators,
			commonFrequencies,
			metadata,
			metadatas,
			measurementCompatibility,
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis: emptyTimeAxis(state.freq),
			chart: {
				status: 'needs_frequency',
				series: [],
				messages: [
					commonFrequencies.length === 0
						? 'Los indicadores seleccionados no comparten una frecuencia.'
						: 'Elige una frecuencia disponible para todos los indicadores seleccionados.'
				]
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	const timeAxis = await loadTimeAxis({
		indicatorCodes: selectedIndicators.map((indicator) => indicator.code),
		freq: state.freq,
		start: state.start,
		end: state.end,
		warnings
	});
	state.start = timeAxis.start || '';
	state.end = timeAxis.end || '';

	const registeredResults = await Promise.all(
		selectedIndicators.map(async (indicator) => ({
			indicator,
			result: await loadRegisteredDimensions(indicator.code, state.freq as string)
		}))
	);
	const registryWarning = registeredResults.find((entry) => entry.result.warning)?.result.warning;

	if (registryWarning) {
		warnings.push(registryWarning);
		return {
			state,
			dataSources: dataSourceOptions,
			themes: themeOptions,
			indicators: catalog,
			selectedIndicator,
			selectedIndicators,
			commonFrequencies,
			metadata,
			metadatas,
			measurementCompatibility,
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis,
			chart: {
				status: 'invalid',
				series: [],
				messages: [registryWarning]
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	const registeredByIndicator = new Map(
		registeredResults.map((entry) => [entry.indicator.code, entry.result.dimensions] as const)
	);
	const commonDimensionCodes = intersectArrays(
		registeredResults.map((entry) => entry.result.dimensions.map((dimension) => dimension.code))
	);
	const commonCodeSet = new Set(commonDimensionCodes);
	const firstRegisteredDimensions = registeredResults[0]?.result.dimensions || [];
	const commonRegisteredDimensions = commonDimensionCodes
		.map((code) => {
			const firstDimension = firstRegisteredDimensions.find((dimension) => dimension.code === code);
			if (!firstDimension) return null;
			return {
				...firstDimension,
				isFilterable: registeredResults.every((entry) =>
					entry.result.dimensions.find((dimension) => dimension.code === code)?.isFilterable
				),
				isSplitable: registeredResults.every((entry) =>
					entry.result.dimensions.find((dimension) => dimension.code === code)?.isSplitable
				)
			};
		})
		.filter((dimension): dimension is RegisteredDimension => Boolean(dimension));

	for (const code of Object.keys(state.filters)) {
		if (!commonCodeSet.has(code)) {
			delete state.filters[code];
			warnings.push(
				`Se ignoró el filtro ${code} porque no aplica a todos los indicadores seleccionados.`
			);
		}
	}

	if (state.by && !commonCodeSet.has(state.by)) {
		warnings.push(
			`Se ignoró la desagregación ${state.by} porque no aplica a todos los indicadores seleccionados.`
		);
		state.by = null;
	}

	if (state.by && state.filters[state.by]) {
		warnings.push(`El filtro ${state.by} tiene prioridad sobre la desagregación.`);
		state.by = null;
	}

	// Collapse every dimension the user has not chosen down to its registry
	// default. The canonical store holds one row per combination of all 13
	// dimensions, so an unpinned dimension does not mean "all" -- it means the
	// query returns that dimension's total row *and* each of its parts, and the
	// chart draws them on top of each other.
	//
	// CATEGORY is the exception: it has no default because 216 of the 230
	// indicators with a breakdown ship no '_T' category row, so filtering to a
	// total would empty the chart. Splitting by it is the useful default -- an
	// indicator like "Régimen de salud del jefe/a" *is* its breakdown.
	if (!state.by) {
		// Specifically CATEGORY, not merely the first dimension without a default.
		// REF_AREA also lacks one for department-only indicators, and splitting by
		// it would draw 24 department series for an indicator whose actual subject
		// is its breakdown. Geography is a filter the user picks; the breakdown is
		// what the indicator is about.
		//
		// A dimension is only registered when it actually varies for the
		// indicator, so presence here already means it has more than one value.
		const breakdown = commonRegisteredDimensions.find(
			(dimension) =>
				dimension.code === 'CATEGORY' &&
				dimension.defaultValue === null &&
				dimension.isSplitable &&
				!state.filters[dimension.code]
		);
		if (breakdown) state.by = breakdown.code;
	}

	for (const dimension of commonRegisteredDimensions) {
		if (state.filters[dimension.code]) continue;
		if (state.by === dimension.code) continue;
		if (dimension.defaultValue) state.filters[dimension.code] = dimension.defaultValue;
	}

	const commonAvailableValueMaps = await Promise.all(
		selectedIndicators.map((indicator) =>
			loadAvailableValues({
				indicatorCode: indicator.code,
				freq: state.freq as string,
				dimensions: commonRegisteredDimensions,
				filters: state.filters
			})
		)
	);
	const commonAvailableValues = intersectValueMaps(commonAvailableValueMaps, commonDimensionCodes);
	const allRegisteredCodes = Array.from(
		new Set(
			registeredResults.flatMap((entry) =>
				entry.result.dimensions.map((dimension) => dimension.code)
			)
		)
	);
	const valueLabels = await loadValueLabels(
		allRegisteredCodes,
		selectedIndicators.map((indicator) => indicator.code),
		warnings
	);
	const dimensions = resolveDimensions({
		registeredDimensions: commonRegisteredDimensions,
		availableValues: commonAvailableValues,
		valueLabels,
		filters: state.filters,
		by: state.by
	});

	const privateDimensions: ExplorerDimension[] = [];
	for (const indicator of selectedIndicators) {
		const registeredDimensions = registeredByIndicator.get(indicator.code) || [];
		const privateRegisteredDimensions = registeredDimensions.filter(
			(dimension) => !commonCodeSet.has(dimension.code)
		);
		if (privateRegisteredDimensions.length === 0) continue;

		const availableValues = await loadAvailableValues({
			indicatorCode: indicator.code,
			freq: state.freq,
			dimensions: privateRegisteredDimensions,
			filters: state.filters
		});
		privateDimensions.push(
			...resolveDimensions({
				registeredDimensions: privateRegisteredDimensions,
				availableValues,
				valueLabels,
				filters: {},
				by: null
			}).map((dimension) => prefixDimensionForIndicator(dimension, indicator))
		);
	}

	const unresolvedDimensions = [
		...dimensions.filter((dimension) => dimension.state === 'unresolved'),
		...privateDimensions.filter((dimension) => dimension.state === 'unresolved')
	];
	const fixedDimensions = [
		...dimensions.filter((dimension) => dimension.state === 'fixed'),
		...privateDimensions.filter((dimension) => dimension.state === 'fixed')
	];
	const chart = !measurementCompatibility.compatible
		? {
				status: 'invalid' as const,
				series: [],
				messages: [measurementCompatibility.message || 'Los indicadores no son comparables.']
			}
		: unresolvedDimensions.length > 0
			? {
					status: 'needs_resolution' as const,
					series: [],
					messages: [
						selectedIndicators.length > 1
							? 'Para comparar sin suposiciones, filtra o desagrega las dimensiones comunes pendientes. Los indicadores con dimensiones propias multi-valor todavía no son comparables.'
							: 'Para graficar sin suposiciones, filtra o desagrega las dimensiones pendientes.'
					]
				}
			: await queryChart({
					indicators: selectedIndicators,
					freq: state.freq,
					by: state.by,
					filters: state.filters,
					start: state.start,
					end: state.end,
					dimensions
				});

	return {
		state,
		dataSources: dataSourceOptions,
		themes: themeOptions,
		indicators: catalog,
		selectedIndicator,
		selectedIndicators,
		commonFrequencies,
		metadata,
		metadatas,
		measurementCompatibility,
		dimensions,
		unresolvedDimensions,
		fixedDimensions,
		timeAxis,
		chart,
		warnings,
		canonicalSearch: buildCanonicalSearch(state)
	};
}
