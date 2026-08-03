# Code Context

## Files Retrieved
1. `/home/gafe/Projects/colombia-en-datos/data/emicron-single/EMICRON_indicadores_SDMX.parquet` (entire file; 6,269,045 bytes) — profiled with DuckDB.
2. `/home/gafe/Projects/colombia-en-datos/data/emicron-single/metadata_emicron.json` (entire file; 83,399 lines, 1,852,332 bytes) — metadata/catalog alignment source.
3. `src/lib/server/ingest.ts` (lines 8-37, 194-344) — canonical upload column and validation contract.
4. `src/lib/server/duckdb.ts` (lines 1-23, 109-180) — canonical store version and query column naming.
5. `src/lib/server/explorer.ts` (lines 12-21, 118-139) — dimensions currently understood by the application.
6. `src/lib/server/seed-indicators.ts` (lines 9-38, 147-202) — expected JSON catalog shape and normalization.

## Key Code

The application upload contract requires lowercase `indicator_code`, `freq`, `ref_area`, `time_period`, `obs_value` (`src/lib/server/ingest.ts:8-21`) and rejects uppercase column names and unregistered extra columns (`src/lib/server/ingest.ts:231-264`). It validates non-null geography/time, numeric observations, and annual/monthly time syntax (`src/lib/server/ingest.ts:287-339`). Canonical querying likewise reads `time_period`, `obs_value`, and `indicator_code` (`src/lib/server/duckdb.ts:154-156`). Explorer recognizes only `GEO_LEVEL`, `DEPT_CODE`, `MUNI_CODE`, `URBAN_RURAL`, `SEX`, `AGE`, and `ADJUSTMENT` (`src/lib/server/explorer.ts:12-21`). JSON seeding expects keyed `indicators` and `collections`, with indicator `dims/freq/unit/...` and collection `members/filter_whitelist` (`src/lib/server/seed-indicators.ts:9-38`).

## Profile Results

### Parquet schema and volume

- **944,667 rows**, **133 distinct indicators**, codes exactly `EMICRON_PI_001` through `EMICRON_PI_133`.
- 36 columns. `OBS_VALUE` is `DOUBLE`; `SOURCE_ROW`, `UNIT_MULT`, `DECIMALS`, `YEAR`, `MONTH` are `BIGINT`; `REPRESENTATIVE` is `BOOLEAN`; the other 29 columns are `VARCHAR`.
- Columns: `DATAFLOW, FREQ, INDICATOR, INDICATOR_NAME, SOURCE_ROW, THEME, REF_AREA, DEPT_CODE, MUNI_CODE, GEO_LEVEL, AREA, DOMAIN, CLASE, URBAN_RURAL, SEX, HEAD_SEX, AGE, CATEGORY, CATEGORY_LABEL, ADJUSTMENT, TIME_PERIOD, OBS_VALUE, UNIT, UNIT_MULT, OBS_STATUS, DECIMALS, YEAR, MONTH, WEIGHT_TYPE, ESTIMATION_SCOPE, REPRESENTATIVE, SOURCE_VARIABLES, FORMULA, UNIVERSE, METHODOLOGY_NOTE, SOURCE`.
- All indicators have one stable `INDICATOR_NAME` (zero indicators with multiple names).

### Dimension cardinalities and values

- `FREQ`: 1 (`A`); `TIME_PERIOD`/`YEAR`: 6 (`2019`–`2024`); rows/year: 48,839; 45,212; 203,004; 215,923; 215,903; 215,786 respectively.
- `REF_AREA`: 26 (`CO` plus 25 `CO-nn` values); `DEPT_CODE`: corresponding 26 (`00` plus 25 department codes); `AREA`: 25 (24 codes plus `_T`).
- `GEO_LEVEL`: 5 — `NAT` 11,958; `CLASS` 23,914; `DEP` 211,584; `AREA` 286,352; `DEP_CLASS` 410,859.
- `CLASE`: 3 (`1` 223,491; `2` 211,282; `_T` 509,894), exactly aligned with `URBAN_RURAL` (`U`, `R`, `_T` with identical counts).
- `SEX`: 3 (`F` 313,988; `M` 315,249; `_T` 315,430).
- `CATEGORY`: 194; `CATEGORY_LABEL`: 202. This is plausible because a code may have context-dependent labels, but consumers must not assume a global one-to-one codelist.
- Fixed dimensions: `MUNI_CODE=0000`, `DOMAIN=_T`, `HEAD_SEX=_T`, `AGE=_T`, `ADJUSTMENT=N`.
- `UNIT`: `NUMBER` 450,390; `PERCENT` 348,501; `THOUSAND_COP` 145,776. `UNIT_MULT=0` throughout. `DECIMALS`: 0 for 596,166 and 2 for 348,501.
- `OBS_STATUS`: `A` 932,490 and `E` 12,177. `DATAFLOW` is uniformly `COL_DATOS:EMICRON_INDICATORS(1.0)`; all rows are `REPRESENTATIVE=true`.
- Other cardinalities: theme 11, source row 133, weight type 3, estimation scope 5, source variables 73, formula 132, universe 62, methodology note 16 non-null values.

