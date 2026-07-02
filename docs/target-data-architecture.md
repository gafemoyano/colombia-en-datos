# Target Data Architecture: Universal Observation Schema

> Status: Accepted direction — Phase 1 foundation and Phase 2 API foundations are implemented; Explorer slice 1 exists and is being hardened through vertical product slices.
>
> Scope: How we store, ingest, and query indicator observations so that **end users can explore data in the browser** and **data scientists can self-service load new indicators** without engineering intervention.

---

## 1. Initial State Analysis (pre-Phase 1)

### What worked before Phase 1

| Strength | Detail |
|----------|--------|
| Columnar storage | Parquet gives us compression and fast column scans via DuckDB. |
| Metadata admin | `/admin` lets curators edit Spanish annotations (name, description, methodology). |
| Runtime dimension discovery | `DESCRIBE` on parquet files finds dimensions (URBAN_RURAL, SEX, etc.) dynamically. |
| Decoupled metadata | SQLite stores indicator definitions; parquet stores observations. |

### What was broken or limiting before Phase 1

| Problem | Consequence |
|---------|-------------|
| **No ingestion path** | Adding a new indicator requires SSH/filesystem access, dropping files into `data/`, and running `npm run db:seed`. A data scientist cannot do this alone. |
| **Two folder conventions** | `data/empleo/` uses direct `FREQ=` dirs; `data/emicron/` uses category prefixes. The scanner has branching logic that is hard to explain and easy to break. |
| ~35 000 tiny files | Average file size is ~18 KB. DuckDB pays a high "open file" overhead; object storage (R2/S3) would pay per-request costs; backups are painful. |
| **Runtime `DESCRIBE` for dimensions** | Every metadata request opens a parquet file to read its schema. This is I/O we could eliminate with a registry. |
| **Hard-coded dimension UI** | `DimensionSelector.svelte` knows about `URBAN_RURAL`, `SEX`, `AGE` by name. A new dimension (e.g. `EDUCATION_LEVEL`) requires a code change. |
| **SQL injection in query builder** | `duckdb.ts` interpolates URL parameters directly into SQL strings. This blocks opening the API to untrusted users. |
| **Measurement format per row** | `UNIT`, `UNIT_MULT`, `DECIMALS` live inside every parquet row, but they are usually stable per indicator. This wastes space and creates ambiguity when rows disagree. |
| **No data lineage** | We cannot answer "when was this indicator last loaded?" or "who uploaded this file?" |
| **Schema implicit** | There is no documented "contract" that a parquet file must satisfy. The seed script assumes SDMX-like columns, but nothing enforces it. |

### Pre-Phase-1 data flow (simplified)

```
Data scientist has new indicator
    ↓
Writes parquet files to data/<data-source>/...  (manually, via Python script)
    ↓
Developer runs npm run db:seed
    ↓
Scanner walks filesystem → inserts into SQLite + registers file paths
    ↓
App queries SQLite for paths → DuckDB opens each parquet → SELECT
```

This flow is **developer-gated at every step**.

---

## 2. Design Principles

1. **Universal observation schema**  
   Every indicator, regardless of source, fits into the same logical table shape. We do not special-case DANE employment vs EMICRON vs future external sources.

2. **Metadata is the source of truth for humans; the registry is the source of truth for machines**  
   What an indicator *means* (name, methodology) lives in SQLite and is editable in `/admin`. What columns an indicator *has*, and where its data *lives*, is also registered relationally so the UI and query engine never need to guess.

3. **Self-service ingestion with explicit canonicalization**  
   A data scientist with a Parquet file that already matches the Observation schema should be able to upload, fix validation errors, and publish through authenticated app surfaces without asking engineering to run a script. Trusted source-shaped batch files are also first-class admin inputs: the platform may analyze a batch file, propose Indicator definitions, and apply explicit reviewed mappings into the canonical Observation schema before publishing. Canonicalization is an ingest step; the canonical store remains uniform.

4. **Canonical storage over scattered files**  
   We should move from 35 000 small files to a smaller number of canonical stores (DuckDB native files or consolidated parquet) so that queries are fast, backups are simple, and object-storage migration is cheap.

5. **Dimension registry drives the UI**  
   The frontend should not hardcode dimensions. If a data scientist adds a new dimension `EDUCATION_LEVEL`, the dimension selector and filter dropdowns should appear automatically.

---

## 3. Target Storage Architecture

### 3.1 Canonical observation store

We introduce a **single DuckDB database file** (`data/observations.duckdb`) as the canonical store for all observation-level data. DuckDB's native format is portable (Python/R/Go can open it), compressed, and supports ACID appends.

#### Logical universal schema

