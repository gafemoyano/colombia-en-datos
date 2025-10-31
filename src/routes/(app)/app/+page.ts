import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/indicators');
	const { indicators } = await response.json();
	return {
		indicators
	};
};
