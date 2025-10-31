import { json } from '@sveltejs/kit';
import { getDimensionsForIndicator } from '$lib/server/duckdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const indicator = params.indicator;
	const freq = url.searchParams.get('freq') || 'M';
	const refArea = url.searchParams.get('ref_area') || 'CO';

	const dims = await getDimensionsForIndicator(indicator, freq, refArea);

	return json({
		indicator,
		freq,
		dims
	});
};
