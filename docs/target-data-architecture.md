# Target Data Architecture: Universal Observation Schema

> Status: Proposal — awaiting review before implementation.
>
> Scope: How we store, ingest, and query indicator observations so that **end users can explore data in the browser** and **data scientists can self-service load new indicators** without engineering intervention.

---

## 1. Current State Analysis

### What works today

| Strength | Detail |
|----------|--------|
| Columnar storage | Parquet gives us compression and fast column scans via DuckDB. |
| Metadata admin | `/admin` lets curators edit Spanish annotations (name, description, methodology). |
| Runtime dimension discovery | `DESCRIBE` on parquet files finds dimensions (URBAN_RURAL, SEX, etc.) dynamically. |
| Decoupled metadata | SQLite stores indicator definitions; parquet stores observations. |

### What is broken or limiting

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

### Data flow today (simplified)

```
Data scientist has new indicator
    ↓
Writes parquet files to data/<area>/...  (manually, via Python script)
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

3. **Self-service ingestion**  
   A data scientist with a CSV/Excel/Parquet file should be able to upload, map columns, fix validation errors, and publish — entirely through the `/admin` UI — without asking engineering to run a script.

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

-- indicator_dimensions
-- Which dimensions apply to a given indicator+freq combination, and their defaults.
indicator_id   INTEGER REFERENCES indicators(id)
freq           VARCHAR NOT NULL      -- 'M', 'A', 'Q', 'D', or '*' for all frequencies
dimension_code VARCHAR
default_value  VARCHAR      -- e.g. 'T' for URBAN_RURAL total
is_filterable  BOOLEAN DEFAULT TRUE
is_splitable   BOOLEAN DEFAULT TRUE  -- can be used as a "by" / trace-split dimension
PRIMARY KEY (indicator_id, freq, dimension_code)

-- data_releases
-- Audit trail / lineage for every batch of data loaded.
id             INTEGER PRIMARY KEY
indicator_id   INTEGER REFERENCES indicators(id)
release_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
period_start   VARCHAR       -- earliest time_period in this batch
period_end     VARCHAR       -- latest time_period in this batch
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

```
Data scientist opens /admin/upload
    ↓
Uploads CSV / Excel / Parquet
    ↓
System detects columns, suggests mappings
    ↓
Data scientist confirms/adjusts mappings
    ↓
System validates (required columns, type checks, dimension codelists)
    ↓
System previews first 20 rows
    ↓
Data scientist publishes
    ↓
System inserts into observations.duckdb
    ↓
System registers dimensions in indicator_dimensions
    ↓
Indicator is live immediately in the app
```

### 4.2 Upload API

```typescript
// POST /api/admin/ingest/upload
// multipart/form-data
// Body: file, indicatorCode, freq
// Response: { jobId, detectedColumns, sampleRows }

// POST /api/admin/ingest/validate
// Body: { jobId }
// Response: { valid, errors[], warnings[], rowCount, preview[] }

