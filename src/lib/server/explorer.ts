import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	areas,
	dimensionDefinitions,
	dimensionValues,
	indicatorDimensions,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { getAvailableFrequenciesByIndicator, runCanonicalQuery } from '$lib/server/duckdb';

const REF_AREA = 'CO';
const DIMENSION_COLUMNS = new Map<string, string>([
	['GEO_LEVEL', 'geo_level'],
	['DEPT_CODE', 'dept_code'],
	['MUNI_CODE', 'muni_code'],
	['URBAN_RURAL', 'urban_rural'],
	['SEX', 'sex'],
	['AGE', 'age'],
	['ADJUSTMENT', 'adjustment']
]);

export interface ExplorerCatalogIndicator {
	code: string;
	name: string;
	shortName: string | null;
	area: string;
	areaCode: string;
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
	area: string;
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
	source: string | null;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	updated: string | null;
}

export interface ExplorerPageModel {
	state: ExplorerState;
	areas: Array<{ code: string; name: string }>;
	indicators: ExplorerCatalogIndicator[];
	selectedIndicator: ExplorerCatalogIndicator | null;
	metadata: ExplorerMetadata | null;
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
	const selectedIndicators = url.searchParams
		.getAll('indicator')
		.map((value) => value.trim())
		.filter(Boolean);

	const filters: Record<string, string> = {};
	for (const [key, value] of url.searchParams.entries()) {
		if (!key.startsWith('filter.')) continue;
		const code = normalizeDimensionCode(key.slice('filter.'.length));
		if (code && value.trim()) filters[code] = value.trim();
	}

