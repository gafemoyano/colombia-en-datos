import { fail, redirect } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	areas,
	dimensionDefinitions,
	indicatorDataSources,
	indicatorDimensions,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { normalizeDataSourceCode } from '$lib/ingest/definitions';
import { validateDefinitionPaste } from '$lib/server/definition-ingest';
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

	const definitions: FrequencyDefinition[] = [];
	for (const indicator of params.indicators) {
		const frequencies = new Set<string>(publishedByIndicator.get(indicator.indicatorId) || []);
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
		const db = getDb();
		const formData = await request.formData();
		const dimensionRows = await db
			.select({ code: dimensionDefinitions.code })
			.from(dimensionDefinitions);
		const validation = validateDefinitionPaste({
			dataSource: {
				code: formValue(formData.get('data_source')),
				name: formValue(formData.get('data_source_name'))
			},
			definitionText: String(formData.get('definition_text') || ''),
			knownDimensionCodes: dimensionRows.map((row) => row.code)
		});
		const result = {
			validation,
			definitionText: String(formData.get('definition_text') || ''),
			selectedInput: validation.dataSource
		};

		if (!validation.valid) return fail(400, result);
		return result;
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
		definitions
	};
};
