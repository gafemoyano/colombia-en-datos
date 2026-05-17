# Handoff: Phase 1 Complete — Target Data Architecture

> Date: 2026-05-16
> Phase: 1 of 5 (Foundation) complete
> Status: Ingestion pipeline ready for Phase 2

---

## What This Project Is

**Colombia en Datos** — A SvelteKit app for visualizing Colombian statistical indicators (DANE employment, EMICRON SME, quality of life surveys). Two surfaces: a public landing page (`/`) and an interactive charting dashboard (`/app`).

**Tech stack:** SvelteKit 2.43 + Svelte 5 runes, TypeScript, Tailwind, Plotly.js. SQLite (Drizzle ORM) for metadata. DuckDB for analytical queries. Fly.io deployment.

---

## Key Architectural Decisions (Locked)

| Decision | Rationale |
|----------|-----------|
| **One canonical DuckDB file** (`data/observations.duckdb`) | Replaces 34,997 scattered parquet files. All observation data in one table. Escape hatches (partitioned parquet, multiple attached DBs) documented for future scale. |
| **Wide table, not EAV** | `indicator_code`, `freq`, `ref_area`, `time_period`, `obs_value`, standard dimensions, + 3 reserved `ext_1/2/3` columns. Preserves columnar performance. |
| **Frequency is per-observation, not per-indicator** | Same indicator code can have `M` and `A` data. `indicators.frequency` column dropped (nullable during migration). |
| **Dimensions are per-indicator-frequency** | `indicator_dimensions` PK = `(indicator_id, freq, dimension_code)`. Monthly EMP can have different dimensions than annual EMP. |
| **Explicit dimension registration** | Data scientist specifies `dimensionsByFreq` when creating an indicator. Upload validates against this registry. No auto-detection. |
| **Data scientists transform files before upload** | System does zero column mapping. Upload must match observation schema exactly. API-first, not web-wizard. |
| **Overwrite contract** | Each upload fully replaces observations for `indicator_code + freq`. `data_releases` is audit-only. |
| **Serialized writes** | Only one upload at a time. DuckDB lacks concurrent write support; acceptable for Phase 2. |
| **Basic auth for ingest API** | Reuse existing `ADMIN_USERNAME`/`ADMIN_PASSWORD` hooks. Works for `curl` and browser. |
| **Gatekeeping for unknown dimensions** | Unknown dimensions go to `ext_dimensions MAP` (escape hatch). No UI filters until promoted to first-class column. |

---

## Domain Language (from CONTEXT.md)

- **Indicator** — A statistical measure selectable and visualizable over time. *Not* "metric" or "variable".
- **Indicator annotation** — Spanish human-facing context (name, description, methodology).
- **Observation dimension** — A category that slices observations (URBAN_RURAL, SEX, AGE).
- **Data scientist** — Technical user who creates indicators via API. Responsible for transforming files to match schema.
- **Curator** — Non-technical user who edits Spanish annotations in `/admin`.
- **Measurement format** — Unit, scale, display precision. Per-indicator (series never vary unit).
- **Frequency** — Per-observation property. Same indicator can have M and A data.

---

## Current Schema (SQLite)

### Existing tables (from before Phase 1)
- `areas`, `indicator_groups`, `indicators`, `indicator_files` (legacy), `departamentos`, `users`

### New tables (Phase 1)

```sql
dimension_definitions   -- Registry of known dimensions (code, name, sort_order, is_standard)
dimension_values        -- Codelists (dimension_code, code, label_es, sort_order)
indicator_dimensions    -- Which dims apply to which indicator+freq (indicator_id, freq, dimension_code, default_value, is_filterable, is_splitable)
data_releases           -- Audit trail (indicator_id, release_date, row_count, checksum, status)
indicator_data_sources  -- Canonical store slice reference (indicator_id, ref_area, freq, year_min, year_max, row_count, release_id)
```

---

## Current Schema (DuckDB canonical store)