	return {
		area: url.searchParams.get('area')?.trim() || '',
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
	if (state.area) params.set('area', state.area);
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
	areas: Array<{ code: string; name: string }>;
	indicators: ExplorerCatalogIndicator[];
}> {
	const db = getDb();
	const rows = await db
		.select({
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			area: areas.name,
			areaCode: areas.code,
			group: indicatorGroups.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(areas, eq(indicatorGroups.areaId, areas.id));

	const frequencyMap = await getAvailableFrequenciesByIndicator(rows.map((row) => row.code));
	const catalog = rows
		.map((row) => ({
			code: row.code,
			name: row.name,
			shortName: row.shortName,
			area: row.area || 'Sin área',
			areaCode: row.areaCode,
			group: row.group || 'Sin grupo',
			availableFrequencies: frequencyMap.get(row.code) || []
		}))
		.sort(
			(a, b) =>
				a.area.localeCompare(b.area) ||
				a.group.localeCompare(b.group) ||
				a.name.localeCompare(b.name)
		);

	const areaOptions = [
		...new Map(catalog.map((indicator) => [indicator.areaCode, indicator.area])).entries()
	]
		.map(([code, name]) => ({ code, name }))
		.sort((a, b) => a.name.localeCompare(b.name));

	return { areas: areaOptions, indicators: catalog };
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
			source: indicators.source,
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
				isSplitable: indicatorDimensions.isSplitable
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
					isSplitable: row.isSplitable ?? true
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
	dimensionCodes: string[]
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
		for (const row of rows) {
			const dimensionLabels = labels.get(row.dimensionCode) || new Map<string, string>();
			dimensionLabels.set(row.code, row.labelEs || row.code);
			labels.set(row.dimensionCode, dimensionLabels);
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
	const conditions = ['indicator_code = ?', 'freq = ?', 'ref_area = ?'];
	const values: unknown[] = [params.indicatorCode, params.freq, REF_AREA];

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
	indicatorCode: string;
	freq: string;
	start: string;
	end: string;
	warnings: string[];
}): Promise<ExplorerTimeAxis> {
	const rows = await runCanonicalQuery<{ time_period: string }>(
		`
			SELECT DISTINCT time_period
			FROM observations
			WHERE indicator_code = ? AND freq = ? AND ref_area = ? AND time_period IS NOT NULL
			ORDER BY time_period
		`,
		params.indicatorCode,
		params.freq,
		REF_AREA
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
	indicator: ExplorerCatalogIndicator;
	freq: string;
	by: string | null;
	filters: Record<string, string>;
	start: string;
	end: string;
	dimensions: ExplorerDimension[];
}): Promise<ExplorerChartModel> {
	const where = buildWhereForObservationQueries({
		indicatorCode: params.indicator.code,
		freq: params.freq,
		filters: params.filters,
		includeDateRange: true,
		start: params.start,
		end: params.end
	});
	const byColumn = params.by ? dimensionColumn(params.by) : null;
	const rows = await runCanonicalQuery<Record<string, unknown>>(
		`
			SELECT time_period AS time, obs_value AS value${byColumn ? `, ${byColumn} AS split_value` : ''}
			FROM observations
			WHERE ${where.conditions.join(' AND ')}
			ORDER BY time_period${byColumn ? ', split_value' : ''}
		`,
		...where.values
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
		const key = params.by ? `${row.time}|${row.split_value}` : String(row.time);
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

	for (const row of rows) {
		const splitValue = params.by ? String(row.split_value || 'Sin valor') : '';
		const name = params.by
			? `${splitDimension?.name || params.by}: ${splitLabels.get(splitValue) || splitValue}`
			: params.indicator.shortName || params.indicator.name;
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
	const { areas: areaOptions, indicators: catalog } = await loadCatalog();
	const selectedIndicator = state.indicator
		? catalog.find((indicator) => indicator.code === state.indicator) || null
		: null;

	if (state.selectedIndicators.length > 1) {
		warnings.push('Esta primera versión solo grafica un indicador; se usa el primero de la URL.');
	}

	if (!state.indicator) {
		return {
			state,
			areas: areaOptions,
			indicators: catalog,
			selectedIndicator: null,
			metadata: null,
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis: emptyTimeAxis(state.freq),
			chart: {
				status: 'needs_indicator',
				series: [],
				messages: ['Elige un indicador para comenzar.']
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	if (!selectedIndicator) {
		return {
			state,
			areas: areaOptions,
			indicators: catalog,
			selectedIndicator: null,
			metadata: null,
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis: emptyTimeAxis(state.freq),
			chart: {
				status: 'invalid',
				series: [],
				messages: [`No se encontró el indicador ${state.indicator}.`]
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	if (!state.freq && selectedIndicator.availableFrequencies.length === 1) {
		state.freq = selectedIndicator.availableFrequencies[0];
	}

	if (!state.freq || !selectedIndicator.availableFrequencies.includes(state.freq)) {
		return {
			state,
			areas: areaOptions,
			indicators: catalog,
			selectedIndicator,
			metadata: await loadMetadata(selectedIndicator.code),
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis: emptyTimeAxis(state.freq),
			chart: {
				status: 'needs_frequency',
				series: [],
				messages: ['Elige una frecuencia disponible para este indicador.']
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}

	const metadata = await loadMetadata(selectedIndicator.code);
	const timeAxis = await loadTimeAxis({
		indicatorCode: selectedIndicator.code,
		freq: state.freq,
		start: state.start,
		end: state.end,
		warnings
	});
	state.start = timeAxis.start || '';
	state.end = timeAxis.end || '';
	const registeredDimensionResult = await loadRegisteredDimensions(
		selectedIndicator.code,
		state.freq
	);
	if (registeredDimensionResult.warning) {
		warnings.push(registeredDimensionResult.warning);
		return {
			state,
			areas: areaOptions,
			indicators: catalog,
			selectedIndicator,
			metadata,
			dimensions: [],
			unresolvedDimensions: [],
			fixedDimensions: [],
			timeAxis,
			chart: {
				status: 'invalid',
				series: [],
				messages: [registeredDimensionResult.warning]
			},
			warnings,
			canonicalSearch: buildCanonicalSearch(state)
		};
	}
	const registeredDimensions = registeredDimensionResult.dimensions;
	const registeredCodes = new Set(registeredDimensions.map((dimension) => dimension.code));

	for (const code of Object.keys(state.filters)) {
		if (!registeredCodes.has(code)) {
			delete state.filters[code];
			warnings.push(`Se ignoró el filtro ${code} porque no aplica a este indicador/frecuencia.`);
		}
	}

	if (state.by && !registeredCodes.has(state.by)) {
		warnings.push(
			`Se ignoró la desagregación ${state.by} porque no aplica a este indicador/frecuencia.`
		);
		state.by = null;
	}

	if (state.by && state.filters[state.by]) {
		warnings.push(`El filtro ${state.by} tiene prioridad sobre la desagregación.`);
		state.by = null;
	}

	const availableValues = await loadAvailableValues({
		indicatorCode: selectedIndicator.code,
		freq: state.freq,
		dimensions: registeredDimensions,
		filters: state.filters
	});
	const valueLabels = await loadValueLabels(
		registeredDimensions.map((dimension) => dimension.code)
	);
	const dimensions = resolveDimensions({
		registeredDimensions,
		availableValues,
		valueLabels,
		filters: state.filters,
		by: state.by
	});
	const unresolvedDimensions = dimensions.filter((dimension) => dimension.state === 'unresolved');
	const fixedDimensions = dimensions.filter((dimension) => dimension.state === 'fixed');
	const chart =
		unresolvedDimensions.length > 0
			? {
					status: 'needs_resolution' as const,
					series: [],
					messages: [
						'Para graficar sin suposiciones, filtra o desagrega las dimensiones pendientes.'
					]
				}
			: await queryChart({
					indicator: selectedIndicator,
					freq: state.freq,
					by: state.by,
					filters: state.filters,
					start: state.start,
					end: state.end,
					dimensions
				});

	return {
		state,
		areas: areaOptions,
		indicators: catalog,
		selectedIndicator,
		metadata,
		dimensions,
		unresolvedDimensions,
		fixedDimensions,
		timeAxis,
		chart,
		warnings,
		canonicalSearch: buildCanonicalSearch(state)
	};
}
