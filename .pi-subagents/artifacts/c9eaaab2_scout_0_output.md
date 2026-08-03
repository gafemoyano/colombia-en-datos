# Code Context

## Files Retrieved
1. `src/lib/db/schema/indicators.ts` (lines 1-209) - current checked-in Drizzle registry, all indicator-owned foreign keys, and uniqueness constraints.
2. `drizzle/0000_clean_magdalene.sql` (lines 1-78) - original `collection_indicators`, `areas`, `categories`, `indicators`, and `indicator_files` SQL/FKs.
3. `drizzle/0003_phase1_registry.sql` (lines 1-133) - registry table replacement and the `indicator_dimensions`, `data_releases`, and `indicator_data_sources` FKs.
4. `drizzle/0006_indicator_frequencies.sql` (lines 1-21) - newer frequency child table and backfill rules.
5. `src/lib/server/scanner.ts` (lines 1-150) - directory-partition conventions accepted by the legacy seed.
6. `src/lib/server/seed-indicators.ts` (lines 240-471) - additive/upsert behavior for sources, groups, indicators, and legacy files.
7. `scripts/seed-dimensions.ts` (lines 1-218) - dimension discovery and additive registry population.
8. `scripts/create-canonical-store.ts` (lines 1-189) - canonical DuckDB rebuild, supported observation columns, and whole-tree parquet ingestion.
9. `scripts/backfill-data-releases.ts` (lines 1-170) - creation of releases/data-source slices from canonical observations.
10. `scripts/seed.ts` (lines 1-20) - seed entry point and `DATA_PATH` behavior.
11. `/home/gafe/Projects/colombia-en-datos/data/emicron-single/metadata_emicron.json` (lines 1-80, 83036-83089) - replacement metadata structure and theme collections.
12. `/home/gafe/Projects/colombia-en-datos/data/emicron-single/EMICRON_indicadores_SDMX.parquet` (schema/statistics inspected with DuckDB) - replacement observation evidence.

## Key Code

### Checked-in relational ownership

`indicators.code` is globally unique and every indicator belongs to a non-null group (`src/lib/db/schema/indicators.ts:48-55`). The indicator-owned tables are:

- `indicator_files.indicator_id` (`src/lib/db/schema/indicators.ts:80-101`)
- `indicator_frequencies.indicator_id` (`src/lib/db/schema/indicators.ts:137-156`)
- `indicator_dimensions.indicator_id` (`src/lib/db/schema/indicators.ts:159-184`)
- `data_releases.indicator_id` (`src/lib/db/schema/indicators.ts:190-203`)
- `indicator_data_sources.indicator_id`, with optional `release_id` (`src/lib/db/schema/indicators.ts:209-232`)
- Historical `collection_indicators.indicator_id` (`drizzle/0000_clean_magdalene.sql:1-8`).

All generated SQL uses `ON DELETE no action`, not cascade (e.g. `drizzle/0003_phase1_registry.sql:100,118,130-131`; `drizzle/0006_indicator_frequencies.sql:7`). Therefore a direct `DELETE FROM indicators ...` fails whenever foreign keys are enforced and children exist.

### Existing live EMICRON evidence

Read-only queries against the configured libSQL database found:

- area `emicron`, id `1`;
- **18** old groups, codes such as `A1.10_SME_OWNSTAT`, `B.2_SME_ACTIVITY`, etc.;
- **75** old indicators, ids 1-75, using `NUM_SME_*` codes;
- **453** `indicator_files` rows and **525** `indicator_dimensions` rows;
- zero EMICRON `data_releases` and zero `indicator_data_sources` rows.

Examples include `NUM_SME_AGRIC`, annual frequency, source `DANE-EMICRON`, six legacy files. This confirms that the replacement is not an upsert of the same keys: the new codes are `EMICRON_PI_001` through `EMICRON_PI_133`.

**Critical schema drift:** the configured live database has `areas` and `indicator_groups.area_id`, no `data_sources`, no `indicator_frequencies`, and no `collection_indicators`. Checked-in Drizzle instead declares `data_sources` and `indicator_groups.data_source_id` (`src/lib/db/schema/indicators.ts:4-45`) and migration 0006 declares frequencies. Any replacement migration must target the actually deployed schema/version, not blindly use current Drizzle symbols.

### Replacement dataset evidence

DuckDB inspection of the single parquet found **944,667 rows**, **133 distinct indicators**, annual frequency `A`, periods 2019-2024, **26 REF_AREA**, 25 AREA values, and 194 CATEGORY values. It contains 36 columns, including app-supported canonical fields plus EMICRON-specific `DOMAIN`, `CLASE`, `HEAD_SEX`, `CATEGORY`, `CATEGORY_LABEL`, `WEIGHT_TYPE`, `ESTIMATION_SCOPE`, and provenance fields.

The JSON has **133 indicators** and **11 theme collections**. Its collection objects start at `metadata_emicron.json:83036`; members refer to `EMICRON_PI_*` and carry `filter_whitelist` (e.g. lines 83037-83063).

## Architecture

The legacy seed scans only Hive-like directories ending in `FREQ=/INDICATOR=/REF_AREA=/part-YYYY.parquet` (`src/lib/server/scanner.ts:18-67,70-116`). A root containing only `EMICRON_indicadores_SDMX.parquet` produces no records. Likewise metadata loading only checks `metadata/metadata_with_collections.json`, not `metadata_emicron.json` (`src/lib/server/seed-indicators.ts:152-163`). Thus `DATA_PATH=.../emicron-single npm run db:seed` is not a viable replacement migration.

