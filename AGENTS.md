# AGENTS.md — Colombia en Datos (Frontend)

A concise guide for AI agents (and humans) working on this codebase.

---

## Project Overview

Full-stack SvelteKit web application for visualizing Colombian demographic, economic, and statistical indicators. Two main surfaces:

1. **Landing page** (`/`): Spanish-language marketing site with scroll sections
2. **App dashboard** (`/app`): Interactive time series charting with Plotly.js

**Deployment**: Fly.io via Docker (`fly.toml`). App name: `colombia-en-datos-webapp-dark-dust-4694`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit 2.43.2 + Svelte 5.39.5 (runes-based) |
| Language | TypeScript 5.9.2 |
| Build | Vite 7.1.7 |
| Styling | Tailwind CSS 4.1.14 + `app.css` |
| Charts | Plotly.js-dist-min 3.1.2 |
| Testing | Vitest 3.2.4 + jsdom (configured, but **zero tests exist**) |
| Lint/Format | ESLint 9 + Prettier 3.6 (`tabs`, `singleQuote`, `no trailing commas`, `printWidth: 100`) |
| Adapter | `@sveltejs/adapter-node` (SSR, not static) |
| Node version | 24 (Docker: `node:24-bookworm`) |

### Data Stack

| Layer | Technology |
|-------|-----------|
| Metadata DB | **SQLite** via `drizzle-orm/better-sqlite3` |
| Analytics | DuckDB 1.4.1 (in-memory `:memory:` instance) |
| Time Series | Apache Parquet files (columnar, on-disk) |
| ORM | Drizzle ORM 0.44.6 |
| Migrations | Drizzle Kit 0.31.5 (`drizzle.config.ts`) |

⚠️ **Important**: `docs/architecture.md` may still mention PostgreSQL. The actual runtime stack is **SQLite**.

---

## Directory Structure

```
frontend/
├── src/
│   ├── app.html                    # HTML template
│   ├── app.css                     # Global Tailwind + custom CSS vars
│   ├── app.d.ts                    # SvelteKit ambient types
│   ├── plotly.d.ts                 # Plotly type augmentations
│   ├── routes/
│   │   ├── (landing)/+page.svelte  # Marketing landing page
│   │   ├── (app)/
│   │   │   ├── +layout.svelte      # App shell (header, gray bg)
│   │   │   └── app/
│   │   │       ├── +page.ts        # Load: fetches /api/indicators
│   │   │       └── +page.svelte    # Main dashboard (chart, selectors, filters)
│   │   └── api/
│   │       ├── indicators/+server.ts        # GET all indicators
│   │       ├── data/+server.ts              # GET time series data
│   │       ├── meta/[indicator]/+server.ts  # GET indicator metadata
│   │       ├── dims/[indicator]/+server.ts  # GET available dimensions
│   │       ├── departamentos/+server.ts     # GET departments list
│   │       └── contact/+server.ts           # POST contact form (stub)
│   └── lib/
│       ├── components/             # Reusable Svelte components
│       │   ├── PlotlyChart.svelte
│       │   ├── IndicatorSelector.svelte
│       │   ├── DimensionSelector.svelte
│       │   └── MetadataDisplay.svelte
│       ├── db/
│       │   ├── client.ts           # Cached getDb() singleton (SQLite)
│       │   ├── script-client.ts    # Direct db export for CLI scripts
│       │   └── schema/
│       │       ├── index.ts        # Re-exports all schemas
│       │       ├── indicators.ts   # indicators + indicatorFiles tables
│       │       ├── users.ts        # users table (auth-ready)
│       │       ├── collections.ts  # collections + collectionIndicators
│       │       └── departamentos.ts# Colombian departments
│       ├── server/
│       │   ├── duckdb.ts           # Core data access (~350 lines)
│       │   ├── scanner.ts          # Parquet file directory scanner
│       │   ├── seed-indicators.ts  # Seed script logic
│       │   └── seed-departamentos.ts
│       ├── stores/
│       │   └── indicators.ts       # Minimal writable stores
│       └── landing/                # Landing page components + data
│           ├── components/*.svelte
│           ├── data/indicators_catalog.json
│           └── icons.ts
├── data/                           # Parquet files (not in repo, mounted on Fly.io)
│   ├── empleo/                     # Employment data
│   ├── emicron/                    # SME data (category-based dirs)
│   └── encuesta_calidad_vida/      # Quality of life surveys
├── drizzle/                        # Migration SQL files + SQLite database file
├── scripts/                        # One-off and seed scripts
├── docs/                           # Architecture docs (Mermaid diagrams)
├── static/                         # Static assets
├── build/                          # SvelteKit build output
├── Dockerfile                      # Multi-stage Node build
├── fly.toml                        # Fly.io deployment config
└── FEATURE_PLAN.md                 # Detailed feature gap analysis
```

---

## Key Patterns

### Svelte 5 Runes

All components use Svelte 5 runes. Do **not** use legacy `$:` reactive declarations.

```svelte
<script lang="ts">
  interface Props { data: SomeType }
  let { data }: Props = $props()

  let count = $state(0)
  let doubled = $derived(count * 2)

  $effect(() => {
    // side effects when dependencies change
  })
</script>
```

