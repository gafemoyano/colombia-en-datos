# Plan: geih-batch-ingest

This plan resets admin ingest work around the actual GEIH batch Parquet delivery. The previous definition-save branch produced useful business rules, but it was built on stale schema names and assumed the next user-facing step was a pasted definition grid. The new direction starts from `main`, keeps definition-save as a primitive, and makes multi-indicator Parquet files first-class: analyze the file, derive its `indicator_code + freq` slices, propose definitions and mappings, canonicalize observations, then publish with lineage fan-out.

The phases are designed so future agents can work in fresh sessions without inheriting the full conversation. Each phase should be implemented from a branch based on `main` and should avoid merging the old `dev` branch wholesale.

## How to use this plan

Each phase is in its own file and is **self-contained**: minimum context, files to create/modify with absolute paths, ordered steps, and "done" criteria. This lets you execute each phase in a separate agent session without saturating context.

To start a phase, open a new session, read this README for shared context, then read the phase file and execute it. Update the `Status` column in the phase map and `plan.json` when each phase completes.

## Status

- **Status**: in-progress
- **Created**: 2026-06-21
- **Owner**: Felipe

## Objective

Provide admin users with a reliable way to load GEIH-style Parquet batches into Colombia en Datos: one natural multi-indicator file in, reviewed definitions and mappings, canonical observations and lineage out. Preserve the canonical Observation schema and public visibility rules while removing the artificial one-indicator-per-upload narrowing from the target admin workflow.

## Scope

### In scope

- Restart implementation from the `main` schema (`data_sources`, `source_citation`, explicit `indicator_frequencies`).
- Port useful definition-save rules from the old `dev` branch instead of merging the branch wholesale.
- Analyze multi-indicator Parquet files without writing data.
- Derive distinct `indicator_code + freq` slices from file contents instead of requiring a user-supplied indicator code.
- Enforce that each flat file's mapped dimension column set is compatible with every slice's dimension contract.
- Generate editable Indicator frequency definition drafts from batch profiles.
- Canonicalize source-shaped rows into the canonical Observation schema.
- Stage and publish every validated slice in the batch.
- Replace only the `indicator_code + freq` pairs present in the batch; leave absent indicators/frequencies untouched.
- Fan one uploaded batch out to per-slice `data_releases` and `indicator_data_sources` lineage.
- Keep public discovery hidden until both lineage and canonical observations exist.

### Out of scope (explicit non-goals)

- Continuing direct implementation on the stale `dev` branch.
- Replacing the canonical DuckDB Observation schema with source-shaped storage.
- Full role-based access control beyond existing admin protection.
- CSV/Excel upload support.
- Reusable mapping-template management beyond per-batch persisted mappings.
- Programmatic external ingest API.
- Broad codelist editing UI; unknown values may be rejected or flagged for later curation.

## Phase map

| # | File | Goal | Status |
|---|---|---|---|
| 0 | [phase-0-port-definition-save.md](phase-0-port-definition-save.md) | Port the definition-save primitive from the old branch onto the `main` schema with tests. | completed |
| 1 | [phase-1-batch-lineage-schema.md](phase-1-batch-lineage-schema.md) | Add batch parent/slice lineage scaffolding so one file can fan out to many releases. | completed |
| 2 | [phase-2-batch-analyzer.md](phase-2-batch-analyzer.md) | Add a read-only Parquet batch profiler that derives slices and validates file-wide dimensionality. | completed |
| 3 | [phase-3-definition-drafts.md](phase-3-definition-drafts.md) | Generate editable definition grids from batch profiles and save definitions transactionally. | completed |
| 4 | [phase-4-canonical-stage.md](phase-4-canonical-stage.md) | Canonicalize source rows and stage validated observation slices per indicator/frequency. | completed |
| 5 | [phase-5-batch-publish.md](phase-5-batch-publish.md) | Publish staged slices to DuckDB with per-slice replacement and lineage fan-out. | completed |
| 6 | [phase-6-admin-batch-ui.md](phase-6-admin-batch-ui.md) | Build the admin UI flow that ties analysis, review, staging, and publish together. | pending |

After phase 2, engineers can repeatedly profile real data-engineering deliveries without touching production data. After phase 4, trusted admins can stage fully canonical slices. After phase 5, batch ingest is end-to-end functional behind API/admin surfaces.

## Cross-service impact

None — isolated to this repo. The feature touches this SvelteKit app, SQLite metadata, and the local DuckDB canonical store. There are no known external service consumers to coordinate.

## Glossary