// POST /api/admin/ingest/publish
// Body: { jobId, releaseNotes? }
// Response: { releaseId, indicatorCode, freq, rowsInserted }
```

### 4.3 Upload schema contract

Data scientists are responsible for transforming their source data into the system's **Observation schema** before upload. The system does not perform column mapping.

The uploaded file must contain at minimum these columns:

| Required column | Type | Example |
|-----------------|------|---------|
| `indicator_code` | VARCHAR | `'EMP'` |
| `freq` | VARCHAR | `'M'`, `'A'` |
| `ref_area` | VARCHAR | `'CO'` |
| `time_period` | VARCHAR | `'2019-01'` (for M), `'2019'` (for A) |
| `obs_value` | DOUBLE | `12345.6` |

The file may also contain any dimensions registered for this **indicator + freq** combination. If a registered dimension column is missing, the upload is rejected.

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

### 4.4 Validation rules

1. `indicator_code` must match an existing indicator.
2. `freq` must match the frequencies registered for this indicator's dimensions (or `'*'` wildcard dimensions).
3. `time_period` must match the declared `freq` (YYYY-MM for M, YYYY for A, YYYY-QN for Q).
4. `obs_value` must be numeric (nulls allowed).
5. All columns present in the file must be either required columns, registered dimensions for this indicator+freq, or `obs_status`.
6. Dimension values must exist in `dimension_values` or be auto-registered with a machine label (flagged for curation).
7. Duplicate primary keys (same indicator, freq, time, dimensions) are rejected. Uploads are always full replacement for the indicator+freq combination.

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

## 6. Frontend Changes

### 6.1 Dynamic dimension selectors

`DimensionSelector.svelte` should consume `/api/dims/[indicator]` which now returns enriched objects instead of raw strings:

```json
{
  "indicator": "EMP",
  "dimensions": [
    {
      "code": "URBAN_RURAL",
      "name": "Zona",
      "isSplitable": true,
      "isFilterable": true,
      "values": [
        { "code": "T", "label": "Total" },
        { "code": "U", "label": "Urbano" },
        { "code": "R", "label": "Rural" }
      ]
    }
  ]
}
```

The component renders selects dynamically. Adding a new dimension to the registry automatically makes it appear in the UI for every indicator that uses it.

### 6.2 Share links and URL state

Because the dimension set is dynamic, URL parameters for filters should use a stable prefix or JSON blob:

```
/app?indicator=EMP&indicator=EMP_F&freq=M&by=URBAN_RURAL&filter.urban_rural=U&filter.sex=F
```

This is already partially supported; we just need to make the parsing dynamic based on the registered dimensions.

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

### Phase 1: Foundation (1–2 weeks)

1. **Schema migration**  
   - Add `dimension_definitions`, `dimension_values`, `indicator_dimensions`, `data_releases`, `indicator_data_sources` tables.
   - Seed standard dimensions and values from existing parquet data.

2. **Canonical store creation**  
   - One-time script: load all existing parquet into `observations.duckdb`.
   - Verify row counts match.

3. **SQL injection fix**  
   - Rewrite `queryTimeSeries()` to use prepared statements.
   - Add Vitest tests for the query builder.

4. **Dimension registry API**  
   - Replace runtime `DESCRIBE` with SQLite registry lookups.
   - Return enriched dimension objects from `/api/dims/[indicator]`.

### Phase 2: Ingestion API (2–3 weeks)

1. **Upload endpoint**  
   - `POST /api/admin/ingest/upload` accepts Parquet (CSV/Excel in future).
   - Body: `file`, `indicatorCode`, `freq`.
   - Returns detected columns + sample rows for preview.

2. **Validation engine**  
   - Verify file columns match the indicator+freq registered dimensions.
   - Type checks, codelist enforcement, duplicate-key detection.
   - Return preview + error list before publish.

3. **Publish flow**  
   - `DELETE FROM observations WHERE indicator_code = X AND freq = Y`.
   - `INSERT` new observations into `observations.duckdb`.
   - Write `data_releases` record.
   - Invalidate any caches.

4. **Indicator creation endpoint**  
   - `POST /api/indicators` with `code`, `name`, `areaCode`, `groupCode`, `dimensionsByFreq`.
   - Inline area/group creation if they don't exist.

### Phase 3: Query migration (1 week)

1. Switch `/api/data` to query `observations.duckdb` instead of scattered parquet files.
2. Remove `indicator_files` table usage from the hot path (keep for archival reference).
3. Benchmark query performance; add DuckDB indexes if needed.

### Phase 4: Dynamic frontend (1 week)

1. Rewrite `DimensionSelector.svelte` to use registry-driven dimension objects.
2. Remove hardcoded dimension codelists from the component.
3. Implement share-link serialization for dynamic filters.

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
| Canonical table grows very large | Medium | DuckDB handles billions of rows; if needed, partition by `indicator_code` into separate files and use `UNION ALL` views. |
| Concurrent uploads | Low | SQLite handles metadata concurrency; DuckDB appends are safe if we use a connection queue or file locking. |

---

## 10. Decision Log

| Decision | Rationale |
|----------|-----------|
| **Wide table over EAV** | Columnar performance is the reason we use DuckDB/Parquet. EAV would force us to pivot at query time, destroying that advantage. |
| **DuckDB native file over many parquets** | Fewer files = lower I/O overhead, simpler backups, and a single object to expose to external data scientists. We can still export to parquet on demand. |
| **Keep metadata in SQLite** | Drizzle ORM, migrations, and admin CRUD are already built for SQLite. Moving metadata to DuckDB would require rebuilding the auth/admin stack. |
| **Prepared statements instead of query builder** | Fixes the critical SQL injection vulnerability and is actually less code than our current string-concatenation approach. |
| **Dimension registry in SQLite** | Eliminates runtime `DESCRIBE` overhead and lets the UI be fully dynamic. The seed cost is paid once at ingestion, not on every metadata request. |
| **Default values for missing dimensions** | Data scientists should not have to know that `SEX='T'` is required. The ingestion pipeline fills sensible defaults. |
| **Frequency is per-observation, not per-indicator** | An indicator code can have both monthly and annual data without splitting into separate indicators. Frequency lives on each observation row. The `indicators.frequency` column is dropped entirely. |
| **Dimensions are per-indicator-frequency** | Monthly `EMP` can have an `URBAN_RURAL` breakdown while annual `EMP` does not. The registry keys dimensions by `(indicator_id, freq)`. |
| **Data scientists transform files before upload** | The system does not perform column mapping. Data scientists produce files that already match the observation schema. This keeps the upload API simple and unambiguous. |
| **Overwrite contract for uploads** | Each upload fully replaces all observations for the given `indicator_code + freq` combination. The canonical table is the only persistent store; original files are not archived. |
| **Serialized writes acceptable** | Only one upload runs at a time. This avoids DuckDB's lack of concurrent write support without adding async job queues in Phase 2. |

---

## 11. Open Questions

1. **Should we keep the `data/` directory as the primary storage and use `observations.duckdb` only as a query acceleration cache?**  
   *Recommendation:* No. Having two primary stores creates sync complexity. Treat the DuckDB file as canonical and the old directory as an archival snapshot.

2. **How do we handle updates to existing data (e.g., DANE revises 2023 employment figures)?**  
   *Recommendation:* Uploads specify a date range. Publishing a new release for the same indicator and overlapping periods uses `INSERT OR REPLACE` semantics in DuckDB. The old release row is kept in `data_releases` for audit, but its observations are overwritten.

3. **Should dimensions be global or per-area?**  
   *Recommendation:* Global. `SEX` means the same thing in employment and quality-of-life surveys. The codelist may vary slightly (e.g. some sources use `M`/`F`, others `1`/`2`), but the dimension definition is shared. Mapping tables in the ingestion layer handle source-specific codes.

4. **Do we need a staging/QA environment for uploaded data?**  
   *Recommendation:* Phase 2 includes a `status = 'staged'` state. A future enhancement could add a `/admin/review` queue where a second curator approves before `status = 'published'`.
