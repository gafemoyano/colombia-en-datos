import { json } from '@sveltejs/kit';
import { BatchIntakeInputError, intakeBatch } from '$lib/server/batch-ingest/intake';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const dataSourceCode = String(formData.get('dataSourceCode') || '').trim() || null;

	if (!(file instanceof File)) {
		return json({ error: 'file is required' }, { status: 400 });
	}

	try {
		const result = await intakeBatch({
			source: Buffer.from(await file.arrayBuffer()),
			originalName: file.name || 'batch.parquet',
			dataSourceCode
		});
		return json(result);
	} catch (error) {
		if (error instanceof BatchIntakeInputError) {
			return json({ error: error.message }, { status: 400 });
		}
		throw error;
	}
};
