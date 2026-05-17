import { json } from '@sveltejs/kit';
import { publishUpload } from '$lib/server/ingest';
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
	const uploadId = typeof payload.uploadId === 'string' ? payload.uploadId.trim() : '';
	if (!uploadId) {
		return json({ error: 'uploadId is required' }, { status: 400 });
	}

	try {
		const result = await publishUpload(uploadId);
		return json(result);
	} catch (error) {
		const details = (error as Error & { details?: string[] }).details;
		const message = error instanceof Error ? error.message : 'Failed to publish upload';
		const status = message.includes('not found') ? 404 : message.includes('valid') ? 400 : 500;

		console.error('[POST /api/admin/ingest/publish] Failed:', error);
		return json({ error: message, details }, { status });
	}
};
