import { json } from '@sveltejs/kit';
import { getAvailableIndicators } from '$lib/server/duckdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const indicators = await getAvailableIndicators();
	return json({ indicators });
};