```sql
CREATE TABLE observations (
    -- Identity
    indicator_code VARCHAR NOT NULL,
    freq           VARCHAR NOT NULL,
    ref_area       VARCHAR NOT NULL DEFAULT 'CO',

    -- Time and value
    time_period    VARCHAR NOT NULL,
    obs_value      DOUBLE,

    -- Standard dimensions (NULL when not applicable)
    geo_level      VARCHAR,
    dept_code      VARCHAR,
    muni_code      VARCHAR,
    urban_rural    VARCHAR,
    sex            VARCHAR,
    age            VARCHAR,
    adjustment     VARCHAR,

    -- Administrative
    obs_status     VARCHAR DEFAULT 'A',
    source_period  VARCHAR,   -- e.g. '2024-Q1' for traceability

    PRIMARY KEY (indicator_code, freq, ref_area, time_period,
                 geo_level, dept_code, muni_code, urban_rural, sex, age, adjustment)
);

-- Partitioned views or indexes for query performance
CREATE INDEX idx_obs_indicator_time ON observations(indicator_code, freq, ref_area, time_period);
```

**Why a wide table instead of EAV?**  
EAV (entity-attribute-value) is flexible but destroys columnar performance. DuckDB is designed for wide analytical tables. We accept that adding a truly new dimension requires a schema migration (see §5.2), but the current set of dimensions (URBAN_RURAL, SEX, AGE, ADJUSTMENT, GEO_LEVEL, DEPT_CODE, MUNI_CODE) covers every indicator we have today and most DANE microdata we are likely to ingest.

**What about indicators that need a dimension we did not predict?**  
We reserve an `ext_dimensions MAP(VARCHAR, VARCHAR)` column in DuckDB as an escape hatch. The ingestion UI warns admins that "unknown columns will be stored as an extension map and will not support filtering in the chart UI until the dimension is promoted to a first-class column."

#### Migration path for existing data

1. Create `observations.duckdb`.
2. Run a one-time script that reads every registered parquet file and `INSERT OR REPLACE` into the canonical table.
3. Update `queryTimeSeries()` to query `observations.duckdb` instead of scattered files.
4. Keep the original `data/` parquet files as an **archival snapshot** (read-only, not queried by the app). Future ingestion writes to the DuckDB canonical store.

### 3.2 Relational metadata extensions (SQLite)

We extend the SQLite schema so that the UI and query builder never need to `DESCRIBE` a data file at runtime.

#### New tables

```sql
-- dimension_definitions
-- Registry of all dimensions the system knows about.
code        VARCHAR PRIMARY KEY  -- 'URBAN_RURAL', 'SEX', 'AGE', ...
name        VARCHAR NOT NULL     -- Spanish display name
name_es     VARCHAR              -- redundant today, but keeps the door open
sort_order  INTEGER              -- UI ordering
is_standard BOOLEAN DEFAULT TRUE -- false for extension-map dimensions
created_at  TIMESTAMP

-- dimension_values
-- Codelists (allowed values) for each dimension.
dimension_code VARCHAR
code           VARCHAR
label_es       VARCHAR
sort_order     INTEGER
PRIMARY KEY (dimension_code, code)

-- indicator_frequencies
-- Explicit admin-visible frequency definitions, including dimensionless indicators.
indicator_id   INTEGER REFERENCES indicators(id)
freq           VARCHAR NOT NULL      -- 'M', 'A', 'Q', 'D'
PRIMARY KEY (indicator_id, freq)

-- indicator_dimensions
-- Which dimensions apply to a given indicator+freq combination, and their defaults.
indicator_id   INTEGER REFERENCES indicators(id)
freq           VARCHAR NOT NULL      -- 'M', 'A', 'Q', 'D', or '*' for all frequencies
dimension_code VARCHAR
default_value  VARCHAR      -- e.g. 'T' for URBAN_RURAL total
is_filterable  BOOLEAN DEFAULT TRUE
is_splitable   BOOLEAN DEFAULT TRUE  -- can be used as a "by" / trace-split dimension
PRIMARY KEY (indicator_id, freq, dimension_code)

-- ingest_batches
-- One uploaded file / admin ingest attempt. A batch can fan out to many releases.
id             INTEGER PRIMARY KEY
data_source_id INTEGER REFERENCES data_sources(id)
original_name  VARCHAR
checksum       VARCHAR       -- sha256 of source file
source_format  VARCHAR       -- 'parquet', 'csv', 'excel'
row_count      INTEGER
status         VARCHAR       -- 'uploaded', 'analyzed', 'staged', 'published', 'failed'
created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
published_at   TIMESTAMP

-- ingest_batch_slices
-- One distinct indicator_code + freq slice derived from a batch.
id             INTEGER PRIMARY KEY
batch_id       INTEGER REFERENCES ingest_batches(id)
indicator_code VARCHAR NOT NULL  -- analyzer can identify slices before Indicator rows exist
freq           VARCHAR NOT NULL
indicator_id   INTEGER REFERENCES indicators(id)
row_count      INTEGER
period_start   VARCHAR
period_end     VARCHAR
status         VARCHAR       -- 'proposed', 'staged', 'published', 'failed'
release_id     INTEGER REFERENCES data_releases(id)
created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP

-- data_releases
-- Per-indicator/frequency lineage emitted by a publish action.
id             INTEGER PRIMARY KEY
indicator_id   INTEGER REFERENCES indicators(id)
ingest_batch_id INTEGER REFERENCES ingest_batches(id)
release_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
period_start   VARCHAR       -- earliest time_period in this release slice
period_end     VARCHAR       -- latest time_period in this release slice
row_count      INTEGER
source_format  VARCHAR       -- 'parquet', 'csv', 'excel'
source_name    VARCHAR       -- original filename
uploaded_by    VARCHAR       -- user identifier or API key name
status         VARCHAR       -- 'staged', 'validated', 'published', 'rolled_back'
checksum       VARCHAR       -- sha256 of source file
```

