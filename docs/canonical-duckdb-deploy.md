# Canonical DuckDB deployment workflow

`observations.duckdb` is the canonical observation store used by `/explore` and the data APIs. Turso/libSQL stores metadata only; chart data comes from DuckDB.

The raw parquet layout carries geography in `REF_AREA` path segments/columns. During canonical rebuild, `REF_AREA` is preserved as `observations.ref_area` and normalized into the filter dimensions used by Explorer:

- `REF_AREA = 'CO'` → `geo_level = 'NAT'`, `dept_code = '00'`, `muni_code = '0000'`
- two-character `REF_AREA` → `geo_level = 'DEP'`, `dept_code = REF_AREA`
- five-character `REF_AREA` → `geo_level = 'MUN'`, `dept_code = first two chars`, `muni_code = REF_AREA`

## Runtime path order

The app opens the first available canonical file in this order:

1. `CANONICAL_DUCKDB_PATH`, when set
2. `$DATA_PATH/observations.duckdb`, when `DATA_PATH` is set and the file exists
3. `./data/observations.duckdb` packaged in the Docker image

Fly sets `DATA_PATH=/data`. If `/data/observations.duckdb` is absent, the app falls back to the packaged image copy.

## Local rebuild and validation

Rebuild from local parquet files under `data/`:

```bash
npm run canonical:rebuild
```

This builds to a temporary `.next-*` DuckDB file, validates it, then atomically replaces `data/observations.duckdb`.

Validate without rebuilding:

```bash
npm run canonical:validate
```

## Safe production update options

### Option A — packaged DuckDB via normal deploy

Use this when the file is small enough to ship with the app image.

```bash
npm run canonical:rebuild
npm run check
flyctl deploy --app colombia-en-datos-webapp-dark-dust-4694
```

This is the simplest and safest current workflow because app code and canonical data are deployed together.

### Option B — rebuild on the Fly volume

Use this when `observations.duckdb` becomes too large to package in the image.

1. Build a replacement file on the mounted Fly volume, without touching the live file:

```bash
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'DATA_PATH=/data CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:build && CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:validate'
```

2. Atomically promote the validated file:

```bash
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'mv /data/observations.duckdb.next /data/observations.duckdb'
```

3. Restart the machine so the cached DuckDB connection opens the new file:

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
flyctl logs --app colombia-en-datos-webapp-dark-dust-4694 --no-tail | rg 'canonical store|observations does not exist|DuckDB'
```

## Important notes

- Do not overwrite the live DuckDB file directly. Build `*.next`, validate it, then `mv` it into place.
- Restart after promoting a volume file; the app caches the DuckDB connection in process memory.
- Schema changes to Turso still need Drizzle migrations. Schema/data changes to `observations.duckdb` need this canonical rebuild/deploy workflow.
