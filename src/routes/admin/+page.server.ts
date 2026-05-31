import { getDb } from '$lib/db/client';
import { dataSources, indicatorGroups, indicators } from '$lib/db/schema';
import {
	getAvailableFrequenciesByIndicator,
	getPublishedFrequenciesByIndicator
} from '$lib/server/duckdb';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9áéíóúñ]+/gi, ' ')
		.trim();
}

function hasMachineTitle(code: string, name: string): boolean {
	return normalizeText(name) === normalizeText(code) || name.includes('_');
}

function attentionNeeds(indicator: {
	code: string;
	name: string;
	description: string | null;
	methodology: string | null;
}) {
	const needsTitle =
		!indicator.name ||
		indicator.name === indicator.code ||
		hasMachineTitle(indicator.code, indicator.name);
	const couldUseDescription = !indicator.description;
	const couldUseMethodology = !indicator.methodology;

	return {
		needsTitle,
		couldUseDescription,
		couldUseMethodology,
		needsAttention: needsTitle || couldUseDescription || couldUseMethodology
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const db = getDb();
	const search = url.searchParams.get('q')?.trim().toLowerCase() || '';
	const dataSourceFilter = url.searchParams.get('data_source') || url.searchParams.get('area') || '';
	const attentionOnly = url.searchParams.get('attention') === '1';

	const rows = await db
		.select({
			code: indicators.code,
			name: indicators.name,
			description: indicators.description,
			methodology: indicators.methodology,
			frequency: indicators.frequency,
			sourceCitation: indicators.sourceCitation,
			unit: indicators.unit,
			dataSource: dataSources.name,
			dataSourceCode: dataSources.code,
			group: indicatorGroups.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id));

	const allDataSources = [
		...new Map(rows.map((row) => [row.dataSourceCode, row.dataSource])).entries()
	].map(([code, name]) => ({ code, name }));
	const indicatorCodes = rows.map((row) => row.code);
	const frequenciesByIndicator = await getAvailableFrequenciesByIndicator(indicatorCodes);
	const publishedFrequenciesByIndicator = await getPublishedFrequenciesByIndicator(indicatorCodes);

	const catalog = rows
		.map((row) => {
			const availableFrequencies =
				frequenciesByIndicator.get(row.code) || (row.frequency ? [row.frequency] : []);
			const publishedFrequencies = publishedFrequenciesByIndicator.get(row.code) || [];

			return {
				...row,
				availableFrequencies,
				publishedFrequencies,
				unpublishedObservationFrequencies: availableFrequencies.filter(
					(freq) => !publishedFrequencies.includes(freq)
				),
				attention: attentionNeeds(row)
			};
		})
		.sort(
			(a, b) =>
				a.dataSource.localeCompare(b.dataSource) ||
				a.group.localeCompare(b.group) ||
				a.name.localeCompare(b.name)
		);

	const filteredIndicators = catalog.filter((row) => {
		if (dataSourceFilter && row.dataSourceCode !== dataSourceFilter) return false;
		if (attentionOnly && !row.attention.needsAttention) return false;
		if (!search) return true;
		return [row.code, row.name, row.group, row.dataSource]
			.filter(Boolean)
			.some((value) => value.toLowerCase().includes(search));
	});

	return {
		indicators: filteredIndicators,
		catalog,
		dataSources: allDataSources.sort((a, b) => a.name.localeCompare(b.name)),
		filters: { search, dataSource: dataSourceFilter, attentionOnly }
	};
};
