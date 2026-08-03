import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client';
import { dataSources, indicatorGroups, indicators } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

function optionalString(value: FormDataEntryValue | null): string | null {
	const text = String(value || '').trim();
	return text.length > 0 ? text : null;
}

function optionalInteger(value: FormDataEntryValue | null): number | null {
	const text = String(value || '').trim();
	if (!text) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

export const load: PageServerLoad = async ({ params, url }) => {
	const db = getDb();
	const code = decodeURIComponent(params.code);

	const rows = await db
		.select({
			id: indicators.id,
			code: indicators.code,
			name: indicators.name,
			shortName: indicators.shortName,
			description: indicators.description,
			methodology: indicators.methodology,
			frequency: indicators.frequency,
			sourceCitation: indicators.sourceCitation,
			unit: indicators.unit,
			unitMult: indicators.unitMult,
			decimals: indicators.decimals,
			defaultViz: indicators.defaultViz,
			updated: indicators.updated,
			dataSource: dataSources.name,
			group: indicatorGroups.name,
			groupCode: indicatorGroups.code,
			filterWhitelist: indicatorGroups.filterWhitelist
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id))
		.where(eq(indicators.code, code))
		.limit(1);

	if (rows.length === 0) {
		throw redirect(303, '/admin');
	}

	return {
		indicator: rows[0],
		saved: url.searchParams.get('saved') === '1'
	};
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const db = getDb();
		const code = decodeURIComponent(params.code);
		const formData = await request.formData();
		const name = optionalString(formData.get('name'));

		if (!name) {
			return fail(400, { error: 'El nombre es obligatorio' });
		}

		await db
			.update(indicators)
			.set({
				name,
				shortName: optionalString(formData.get('shortName')),
				description: optionalString(formData.get('description')),
				methodology: optionalString(formData.get('methodology')),
				sourceCitation: optionalString(formData.get('sourceCitation')),
				unit: optionalString(formData.get('unit')),
				unitMult: optionalInteger(formData.get('unitMult')),
				decimals: optionalInteger(formData.get('decimals')),
				defaultViz: optionalString(formData.get('defaultViz')),
				updated: optionalString(formData.get('updated')),
				updatedAt: sql`(CURRENT_TIMESTAMP)`
			})
			.where(eq(indicators.code, code));

		throw redirect(303, `/admin/indicators/${encodeURIComponent(code)}?saved=1`);
	}
};