#### Modified tables

```sql
-- indicator_files becomes indicator_data_sources
-- It now points to a slice of the canonical store, not a filesystem path.
indicator_id   INTEGER
ref_area       VARCHAR
freq           VARCHAR
year_min       INTEGER       -- replaces single-year files
year_max       INTEGER
row_count      INTEGER
release_id     INTEGER REFERENCES data_releases(id)
```

**Note on `indicators` table:**  
- Keep `unit`, `unitMult`, `decimals` here. Remove the habit of reading them from parquet rows.
- **Remove `frequency` column.** Frequency is a property of each observation row, not of the indicator identity. The same indicator code can have monthly and annual data.
- If an indicator truly has mixed units across dimensions (we have not seen this yet), we can add an `indicator_dimension_units` table later.

---

## 4. Ingestion Pipeline: Self-Service for Data Scientists

### 4.1 High-level flow

The canonical `observations` table is inherently multi-indicator because `indicator_code` and `freq` are row keys. Admin ingest should therefore treat a Parquet file as a batch that can contain one or many distinct `indicator_code + freq` slices. The current single-indicator upload endpoint is a compatibility path, not the target workflow.

```
Admin creates or chooses a Data source
    ↓
Admin uploads a Parquet batch file
    ↓
System profiles columns, indicator codes, frequencies, periods, measurement fields, and dimensions
    ↓
System derives distinct indicator_code + freq slices from the file
    ↓
System proposes editable Indicator frequency definitions and explicit canonicalization mappings when needed
    ↓
Admin saves definitions and confirms mappings
    ↓
System canonicalizes observations into the Observation schema and stages every valid slice
    ↓
Admin publishes the batch
    ↓
For each present indicator_code + freq, system replaces only that slice in observations.duckdb
    ↓
System fans lineage out from one ingest batch to per-indicator data_releases and indicator_data_sources rows
    ↓
Published Indicator frequencies become live immediately in the Explorer view
```

A canonical batch already uses Observation-schema column names and may skip source-to-canonical mappings. A source-shaped batch, such as the GEIH delivery, additionally needs explicit mappings for columns like `INDICADOR`, `ADJUSTEMENT`, and `TIME_PERIOD = '1-2010'`.

### 4.2 Upload API

```typescript
// POST /api/indicators
// Body: { code, name, dataSourceCode, groupCode, dimensionsByFreq }
// Response: { indicator }

// Existing compatibility path: single-slice canonical upload
// POST /api/admin/ingest/upload
// multipart/form-data
// Body: file, indicatorCode, freq
// Response: { valid, errors[], rowCount, preview[], columns[], uploadId?, checksum? }

// Existing compatibility path: single-slice publish
// POST /api/admin/ingest/publish
// Body: { uploadId, releaseNotes? }
// Response: { releaseId, indicatorCode, freq, rowsInserted }

// Target batch-first flow
// POST /api/admin/ingest/batches/analyze
// multipart/form-data
// Body: file, dataSourceCode
// Response: { batchId, profile, proposedDefinitions, proposedMappings, warnings[] }

// POST /api/admin/ingest/batches/stage
// Body: { batchId, acceptedDefinitions, acceptedMappings }
// Response: { valid, errors[], stagedSlices[] }

// POST /api/admin/ingest/batches/publish
// Body: { batchId, sliceIds?: string[] }
// Response: { publishedSlices[], releaseIds[], errors[] }
```

### 4.3 Upload schema contract

There are two supported input contracts.

#### Canonical observation batch

Canonical batch files are already transformed into the system's **Observation schema** before upload. They may contain one or many distinct `indicator_code + freq` slices. The batch endpoint does not infer mappings for this path because the file already uses canonical column names.

The uploaded file must contain at minimum these columns:

| Required column | Type | Example |
|-----------------|------|---------|
| `indicator_code` | VARCHAR | `'EMP'` |
| `freq` | VARCHAR | `'M'`, `'A'` |
| `ref_area` | VARCHAR | `'CO'` |
| `time_period` | VARCHAR | `'2019-01'` (for M), `'2019'` (for A) |
| `obs_value` | DOUBLE | `12345.6` |

For each distinct `indicator_code + freq` slice, the file must contain every dimension registered for that Indicator frequency. Missing registered dimension columns are rejected because the saved definition is the declared observation contract.

