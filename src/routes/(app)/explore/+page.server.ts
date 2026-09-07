import { redirect } from '@sveltejs/kit';
import { getExplorerPageModel } from '$lib/server/explorer';
import { currentRequestId, measure } from '$lib/server/performance';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const model = await measure('explorer_model', () => getExplorerPageModel(url));
	const currentSearch = url.searchParams.toString();

	if (currentSearch && model.canonicalSearch !== currentSearch) {
		throw redirect(303, model.canonicalSearch ? `/explore?${model.canonicalSearch}` : '/explore');
	}

	return { ...model, performanceRequestId: currentRequestId() };
};
