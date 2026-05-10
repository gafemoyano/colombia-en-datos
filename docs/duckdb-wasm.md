# DuckDB WASM Migration Plan (Phase 2)

> **Status**: Not started — planned for after production environment is stable.
>
> **Goal**: Move DuckDB analytics entirely client-side, enabling deployment on Vercel or any static-friendly platform.

---

## Why DuckDB WASM?

Our current architecture runs DuckDB on the server (Node.js native bindings) against local Parquet files. This is fast and elegant, but it locks us into containerized deployments (Fly.io, Railway, etc.) because:

1. The `duckdb` npm package uses native C++ bindings that are heavy and platform-specific
2. Parquet files (616MB total) must live on a persistent filesystem
3. Each deploy must include the data layer

DuckDB WASM runs entirely in the browser. This unlocks:

- **Serverless deployment** (Vercel, Netlify, Cloudflare Pages)
- **No cold starts** for analytics queries
- **Zero server-side compute** for data visualization
- **Lower hosting costs** — only metadata APIs run server-side
- **Better geographic distribution** — data is fetched from a CDN, not a single server

---

## Architecture Overview

### Current (Server-Side DuckDB)

```
Browser → SvelteKit Server → DuckDB Node.js → local Parquet files
                ↓
         PostgreSQL/SQLite (metadata)
```

### Target (Client-Side DuckDB WASM)

```
Browser → SvelteKit/Vercel (metadata APIs only)
                ↓
         Turso / SQLite (metadata — small, fast)

Browser (client-side):
  → Load DuckDB WASM bundle (~30MB, cached)
  → Fetch Parquet files from R2/S3 over HTTP
  → Run SQL queries in browser
  → Render with Plotly (already client-side)
```

---

## File Size Reality Check

Our 616MB of parquet is spread across **34,997 files** — that's an **average of ~18KB per file**.

A typical query touches 5–15 files (one or two indicators across a few years). That's **~100–300KB of parquet data** per chart render. On a decent connection, this downloads in well under a second.

DuckDB WASM itself is ~30MB but **heavily cached** by the browser after first load.

---

## Implementation Steps

### Step 1: Move Parquet Files to Object Storage

**Target**: Cloudflare R2 (free tier: 10GB storage, 10M reads/month)

- Upload all `data/` parquet files to an R2 bucket
- Enable public access or signed URLs
- URLs will look like: `https://<account>.r2.dev/empleo/FREQ=M/INDICATOR=EMP/REF_AREA=CO/part-2019.parquet`

**Keep local `data/` for development** — use environment variable to switch between local paths and R2 URLs.

### Step 2: Add DuckDB WASM Dependency

```bash
npm install @duckdb/duckdb-wasm
```

Remove server-side DuckDB:
```bash
npm uninstall duckdb
```

### Step 3: Create Client-Side DuckDB Service

New file: `src/lib/duckdb-wasm/client.ts`

Responsibilities:
- Lazily instantiate DuckDB WASM on first use
- Maintain a singleton database instance
- Provide `queryTimeSeries()` and `getIndicatorMetadata()` functions
- Accept R2 URLs instead of local file paths

Example API shape:
```ts
export async function queryTimeSeriesWASM(
  params: TimeSeriesQueryParams,
  fileUrls: string[]    // R2 URLs fetched from metadata API
): Promise<IndicatorData[]>

export async function getIndicatorMetadataWASM(
  fileUrl: string
): Promise<IndicatorMetadata | null>
```

### Step 4: Rewrite Metadata API Routes

The server-side API routes become thinner:

- `GET /api/indicators` — unchanged (queries Turso/SQLite)
- `GET /api/meta/[indicator]` — returns metadata from SQLite, plus **R2 file URLs**
- `GET /api/dims/[indicator]` — returns available dimensions from SQLite
- `GET /api/departamentos` — unchanged
- `DELETE /api/data` — **remove entirely** (data queries move client-side)

New endpoint:
- `GET /api/files?indicator=X&freq=M&ref_area=CO&start=2019&end=2024` — returns array of R2 URLs for the relevant parquet files

### Step 5: Rewrite `+page.svelte` Data Flow

Current flow:
```ts
// Server-side
const response = await fetch(`/api/data?${params}`)
const result = await response.json()
```

New flow:
```ts
// Client-side
import { queryTimeSeriesWASM } from '$lib/duckdb-wasm/client'

// 1. Fetch metadata + file URLs from server
const [meta, fileUrls] = await Promise.all([
  fetch(`/api/meta/${indicator}?freq=${freq}`).then(r => r.json()),
  fetch(`/api/files?indicator=${indicator}&...`).then(r => r.json())
])

// 2. Load DuckDB WASM (cached after first call)
// 3. Query parquet files directly in browser
const data = await queryTimeSeriesWASM(params, fileUrls)

// 4. Transform to Plotly format (same as now)
chartData = transformToPlotly(data)
```

