import type { ExplorerCatalogIndicator } from './explorer';

interface Catalog {
	dataSources: Array<{ code: string; name: string }>;
	themes: string[];
	indicators: ExplorerCatalogIndicator[];
}

// Bound external registry/publication staleness; local publication invalidates immediately.
const MAX_AGE_MS = 30_000;
let entry: { promise: Promise<Catalog>; expiresAt: number; pending: boolean } | undefined;

export function invalidateExplorerCatalog(): void {
	entry = undefined;
}

export function cachedExplorerCatalog(load: () => Promise<Catalog>): Promise<Catalog> {
	if (entry && (entry.pending || Date.now() < entry.expiresAt)) return entry.promise;
	const next = {
		promise: Promise.resolve().then(load),
		expiresAt: Date.now() + MAX_AGE_MS,
		pending: true
	};
	entry = next;
	void next.promise.then(
		() => {
			next.pending = false;
		},
		() => {
			if (entry === next) entry = undefined;
		}
	);
	return next.promise;
}
