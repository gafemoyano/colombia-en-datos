import { json } from '@sveltejs/kit';
import { getIndicatorMetadata } from '$lib/server/duckdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const indicator = params.indicator;
	const freq = url.searchParams.get('freq') || 'M';
	const refArea = url.searchParams.get('ref_area') || 'CO';

	const metadata = await getIndicatorMetadata(indicator, freq, refArea);

	if (!metadata) {
		return json({ error: 'Indicator not found' }, { status: 404 });
	}

	return json(metadata);
};
