# Canonical DuckDB deployment workflow

`observations.duckdb` is the canonical observation store used by `/explore` and the data APIs. Turso/libSQL stores metadata only; chart data comes from DuckDB.

The raw parquet layout carries geography in `REF_AREA` path segments/columns. During canonical rebuild, `REF_AREA` is preserved as `observations.ref_area` and normalized into the filter dimensions used by Explorer:

- `REF_AREA = 'CO'` → `geo_level = 'NAT'`, `dept_code = '00'`, `muni_code = '0000'`
- two-character `REF_AREA` → `geo_level = 'DEP'`, `dept_code = REF_AREA`
- five-character `REF_AREA` → `geo_level = 'MUN'`, `dept_code = first two chars`, `muni_code = REF_AREA`

## Runtime path resolution

The app resolves the canonical file in strict priority:

1. `CANONICAL_DUCKDB_PATH`, when set
2. `$DATA_PATH/observations.duckdb`, when `DATA_PATH` is set
3. `./data/observations.duckdb` (local dev only)

On Fly.io, `DATA_PATH=/data` and the volume is mounted at `/data`. The app **does not fall back** to an embedded copy if the volume file is missing — it will fail fast at startup.

## First-time volume bootstrap

The Docker image includes `data/observations.duckdb.template`. On first boot, if `/data/observations.duckdb` is absent, the app copies the template to the volume. This gives you a runnable baseline, but you should rebuild the canonical store from current parquet data as soon as possible.

## Schema versioning

The canonical store carries an internal `_meta` table with a `schema_version` key. The app checks this version on connection and refuses to start if it mismatches `CANONICAL_SCHEMA_VERSION` (defined in `src/lib/server/duckdb.ts`).

When you need to change the DuckDB schema (add columns, new indexes, etc.):

1. Bump `CANONICAL_SCHEMA_VERSION` in `src/lib/server/duckdb.ts`.
2. Update `scripts/create-canonical-store.ts` to emit the new schema.
3. Update `scripts/validate-canonical-store.ts` `REQUIRED_SCHEMA_VERSION` to match.
4. Rebuild the canonical store (`npm run canonical:rebuild`).
5. Deploy the new image (which validates the new schema at runtime).

## Local rebuild and validation

Rebuild from local parquet files under `data/`:

```bash
npm run canonical:rebuild
npm run data:backfill-releases
```

This builds to a temporary `.next-*` DuckDB file, validates it, then atomically replaces `data/observations.duckdb`. The backfill command creates published `data_releases` and `indicator_data_sources` rows for existing canonical observations so public catalogs can expose published indicator frequencies.

Validate without rebuilding:

```bash
npm run canonical:validate
```

## Production update workflow

Data updates are decoupled from code deploys. You rebuild the DB directly on the Fly volume.

### 1. Build a replacement file on the volume

```bash
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'DATA_PATH=/data CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:build && CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:validate'
```

### 2. Atomically promote the validated file

```bash
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'mv /data/observations.duckdb.next /data/observations.duckdb'
```

### 3. Restart the machine

The app caches the DuckDB connection in process memory, so a restart is required to open the new file:

```bash
flyctl machine restart 2865655f1633e8 --app colombia-en-datos-webapp-dark-dust-4694
```

## Health check commands

Check the deployed page uses the canonical store:

```bash
curl -fsSL 'https://colombia-en-datos-webapp-dark-dust-4694.fly.dev/explore?indicator=hogares_por_vivienda&filter.URBAN_RURAL=T' | rg 'plotly-chart|La selección todavía no es graficable'
```

Check logs for canonical-store failures:

```bash
flyctl logs --app colombia-en-datos-webapp-dark-dust-4694 --no-tail | rg 'canonical store|observations does not exist|DuckDB|schema version'
```

## Important notes

- Do not overwrite the live DuckDB file directly. Build `*.next`, validate it, then `mv` it into place.
- Restart after promoting a volume file; the app caches the DuckDB connection in process memory.
- Schema changes to Turso still need Drizzle migrations. Schema/data changes to `observations.duckdb` need the canonical rebuild workflow above.
- Because Fly volumes are tied to specific machines, you currently run a single persistent machine (`auto_stop_machines = 'off'`). Scaling to multiple machines requires either replicated volumes (one per machine) or moving to a shared backend (e.g. MotherDuck, S3-attached DuckDB).