### Nulls, duplicates, and internal integrity

- Required analytical fields have **zero nulls**, including indicator, frequency, reference area, time, observation, unit, multiplier, decimals, and all dimensions.
- Nulls occur only in `MONTH` (**944,667/944,667**, structurally appropriate for annual data) and `METHODOLOGY_NOTE` (**551,754**, 58.4%, optional descriptive metadata).
- **Zero exact duplicate rows.** Also zero duplicates on the SDMX observation key formed by frequency, indicator, reference/geographic dimensions, category, adjustment, and time.
- Zero invalid annual time strings, non-annual rows, non-`CO%` reference areas, null observations, or mismatches between `YEAR` and `TIME_PERIOD`.
- Zero `REF_AREA`/`DEPT_CODE`, `CLASE`/`URBAN_RURAL`, or `GEO_LEVEL`/geographic-component consistency violations under the evident coding rules.

### JSON catalog and alignment

- JSON has **133 indicators** and **11 collections**. Collection membership totals 133 and has 133 unique members: every indicator belongs to exactly one collection.
- Collection sizes are 6, 24, 8, 3, 3, 3, 24, 8, 16, 24, and 14 (capital social through variables principales).
- **Perfect code alignment:** no parquet-only codes, JSON-only codes, key-vs-embedded-`code` mismatches, missing collection references, missing member codes, duplicated members, or disagreement between indicator-side and collection-side membership.
- All 133 JSON indicators declare annual frequency. Units split as NUMBER 61, PERCENT 65, THOUSAND_COP 7, aligning with parquet unit families. Every indicator contains the same 29 expected metadata fields; all carry dimension details.
- Dimension-detail union is 15 fields: `ADJUSTMENT, AGE, AREA, CATEGORY, CLASE, DEPT_CODE, DOMAIN, FREQ, GEO_LEVEL, HEAD_SEX, MUNI_CODE, REF_AREA, SEX, TIME_PERIOD, URBAN_RURAL`. Applicable-dimension union is the varying subset excluding fixed total-only/support fields.

## Review Findings

1. **High — not directly ingestible into canonical application format.** The parquet is SDMX-styled uppercase and uses `INDICATOR`, while application ingestion requires lowercase `indicator_code` and rejects case differences and unregistered columns (`src/lib/server/ingest.ts:8-21, 231-264`). Nearly all 36 input columns would therefore fail the current upload validator. A deliberate transform/mapping is required, not direct publication.
2. **Medium — semantic dimensions exceed current canonical/explorer model.** `AREA`, `DOMAIN`, `CLASE`, `HEAD_SEX`, and `CATEGORY` carry observation-key semantics, but are absent from explorer's supported map (`src/lib/server/explorer.ts:12-21`) and absent from canonical optional columns (`src/lib/server/ingest.ts:9-23`). Dropping them would collapse distinct series; mapping only seven supported dimensions is unsafe.
3. **Medium — JSON `_schema` under-declares the actual SDMX structure.** It declares only `TIME_PERIOD`, `FREQ`, `REF_AREA`, attributes `UNIT/UNIT_MULT`, and measure `OBS_VALUE`, although observations and per-indicator `dimension_details` use 15 key dimensions plus further observation attributes. Generic schema-driven consumers will not discover the complete key or attributes.
4. **Low — duplicated representations require preservation rules.** `YEAR` duplicates annual `TIME_PERIOD`; `CLASE` duplicates `URBAN_RURAL`; `REF_AREA` overlaps `DEPT_CODE`; `CATEGORY_LABEL` is not globally one-to-one with `CATEGORY`. Current data is internally consistent, but transformations should choose authoritative columns and retain contextual label mapping.
5. **Info — no row-level quality blockers found.** No null required values, duplicate observation keys, invalid periods, geography inconsistencies, or parquet/JSON code drift were detected.

## Architecture

The source is a rich, denormalized SDMX-like observation file plus a keyed JSON catalog. The repository's runtime, however, expects normalized lowercase canonical observations and separately registered metadata/dimensions. A loader must (1) map `INDICATOR→indicator_code` and lowercase canonical columns, (2) register all series-defining dimensions or explicitly encode extras, (3) move descriptive/provenance columns into metadata, and (4) preserve collection membership from JSON. Direct use of the current upload path will fail validation.

## Start Here

Open `src/lib/server/ingest.ts:8-37,194-344` first: it is the exact compatibility boundary that explains why this otherwise internally clean dataset cannot be ingested unchanged.

## Residual Risks

- Profiling establishes structural and relational consistency, not statistical correctness against DANE source tables; extreme-value/outlier or weighted-estimate validation was not possible without source benchmarks.
- `OBS_STATUS` meanings (`A`, `E`) and the contextual `CATEGORY`/`CATEGORY_LABEL` codelist should be formally documented before transformation.
- Canonical key conclusions depend on treating all listed analytic dimensions as key components; no formal external DSD was supplied.