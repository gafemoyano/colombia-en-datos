// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	createRequestTrace,
	currentRequestId,
	measure,
	serverTiming,
	withRequestTrace
} from './performance';

describe('request performance tracing', () => {
	it('is transparent without an active request', async () => {
		const value = { rows: [1] };
		expect(await measure('query', async () => value)).toBe(value);
		expect(currentRequestId()).toBeNull();
	});

	it('isolates concurrent requests and keeps parallel spans under their parent', async () => {
		const traces = [createRequestTrace(), createRequestTrace()];
		await Promise.all(
			traces.map((trace) =>
				withRequestTrace(trace, () =>
					measure('catalog', async () => {
						await Promise.all(
							[1, 2].map(() =>
								measure('query', async () => {
									await new Promise((resolve) => setTimeout(resolve, 5));
									expect(currentRequestId()).toBe(trace.requestId);
									return { rows: [1, 2] };
								})
							)
						);
					})
				)
			)
		);
		for (const trace of traces) {
			expect(trace.spans).toHaveLength(3);
			expect(trace.spans.slice(1).map((span) => span.parentId)).toEqual([1, 1]);
			expect(trace.spans.slice(1).every((span) => span.rows === 2)).toBe(true);
			expect(trace.spans.every((span) => span.durationMs >= 0 && span.startMs >= 0)).toBe(true);
			expect(serverTiming(trace)).toMatch(
				/^server;dur=[\d.]+, catalog;dur=[\d.]+, query;dur=[\d.]+$/
			);
		}
		expect(traces[0].requestId).not.toBe(traces[1].requestId);
		expect(currentRequestId()).toBeNull();
	});

	it('preserves failures without recording their potentially sensitive contents', async () => {
		const trace = createRequestTrace();
		const failure = new Error('secret query parameter');
		await expect(
			withRequestTrace(trace, () =>
				measure('query', async () => {
					throw failure;
				})
			)
		).rejects.toBe(failure);
		expect(trace.spans[0].status).toBe('error');
		expect(JSON.stringify(trace)).not.toContain(failure.message);
	});

	it('bounds recorded spans without dropping work', async () => {
		const trace = createRequestTrace();
		let calls = 0;
		await withRequestTrace(trace, async () => {
			for (let i = 0; i < 300; i++) await measure('query', async () => ++calls);
		});
		expect(calls).toBe(300);
		expect(trace.spans).toHaveLength(256);
		expect(trace.droppedSpans).toBe(44);
	});
});
