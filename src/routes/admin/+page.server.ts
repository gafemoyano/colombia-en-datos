import { getDb } from '$lib/db/client';
import { areas, indicatorGroups, indicators } from '$lib/db/schema';
import { getAvailableFrequenciesByIndicator } from '$lib/server/duckdb';
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
	const areaFilter = url.searchParams.get('area') || '';
	const attentionOnly = url.searchParams.get('attention') === '1';

	const rows = await db
		.select({
			code: indicators.code,
			name: indicators.name,
			description: indicators.description,
			methodology: indicators.methodology,
			frequency: indicators.frequency,
			source: indicators.source,
			unit: indicators.unit,
			area: areas.name,
			areaCode: areas.code,
			group: indicatorGroups.name
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(areas, eq(indicatorGroups.areaId, areas.id));

	const allAreas = [...new Map(rows.map((row) => [row.areaCode, row.area])).entries()].map(
		([code, name]) => ({ code, name })
	);
	const frequenciesByIndicator = await getAvailableFrequenciesByIndicator(
		rows.map((row) => row.code)
	);

	const catalog = rows
		.map((row) => ({
			...row,
			availableFrequencies:
				frequenciesByIndicator.get(row.code) || (row.frequency ? [row.frequency] : []),
			attention: attentionNeeds(row)
		}))
		.sort(
			(a, b) =>
				a.area.localeCompare(b.area) ||
				a.group.localeCompare(b.group) ||
				a.name.localeCompare(b.name)
		);

	const filteredIndicators = catalog.filter((row) => {
		if (areaFilter && row.areaCode !== areaFilter) return false;
		if (attentionOnly && !row.attention.needsAttention) return false;
		if (!search) return true;
		return [row.code, row.name, row.group, row.area]
			.filter(Boolean)
			.some((value) => value.toLowerCase().includes(search));
	});

	return {
		indicators: filteredIndicators,
		catalog,
		areas: allAreas.sort((a, b) => a.name.localeCompare(b.name)),
		filters: { search, area: areaFilter, attentionOnly }
	};
};