### API Routes

Simple file-based REST endpoints. Export `GET`/`POST` handlers returning `json()`:

```ts
// src/routes/api/example/+server.ts
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, params }) => {
  // ...
  return json({ result })
}
```

### Database Access

Always use the cached singleton:

```ts
import { getDb } from '$lib/db/client'
const db = getDb()
```

For scripts (outside SvelteKit), use:

```ts
import { db } from '$lib/db/script-client'
```

### DuckDB Queries

DuckDB is instantiated once as an in-memory singleton (`:memory:`). It queries Parquet files by path.

**⚠️ CRITICAL SECURITY ISSUE**: The query builder in `src/lib/server/duckdb.ts` interpolates user-supplied URL parameters directly into SQL strings. Date values, dimension names, and filter values are concatenated without parameterization. **Sanitize or parameterize before handling production data.**

Example of the risky pattern (do not replicate):
```ts
// CURRENT CODE — VULNERABLE
whereConditions.push(`TIME_PERIOD >= '${startDate}'`)  // startDate from URL
```

---

## Data Flow

```
User selects indicators + filters
    ↓
+page.svelte makes parallel fetch() calls:
  → GET /api/meta/{indicator}      (metadata + dimensions)
  → GET /api/data?indicator=X&...  (time series)
    ↓
API routes delegate to duckdb.ts
    ↓
DuckDB:
  1. Queries SQLite for indicator metadata + file paths
  2. Filters files by year + ref_area
  3. For each parquet file: DESCRIBE columns → SELECT with WHERE
  4. Aggregates, sorts, returns
    ↓
+page.svelte transforms to Plotly format → <PlotlyChart>
```

---

## Database Schema

Uses `drizzle-orm/sqlite-core` (SQLite).

### Tables

| Table | Purpose |
|-------|---------|
| `areas` | Top-level data domains (e.g., empleo, emicron) |
| `categories` | Sub-domains within areas |
| `indicators` | Indicator definitions (code, name, frequency, source, metadata JSON) |
| `indicator_files` | Maps indicators to parquet file paths (year, ref_area) |
| `departamentos` | Colombian departments (code, name) |
| `users` | User accounts (email, password_hash, name) |
| `collections` | User-created indicator groups |
| `collection_indicators` | Junction table (collections ↔ indicators) |

### Environment

```bash
DATABASE_URL=./drizzle/db.sqlite   # Local dev path
DUCKDB_PATH=../data                # Path to parquet root directory
```

On Fly.io production, `DATABASE_URL=/data/db.sqlite` (persistent volume).

---

## Parquet File Conventions

Parquet files live under `data/<area>/` with two possible structures:

**Direct FREQ structure** (e.g., `data/empleo/`):
```
data/empleo/FREQ=M/INDICATOR=EMP/REF_AREA=CO/part-2019.parquet
```

**Category-based structure** (e.g., `data/emicron/`):
```
data/emicron/A1.10_SME_OWNSTAT/FREQ=A/INDICATOR=SME_OWNSTAT/REF_AREA=CO/part-2019.parquet
```

Scanner (`scanner.ts`) auto-detects structure by checking for `FREQ=` directories at the area root.

---

## Available Scripts

```bash
npm run dev              # Vite dev server
npm run build            # Production build
npm run preview          # Preview production build
npm run check            # svelte-check + TypeScript
npm run lint             # ESLint
npm run format           # Prettier
npm run test             # Vitest (no tests exist yet)
npm run db:generate      # Generate Drizzle migrations
npm run db:migrate       # Run migrations
npm run db:push          # Push schema directly
npm run db:studio        # Drizzle Studio GUI
npm run db:seed          # Seed indicators from data/ directory
```

---

## Feature Roadmap

See `FEATURE_PLAN.md` for full details. Key gaps:

| Feature | Status |
|---------|--------|
| Multi-indicator charts | ✅ Done |
| Date range + frequency filters | ✅ Done |
| URBAN_RURAL dimension (`by` param) | ✅ Partial (backend done, frontend selector exists) |
| Metadata display | ✅ Partial (component exists, API done) |
| Share links (URL state) | ❌ Missing |
| Excel download | ❌ Missing |
| Collections | ❌ Missing |
| Auto frequency detection | ❌ Missing |
| SEX, AGE, ADJUSTMENT dimensions | ❌ Missing |

---

## Important Gotchas

1. **SQLite, not PostgreSQL**: All schema files use `sqliteTable`. The database is a single SQLite file.
2. **SQL Injection Risk**: DuckDB queries interpolate URL parameters directly. Fix before production.
3. **No Tests**: Vitest configured but zero test files. Add tests for `duckdb.ts` first.
4. **No GitHub Templates/CI**: No `.github/` directory. No issue templates, PR templates, or workflows.
5. **DuckDB is In-Memory**: Each Fly.io instance gets its own `:memory:` DuckDB. Queries are fast but stateless.
6. **Node 24**: Requires Node 22.12+. Docker uses `node:24-bookworm`.
7. **Tabs, not Spaces**: Prettier uses tabs. Respect this.
8. **Contact API is a Stub**: `POST /api/contact` just returns `{ok: true}` — no email is sent.
