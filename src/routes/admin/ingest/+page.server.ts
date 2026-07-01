import { fail, redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import { dataSources } from '$lib/db/schema';
import { normalizeDataSourceCode } from '$lib/ingest/definitions';
import { listAdminDefinitionFrequencies } from '$lib/server/admin-definition-catalog';
import { saveDefinitionGrid } from '$lib/server/definition-ingest';
import type { Actions, PageServerLoad } from './$types';

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
		.select({ code: dataSources.code, name: dataSources.name })
		.from(dataSources)
		.orderBy(asc(dataSources.name));

	const selectedDataSource = selectedInput.code
		? dataSourceOptions.find((dataSource) => dataSource.code === selectedInput.code) || null
		: null;

	const definitions = selectedInput.code
		? await listAdminDefinitionFrequencies(selectedInput.code, db)
		: [];

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