| Optional dimension | Present only if registered for indicator+freq | Example values |
|--------------------|-----------------------------------------------|----------------|
| `geo_level` | yes | `'NAT'`, `'DEP'`, `'MUN'` |
| `dept_code` | yes | `'00'`, `'05'`, `'11'` |
| `muni_code` | yes | `'0000'`, `'11001'` |
| `urban_rural` | yes | `'T'`, `'U'`, `'R'` |
| `sex` | yes | `'T'`, `'M'`, `'F'` |
| `age` | yes | `'TOTAL'`, `'Y15PLUS'` |
| `adjustment` | yes | `'NSA'`, `'SA'` |
| `obs_status` | always allowed | `'A'` |

Extra columns not registered as dimensions are rejected with a clear error.

#### Source-shaped batch intake

Source-shaped batch files may differ from the canonical Observation schema, but only through explicit, previewed mappings accepted by an admin. The GEIH sample is the motivating example:

| Source column/value | Canonical target | Rule |
|---------------------|------------------|------|
| `INDICADOR` | `indicator_code` | Preserve source indicator code casing unless the admin edits the proposed definition. |
| `FREQ` | `freq` | Uppercase one-letter frequency code. |
| `REF_AREA` | `ref_area` | Preserve source reference area. |
| `TIME_PERIOD = '1-2010'` | `time_period = '2010-01'` | Convert monthly `M-YYYY` values to canonical `YYYY-MM`. |
| `OBS_VALUE` | `obs_value` | Cast to double. |
| `ADJUSTEMENT` | `adjustment` | Accept known source typo only when mapped explicitly. |
| `UNIT`, `UNIT_MULT`, `DECIMALS` | `indicators.unit`, `unit_mult`, `decimals` | Extract stable per-indicator measurement fields into the definition grid, not observation rows. |
| `YEAR` | none | Treat as derivable trace metadata; reject from canonical observations unless a future `source_period` policy uses it. |

The analyzer must report row counts, indicator counts, frequency counts, distinct period coverage, measurement variation by indicator, dimension candidate values, duplicate-key checks, and warnings for unknown columns or unsupported time formats before any database writes.

A flat Parquet file has one column set, so multi-indicator ingest has one new load-bearing invariant: all indicators in a file share the same observable dimensionality. The analyzer must validate each derived `indicator_code + freq` slice against the file's mapped dimension columns and its saved/proposed `indicator_dimensions` contract. If one indicator declares `SEX` and another does not, the batch is ambiguous unless the admin explicitly collapses fixed total columns or stages separate batches.

### 4.4 Validation rules

These are target validation rules. Phase 2 implemented the core single-indicator upload/publish path; codelist enforcement, duplicate-key checks, multi-indicator batch analysis, canonicalization, and final missing-dimension policy still need hardening before broad data-scientist self-service.

Batch validation:

1. `indicator_code` and `freq` are read from the file, not supplied by the user. The file is authoritative for which slices are being loaded.
2. Every distinct `indicator_code` must match an existing or newly accepted Indicator definition before staging observations.
3. Every distinct `indicator_code + freq` must match an explicit `indicator_frequencies` row before publish.
4. `time_period` must match the declared `freq` after canonicalization (YYYY-MM for M, YYYY for A, YYYY-QN for Q).
5. `obs_value` must be numeric (nulls allowed).
6. Every registered dimension for each Indicator frequency must be present, and no unmapped/unregistered dimension columns may be silently stored.
7. Dimension values must exist in `dimension_values`; unknown values are rejected or routed to a deliberate codelist-curation step before publish.
8. Duplicate primary keys (same indicator, freq, time, dimensions) are rejected per slice.
9. Every source-to-canonical column mapping must be explicit and persisted in the analyzer / definition-draft model chosen in phases 2–3; phase 1 stores only durable lineage, not mappings.
10. The file's mapped dimension column set must be compatible with every slice's dimension contract. Uniform dimensionality is validated, not assumed.
11. Measurement fields extracted from the source file must be stable per Indicator; mixed units or decimals for the same Indicator are rejected until a frequency/dimension-specific measurement model exists.
12. Generated definitions are saved before observations are published, so public visibility still requires both lineage and canonical observations.
13. Batch publish must be all-or-nothing by default for trusted admin flows, with a future option to publish only selected valid slices.

Publish replacement semantics:

1. Derive the set of distinct `indicator_code + freq` pairs present in the staged canonical rows.
2. For each pair, delete existing canonical observations for only that pair.
3. Insert staged canonical rows for that pair.
4. Leave indicators/frequencies absent from the batch untouched.
5. Create one `data_releases` row and refresh `indicator_data_sources` per published pair, linked back to the parent `ingest_batches` row.

---

## 5. Query Layer Changes

### 5.1 Fix SQL injection

Replace string interpolation with DuckDB prepared statements:

```typescript
// BEFORE (vulnerable)
whereConditions.push(`TIME_PERIOD >= '${startDate}'`)

// AFTER (safe)
const query = `
  SELECT time_period, obs_value, ${safeDimensionCols.join(', ')}
  FROM observations
  WHERE indicator_code = ?
    AND freq = ?
    AND ref_area = ?
    AND time_period >= ?
    AND time_period <= ?
