# Phase 4 — canonical stage: convert batch rows into validated canonical slices

## Goal

Canonicalize accepted batch rows into the Observation schema and stage one validated row set per `indicator_code + freq` slice. This phase stops before publish, so admins can inspect errors without mutating production observations.

## Prerequisites

- Phase 1 complete: batch/slice manifest shape exists.
- Phase 2 complete: analyzer and accepted mappings exist.
- Phase 3 complete: required Indicator frequency definitions are saved.

## Scope

### In scope

- Apply accepted source-to-canonical mappings to the uploaded Parquet.
- Convert GEIH-style monthly periods (`M-YYYY`) to canonical `YYYY-MM`.
- Lowercase canonical column names at the staging boundary.
- Validate each slice against its `indicator_frequencies` and `indicator_dimensions` contracts.
- Validate codelists, required dimensions, duplicate keys, and numeric `obs_value` per slice.
- Persist staged artifacts and update `ingest_batch_slices` statuses.

### Out of scope for this phase

- Deleting/inserting production DuckDB observations.
- Creating `data_releases` or `indicator_data_sources` rows.
- Admin UI polish.
- Reusable mapping templates.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/canonicalize.ts` | create | Convert source/canonical batches into canonical staged rows. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/stage.ts` | create | Persist staged slices and validation summaries. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/canonicalize.test.ts` | create | Tests for mapping, period conversion, dimensions, and per-slice validation. |
| `/home/gafe/Projects/colombia-en-datos/data/ingest/batches/` | create at runtime | Storage for uploaded/staged batch artifacts if file-based staging is chosen. |

## Steps

### 4.1 — Implement canonical row projection

Project source columns into canonical columns according to accepted mappings. Canonical files can use identity mappings.

> Expand during implementation: ensure `UNIT`, `UNIT_MULT`, `DECIMALS`, and `YEAR` are not inserted as observation columns.

### 4.2 — Normalize periods

Convert supported source period formats into canonical storage values. Monthly `1-2010` becomes `2010-01`.

> Expand during implementation: invalid months or mixed unsupported formats should fail staging with clear diagnostics.

### 4.3 — Validate per-slice contracts

For every derived `indicator_code + freq`, load the saved definition and validate required dimension columns and codelist values.

> Expand during implementation: decide how to represent dimensionless slices when the source file contains fixed-total columns collapsed by phase 3.

### 4.4 — Persist staged slices

Write staged canonical rows and slice validation summaries without touching production `observations`.

> Expand during implementation: choose file-based staged Parquet vs DuckDB staging table; keep the interface stable for phase 5.

## Success criteria

- A GEIH-like batch stages all derived slices without requiring manual file splitting.
- Staged rows use canonical lowercase Observation columns and canonical time periods.
- Each slice is validated independently.
- Indicators/frequencies not present in the batch are not staged or marked for deletion.
- Stage results are reproducible from the persisted batch manifest and uploaded file.

## Context budget

Single session.

## Notes for the implementing session

The core semantic shift is here: the file decides which slices exist. The user no longer asserts `indicatorCode`; validation checks what the file says.