### Step 6: Update Scanner for R2

Current `scanner.ts` walks the local filesystem. For R2, create `src/lib/server/scanner-r2.ts`:

- Lists objects via R2/S3 API instead of `fs.readdir`
- Parses object keys to extract area, category, frequency, indicator, ref_area, year
- Same output shape as current `ParquetFile[]`

The seed script (`seed-indicators.ts`) would run against R2 in a one-off script or CI step.

### Step 7: Migrate Metadata DB to Turso

With the server now only handling metadata, Turso (libsql) is a natural fit:

- **Free tier**: 500 databases, 9GB storage per database
- **Edge-distributed**: queries served from the nearest region
- **Drop-in replacement**: change `better-sqlite3` → `@libsql/client`, update `DATABASE_URL` to `libsql://...`

The Drizzle schema files already use `sqlite-core`, so the migration is minimal:

```ts
// src/lib/db/client.ts
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

const client = createClient({ url: env.DATABASE_URL })
export const db = drizzle(client, { schema })
```

### Step 8: Deployment on Vercel

With server-side DuckDB removed:

- Use `@sveltejs/adapter-vercel` or `@sveltejs/adapter-auto`
- Metadata APIs run as Vercel Serverless Functions
- Static assets served from Vercel Edge Network
- Parquet files served from R2 (Cloudflare's CDN)

Update `svelte.config.js`:
```js
import adapter from '@sveltejs/adapter-vercel'
// or adapter-auto
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DuckDB WASM bundle too large | Medium | High | Lazy-load only on `/app` route; show loading spinner |
| First query slower than server-side | High | Medium | Pre-warm DuckDB on app page load; cache aggressively |
| CORS issues with R2 | Low | High | Configure R2 bucket CORS rules properly |
| Mobile performance | Medium | Medium | Warn users on slow connections; offer "server-rendered" fallback |
| DuckDB WASM missing Node features | Low | High | Test all query patterns before migrating; `read_parquet` over HTTP is supported |
| Data volume growth | Low | Medium | R2 free tier is 10GB; we currently use ~600MB |

---

## Open Questions

1. **Does DuckDB WASM support `read_parquet('https://...')`?**
   
   Yes, DuckDB WASM supports reading parquet over HTTP. However, we should verify performance with our specific file sizes and query patterns.

2. **Should we keep server-side DuckDB as a fallback?**
   
   Possibly. A hybrid approach where mobile/slow clients hit a server-side API while desktop clients use WASM could be ideal. This adds complexity though.

3. **How do we handle the seed script with R2?**
   
   The scanner and seed script would need to run in a CI environment (GitHub Actions) with R2 credentials, or locally by the developer. The seeded metadata would be written to Turso.

4. **What about the `by` parameter (dimension splitting)?**
   
   This is purely a SQL query concern. As long as DuckDB WASM supports the same SQL syntax as Node DuckDB (it does), dimension splitting works identically.

---

## Migration Order of Operations

1. **Set up R2 bucket** and upload parquet files
2. **Verify DuckDB WASM** in a proof-of-concept page (read one parquet file, render one chart)
3. **Build `scanner-r2.ts`** and test file enumeration
4. **Create `/api/files` endpoint** that returns R2 URLs
5. **Build client-side DuckDB service** (`duckdb-wasm/client.ts`)
6. **Rewrite `+page.svelte`** to use client-side queries
7. **Remove `/api/data` endpoint** and server-side `duckdb.ts`
8. **Migrate metadata DB to Turso** (optional — can stay on SQLite/local if desired)
9. **Switch SvelteKit adapter to Vercel**
10. **Deploy and monitor performance**

---

## Effort Estimate

| Task | Estimate |
|------|----------|
| R2 setup + parquet upload | 2 hours |
| DuckDB WASM POC | 4 hours |
| Scanner rewrite for R2 | 3 hours |
| Client-side query service | 6 hours |
| API route refactoring | 3 hours |
| Frontend integration + testing | 4 hours |
| Turso migration (optional) | 2 hours |
| **Total** | **~24 hours** |

---

## When to Do This

**Trigger conditions:**

- ✅ Production is stable on Fly.io + SQLite
- ✅ Feature gaps from `FEATURE_PLAN.md` are mostly closed
- ✅ We want to move to Vercel for cost, CDN, or ecosystem reasons
- ✅ We have time for a 2–3 day focused migration sprint

**Do not do this if:**

- The current Fly.io + SQLite setup is working well and costs are acceptable
- We're in active feature development that would conflict with the refactor
- We haven't validated DuckDB WASM performance with our actual parquet files
