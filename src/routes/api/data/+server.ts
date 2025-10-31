import { json } from '@sveltejs/kit';
import { queryTimeSeries } from '$lib/server/duckdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const indicatorsParam = url.searchParams.getAll('indicator');
	const refArea = url.searchParams.get('ref_area') || 'CO';
	const freq = url.searchParams.get('freq') || 'M';
	const startDate = url.searchParams.get('start') || undefined;
	const endDate = url.searchParams.get('end') || undefined;
	const by = url.searchParams.get('by') || undefined;
	const urbanRural = url.searchParams.get('urban_rural') || undefined;
	const sex = url.searchParams.get('sex') || undefined;
	const age = url.searchParams.get('age') || undefined;
	const adjustment = url.searchParams.get('adjustment') || undefined;
	const geoLevel = url.searchParams.get('geo_level') || undefined;
	const deptCode = url.searchParams.get('dept_code') || undefined;
	const muniCode = url.searchParams.get('muni_code') || undefined;

	if (indicatorsParam.length === 0) {
		return json({ error: 'No indicators specified' }, { status: 400 });
	}

	const data = await queryTimeSeries({
		indicators: indicatorsParam,
		refArea,
		freq,
		startDate,
		endDate,
		by,
		urbanRural,
		sex,
		age,
		adjustment,
		geoLevel,
		deptCode,
		muniCode
	});

	return json({
		data,
		meta: {
			count: data.length,
			indicators: indicatorsParam,
			ref_area: refArea,
			freq,
			by
		}
	});
};
