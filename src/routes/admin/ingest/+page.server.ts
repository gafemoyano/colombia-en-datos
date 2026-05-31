import { fail, redirect } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	areas,
	indicatorDataSources,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { normalizeDataSourceCode } from '$lib/ingest/definitions';
import { saveDefinitionGrid } from '$lib/server/definition-ingest';
import type { Actions, PageServerLoad } from './$types';

interface IndicatorDefinitionSeed {
	indicatorId: number;
	indicatorCode: string;
	indicatorName: string;
	groupCode: string;
	groupName: string;
	legacyFreq: string | null;
}

interface FrequencyDefinition {
	indicatorId: number;
	indicatorCode: string;
	indicatorName: string;
	groupCode: string;
	groupName: string;
	freq: string;
	dimensions: string[];
	published: boolean;
}

function formValue(value: FormDataEntryValue | null): string {
	return String(value || '').trim();
}

function ingestHref(params: URLSearchParams): string {
	const search = params.toString();
	return search ? `/admin/ingest?${search}` : '/admin/ingest';
}

function canonicalizeDataSourceParams(url: URL): { code: string; name: string } {
	const rawCode = url.searchParams.get('data_source')?.trim() || '';
	const normalizedCode = normalizeDataSourceCode(rawCode);
	const name = url.searchParams.get('data_source_name')?.trim() || '';

	if (rawCode && rawCode !== normalizedCode) {
		const params = new URLSearchParams(url.searchParams);
		if (normalizedCode) params.set('data_source', normalizedCode);
		else params.delete('data_source');
		if (name) params.set('data_source_name', name);
		else params.delete('data_source_name');
		throw redirect(303, ingestHref(params));
	}

	return { code: normalizedCode, name };
}

function buildDefinitions(params: {
	indicators: IndicatorDefinitionSeed[];
	explicitFrequencies: Array<{ indicatorId: number; freq: string }>;
	publishedFrequencies: Array<{ indicatorId: number; freq: string }>;
	dimensions: Array<{ indicatorId: number; freq: string; dimensionCode: string }>;
}): FrequencyDefinition[] {
	const publishedByIndicator = new Map<number, Set<string>>();
	for (const row of params.publishedFrequencies) {
		const frequencies = publishedByIndicator.get(row.indicatorId) || new Set<string>();
		frequencies.add(row.freq);
		publishedByIndicator.set(row.indicatorId, frequencies);
	}

	const dimensionsByIndicator = new Map<number, Array<{ freq: string; dimensionCode: string }>>();
	for (const row of params.dimensions) {
		const dimensions = dimensionsByIndicator.get(row.indicatorId) || [];
		dimensions.push({ freq: row.freq, dimensionCode: row.dimensionCode });
		dimensionsByIndicator.set(row.indicatorId, dimensions);
	}

	const explicitByIndicator = new Map<number, Set<string>>();
	for (const row of params.explicitFrequencies) {
		const frequencies = explicitByIndicator.get(row.indicatorId) || new Set<string>();
		frequencies.add(row.freq);
		explicitByIndicator.set(row.indicatorId, frequencies);
	}

	const definitions: FrequencyDefinition[] = [];
	for (const indicator of params.indicators) {
		const frequencies = new Set<string>(explicitByIndicator.get(indicator.indicatorId) || []);
		for (const freq of publishedByIndicator.get(indicator.indicatorId) || []) frequencies.add(freq);
		if (indicator.legacyFreq) frequencies.add(indicator.legacyFreq);

		for (const freq of Array.from(frequencies).sort((a, b) => a.localeCompare(b))) {
			const dimensionCodes = new Set(
				(dimensionsByIndicator.get(indicator.indicatorId) || [])
					.filter((dimension) => dimension.freq === freq || dimension.freq === '*')
					.map((dimension) => dimension.dimensionCode)
			);

			definitions.push({
				indicatorId: indicator.indicatorId,
				indicatorCode: indicator.indicatorCode,
				indicatorName: indicator.indicatorName,
				groupCode: indicator.groupCode,
				groupName: indicator.groupName,
				freq,
				dimensions: Array.from(dimensionCodes).sort((a, b) => a.localeCompare(b)),
				published: publishedByIndicator.get(indicator.indicatorId)?.has(freq) || false
			});
		}
	}

	return definitions;
}

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const result = await saveDefinitionGrid({
			dataSource: {
				code: formValue(formData.get('data_source')),
				name: formValue(formData.get('data_source_name'))
			},
			definitionText: String(formData.get('definition_text') || '')
		});

		if (!result.ok) {
			return fail(400, {
				validation: result.validation,
				definitionText: String(formData.get('definition_text') || ''),
				selectedInput: result.validation.dataSource
			});
		}

		throw redirect(303, `/admin/ingest?data_source=${result.saved?.dataSourceCode}&saved=1`);
	}
};

export const load: PageServerLoad = async ({ url }) => {
	const db = getDb();
	const selectedInput = canonicalizeDataSourceParams(url);

	const dataSourceOptions = await db
		.select({ code: areas.code, name: areas.name })
		.from(areas)
		.orderBy(asc(areas.name));

	const selectedDataSource = selectedInput.code
		? dataSourceOptions.find((dataSource) => dataSource.code === selectedInput.code) || null
		: null;

	let definitions: FrequencyDefinition[] = [];
	if (selectedInput.code) {
		const indicatorRows = await db
			.select({
				indicatorId: indicators.id,
				indicatorCode: indicators.code,
				indicatorName: indicators.name,
				groupCode: indicatorGroups.code,
				groupName: indicatorGroups.name,
				legacyFreq: indicators.frequency
			})
			.from(indicators)
			.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
			.innerJoin(areas, eq(indicatorGroups.areaId, areas.id))
			.where(eq(areas.code, selectedInput.code))
			.orderBy(asc(indicatorGroups.code), asc(indicators.code));

		const indicatorIds = indicatorRows.map((row) => row.indicatorId);
		const explicitFrequencyRows = indicatorIds.length
			? await db
					.select({
						indicatorId: indicatorFrequencies.indicatorId,
						freq: indicatorFrequencies.freq
					})
					.from(indicatorFrequencies)
					.where(inArray(indicatorFrequencies.indicatorId, indicatorIds))
			: [];
		const publishedRows = indicatorIds.length
			? await db
					.select({
						indicatorId: indicatorDataSources.indicatorId,
						freq: indicatorDataSources.freq
					})
					.from(indicatorDataSources)
					.where(inArray(indicatorDataSources.indicatorId, indicatorIds))
			: [];
		const dimensionRows = indicatorIds.length
			? await db
					.select({
						indicatorId: indicatorDimensions.indicatorId,
						freq: indicatorDimensions.freq,
						dimensionCode: indicatorDimensions.dimensionCode
					})
					.from(indicatorDimensions)
					.where(inArray(indicatorDimensions.indicatorId, indicatorIds))
			: [];

		definitions = buildDefinitions({
			indicators: indicatorRows,
			explicitFrequencies: explicitFrequencyRows,
			publishedFrequencies: publishedRows,
			dimensions: dimensionRows
		});
	}

	return {
		dataSources: dataSourceOptions,
		selectedInput: {
			code: selectedInput.code,
			name: selectedInput.name || selectedDataSource?.name || ''
		},
		selectedDataSource,
		definitions,
		saved: url.searchParams.get('saved') === '1'
	};
};
