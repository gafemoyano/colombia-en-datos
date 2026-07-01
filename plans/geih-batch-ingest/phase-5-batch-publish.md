# Phase 5 — batch publish: replace present slices and fan out lineage

## Goal

Publish staged batch slices into the canonical DuckDB store. Batch publish replaces only the `indicator_code + freq` pairs present in the staged batch, leaves absent slices untouched, and creates per-slice lineage linked to the parent batch.

## Prerequisites

- Phase 1 complete: batch lineage schema exists.
- Phase 4 complete: staged canonical slices exist and are valid.

## Scope

### In scope

- Publish all valid staged slices in one serialized operation.
- In DuckDB, delete existing observations for each present `indicator_code + freq` pair and insert staged rows for that pair.
- Leave every absent Indicator frequency untouched.
- Create one `data_releases` row per published slice and link it to the parent `ingest_batches` row.
- Refresh `indicator_data_sources` per published slice.
- Mark `ingest_batches` and `ingest_batch_slices` statuses.
- Preserve existing public visibility rules.

### Out of scope for this phase

- Partial selected-slice publish unless trivial after all-or-nothing publish works.
- Rollback UI.
- Scheduled jobs or async queue.
- External programmatic ingest API.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/publish.ts` | create | Batch publish orchestration and lineage fan-out. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/publish.test.ts` | create | Tests for per-slice replacement and lineage records. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/ingest.ts` | modify | Reuse or extract existing single-slice publish helpers where safe. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/api/admin/ingest/batches/publish/+server.ts` | create | Thin endpoint for publishing a staged batch. |

## Steps

### 5.1 — Extract shared DuckDB write helpers

Reuse the existing single-slice `DELETE` then `INSERT` idea, but parameterize it by a list of present slices.

> Expand during implementation: preserve serialized writes to avoid concurrent DuckDB write conflicts.

### 5.2 — Implement per-slice replacement

Derive the set of present `indicator_code + freq` pairs from staged rows. For each pair, delete only that pair and insert its staged rows.

> Expand during implementation: wrap DuckDB writes in a transaction; ensure a failure rolls back all slice writes for all-or-nothing publish.

### 5.3 — Fan out lineage

For each published slice, create a `data_releases` row, refresh `indicator_data_sources`, and link the release back to the batch/slice records.

> Expand during implementation: compute `period_start`, `period_end`, `row_count`, `year_min`, and `year_max` from staged canonical rows.

### 5.4 — Preserve visibility rules

Public catalog visibility should remain dependent on published lineage and observations. Definition-only or staged-only slices stay admin-only.

> Expand during implementation: add tests around `GET /api/indicators` or the helper that computes available frequencies.

## Success criteria

- Publishing a batch with multiple indicators writes observations for all present slices.
- Existing observations for a present slice are replaced.
- Existing observations for absent slices remain untouched.
- One batch publish creates one batch parent with many linked release rows.
- Public discovery exposes only published slices with canonical observations.
- Publish failure leaves DuckDB and SQLite lineage in a consistent state.

## Context budget

Single session, possibly split if DuckDB test setup is slow.

## Notes for the implementing session

This is the main behavioral generalization from the current single-indicator API. Do not reintroduce user-supplied `indicatorCode` as the batch authority; the staged rows are authoritative.
