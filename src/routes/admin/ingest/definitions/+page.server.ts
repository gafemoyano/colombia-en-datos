import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client';
import { dataSources } from '$lib/db/schema';
import {
	listAdminDefinitionFrequencies,
	normalizeDataSourceCode,
	saveIndicatorDefinitionRows
} from '$lib/server/definition-ingest';
import type { Actions, PageServerLoad } from './$types';

function stringValue(value: FormDataEntryValue | null): string {
	return String(value || '').trim();
}

export const load: PageServerLoad = async ({ url }) => {
	const db = getDb();
	const selectedDataSourceCode = normalizeDataSourceCode(url.searchParams.get('data_source') || '');
	const allDataSources = await db
		.select({ code: dataSources.code, name: dataSources.name })
		.from(dataSources);
	const selectedDataSource = selectedDataSourceCode
		? allDataSources.find((dataSource) => dataSource.code === selectedDataSourceCode) || null
		: null;

	return {
		dataSources: allDataSources.sort((a, b) => a.name.localeCompare(b.name)),
		selectedDataSourceCode,
		selectedDataSource,
		definitions: selectedDataSourceCode
			? await listAdminDefinitionFrequencies(selectedDataSourceCode, { db })
			: [],
		saved: url.searchParams.get('saved') === '1',
		createdFrequencies: Number.parseInt(url.searchParams.get('frequencies') || '0', 10) || 0
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const dataSourceCodeInput = stringValue(formData.get('data_source_code'));
		const dataSourceName = stringValue(formData.get('data_source_name'));
		const definitionText = String(formData.get('definitions') || '');

		const result = await saveIndicatorDefinitionRows({
			dataSource: {
				code: dataSourceCodeInput,
				name: dataSourceName
			},
			definitionText
		});

		if (!result.ok) {
			return fail(400, {
				errors: result.errors,
				values: {
					dataSourceCode: dataSourceCodeInput,
					dataSourceName,
					definitions: definitionText
				},
				normalizedDataSourceCode: result.dataSourceCode
			});
		}

		throw redirect(
			303,
			`/admin/ingest/definitions?data_source=${encodeURIComponent(result.dataSourceCode)}&saved=1&frequencies=${result.summary.createdFrequencies}`
		);
	}
};