`;
const rows = await conn.all(query, [
  indicatorCode, freq, refArea, startDate, endDate
]);
```

Dimension filters are also parameterized. If a dimension is not registered for the indicator, the filter is ignored rather than injected.

### 5.2 Query from canonical store

```typescript
// duckdb.ts — simplified target

export async function queryTimeSeries(params: TimeSeriesQueryParams): Promise<IndicatorData[]> {
  const db = await getDuckDB();
  // Attach the canonical database (or open it directly if we switch to file-based DuckDB)
  await runQuery(db, `ATTACH '${CANONICAL_DB_PATH}' AS canonical (READ_ONLY)`);

  // Build safe, parameterized query...
}
```

Because all observations live in one table, we no longer loop over files. We query once with `WHERE indicator_code IN (...) AND freq = ? AND time_period BETWEEN ? AND ?`.

### 5.3 Dimension registry replaces runtime DESCRIBE

```typescript
// BEFORE
const columns = await getParquetColumns(files[0].filePath);
const dims = columns.filter(c => !BASE_COLS.has(c));

// AFTER
const dims = await db
  .select({ dimensionCode: indicatorDimensions.dimensionCode })
  .from(indicatorDimensions)
  .where(and(
    eq(indicatorDimensions.indicatorId, indicatorId),
    or(
      eq(indicatorDimensions.freq, freq),
      eq(indicatorDimensions.freq, '*')
    )
  ));
```

This removes filesystem I/O from the metadata hot path and makes dimension response times deterministic.

---

## 6. Explorer View: Vertical Product Slice

The next product work is not a backend/frontend split. The app should add a parallel **Explorer view** at `/explore` and build it as a SvelteKit fullstack vertical slice. The current `/app` dashboard remains in place while `/explore` proves the new interaction model.

### 6.1 Route and integration shape

`/explore` lives under the existing app layout group:

```txt
src/routes/(app)/explore/+page.server.ts
src/routes/(app)/explore/+page.svelte
src/lib/server/explorer.ts
```

The route uses SvelteKit server load as the primary composition layer. It imports server-side query helpers directly instead of making internal HTTP requests to `/api/data`, `/api/dims`, or `/api/meta`. REST endpoints remain available for external use and backward compatibility.

The Explorer server layer returns a chart-library-neutral page model. Plotly remains the charting foundation, but conversion to Plotly traces happens in the Svelte/UI layer.

### 6.2 URL state and share links

Explorer state is URL-first. The first UI supports a single selected Indicator, but the URL parser is plural-capable from day one so multi-indicator comparison can be added without breaking links.

```txt
/explore?indicator=EMP&freq=M&by=SEX&filter.DEPT_CODE=05&start=2020-01&end=2024-12
```

Rules:

- `indicator` may appear multiple times, but slice 1 uses only one selected Indicator.
- `freq` selects the observation Frequency for the current data scope.
- `by` identifies the Split dimension using the uppercase registry code.
- `filter.{DIMENSION_CODE}=value` records an Explicit filter choice.
- Omitting `filter.{DIMENSION_CODE}` means the All values option, not a source-provided total.
- A source value such as `SEX=T` remains a normal Explicit filter choice labeled as Total if the codelist says so.
- If a dimension is both filtered and used as `by`, the filter wins and `by` is canonicalized away.
- Date range constrains chart observations, but does not change dimension value availability.

### 6.3 Discovery controls and visualization controls

The Explorer UI separates Indicator discovery from observation visualization:

- Top Discovery/data-scope row: data source narrowing, indicator combobox/search, Frequency selector.
- Left Visualization panel: Split dimension selector, dynamic dimension filters, Fixed dimension summary, chartability guidance.
- Chart surface: Plotly chart, no-data states, and chart-local date controls.
- Context/details area: Indicator annotation and Measurement format.

Data source narrowing is optional. Indicator search is primary. Frequency lives with Indicator selection because it determines the applicable dimensions and time grain.

### 6.4 Chartability rules

The Explorer does not guess user intent by silently applying total/default filters. A chart renders only when the current state is a **Chartable selection**: each returned observation maps unambiguously to one point in one visual series.

A registered Observation dimension is resolved when it is one of:

1. an Explicit filter choice;
2. the Split dimension; or
3. a Fixed dimension with only one available value for the current Indicator/Frequency/filter context.

If unresolved multi-value dimensions remain, the chart area shows guidance instead of rendering an arbitrary chart. The user must add filters or choose a Split dimension. If a Split dimension is chosen, every other applicable multi-value dimension must be filtered or fixed.

Chartability is checked in two steps:

1. Registry preflight: compare registered dimensions against URL filters and `by`.
2. Post-query assertion: verify that the returned observations do not produce ambiguous duplicate points.

### 6.5 Dimension labels and geography

The Explorer reads all dimension labels from `dimension_values`, including geographic dimensions (`GEO_LEVEL`, `DEPT_CODE`, and future `MUNI_CODE`). The existing `departamentos` table may seed department labels, but it is not the runtime label source for Explorer controls. See `docs/adr/0002-geography-labels-from-dimension-values.md`.

