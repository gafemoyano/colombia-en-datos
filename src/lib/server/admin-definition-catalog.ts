import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	dataSources,
	indicatorDataSources,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';

export interface AdminDefinitionFrequency {
	indicatorId: number;
	indicatorCode: string;
	indicatorName: string;
	groupCode: string;
	groupName: string;
	freq: string;
	dimensions: string[];
	published: boolean;
}

type AppDb = ReturnType<typeof getDb>;

interface IndicatorDefinitionSeed {
	indicatorId: number;
	indicatorCode: string;
	indicatorName: string;
	groupCode: string;
	groupName: string;
	legacyFreq: string | null;
}

function buildDefinitions(params: {
	indicators: IndicatorDefinitionSeed[];
	explicitFrequencies: Array<{ indicatorId: number; freq: string }>;
	publishedFrequencies: Array<{ indicatorId: number; freq: string }>;
	dimensions: Array<{ indicatorId: number; freq: string; dimensionCode: string }>;
}): AdminDefinitionFrequency[] {
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

	const definitions: AdminDefinitionFrequency[] = [];
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

export async function listAdminDefinitionFrequencies(
	dataSourceCode: string,
	db: AppDb = getDb()
): Promise<AdminDefinitionFrequency[]> {
	if (!dataSourceCode) return [];

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
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id))
		.where(eq(dataSources.code, dataSourceCode))
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

	return buildDefinitions({
		indicators: indicatorRows,
		explicitFrequencies: explicitFrequencyRows,
		publishedFrequencies: publishedRows,
		dimensions: dimensionRows
	});
}
