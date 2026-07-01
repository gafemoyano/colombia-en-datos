# Phase 2 — batch analyzer: profile multi-indicator Parquet without writing data

## Goal

Build a read-only analyzer for Parquet batches. It should derive the set of `indicator_code + freq` slices from file contents, detect canonical vs source-shaped columns, profile measurement and dimension candidates, and enforce the uniform-dimensionality invariant before any database writes.

## Prerequisites

- Phase 1 complete for batch manifest types, or a temporary in-memory result type agreed for analyzer output.
- Access to representative GEIH-like sample structure.

## Scope

### In scope

- Read Parquet metadata and preview rows through DuckDB.
- Support canonical column names and GEIH source names (`INDICADOR`, `FREQ`, `REF_AREA`, `TIME_PERIOD`, `OBS_VALUE`, `ADJUSTEMENT`).
- Derive all distinct `indicator_code + freq` slices from the file.
- Report counts, period coverage, measurement variation, candidate dimension values, duplicate keys, and warnings.
- Validate that one flat file's mapped dimension column set is compatible with every slice's current/proposed dimension contract.
- Return proposed source-to-canonical mappings, but do not persist definitions or observations.

### Out of scope for this phase

- Saving definitions.
- Writing staged canonical rows.
- Publishing to DuckDB.
- Admin UI.
- Reusable mapping templates.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/analyzer.ts` | create | Read-only Parquet profile and slice derivation module. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/analyzer.test.ts` | create | Tests for GEIH-like mapping, slice derivation, time profile, and uniform dimensionality. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/types.ts` | create | Shared analyzer/profile/mapping/slice types. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/api/admin/ingest/batches/analyze/+server.ts` | create | Optional thin endpoint if useful for manual testing. |

## Steps

### 2.1 — Define analyzer output contract

Create a stable `BatchProfile` shape with columns, detected mappings, derived slices, measurement summaries, dimension summaries, errors, and warnings.

> Expand during implementation: include enough detail for phase 3 to generate definition drafts without re-reading the entire file.

### 2.2 — Detect canonical and GEIH source column mappings

Map canonical files directly. For GEIH-like files, propose mappings such as `INDICADOR -> indicator_code`, `ADJUSTEMENT -> adjustment`, and `TIME_PERIOD M-YYYY -> YYYY-MM`.

> Expand during implementation: keep mapping detection conservative; unsupported columns should produce warnings rather than silent guesses.

### 2.3 — Derive slices from file contents

Use distinct mapped `indicator_code + freq` pairs from the file. Do not ask the user for one indicator code.

> Expand during implementation: profile row counts and period bounds per slice.

### 2.4 — Check uniform dimensionality

A flat Parquet file has one column set. Validate the mapped dimension column set against every slice's existing or proposed dimension contract.

> Expand during implementation: decide how the analyzer represents fixed-total columns that may be collapsed into dimensionless definitions later.

### 2.5 — Add duplicate-key and time-format diagnostics

Report duplicate observation keys per slice and non-canonical period formats before staging.

> Expand during implementation: monthly GEIH `1-2010` should be recognized as convertible, while invalid months should fail.

## Success criteria

- Analyzer can profile a GEIH-like multi-indicator file and report 11 derived slices in tests/fixtures.
- Analyzer output identifies source mappings and source warnings without writing SQLite or DuckDB data.
- No user-supplied `indicatorCode` is required for batch analysis.
- Uniform dimensionality conflicts are explicit errors.
- Duplicate observation keys are detected per slice.

## Context budget

Single session.

## Notes for the implementing session

Avoid making the large real GEIH file a required test fixture. Prefer a tiny generated Parquet fixture with 2–3 indicators and the same column patterns.
