# Batch Parquet ingest starts with analysis before definition review

## Status

Accepted

## Context

The admin definition-save PRD assumed a workflow where a data scientist first prepares a tabular definition grid, saves Indicator frequency definitions, and later uploads observation files that already match the canonical Observation schema. That remains a useful backend primitive.

The GEIH delivery from data engineering showed a different real input shape: one Parquet file contained many indicators, source-native column names (`INDICADOR`), uppercase SDMX-like columns, a source typo (`ADJUSTEMENT`), per-row measurement fields (`UNIT`, `UNIT_MULT`, `DECIMALS`), and monthly periods encoded as `M-YYYY` instead of canonical `YYYY-MM`.

The canonical `observations` table is already inherently multi-indicator: rows are keyed by `indicator_code`, `freq`, `ref_area`, `time_period`, and dimensions. The current single-indicator upload API narrows this artificially by requiring an `indicatorCode` form field and then rejecting rows whose file value does not match that user-supplied value. GEIH shows the file already self-identifies indicators; splitting one natural export into 11 one-indicator uploads is workflow friction introduced by the API, not by the data model.

Continuing directly on the old `dev` branch would also carry stale schema assumptions. The current `main` schema uses `data_sources`, `indicator_groups.data_source_id`, `indicators.source_citation`, and explicit `indicator_frequencies`, while the old branch still used legacy `areas` / `source` names in its definition-ingest implementation.

## Decision

Implement future admin ingest work from `main`, not by continuing directly on the old `dev` branch.

Keep definition-save as a reusable primitive, but make multi-indicator files first-class in the user-facing ingest flow:

1. Admin chooses or creates a Data source.
2. Admin uploads a Parquet batch. The batch may already use canonical column names or may be source-shaped and require explicit mappings.
3. The system profiles the file without writing data.
4. The system derives distinct `indicator_code + freq` slices from the file instead of asking the user to hand-type a single indicator code.
5. The system proposes Indicator frequency definitions and explicit source-to-canonical mappings when needed.
6. Admin reviews/edits definitions and mappings.
7. The system canonicalizes observations into the Observation schema and stages every valid slice.
8. Admin publishes valid slices, which writes canonical observations plus lineage.

Publish replacement semantics generalize from one slice to many: for each distinct `indicator_code + freq` present in the staged batch, delete and replace only that slice in `observations`. Indicators/frequencies absent from the file are left untouched.

Lineage keeps `data_releases` per Indicator, but adds a batch/upload parent concept so one uploaded file can fan out to many per-indicator release rows. This preserves existing per-indicator Explorer/public visibility while recording the natural uploaded batch as one audit object.

Canonical single-slice upload can remain as a compatibility path for technical users, but the target admin flow should not require splitting natural multi-indicator files. Source-shaped batch intake is an ingest-boundary concern, not a change to the canonical storage model.

## Consequences

- Future implementation sessions should use `plans/geih-batch-ingest/README.md` as the entry point.
- The useful parser/validation/safety behavior from the old definition-ingest branch should be ported to the `main` schema instead of merged wholesale.
- Batch mappings must be explicit and previewed before publish. Phase 4 implements this as separate immutable, versioned artifacts: an accepted-mapping manifest, a staging-input manifest, and a staged-result manifest.
- The canonical DuckDB `observations` table remains schema-uniform and multi-indicator; source quirks are handled at ingest boundaries.
- The batch analyzer must enforce the new load-bearing invariant: all indicators in one flat file share the same observable column set, and each indicator/frequency definition contract must be compatible with that set.
- `data_releases` should still be emitted per indicator/frequency slice, linked back to a batch parent so lineage can answer both "which upload did this release come from?" and "which indicators did this upload publish?".
- GEIH-like fixed total columns (`GEO_LEVEL=NAT`, `SEX=T`, etc.) should not automatically create noisy user-facing dimensions. The batch analyzer should report them, and v1 can collapse fixed-total-only slices into dimensionless definitions unless multiple values are present.

## Alternatives considered

- **Continue with the old definition-first branch as-is.** Rejected because it targets stale schema names and does not address source-shaped multi-indicator batch files.
- **Require data engineering to split natural exports into canonical one-indicator files.** Rejected as the only path because the observations model is already multi-indicator, the file self-identifies indicators, and splitting creates workflow friction without improving data quality.
- **Store source-shaped Parquet directly.** Rejected because Explorer and public APIs depend on the canonical Observation schema, lineage, and dimension registry.

## Follow-up

Phase 4 selected immutable file-based staging under `DATA_PATH/ingest/batches` on the Fly persistent volume. See [ADR 0006](0006-file-based-batch-staging-on-data-path.md) for the artifact layout, rebuild exclusion, memory guard, and operational consequences.
