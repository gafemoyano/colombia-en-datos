# Handoff: Explorer Next Phase — Reactive UX

> Date: 2026-05-16
> Status: `/explore` slice 1 exists, but needs UX hardening
> Focus: make the Explorer feel reactive and product-grade, not form-driven

---

## Current Context

We are building a parallel **Explorer view** at `/explore` while keeping the existing `/app` dashboard intact. The Explorer is the new SvelteKit fullstack vertical slice for selecting indicators, resolving observation dimensions, and rendering Plotly time-series charts from the canonical DuckDB observation store.

The project now intentionally uses the same metadata infrastructure as production in development: **Turso/libSQL**, not the local `drizzle/db.sqlite` fallback. `drizzle.config.ts` now loads `.env` and requires `DATABASE_URL`.

Current configured Turso dev DB was force-pushed with Drizzle and verified:

```txt
areas: 3
indicator_groups: 37
indicators: 242
dimension_definitions: 7
dimension_values: 29
indicator_dimensions: 1694
data_releases: 0
indicator_data_sources: 0
```

---

## Domain / Product Decisions Already Made

Key glossary terms are in `CONTEXT.md`:

- **Explorer view** — end-user workspace for choosing indicators and visualizing observations.
- **Discovery controls** — controls used to choose/narrow the Indicator.
- **Visualization controls** — controls used to constrain/split observations.
- **Explicit filter choice** — user-selected dimension constraint.
- **All values option** — UI-only option that removes a dimension constraint; distinct from source-provided totals like `SEX=T`.
- **Split dimension** — dimension selected to create separate visual series.
- **Fixed dimension** — dimension with only one applicable value for the current Explorer state, excluding date range.
- **Chartable selection** — state where every observation maps unambiguously to one point in one series.

Important rules:

1. `/explore` is URL-state-first.
2. URL uses repeated `indicator` params, but first slice supports one indicator.
3. Dimension URL params use uppercase registry codes:
   - `by=SEX`
   - `filter.DEPT_CODE=05`
4. Omitting a filter param means **All values**, not source-provided total.
5. If a dimension is both filtered and used as `by`, filter wins.
6. Date range affects chart observations but not dimension value availability.
7. Chart renders only when all multi-value applicable dimensions are filtered, split, or fixed.
8. Future multi-indicator comparison starts with common dimensions only.

Relevant ADRs:

- `docs/adr/0002-geography-labels-from-dimension-values.md`
- `docs/adr/0003-shadcn-svelte-for-explorer-ui.md`

---

## What Exists Now

### shadcn-svelte foundation

Initialized shadcn-svelte with Tailwind v4 theme tokens.

Files/config:

```txt
components.json
src/app.css
src/lib/utils.ts
src/lib/components/ui/*
```

Generated components include button, card, input, label, badge, alert, select, command, popover, dialog, separator, textarea, input-group.

### Explorer route

```txt
src/routes/(app)/explore/+page.server.ts
src/routes/(app)/explore/+page.svelte
src/lib/server/explorer.ts
```

Server layer currently does:

- parses URL state
- loads indicator catalog from Turso
- loads available frequencies from `observations.duckdb`
- loads registered dimensions from Turso
- loads available dimension values from DuckDB observations
- identifies fixed/unresolved/filtered/split dimensions
- canonicalizes safe invalid URL states
- returns chart-library-neutral series

UI currently has:

- top discovery/data-scope row
- area dropdown
- indicator datalist text input
- frequency dropdown
- left visualization panel
- split selector
- dynamic dimension filters
- fixed dimensions summary
- chartability guidance
- Plotly chart when chartable

---

## Known UX Problem

The current UI still feels form-driven:

- It uses a `<form method="GET">` with `onchange={submitExplorer}`.
- Some controls only update on blur/enter.
- Indicator search is a native `datalist`, not a proper combobox.
- The remaining submit buttons make the flow feel non-reactive.
- The page reload/navigation is visible enough to feel janky.

The next phase must make the Explorer **reactive**:

> Selecting values should update the URL and graph automatically without requiring the user to press buttons.

Buttons can remain only as no-JS progressive fallback if we deliberately keep a fallback form, but they should not be part of the primary interaction.

---

## Next Phase Goal

Build a product-grade reactive Explorer interaction loop.

### UX acceptance criteria

