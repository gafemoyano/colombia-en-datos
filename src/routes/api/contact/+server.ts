import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		await request.json();
	} catch (error) {
		console.error('Failed to parse contact request payload', error);
		return json({ ok: false }, { status: 400 });
	}

	return json({ ok: true });
};
