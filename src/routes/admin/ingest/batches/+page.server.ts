import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import { dataSources } from '$lib/db/schema';
import {
	adminBatchWorkflowError,
	analyzeAdminBatch,
	acceptAdminMappingAndStage,
	loadAdminBatchWorkflow,
	publishAdminBatch,
	saveAdminBatchDefinitions,
	type AdminDefinitionDraftEdit
} from '$lib/server/batch-ingest/admin-workflow';
import type { AcceptedBatchColumnMapping } from '$lib/server/batch-ingest/storage';
import type { Actions, PageServerLoad } from './$types';

const BATCH_ROUTE = '/admin/ingest/batches';

function text(formData: FormData, name: string): string {
	return String(formData.get(name) || '').trim();
}

function positiveBatchId(value: string): number | null {
	if (!/^\d+$/.test(value)) return null;
	const batchId = Number(value);
	return Number.isSafeInteger(batchId) && batchId > 0 ? batchId : null;
}

function batchRedirect(batchId: number, result?: string): string {
	const params = new URLSearchParams({ batchId: String(batchId) });
	if (result) params.set('result', result);
	return `${BATCH_ROUTE}?${params}`;
}

function parseJsonArray(value: string, label: string): unknown[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label} must be valid JSON.`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
	return parsed;
}

function parseDraftEdits(value: string): AdminDefinitionDraftEdit[] {
	return parseJsonArray(value, 'Definition edits').map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new Error('Each definition edit must be an object.');
		}
		const edit = item as Record<string, unknown>;
		if (typeof edit.id !== 'string' || !edit.values || typeof edit.values !== 'object') {
			throw new Error('Each definition edit requires an id and values object.');
		}
		return { id: edit.id, values: edit.values as AdminDefinitionDraftEdit['values'] };
	});
}

function parseMappings(value: string): AcceptedBatchColumnMapping[] {
	return parseJsonArray(value, 'Mappings').map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new Error('Each mapping must be an object.');
		}
		const mapping = item as Record<string, unknown>;
		if (
			typeof mapping.sourceColumn !== 'string' ||
			!(typeof mapping.canonicalField === 'string' || mapping.canonicalField === null) ||
			!Array.isArray(mapping.transforms) ||
			!mapping.transforms.every((transform) => typeof transform === 'string')
		) {
			throw new Error('Each mapping requires sourceColumn, canonicalField, and transforms.');
		}
		return mapping as unknown as AcceptedBatchColumnMapping;
	});
}

function invalidAction(message: string, action: string, batchId: number | null = null) {
	return fail(400, {
		action,
		batchId,
		error: {
			code: 'invalid-input',
			message,
			action,
			retryable: false,
			batchId
		}
	});
}

export const load: PageServerLoad = async ({ url }) => {
	const db = getDb();
	const sourceOptions = await db
		.select({
			code: dataSources.code,
			name: dataSources.name,
			description: dataSources.description
		})
		.from(dataSources)
		.orderBy(asc(dataSources.name));
	const rawBatchId = url.searchParams.get('batchId');
	if (!rawBatchId) {
		return { batch: null, loadError: null, dataSources: sourceOptions, result: null };
	}
	const batchId = positiveBatchId(rawBatchId);
	if (!batchId) {
		return {
			batch: null,
			loadError: {
				code: 'invalid-input',
				message: 'batchId must be a positive integer.',
				action: 'load',
				retryable: false,
				batchId: null
			},
			dataSources: sourceOptions,
			result: null
		};
	}
	try {
		return {
			batch: await loadAdminBatchWorkflow(batchId, { db }),
			loadError: null,
			dataSources: sourceOptions,
			result: url.searchParams.get('result')
		};
	} catch (error) {
		return {
			batch: null,
			loadError: adminBatchWorkflowError(error),
			dataSources: sourceOptions,
			result: null
		};
	}
};

export const actions: Actions = {
	analyze: async ({ request }) => {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return invalidAction('A non-empty Parquet file is required.', 'analyze');
		}
		try {
			const result = await analyzeAdminBatch({
				source: Buffer.from(await file.arrayBuffer()),
				originalName: file.name || 'batch.parquet',
				dataSource: {
					code: text(formData, 'data_source_code'),
					name: text(formData, 'data_source_name'),
					description: text(formData, 'data_source_description') || null
				}
			});
			throw redirect(303, batchRedirect(result.batchId, 'analyzed'));
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(400, {
				action: 'analyze',
				error: adminBatchWorkflowError(error),
				dataSource: {
					code: text(formData, 'data_source_code'),
					name: text(formData, 'data_source_name'),
					description: text(formData, 'data_source_description')
				}
			});
		}
	},

	saveDefinitions: async ({ request }) => {
		const formData = await request.formData();
		const batchId = positiveBatchId(text(formData, 'batch_id'));
		if (!batchId) return invalidAction('A valid batch_id is required.', 'save-definitions');
		try {
			const result = await saveAdminBatchDefinitions({
				batchId,
				edits: parseDraftEdits(String(formData.get('definition_edits') || '[]'))
			});
			if (!result.ok) {
				return fail(400, {
					action: 'save-definitions',
					batchId,
					validation: result.validation,
					error: {
						code: 'invalid-input',
						message: 'Correct the definition validation errors and try again.',
						action: 'save-definitions',
						retryable: false,
						batchId
					}
				});
			}
			throw redirect(303, batchRedirect(batchId, 'definitions-saved'));
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(400, {
				action: 'save-definitions',
				batchId,
				error: adminBatchWorkflowError(error)
			});
		}
	},

	stage: async ({ request }) => {
		const formData = await request.formData();
		const batchId = positiveBatchId(text(formData, 'batch_id'));
		if (!batchId) return invalidAction('A valid batch_id is required.', 'accept-and-stage');
		try {
			await acceptAdminMappingAndStage({
				batchId,
				mappings: parseMappings(String(formData.get('mappings') || '[]'))
			});
			throw redirect(303, batchRedirect(batchId, 'staged'));
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(400, {
				action: 'accept-and-stage',
				batchId,
				error: adminBatchWorkflowError(error)
			});
		}
	},

	publish: async ({ request }) => {
		const formData = await request.formData();
		const batchId = positiveBatchId(text(formData, 'batch_id'));
		if (!batchId) return invalidAction('A valid batch_id is required.', 'publish');
		try {
			await publishAdminBatch({
				batchId,
				confirmed: formData.get('confirm_replacement') === 'yes'
			});
			throw redirect(303, batchRedirect(batchId, 'published'));
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(400, { action: 'publish', batchId, error: adminBatchWorkflowError(error) });
		}
	}
};