1. Choosing an area immediately narrows the indicator combobox.
2. Choosing an indicator immediately updates URL state and available frequencies.
3. Choosing frequency immediately updates dimensions and chartability state.
4. Choosing a split dimension immediately updates URL state and chart/chartability.
5. Choosing a dimension value immediately updates URL state and chart/chartability.
6. Choosing **Todos los valores** removes the corresponding `filter.{DIMENSION_CODE}` param.
7. Date edits update the chart without requiring a button, preferably on blur or short debounce.
8. URL remains shareable and canonical.
9. No “Actualizar” button is needed for normal use.
10. Existing `/app` and `/admin` keep compiling.

---

## Recommended Implementation Plan

### 1. Replace form-driven GET with SvelteKit navigation helpers

Use client-side `goto()` from `$app/navigation` to update search params.

Create small helpers in `+page.svelte` or a component-local utility:

```ts
function navigateWith(mutator: (params: URLSearchParams) => void) {
  const params = new URLSearchParams(page.url.searchParams);
  mutator(params);
  goto(`/explore?${params.toString()}`, {
    keepFocus: true,
    noScroll: true,
    replaceState: false
  });
}
```

Use `replaceState: true` for high-frequency edits like date typing/debounced search; use normal push for committed selections.

### 2. Use real shadcn combobox for Indicator discovery

Replace native `datalist` with shadcn-svelte `Popover + Command`:

- area select narrows command items
- command item selection sets `indicator`
- selecting a new indicator should clear visualization params that may no longer apply:
  - `freq` unless still valid? Prefer clear or set if only one available frequency.
  - `by`
  - all `filter.*`
  - date range can remain, but this is debatable

### 3. Split Explorer UI into components

Suggested component extraction:

```txt
src/lib/components/explorer/IndicatorCombobox.svelte
src/lib/components/explorer/ExplorerControls.svelte
src/lib/components/explorer/DimensionFilter.svelte
src/lib/components/explorer/ExplorerChart.svelte
src/lib/components/explorer/ChartStateMessage.svelte
```

Keep `src/lib/server/explorer.ts` as the server-side product model builder.

### 4. Improve server model for reactive UI

Add convenience fields to the Explorer model if useful:

- `availableIndicatorsForArea`
- `validFrequencies`
- `canonicalHref`
- `dimension.disabledReason`
- `nextActions` for chartability guidance

Do not move interaction state into stores unless needed; URL remains source of truth.

### 5. Date range behavior

Date range should be chart-local.

Recommended behavior:

- controlled local input state for `start` and `end`
- debounce URL updates by ~400ms or update on blur/Enter
- invalid date formats should not crash; show guidance

### 6. Keep canonical redirect, but avoid redirect loops

`+page.server.ts` currently redirects when `model.canonicalSearch !== currentSearch`. Keep this, but ensure client-side navigation helpers produce canonical params as much as possible to avoid extra round-trips.

---

## Current Technical Caveats

1. `src/lib/server/explorer.ts` catches missing dimension registry and renders a warning, but in normal Turso dev the tables are now present.
2. `dimension_values` currently has sparse labels (`label_es` often null). UX will show raw codes until geography/codelist seed work improves labels.
3. `observations.duckdb` remains local file-based. Turso stores metadata only.
4. `/explore` currently uses generated shadcn components but not the richer `Command/Popover` controls yet.
5. The existing local PascalCase UI primitives still exist for compile preservation; new product work should use shadcn-generated directories.

---

## Useful Commands

```bash
# Run dev using .env Turso dev DB
npm run dev

# Type/Svelte check
npm run check

# Build
npm run build

# Push schema to Turso dev DB; dev DB can be force-pushed
npm run db:push -- --force

# Verify Turso phase tables
node - <<'NODE'
import { config } from 'dotenv';
import { createClient } from '@libsql/client';
config({ quiet: true });
const client = createClient({ url: process.env.DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
for (const table of ['dimension_definitions','dimension_values','indicator_dimensions']) {
  const rs = await client.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  console.log(table, Number(rs.rows[0].c));
}
NODE
```

---

## Suggested Smoke URLs

Needs chartability resolution:

```txt
/explore?indicator=NUM_SME_CTA_PROP&freq=A
```

Chartable with explicit filters:

```txt
/explore?indicator=NUM_SME_CTA_PROP&freq=A&filter.GEO_LEVEL=NAT&filter.DEPT_CODE=00&filter.MUNI_CODE=0000&filter.URBAN_RURAL=T&filter.SEX=T&filter.AGE=TOTAL&filter.ADJUSTMENT=NSA
```

Canonicalization check — filter wins over split:

```txt
/explore?indicator=NUM_SME_CTA_PROP&freq=A&by=SEX&filter.SEX=T
```

Expected redirect to:

```txt
/explore?indicator=NUM_SME_CTA_PROP&freq=A&filter.SEX=T
```
