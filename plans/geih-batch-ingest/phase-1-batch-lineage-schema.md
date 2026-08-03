# Phase 1 — batch lineage schema: represent one upload that fans out to many releases

## Goal

Add explicit batch lineage scaffolding so one uploaded Parquet file can produce many per-indicator/frequency release rows. This resolves the mental-model shift from "upload equals one release" to "upload equals one batch, publishing N slices."

## Prerequisites

Phase 0 should be complete or at least the `main` schema should remain stable.

## Scope

### In scope

- Add SQLite schema for `ingest_batches` and `ingest_batch_slices`.
- Link `data_releases` back to an ingest batch parent.
- Keep `data_releases` per Indicator because public visibility and `indicator_data_sources` are per Indicator frequency.
- Add minimal types/helpers for creating and reading batch manifests.
- Add migration tests or DB-backed unit tests where feasible.

### Out of scope for this phase

- Reading Parquet files.
- Canonicalizing observations.
- Publishing to DuckDB.
- Admin UI.
- Reusable source mapping templates.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/db/schema/indicators.ts` | modify | Add `ingestBatches`, `ingestBatchSlices`, and optional `dataReleases.ingestBatchId`. |
| `/home/gafe/Projects/colombia-en-datos/drizzle/_TBD_.sql` | create | Drizzle migration for batch lineage tables and release FK. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/manifest.ts` | create | Typed helpers for batch status, slice status, and persisted profile/mapping JSON. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/manifest.test.ts` | create | Tests for helper behavior and JSON shape stability. |

## Steps

### 1.1 — Design exact table columns

Use `docs/target-data-architecture.md` §3.2 as the starting point: `ingest_batches` is the uploaded file parent; `ingest_batch_slices` is one `indicator_code + freq` child.

> Expand during implementation: choose exact Drizzle names and JSON typing for `profile_json` and `mappings_json`.

### 1.2 — Create migration

Generate or hand-write the SQLite migration. Keep it additive if possible: existing single-slice uploads should continue to work.

> Expand during implementation: confirm migration ordering relative to existing Drizzle files on `main`.

### 1.3 — Add manifest helpers

Provide small server helpers/types for batch IDs, statuses, slice summaries, and profile/mapping persistence.

> Expand during implementation: decide whether file-based staging manifests remain in `data/ingest/batches/` or whether SQLite JSON is the only manifest source for this phase.

### 1.4 — Verify backward compatibility

Existing `POST /api/admin/ingest/upload` and publish code should not be forced to use batches yet.

> Expand during implementation: run existing tests and add a smoke test if the upload module has test seams.

## Success criteria

- Schema exports compile and migrations apply cleanly to a fresh SQLite database.
- Existing single-slice ingest code still compiles.
- A batch parent can be represented independently of releases.
- A batch slice can later link to a per-indicator `data_releases` row.
- Documentation names (`ingest_batches`, `ingest_batch_slices`) and code names are consistent.

## Context budget

Single session.

## Notes for the implementing session

This phase deliberately does not publish data. It only creates the lineage shape needed for multi-indicator files.
