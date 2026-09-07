// @vitest-environment node
import { expect, it } from 'vitest';
import { createNavigationId, performanceMark, performanceMeasure } from './explorer-performance';

it('correlates measures, whitelists details and tolerates evicted marks', () => {
	const context = {
		navigationId: createNavigationId(),
		requestId: 'test-request',
		secret: 'do not record'
	};
	const start = performanceMark(context, 'explorer', 'navigation-start');
	const end = performanceMark(context, 'explorer', 'data-ready');
	const name = performanceMeasure(context, 'explorer', 'navigation-to-data-ready', start, end);
	const entry = performance.getEntriesByName(name)[0] as PerformanceMeasure;
	expect(entry.detail.requestId).toBe('test-request');
	expect(entry.detail).not.toHaveProperty('secret');
	for (let i = 0; i < 130; i++) performanceMark(context, 'plotly', 'render-start');
	const latest = performanceMark(context, 'plotly', 'render-complete');
	expect(performanceMeasure(context, 'plotly', 'render', start, latest)).toBe('');
	expect(
		performance.getEntries().filter((entry) => entry.name.startsWith('explorer:')).length
	).toBeLessThanOrEqual(120);
});
