import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflow = vi.hoisted(() => ({
	analyze: vi.fn(),
	saveDefinitions: vi.fn(),
	stage: vi.fn(),
	publish: vi.fn(),
	load: vi.fn()
}));
const database = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('$lib/db/client', () => ({ getDb: () => database }));

vi.mock('$lib/server/batch-ingest/admin-workflow', () => ({
	analyzeAdminBatch: workflow.analyze,
	saveAdminBatchDefinitions: workflow.saveDefinitions,
	acceptAdminMappingAndStage: workflow.stage,
	publishAdminBatch: workflow.publish,
	loadAdminBatchWorkflow: workflow.load,
	adminBatchWorkflowError: (error: unknown) => ({
		code: 'operation-failed',
		message: error instanceof Error ? error.message : String(error),
		action: 'load',
		retryable: false,
		batchId: null
	})
}));

import { actions, load } from './+page.server';

function actionRequest(formData: FormData): Request {
	return { formData: async () => formData } as Request;
}

beforeEach(() => {
	vi.clearAllMocks();
	database.select.mockReturnValue({
		from: () => ({
			orderBy: async () => [{ code: 'geih', name: 'GEIH', description: 'Monthly labor survey' }]
		})
	});
});

describe('admin batch page loader', () => {
	it('reconstructs the durable batch selected by the batchId query parameter', async () => {
		const batch = { manifest: { batch: { id: 17, status: 'staged' } } };
		workflow.load.mockResolvedValueOnce(batch);

		const result = await load({
			url: new URL('http://localhost/admin/ingest/batches?batchId=17&result=staged')
		} as never);

		expect(workflow.load).toHaveBeenCalledWith(17, { db: database });
		expect(result).toEqual({
			batch,
			loadError: null,
			dataSources: [{ code: 'geih', name: 'GEIH', description: 'Monthly labor survey' }],
			result: 'staged'
		});
	});
});

describe('admin batch page actions', () => {
	it('analyzes an upload with batch-level Data source metadata and redirects with batchId', async () => {
		workflow.analyze.mockResolvedValueOnce({ batchId: 42 });
		const formData = new FormData();
		const file = new File(['parquet'], 'geih.parquet');
		Object.defineProperty(file, 'arrayBuffer', {
			value: async () => new TextEncoder().encode('parquet').buffer
		});
		formData.set('file', file);
		formData.set('data_source_code', 'GEIH');
		formData.set('data_source_name', 'GEIH');
		formData.set('data_source_description', 'Labor survey');

		await expect(
			actions.analyze!({ request: actionRequest(formData) } as never)
		).rejects.toMatchObject({
			status: 303,
			location: '/admin/ingest/batches?batchId=42&result=analyzed'
		});
		expect(workflow.analyze).toHaveBeenCalledWith(
			expect.objectContaining({
				originalName: 'geih.parquet',
				dataSource: { code: 'GEIH', name: 'GEIH', description: 'Labor survey' }
			})
		);
	});

	it('returns definition validation details without losing the batch context', async () => {
		const validation = {
			valid: false,
			errors: [{ rowNumber: 1, field: 'name', message: 'Name is required.' }]
		};
		workflow.saveDefinitions.mockResolvedValueOnce({ ok: false, validation });
		const formData = new FormData();
		formData.set('batch_id', '9');
		formData.set('definition_edits', JSON.stringify([{ id: 'TD/M', values: { name: '' } }]));

		const result = await actions.saveDefinitions!({ request: actionRequest(formData) } as never);

		expect(workflow.saveDefinitions).toHaveBeenCalledWith({
			batchId: 9,
			edits: [{ id: 'TD/M', values: { name: '' } }]
		});
		expect(result).toMatchObject({
			status: 400,
			data: {
				action: 'save-definitions',
				batchId: 9,
				validation,
				error: { code: 'invalid-input', retryable: false, batchId: 9 }
			}
		});
	});

	it('passes reviewed mappings to staging and preserves batch context in the redirect', async () => {
		workflow.stage.mockResolvedValueOnce({ batchId: 9, status: 'staged' });
		const mappings = [
			{ sourceColumn: 'INDICADOR', canonicalField: 'indicator_code', transforms: ['trim'] }
		];
		const formData = new FormData();
		formData.set('batch_id', '9');
		formData.set('mappings', JSON.stringify(mappings));

		await expect(
			actions.stage!({ request: actionRequest(formData) } as never)
		).rejects.toMatchObject({
			status: 303,
			location: '/admin/ingest/batches?batchId=9&result=staged'
		});
		expect(workflow.stage).toHaveBeenCalledWith({ batchId: 9, mappings });
	});

	it('requires explicit replacement confirmation before the publish service can proceed', async () => {
		workflow.publish.mockRejectedValueOnce(new Error('confirmation required'));
		const formData = new FormData();
		formData.set('batch_id', '9');

		const result = await actions.publish!({ request: actionRequest(formData) } as never);

		expect(workflow.publish).toHaveBeenCalledWith({ batchId: 9, confirmed: false });
		expect(result).toMatchObject({ status: 400, data: { action: 'publish', batchId: 9 } });
	});

	it('publishes all staged slices after confirmation and redirects to durable batch state', async () => {
		workflow.publish.mockResolvedValueOnce({ batchId: 9, status: 'published' });
		const formData = new FormData();
		formData.set('batch_id', '9');
		formData.set('confirm_replacement', 'yes');

		await expect(
			actions.publish!({ request: actionRequest(formData) } as never)
		).rejects.toMatchObject({
			status: 303,
			location: '/admin/ingest/batches?batchId=9&result=published'
		});
		expect(workflow.publish).toHaveBeenCalledWith({ batchId: 9, confirmed: true });
	});
});
