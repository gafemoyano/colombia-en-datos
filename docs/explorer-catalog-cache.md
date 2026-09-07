# Explorer catalog availability

The canonical builder already derives `indicator_meta.freqs` from the exact
observation rows. Availability reads expand this small summary, never scan the
catalog's observations. The published SQLite coverage/release join remains a
separate gate: an indicator/frequency must be both observed and published.
`SELECT DISTINCT` eliminates repeated geographic coverage pairs before transfer.

Explorer caches the assembled catalog for **30 seconds from the start of its
load**, sharing concurrent reads. Failures are evicted, not converted to cached
empty catalogs. Local upload publication invalidates after the observation commit
and again after the registry commit; a superseded load cannot refill the cache.
The upload transaction also maintains the observed frequency summary, including
newly observed indicators. It scans only the affected indicator at publication,
not the catalog or any request-time observation data.

External registry imports, release-status changes, and edits from another process
become visible on the first load after the 30-second window. This is deliberately
bounded staleness, not immediate cross-process consistency. Restart the app to
discard it immediately when operating the registry. Each process has its own cache.
Catalog records are shared read-only by the explorer; request selection/filter
state is still built separately.

The canonical store is opened read-only and retained by the existing runtime.
After `canonical:build` replaces the file, **restart the app** to read the new
store and clear the catalog together. No migration or rebuild is required just
to adopt this optimization on a schema-v2 canonical store. Direct observation
writes must maintain `indicator_meta.freqs` in the same transaction; do not edit
observations behind the summary. The existing upload path attempts writes via
the read-only connection and therefore remains non-operational in that runtime;
this change does not redesign ingestion or DuckDB connection ownership.

Existing performance spans are retained. A cache hit still emits `catalog`, but
no nested catalog database/frequency spans. A miss reads the catalog, distinct
published pairs, and `indicator_meta`; `observed_frequencies` retains its name
for comparison with the scan-based baseline.