```sql
CREATE TABLE observations (
    indicator_code VARCHAR NOT NULL,
    freq VARCHAR NOT NULL,
    ref_area VARCHAR NOT NULL DEFAULT 'CO',
    time_period VARCHAR NOT NULL,
    obs_value DOUBLE,
    geo_level VARCHAR,
    dept_code VARCHAR,
    muni_code VARCHAR,
    urban_rural VARCHAR,
    sex VARCHAR,
    age VARCHAR,
    adjustment VARCHAR,
    ext_1 VARCHAR,      -- Reserved for future dimensions
    ext_2 VARCHAR,
    ext_3 VARCHAR,
    obs_status VARCHAR DEFAULT 'A'
);
CREATE INDEX idx_obs_indicator_freq ON observations(indicator_code, freq, ref_area);
CREATE INDEX idx_obs_time ON observations(time_period);
```

**Scale:** 42,329 rows from 34,997 source files. 242 indicators. 2 frequencies (M, A).

---

## Phase 1 Implementation

### 1. Schema migration ✅
- Added 5 new tables to `src/lib/db/schema/indicators.ts`
- Applied via `npx drizzle-kit push --force`
- `indicators.frequency` made nullable (will be dropped in Phase 3)

### 2. Dimension registry seed ✅
- Script: `scripts/seed-dimensions.ts`
- Scanned 242 sample parquet files (one per indicator)
- Registered 7 dimensions: GEO_LEVEL, DEPT_CODE, MUNI_CODE, URBAN_RURAL, SEX, AGE, ADJUSTMENT
- 1,694 indicator_dimension combinations seeded

### 3. Canonical store creation ✅
- Script: `scripts/create-canonical-store.ts`
- Creates `data/observations.duckdb`
- Worked around DuckDB Node.js bug: `=` in file paths triggers auto-discovery of unrelated parquet files. Solution: copy files to temp dir or use absolute paths without `=` characters.
- All 42,329 rows loaded with indexes

### 4. SQL injection fix ✅
- `src/lib/server/duckdb.ts` completely rewritten
- **Old:** String interpolation `WHERE TIME_PERIOD >= '${startDate}'`
- **New:** DuckDB prepared statements `stmt.all(param1, param2, callback)`
- Query builder constructs parameterized queries with `?` placeholders

### 5. Query migration ✅
- `queryTimeSeries()` now queries `observations.duckdb` directly
- No file-looping. No `DESCRIBE` at runtime.
- Dimension filters validated against registry before being applied

### 6. Dimension registry API ✅
- `GET /api/dims/[indicator]?freq=M` returns enriched objects:
  ```json
  {
    "indicator": "EMP",
    "dimensions": [
      {
        "code": "URBAN_RURAL",
        "name": "Zona",
        "isFilterable": true,
        "isSplitable": true,
        "values": [{"code": "T", "labelEs": null}, ...]
      }
    ]
  }
  ```

---

## Verified Endpoints

```bash
# Data query (prepared statements)
GET /api/data?indicator=EMP&freq=M&ref_area=CO
→ 296 rows

# Dimension registry
GET /api/dims/EMP?freq=M
→ 7 dimensions with values

# Metadata (from SQLite, no parquet DESCRIBE)
GET /api/meta/EMP?freq=M
→ name, unit, methodology, availableDimensions
```

---

## Critical Technical Details

### DuckDB Node.js path bug
DuckDB's Node.js binding has a bug where paths containing `=` (like `INDICATOR=EMP`) trigger auto-discovery of unrelated parquet files in `node_modules/`. **This affects direct file reads but NOT the canonical store** (which lives at `data/observations.duckdb` with a clean path).

If you ever need to read individual parquet files in Node.js, use:
- `read_parquet('file.parquet', union_by_name=true)` to suppress the error, OR
- Copy the file to a temp path without `=` characters before reading.

