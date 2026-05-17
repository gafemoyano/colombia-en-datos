import { json } from '@sveltejs/kit';
import { uploadIndicatorData } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const indicatorCode = String(formData.get('indicatorCode') || '').trim();
	const freq = String(formData.get('freq') || '')
		.trim()
		.toUpperCase();

	if (!(file instanceof File)) {
		return json({ valid: false, errors: ['file is required'] }, { status: 400 });
	}

	if (!indicatorCode) {
		return json({ valid: false, errors: ['indicatorCode is required'] }, { status: 400 });
	}

	if (!/^[A-Z]$/.test(freq)) {
		return json(
			{ valid: false, errors: ['freq is required and must be a single letter like A or M'] },
			{ status: 400 }
		);
	}

	const result = await uploadIndicatorData({ file, indicatorCode, freq });
	return json(result, { status: result.valid ? 200 : 400 });
};
