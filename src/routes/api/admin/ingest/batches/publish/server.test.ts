import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishBatchMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/batch-ingest/publish', () => ({ publishBatch: publishBatchMock }));

import { POST } from './+server';

function post(body: unknown) {
	return POST({
		request: new Request('http://localhost/api/admin/ingest/batches/publish', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0]);
}

describe('POST /api/admin/ingest/batches/publish', () => {
	beforeEach(() => publishBatchMock.mockReset());

	it('publishes the complete staged batch by batch id', async () => {
		publishBatchMock.mockResolvedValueOnce({
			batchId: 42,
			status: 'published',
			publishedAt: '2026-07-19T12:00:00.000Z',
			slices: []
		});

		const response = await post({ batchId: 42 });

		expect(response.status).toBe(200);
		expect(publishBatchMock).toHaveBeenCalledWith({ batchId: 42 });
		expect(await response.json()).toMatchObject({ batchId: 42, status: 'published' });
	});

	it('rejects partial slice selection before starting publish', async () => {
		const response = await post({ batchId: 42, sliceIds: [1] });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Partial slice selection is not supported' });
		expect(publishBatchMock).not.toHaveBeenCalled();
	});
});