`ref_area` remains a Reference area / source coverage anchor, usually `CO`. Department and municipality selection are expressed through Geographic observation dimensions, not by rewriting `ref_area`.

### 6.6 UI component foundation

The Explorer uses shadcn-svelte as its UI component foundation rather than expanding the existing local primitives. Current Explorer controls use shadcn-svelte cards, buttons, selects, popovers, command/combobox search, badges, alerts, labels, and inputs where free text is appropriate. See `docs/adr/0003-shadcn-svelte-for-explorer-ui.md`.

### 6.7 Time axis and date filtering

Date filtering is chart-local Explorer state, but users should not type storage-formatted periods. The Explorer server layer derives a **Time axis** from the canonical observation store for the selected Indicator, Frequency, and Reference area:

```sql
SELECT DISTINCT time_period
FROM observations
WHERE indicator_code = ?
  AND freq = ?
  AND ref_area = ?
ORDER BY time_period;
```

The server model exposes chart-control options instead of only echoing raw URL state:

```typescript
interface ExplorerTimeAxis {
  freq: string | null;
  granularity: 'year' | 'month' | 'quarter' | 'day' | 'unknown';
  periods: Array<{
    value: string; // canonical URL/storage value, e.g. '2024' or '2024-01'
    label: string; // human label, e.g. '2024' or 'Ene 2024'
  }>;
  start: string | null;
  end: string | null;
}
```

URL parameters remain stable and shareable:

```txt
/explore?indicator=EMP&freq=M&start=2020-01&end=2024-12
/explore?indicator=NUM_SME_CTA_PROP&freq=A&start=2020&end=2024
```

Rules:

- `start` and `end` are optional bounds over `time_period`.
- The UI renders period selectors from the Time axis (`Desde el inicio`, `Hasta el final`, then observed periods).
- Period labels depend on Frequency: annual values show years, monthly values show month-year labels, quarterly values show quarter-year labels.
- Invalid URL period values are canonicalized away with a warning rather than passed to DuckDB.
- If `start` is after `end`, the Explorer canonicalizes the range to a valid order.
- The Time axis depends on Indicator + Frequency + Reference area, not on Observation dimension filters. This preserves the rule that date range constrains chart observations but does not change Observation dimension value availability.

---

## 7. External / Data-Scientist Access

Self-service is not only about uploading through the web UI. Data scientists also want to query the data from Python, R, or Jupyter.

### 7.1 DuckDB file access

Because the canonical store is a standard DuckDB file, a data scientist can:

```python
import duckdb
con = duckdb.connect("observations.duckdb")
df = con.execute("""
    SELECT * FROM observations
    WHERE indicator_code = 'EMP'
      AND freq = 'M'
      AND time_period >= '2023-01'
""").fetchdf()
```

We can expose this file via:
- A read-only volume mount in Fly.io (today).
- A signed-URL download endpoint (`/api/export/observations.duckdb`) updated nightly.
- R2/S3 sync if we move to object storage.

### 7.2 Programmatic upload API (future)

```bash
curl -X POST https://colombia-en-datos.fly.dev/api/v1/ingest \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "file=@nuevo_indicador.csv" \
  -F "mappings={\"time_period\":\"periodo\",\"obs_value\":\"valor\"}"
```

This is blocked until we have:
- API key auth (`users` table + `api_keys` table).
- Async job queue (or at least a worker thread) for large files.

---

## 8. Implementation Roadmap

### Phase 1: Foundation — complete

1. **Schema migration**  
   - Added `dimension_definitions`, `dimension_values`, `indicator_dimensions`, `data_releases`, `indicator_data_sources` tables.
   - Made `indicators.frequency` nullable during migration.

2. **Canonical store creation**  
   - Created `data/observations.duckdb` and loaded existing observations.
   - Replaced scattered parquet querying on the hot path.

3. **SQL injection fix**  
   - Rewrote `queryTimeSeries()` to use prepared statements.

4. **Dimension registry API**  
   - Replaced runtime `DESCRIBE` with SQLite registry lookups.
   - `/api/dims/[indicator]` returns enriched dimension objects.

### Phase 2: Ingestion API foundations — complete enough for Explorer work

1. **Indicator creation endpoint**  
   - `POST /api/indicators` creates indicators and registers `dimensionsByFreq`.

2. **Upload endpoint and validation engine**  
   - `POST /api/admin/ingest/upload` accepts single-indicator Parquet files matching the Observation schema.
   - Validation returns errors, row count, preview rows, columns, uploadId, and checksum.
   - GEIH-style multi-indicator source batches are not covered by this endpoint; they require the future batch-first flow described in §4.

3. **Publish flow**  
   - `POST /api/admin/ingest/publish` fully replaces observations for `indicator_code + freq`.
   - Writes `data_releases` and refreshes `indicator_data_sources`.

4. **Frequency availability**  
   - Public `GET /api/indicators` and Explorer expose only published frequencies: a published release/source record must exist and observations must exist in the canonical store. Admin listing still shows saved definitions without observations.