| Term | Meaning |
|---|---|
| Canonical Observation schema | The lowercase DuckDB row shape used by Explorer: `indicator_code`, `freq`, `ref_area`, `time_period`, `obs_value`, standard dimension columns, `obs_status`. |
| Batch | One uploaded Parquet file / admin ingest attempt. It may contain one or many `indicator_code + freq` slices. |
| Source-shaped batch | A data-engineering Parquet delivery that may contain source-native column names and non-canonical values. |
| Slice | One staged subset for a single `indicator_code + freq`, validated and published independently inside a batch. |
| Uniform dimensionality | The enforced invariant that a flat file's mapped dimension column set is compatible with every slice's `indicator_dimensions` contract. |
| Lineage fan-out | One batch parent producing many per-indicator `data_releases` / `indicator_data_sources` rows. |
| Definition-save primitive | The server/UI behavior that creates Data source, Indicator group, Indicator, Indicator frequency, and dimension contract records without observations. |
| Published visibility | Public catalogs show an Indicator frequency only after both published lineage and canonical observations exist. |

## Target architecture

```
/admin/ingest/batches
  upload source-shaped parquet
    ↓
$lib/server/batch-ingest/schema.ts + SQLite tables
  ingest_batches parent + ingest_batch_slices children
    ↓
$lib/server/batch-ingest/analyzer.ts
  read-only profile: columns, indicators, frequencies, derived slices, periods, units, dimensions, warnings
  validates uniform mapped dimensionality across slices
    ↓
$lib/server/batch-ingest/definition-drafts.ts
  proposed definition grid + measurement extraction + fixed-dimension policy
    ↓
$lib/server/definition-ingest.ts
  transactional definition save against main schema
    ↓
$lib/server/batch-ingest/canonicalize.ts
  source-to-canonical mapping, time normalization, row validation
    ↓
data/ingest/batches/<batchId>.json + staged parquet/duckdb slices
    ↓
$lib/server/batch-ingest/publish.ts
  for each present indicator_code + freq: delete/insert that slice only
  write per-slice data_releases + indicator_data_sources linked to batch parent
```

## Conventions

- All new implementation should target `main` schema names: `dataSources`, `indicatorGroups.dataSourceId`, `indicators.sourceCitation`.
- Treat the old `dev` branch as reference-only. Cherry-pick ideas/tests manually; do not merge it wholesale.
- Canonical columns are lowercase. Source columns may be uppercase only before the canonicalization boundary.
- Canonical monthly periods are `YYYY-MM`. GEIH-style `M-YYYY` is a source format, not a storage format.
- Store `unit`, `unit_mult`, and `decimals` on Indicator definitions, not in canonical observation rows.
- Do not ask admins to hand-type one `indicatorCode` for batch ingest; derive indicator codes and frequencies from file contents.
- Batch publish replaces only slices present in the batch and leaves absent slices untouched.

## Open questions

- Should fixed total dimensions from GEIH (`GEO_LEVEL=NAT`, `SEX=T`, etc.) be collapsed into dimensionless definitions for every batch, or should admins choose per batch? Current recommendation: collapse when each candidate dimension has one value.
- Should batch publish be all-or-nothing by default, or allow selected-slice publish in v1? Current recommendation: all-or-nothing first; selected-slice publish later.
- Should accepted mappings become reusable templates? Current recommendation: persist per-batch mappings first and promote templates only after repeated source deliveries prove stable.
- Where should staged batch artifacts live in production: local Fly volume, object storage, or DuckDB staging tables? Current recommendation: start with local `data/ingest/batches/` manifests plus stored uploaded files, matching existing upload foundations.
- Should canonical multi-indicator batches use the same `/batches/*` endpoints as source-shaped batches? Current recommendation: yes; the old `/upload` endpoint stays as compatibility only.

## Decisions made during planning

- Future ingest work starts from `main`, not the old `dev` branch. → ADR 0005
- Definition-save remains useful as a primitive but is no longer the first user-facing GEIH workflow. → ADR 0005
- Batch ingest starts with read-only analysis and admin-reviewed mappings before any database writes. → ADR 0005
- Multi-indicator files are first-class because the Observation schema already supports them; the current single-indicator API is an artificial narrowing. → ADR 0005
- Batch publish replaces only `indicator_code + freq` pairs present in the batch. → ADR 0005
- Lineage keeps per-indicator releases but links them to a batch parent. → ADR 0005
- Uniform file dimensionality is a validation invariant, not an implicit assumption. → ADR 0005
- Canonical storage remains the existing Observation schema; source quirks are handled at ingest boundaries. → ADR 0005

## References

- `docs/target-data-architecture.md`
- `docs/prd/admin-ingest-definitions.md`
- `docs/adr/0004-data-sources-replace-areas.md`
- `docs/adr/0005-batch-parquet-ingest-before-definition-review.md`
- `src/lib/db/schema/indicators.ts`
- `src/lib/server/ingest.ts`
- Reference-only old branch files: `dev:src/lib/server/definition-ingest.ts`, `dev:src/routes/admin/ingest/+page.svelte`, `dev:src/lib/server/admin-definition-catalog.ts`
- Sample file analyzed in planning: `data/geih_2021_2026_arq_ok_v2.parquet`