### Prepared statement API
DuckDB Node.js uses callbacks, not promises:
```typescript
const stmt = db.prepare('SELECT * FROM observations WHERE indicator_code = ? AND freq = ?');
stmt.all('EMP', 'M', (err, rows) => {
  // rows is array
});
```

### Environment variables
```bash
DATABASE_URL=file:./drizzle/db.sqlite    # Local dev
# DATABASE_URL=libsql://...               # Production Turso
# TURSO_AUTH_TOKEN=...                    # Production only
DUCKDB_PATH=./data
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

---

## Files Modified / Created

```
src/lib/db/schema/indicators.ts          # Added 5 new tables
src/lib/db/schema/index.ts               # Re-exports
src/lib/server/duckdb.ts                 # Completely rewritten (prepared statements, canonical store)
src/routes/api/dims/[indicator]/+server.ts  # Returns enriched dimension objects

scripts/seed-dimensions.ts               # Seeds dimension registry from parquet
scripts/create-canonical-store.ts        # Builds observations.duckdb
scripts/analyze-dims.ts                  # Diagnostic (can delete)
scripts/check-multi-freq.ts              # Diagnostic (can delete)

data/observations.duckdb                 # Canonical store (not in git)

docs/target-data-architecture.md         # Full architecture proposal
docs/scalability-analysis.md             # Scale projections and escape hatches
docs/handoff-phase1.md                   # This file
```

---

## Phase 2: Ingestion API (Next)

### Tasks
1. **`POST /api/indicators`** — Create indicator with `code`, `name`, `areaCode`, `groupCode`, `dimensionsByFreq`
2. **`POST /api/admin/ingest/upload`** — Accept Parquet, validate columns match registry, preview
3. **`POST /api/admin/ingest/publish`** — `DELETE WHERE indicator_code=X AND freq=Y`, then `INSERT` into canonical store
4. **Update `/admin` indicator list** — Show frequency availability per indicator (query canonical store for distinct freq values)

### API shape
```typescript
// POST /api/indicators
{
  code: "NEW_IND",
  name: "Nuevo Indicador",
  areaCode: "ambiente",
  groupCode: "calidad_aire",
  dimensionsByFreq: {
    "A": ["GEO_LEVEL", "DEPT_CODE"],
    "M": ["GEO_LEVEL", "DEPT_CODE", "URBAN_RURAL"]
  }
}

// POST /api/admin/ingest/upload
// multipart/form-data
// Body: file (Parquet), indicatorCode, freq
// Response: { valid, errors[], rowCount, preview[] }

// POST /api/admin/ingest/publish
// Body: { uploadId, releaseNotes? }
// Response: { releaseId, rowsInserted }
```

### Key constraint
- One upload at a time (serialized). DuckDB file lock.
- Upload fully replaces `indicator_code + freq` observations.
- Validation: all file columns must be required columns or registered dimensions for that indicator+freq.
- `time_period` format must match `freq` (YYYY-MM for M, YYYY for A).

---

## Open Questions from Phase 1

1. Should we add a `dimension_values` label seed script? Currently all labels are `null`.
2. Should we migrate existing `indicator_files` table data into `indicator_data_sources`?
3. When do we drop the legacy `indicators.frequency` column? (Phase 3, after query layer fully migrated)
4. Do we need `GET /api/indicators` to return available frequencies per indicator? (Yes, for Phase 2 UI)

---

## How to Resume

```bash
# Start dev server
cd /home/gafe/Projects/colombia-en-datos
DATABASE_URL=file:./drizzle/db.sqlite TURSO_AUTH_TOKEN= npm run dev

# Verify canonical store
node -e "const d=require('duckdb'); const b=new d.Database('data/observations.duckdb'); b.all('SELECT COUNT(*) as c FROM observations',(e,r)=>console.log('Rows:',Number(r[0].c)))"

# Verify dimension registry
sqlite3 drizzle/db.sqlite "SELECT COUNT(*) FROM indicator_dimensions"
```
