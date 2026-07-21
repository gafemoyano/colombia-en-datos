import { json } from '@sveltejs/kit';
import { publishBatch } from '$lib/server/batch-ingest/publish';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Request body must be a JSON object' }, { status: 400 });
	}

	const payload = body as Record<string, unknown>;
	if ('sliceIds' in payload) {
		return json({ error: 'Partial slice selection is not supported' }, { status: 400 });
	}
	if (
		typeof payload.batchId !== 'number' ||
		!Number.isSafeInteger(payload.batchId) ||
		payload.batchId < 1
	) {
		return json({ error: 'batchId must be a positive integer' }, { status: 400 });
	}

	try {
		return json(await publishBatch({ batchId: payload.batchId }));
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to publish ingest batch';
		if (message.includes('does not exist')) {
			return json({ error: message }, { status: 404 });
		}
		throw error;
	}
};
