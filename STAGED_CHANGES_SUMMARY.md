# Summary of Staged Changes

This document summarizes the changes currently staged on the `main` branch.

---

## 1. Canonical DuckDB Store — Core Data Architecture

**Goal**: Replace on-the-fly Parquet file scanning with a single, pre-built DuckDB file (`observations.duckdb`) that serves as the canonical observation store for chart data.

### What changed

| File | Change |
|------|--------|
| `data/observations.duckdb` | New binary — the canonical observation store (~2.9 MB). |
| `scripts/create-canonical-store.ts` | Major rewrite. Now supports environment-based paths (`DATA_PATH`, `CANONICAL_DUCKDB_PATH`, `CANONICAL_BUILD_PATH`) and builds atomically to a `.next-*` temp file before renaming into place. Added geography normalization logic (see below). |
| `scripts/validate-canonical-store.ts` | **New file.** Validates the canonical store: checks table/column existence, ensures non-empty data, and prints a JSON summary of row counts, indicators, frequencies, date range, etc. |
| `docs/canonical-duckdb-deploy.md` | **New file.** Documents the rebuild/validate workflow, runtime path resolution, safe production update options (packaged deploy vs. volume rebuild), and health check commands. |
| `package.json` | Three new scripts: `canonical:build`, `canonical:validate`, `canonical:rebuild`. |
| `Dockerfile` | Copies `data/observations.duckdb` into the production image so the app can use the packaged canonical store. |

### Geography normalization during build

The canonical builder normalizes raw `REF_AREA` values into structured filter dimensions:

| `REF_AREA` | `geo_level` | `dept_code` | `muni_code` |
|------------|-------------|-------------|-------------|
| `CO` | `NAT` | `00` | `0000` |
| 2 chars (e.g. `05`) | `DEP` | `REF_AREA` | `NULL` |
| 5 chars (e.g. `05001`) | `MUN` | first 2 chars | `REF_AREA` |

Existing Parquet columns `GEO_LEVEL`, `DEPT_CODE`, `MUNI_CODE` are used when present; otherwise they are derived from `REF_AREA`.

### Runtime path resolution

`src/lib/server/duckdb.ts` now resolves the canonical store path in this priority:
1. `CANONICAL_DUCKDB_PATH` env var
2. `$DATA_PATH/observations.duckdb` (if `DATA_PATH` is set and file exists)
3. `./data/observations.duckdb` (packaged fallback)

---

## 2. SQLite Schema Migrations — Phase 1 Registry

Two new Drizzle migrations were generated and staged.

### Migration 0003: `phase1_registry`

Adds the foundational metadata/registry tables:

- **`dimension_definitions`** — Registry of filter dimensions (`GEO_LEVEL`, `DEPT_CODE`, `MUNI_CODE`, `URBAN_RURAL`, `SEX`, `AGE`, `ADJUSTMENT`, etc.).
- **`dimension_values`** — Per-dimension value labels (e.g. `NAT` → "Nacional", `DEP` → "Departamental").
- **`indicator_dimensions`** — Junction table declaring which dimensions apply to which indicators (and per-frequency defaults, filterable/splittable flags).
- **`data_releases`** — Tracks data uploads/releases per indicator (release date, period coverage, row count, source, status, checksum).
- **`indicator_data_sources`** — Maps indicators to available geographic/frequency coverage (year min/max, row count, release link).

Also recreates the `indicators` table (to add/drop columns cleanly) and enforces `UNIQUE INDEX indicators_code_unique`.

### Migration 0004: `fix_antioquia_departamento_code`

Fixes the DANE code for Antioquia in the `departamentos` table:
- Changes `06` → `05`
- Prevents duplicate-key issues with an existence guard

---

## 3. Explorer Backend Updates

`src/lib/server/explorer.ts` was updated to work with the new canonical store and multi-geography data.

### Key changes

- **Removed hardcoded `REF_AREA = 'CO'` filter** — The Explorer now queries all `ref_area` values, enabling department/municipal-level charts.
- **Hardcoded geography dimension labels** — When `GEO_LEVEL`, `DEPT_CODE`, or `MUNI_CODE` are requested, the backend injects sensible defaults:
  - `GEO_LEVEL`: `NAT` → "Nacional", `DEP` → "Departamental", `MUN` → "Municipal"
  - `DEPT_CODE`: `00` → "Colombia", plus all rows from the `departamentos` table
  - `MUNI_CODE`: `0000` → "Todos los municipios"
- **Imports `departamentos` schema** to resolve department names dynamically.

---

## 4. Data Fix: Antioquia Department Code

The static CSV and the database now agree on Antioquia's code:

| File | Change |
|------|--------|
| `static/departamentos.csv` | `06;ANTIOQUIA` → `05;ANTIOQUIA` |
| `drizzle/0004_fix_antioquia_departamento_code.sql` | Same correction applied to SQLite table |

---

## 5. UI Polish

`src/lib/components/ui/select/select-content.svelte`
- Added `max-h-[var(--bits-select-content-available-height)]` so dropdown menus respect the available viewport height and scroll correctly instead of overflowing.

---

## 6. Tooling & Environment

| File | Change |
|------|--------|
| `.tool-versions` | Node.js `24.3.0` → `24.15.0` |
| `package.json` | New scripts for canonical store workflow (see §1) |
| `drizzle/meta/_journal.json` | Entries for migrations 0003 and 0004 |

---

## Deployment Notes

- The canonical DuckDB file is now **packaged in the Docker image** and used at runtime.
- On Fly.io, if `DATA_PATH=/data` is set and `/data/observations.duckdb` exists, that volume copy takes precedence over the packaged one.
- To update production data safely, either:
  1. **Rebuild locally** → `npm run canonical:rebuild` → `fly deploy` (simplest), or
  2. **Rebuild on the volume** via SSH, validate, `mv` into place, and restart the machine (for large files).

---

## Files Changed (15 files)

```
 .tool-versions
 Dockerfile
 data/observations.duckdb
 docs/canonical-duckdb-deploy.md          [new]
 drizzle/0003_phase1_registry.sql         [new]
 drizzle/0004_fix_antioquia_departamento_code.sql [new]
 drizzle/meta/0003_snapshot.json          [new]
 drizzle/meta/_journal.json
 package.json
 scripts/create-canonical-store.ts
 scripts/validate-canonical-store.ts      [new]
 src/lib/components/ui/select/select-content.svelte
 src/lib/server/duckdb.ts
 src/lib/server/explorer.ts
 static/departamentos.csv
```