### Phase 2B: Batch-first admin ingest — planned

The GEIH sample file (`data/geih_2021_2026_arq_ok_v2.parquet`) showed that trusted data-engineering deliveries may arrive as one natural multi-indicator Parquet file. The file self-identifies each indicator; the current API is what forces artificial one-indicator uploads. The next ingest work should start from the `main` schema and add a batch analyzer/canonicalizer before extending the admin UI.

Planned slices:

1. Port the definition-save UI/module onto the `data_sources` + `source_citation` schema from `main`. ✅ Implemented in phase 0 via `/admin/ingest`, `src/lib/server/definition-ingest.ts`, `src/lib/server/admin-definition-catalog.ts`, and tests covering explicit `indicator_frequencies` / `indicator_dimensions` writes.
2. Add `ingest_batches` / `ingest_batch_slices` lineage scaffolding so one uploaded file can fan out to many per-indicator releases. ✅ Implemented in phase 1 via `src/lib/db/schema/indicators.ts`, `drizzle/0007_batch_lineage_schema.sql`, and thin batch manifest summary helpers.
3. Add a read-only batch analyzer that profiles multi-indicator Parquet files, derives slices, checks uniform dimensionality, and proposes definitions/mappings without writing observations.
4. Generate editable definition drafts from batch profiles and save definitions transactionally.
5. Canonicalize and stage every validated `indicator_code + freq` slice.
6. Publish all valid slices by replacing only pairs present in the batch, then writing per-slice releases and `indicator_data_sources` records linked to the batch parent.

Detailed execution plan: `plans/geih-batch-ingest/README.md`.

### Phase 3/4: Explorer vertical slices — in progress

Build the new `/explore` route as a parallel prototype while leaving `/app` intact.

#### Slice 1: Single-indicator chartability loop — implemented, hardening continues

1. **Install and configure shadcn-svelte for the Explorer.** ✅
2. **Create the route:** `src/routes/(app)/explore/+page.server.ts` and `+page.svelte`. ✅
3. **Create `src/lib/server/explorer.ts`:** parse URL state, load catalog, resolve dimensions, compute chartability, query observations, and return chart-library-neutral series. ✅
4. **Top Discovery/data-scope controls:** data source narrowing, indicator combobox/search, Frequency selector. ✅
5. **Left Visualization controls:** Split dimension selector, dynamic dimension filters with All values option, Fixed dimension summary, unresolved-dimension guidance. ✅
6. **Chart surface:** Time axis selectors, Plotly rendering when chartable, empty/no-data/needs-selection states. ✅
7. **Share-link behavior:** repeated `indicator` params, uppercase dimension URL codes, `filter.{DIMENSION_CODE}` params, canonicalization of invalid state. ✅

#### Later Explorer slices

1. Multi-indicator comparison using common dimensions first; per-indicator overrides are future advanced behavior.
2. Excel/download export for the current Explorer state.
3. Saved collections or saved Explorer states.
4. Admin batch ingest UI built on top of the analyzer, definition-save, canonicalization, and publish APIs.

### Phase 5: External access (future)

1. API key authentication.
2. Programmatic ingest endpoint.
3. Scheduled export of `observations.duckdb` to R2/S3 for external download.

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| DuckDB native file corruption | High | Keep `data/` parquet archive read-only; nightly backup of `.duckdb` file; `db:seed` can rebuild from archive. |
| Schema migration for new dimensions | Medium | Reserve `ext_dimensions MAP(VARCHAR, VARCHAR)` as escape hatch; promote to first-class column only when a dimension is reused across multiple indicators. |
| Data scientist uploads bad data | Medium | Validation gate + preview + staging table; require explicit "publish" action; `data_releases` supports rollback. |
| Multi-indicator lineage becomes hard to audit | Medium | Add a batch parent record and link each per-indicator `data_releases` row back to the originating batch. |
| A flat file mixes indicators with incompatible dimension contracts | Medium | Validate the shared mapped dimension column set against every slice before staging. Reject ambiguous batches or require explicit fixed-total collapse. |
| Canonical table grows very large | Medium | DuckDB handles billions of rows; if needed, partition by `indicator_code` into separate files and use `UNION ALL` views. |
| Concurrent uploads | Low | SQLite handles metadata concurrency; DuckDB appends are safe if we use a connection queue or file locking. |

---

## 10. Decision Log