The seed is additive: it updates/inserts matching groups/indicators (`src/lib/server/seed-indicators.ts:285-355,390-430`) and inserts files with conflict-ignore (`src/lib/server/seed-indicators.ts:432-471`). It never removes stale EMICRON indicators, groups, files, or dimensions.

The canonical builder recursively reads any parquet (`scripts/create-canonical-store.ts:49-64`) and atomically replaces the entire DuckDB (`scripts/create-canonical-store.ts:8-14,178-181`), but maps only a fixed set of dimensions (`scripts/create-canonical-store.ts:19-38,88-140`). EMICRON `AREA`, `CATEGORY`, `CLASE`, `DOMAIN`, and `HEAD_SEX` are currently discarded. Worse, the batch query directly references `SOURCE_SHEET` and `CUADRO_TITLE` nowhere but relies on standard named columns; single-file fallback silently skips failures (`scripts/create-canonical-store.ts:143-159`). A replacement should validate row count after build.

### Exact delete/upsert set and safe order

Run in one transaction, with foreign keys enabled and pre/post count assertions:

1. Resolve the EMICRON parent by code (`areas.code='emicron'` in the live schema; `data_sources.code='emicron'` only after schema reconciliation), then materialize old group IDs and indicator IDs. Do not select by `NUM_SME_%` alone because indicator codes are globally shared namespace.
2. Delete `indicator_data_sources` for old indicator IDs **before** `data_releases`, because `indicator_data_sources.release_id` also points at releases.
3. Delete old `data_releases`, `indicator_dimensions`, `indicator_frequencies` (if table exists), `indicator_files`, and historical `collection_indicators` (if table exists).
4. Delete the 75 old `indicators`, then the 18 old `indicator_groups`. Preserve/upsert the EMICRON area/source row rather than deleting it; deleting it is blocked by group FKs and risks changing its stable id.
5. Upsert 11 new theme groups keyed by `(EMICRON parent id, collection code)`, including title, `source_type='metadata_collection'`, and serialized `filter_whitelist`.
6. Upsert exactly 133 indicators by globally unique `code`, assigning the theme group and replacing authoritative metadata fields (name, methodology/description as mapped, frequency `A`, source/source citation, unit, multiplier, decimals, viz, updated). The existing seed's “keep nonempty old value” policy is inappropriate for a replacement (`src/lib/server/seed-indicators.ts:401-420`).
7. Insert/upsert `(indicator_id,'A')` into `indicator_frequencies` where that migration exists. Populate `indicator_dimensions` per indicator from JSON applicability/details, not from one sampled file; its unique key is `(indicator_id,freq,dimension_code)` (`src/lib/db/schema/indicators.ts:179-183`). Upsert shared `dimension_definitions`/`dimension_values`; do **not** globally delete them because other datasets reference them.
8. Do **not** create `indicator_files` rows pointing at the flat parquet unless runtime is explicitly changed to support a single shared file (the legacy uniqueness key includes path/year/ref area, `src/lib/db/schema/indicators.ts:94-100`). For canonical runtime, rebuild/replace observations and then create one `data_releases` row per indicator/frequency plus 26-ish `indicator_data_sources` slices per indicator as derived from actual observations (`scripts/backfill-data-releases.ts:88-161`).
9. Verify: 133 EMICRON indicators; no old `NUM_SME_*` rows under EMICRON; 11 theme groups; no orphan child/release rows; canonical count 944,667; periods 2019-2024; frequency A; all 133 codes represented.

## Review Findings

- **blocker:** `src/lib/db/schema/indicators.ts:4-45` versus live PRAGMA evidence - checked-in schema expects `data_sources/data_source_id`, while deployed DB has `areas/area_id`. A generated migration from the current schema can address the wrong tables or fail.
- **high:** `drizzle/0003_phase1_registry.sql:100,118,130-131` and `drizzle/0006_indicator_frequencies.sql:7` - no cascade exists; deletion must explicitly clear every child in dependency order.
- **high:** `src/lib/server/scanner.ts:119-150` - the single flat parquet is invisible to the legacy scanner, so ordinary seeding yields zero new registry rows.
- **high:** `src/lib/server/seed-indicators.ts:390-471` - seeding is additive and cannot remove the 75/18 stale indicator/group records or their 978 known child rows.
- **high:** `scripts/create-canonical-store.ts:88-140` - fixed canonical projection drops important new EMICRON dimensions; registry claims could diverge from queryable data.
- **medium:** `scripts/seed-dimensions.ts:39-104` - one legacy file per indicator is sampled, potentially under-registering dimension values; flat shared parquet is not represented in `indicator_files`.
- **medium:** historical `drizzle/0000_clean_magdalene.sql:1-8` - collection links can block indicator deletion on databases where that table still exists, even though it is absent from current exports/live database.

## Residual Risks

- The inspected configured database is evidently behind the repository migration/schema state; migration journal/version reconciliation remains required.
- No repository migration yet defines how the 11 metadata “collections” map to `indicator_groups`; the proposed mapping follows existing seed semantics, but product confirmation may be needed for the oddly named `EMICRON_THEME_imicro_*` groups.
- Shared `dimension_values` lack dataset ownership, so stale EMICRON-only values cannot be safely deleted without proving no other indicator uses them.
- Canonical observations have no relational FK to SQLite indicator IDs; registry and DuckDB replacement are not atomically transactional across engines.
- `collection_indicators` may exist in other environments despite being absent live/current schema; migrations must feature-detect or standardize schema first.

## Start Here

Open `src/lib/db/schema/indicators.ts` first to enumerate ownership and constraints, then compare it with target-database `sqlite_master`/PRAGMA before authoring any SQL. The schema drift is the gating issue.