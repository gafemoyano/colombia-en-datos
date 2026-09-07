import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedExplorerCatalog, invalidateExplorerCatalog } from './explorer-catalog-cache';

const catalog = { dataSources: [], themes: [], indicators: [] };

describe('explorer catalog cache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		invalidateExplorerCatalog();
	});
	afterEach(() => vi.useRealTimers());

	it('shares concurrent and repeated loads, then expires external registry changes', async () => {
		const load = vi.fn().mockResolvedValue(catalog);
		const first = cachedExplorerCatalog(load);
		expect(cachedExplorerCatalog(load)).toBe(first);
		await first;
		await cachedExplorerCatalog(load);
		expect(load).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(30_000);
		await cachedExplorerCatalog(load);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('coalesces a slow load even after its cache window expires', async () => {
		let finish!: (value: typeof catalog) => void;
		const load = vi.fn(() => new Promise<typeof catalog>((resolve) => (finish = resolve)));
		const first = cachedExplorerCatalog(load);
		await Promise.resolve();
		vi.advanceTimersByTime(31_000);
		expect(cachedExplorerCatalog(load)).toBe(first);
		expect(load).toHaveBeenCalledTimes(1);
		finish(catalog);
		await first;
		expect(cachedExplorerCatalog(async () => catalog)).not.toBe(first);
	});

	it('invalidates immediately and cannot be repopulated by an older in-flight read', async () => {
		let finish!: (value: typeof catalog) => void;
		const old = cachedExplorerCatalog(() => new Promise((resolve) => (finish = resolve)));
		await Promise.resolve();
		invalidateExplorerCatalog();
		const fresh = { ...catalog, themes: ['New release'] };
		const load = vi.fn().mockResolvedValue(fresh);
		await cachedExplorerCatalog(load);
		finish(catalog);
		await old;
		expect(await cachedExplorerCatalog(load)).toBe(fresh);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('retries failed reads rather than caching an unavailable catalog', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(catalog);
		await expect(cachedExplorerCatalog(load)).rejects.toThrow('offline');
		expect(await cachedExplorerCatalog(load)).toBe(catalog);
		expect(load).toHaveBeenCalledTimes(2);
	});
});
