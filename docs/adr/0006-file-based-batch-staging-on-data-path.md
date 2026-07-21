# Use file-based batch staging on the DATA_PATH persistent volume

## Status

Accepted

## Context

Batch analysis and definition review produce accepted mappings that Phase 4 must apply without modifying production observations. Staging needs to survive process restarts, preserve the uploaded source, isolate every `indicator_code + freq` slice, and provide Phase 5 with integrity-checked publish inputs.

Fly.io deploys the application with `DATA_PATH=/data` on the machine-local `indicator_data` volume. The canonical observation store also lives on this volume, while Turso/libSQL stores relational metadata and batch lineage. Phase 1 intentionally avoided storing analyzer profiles and mappings as JSON columns in SQLite because those payloads are immutable artifacts rather than relational sources of truth.

The previous analyze endpoint used a temporary file and deleted it after returning the profile. That made later staging impossible to reproduce from the batch identity.

## Decision

Store durable batch artifacts beneath:

```text
DATA_PATH/ingest/batches/<batchId>/
```

Each batch retains:

- the immutable uploaded source Parquet and its SHA-256 integrity;
- the analyzer profile and intake manifest;
- a versioned accepted-mapping manifest, including collapsed fixed dimensions;
- a versioned staging-input manifest;
- one immutable canonical Parquet artifact per valid `indicator_code + freq` slice; and
- a versioned staged-result manifest containing schemas, checksums, counts, period bounds, reference-area summaries, diagnostics, and statuses.

SQLite/Turso continues to store relational `ingest_batches` and `ingest_batch_slices` lineage and status. It does not become the source of truth for mapping/profile JSON.

Canonical rebuild discovery excludes the entire `DATA_PATH/ingest` namespace so retained uploads and staged slices cannot be accidentally loaded into `observations.duckdb`.

Canonicalization remains memory-backed for this phase. `BATCH_STAGE_MAX_ROWS` guards the pre-projection row count and defaults to `250000`. Operators may raise the limit deliberately when the Fly machine has enough memory.

## Alternatives considered

### DuckDB staging tables

Rejected for Phase 4. They would centralize storage but introduce staging schema lifecycle, cleanup, and transaction coupling before the publish contract is implemented.

### Temporary local files

Rejected because they do not survive restarts and are not durable on Fly.io.

### Profile and mapping JSON in SQLite

Rejected as the primary representation. Large immutable workflow payloads fit versioned artifacts better, while SQLite remains useful for queryable lineage and statuses.

### Object storage

Deferred. A shared bucket may become preferable if the app scales to multiple Fly machines, but the current deployment already operates a persistent single-machine volume.

## Consequences

- Source uploads and staged slices survive application restarts on the mounted Fly volume.
- Phase 5 can publish immutable per-slice inputs and verify their checksums.
- Canonical store rebuilds must continue excluding `DATA_PATH/ingest`.
- Volume capacity, backup, retention, and cleanup must include retained batch artifacts.
- Fly volumes are machine-local; horizontal scaling requires replicated volumes or migration to shared object storage.
- Staging is idempotent for identical source, accepted mappings, and current metadata contracts.
- Exact historical replay is not yet guaranteed because Indicator definitions and dimension codelists are reloaded from the current metadata database rather than snapshotted into the batch artifacts.
- Batches above the configured memory guard fail before canonical projection and need an explicit limit increase or a future streaming canonicalizer.