| Decision | Rationale |
|----------|-----------|
| **Wide table over EAV** | Columnar performance is the reason we use DuckDB/Parquet. EAV would force us to pivot at query time, destroying that advantage. |
| **DuckDB native file over many parquets** | Fewer files = lower I/O overhead, simpler backups, and a single object to expose to external data scientists. We can still export to parquet on demand. |
| **Keep metadata in SQLite** | Drizzle ORM, migrations, and admin CRUD are already built for SQLite. Moving metadata to DuckDB would require rebuilding the auth/admin stack. |
| **Data source over Area** | The top-level indicator parent is provenance-oriented, not a stable product taxonomy. `data_sources` replaces the legacy `areas` table, and public controls should say Data source. |
| **Source citation over source** | The parent origin is a Data source; indicator-specific provenance text is a Source citation stored as `source_citation`. |
| **Prepared statements instead of query builder** | Fixes the critical SQL injection vulnerability and is actually less code than our current string-concatenation approach. |
| **Dimension registry in SQLite** | Eliminates runtime `DESCRIBE` overhead and lets the UI be fully dynamic. The seed cost is paid once at ingestion, not on every metadata request. |
| **Explicit filters over implicit defaults in Explorer** | The Explorer should not guess user intent by silently applying totals such as `SEX='T'` or geography defaults such as `DEPT_CODE='00'`. Users choose filters explicitly; unresolved multi-value dimensions produce guidance instead of arbitrary charts. |
| **Frequency is per-observation, not per-indicator** | An indicator code can have both monthly and annual data without splitting into separate indicators. Frequency lives on each observation row. The `indicators.frequency` column is dropped entirely. |
| **Indicator frequencies are explicit definitions** | `indicator_frequencies` records every admin-defined `indicator + freq`, including dimensionless indicators. `indicator_dimensions` then records dimensions for that scope. |
| **Dimensions are per-indicator-frequency** | Monthly `EMP` can have an `URBAN_RURAL` breakdown while annual `EMP` does not. The registry keys dimensions by `(indicator_id, freq)`. |
| **Multi-indicator files are first-class** | The Observation schema is already keyed by `indicator_code` and `freq`; ingest should derive slices from the file rather than force admins to split natural exports and hand-type one indicator code per upload. |
| **Two-stage ingest: batch intake then canonical observations** | Canonical and source-shaped batch Parquet files can be accepted through an explicit analyzer/canonicalizer flow. Mappings are reviewed before publish; the canonical DuckDB table still stores only the Observation schema. |
| **Per-slice overwrite contract for batch uploads** | Batch publish replaces only the distinct `indicator_code + freq` pairs present in the batch. Other indicators/frequencies remain untouched. |
| **Lineage fan-out from batch parent to releases** | One uploaded file is tracked as an `ingest_batches` parent; publish emits one `data_releases` row and one or more `indicator_data_sources` rows per published indicator/frequency slice. |
| **Published visibility requires lineage and observations** | Public catalogs expose an indicator frequency only when `data_releases`/`indicator_data_sources` mark it published and the canonical store contains observations for the same indicator/frequency. Admin surfaces can still show saved definitions without observations. |
| **Serialized writes acceptable** | Only one upload runs at a time. This avoids DuckDB's lack of concurrent write support without adding async job queues in Phase 2. |
| **Explorer as SvelteKit vertical slice** | `/explore` uses server load as the primary composition layer instead of orchestrating internal REST calls from the browser. |
| **Chart-library-neutral series model** | The Explorer server layer returns domain chart series; Plotly-specific traces are built in the UI layer. |
| **Geographic labels from dimension values** | Explorer-facing labels for `GEO_LEVEL`, `DEPT_CODE`, and future `MUNI_CODE` come from `dimension_values`; see ADR 0002. |
| **shadcn-svelte for Explorer UI** | The Explorer uses shadcn-svelte as its component foundation; see ADR 0003. |

---

## 11. Open Questions

1. **When do we drop the legacy `indicators.frequency` column?**  
   *Recommendation:* After `/explore` and the remaining app surfaces read available frequencies from observations or `indicator_data_sources`.

2. **How should DANE geographic code labels be seeded?**  
   *Recommendation:* Save the DANE code reference locally, then seed `dimension_values` for `DEPT_CODE`, `MUNI_CODE`, and `GEO_LEVEL`. `departamentos` can be a seed source, but not the Explorer runtime label source.

3. **How should batch mapping rules be persisted and audited?**  
   *Recommendation:* Defer the persistence shape until the analyzer and definition-draft phases expose the real domain concepts. Phase 1 intentionally keeps `ingest_batches` / `ingest_batch_slices` as relational lineage only, without `profile_json` or `mappings_json` as source-of-truth columns. Candidate shapes for phases 2–3 include relational mapping tables, audited accepted-mapping snapshots, or both; promote reusable source-specific mapping templates only after repeated batches from the same Data source prove the rules are stable.

4. **Should fixed total dimensions be stored as dimensions or collapsed into dimensionless definitions?**  
   *Recommendation:* For v1, collapse GEIH-like national total slices into dimensionless definitions unless the source file contains multiple values for a dimension. Preserve fixed values in batch analysis metadata for audit.

5. **How much ingestion validation hardening is required before broad self-service?**  
   *Recommendation:* Add codelist enforcement that rejects unknown dimension values, duplicate-key detection, required registered-dimension enforcement, batch mapping previews, and clearer release rollback semantics before exposing upload/publish beyond trusted technical users.

6. **When should multi-indicator comparison support per-indicator overrides?**  
   *Recommendation:* Start with common dimensions only. Add per-indicator filter overrides only after the single-indicator Explorer and common-dimension comparison are stable.
