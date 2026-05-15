# Indicator annotations implementation plan

This plan captures the decisions resolved during the grilling session for making Colombia en Datos more user friendly through relational, admin-editable indicator context.

## Decisions resolved

- Use **Indicator annotation** as the domain term for Spanish human-facing context about an indicator. Avoid using "metadata" as domain language.
- Store annotations in SQLite as the runtime source of truth. Parquet files, folder names, and JSON catalogs are bootstrap inputs only.
- Use `indicators.name` as the public Spanish indicator title; `indicators.code` remains the stable machine identifier.
- Extend `indicators` with explicit annotation and measurement columns instead of keeping annotation data in JSON.
- Rename `categories` to **Indicator groups** because folder/catalog groupings are source-derived context, not generic categories.
- Remove the unused old user `collections` tables rather than reusing that ambiguous term.
- Use Spanish (`es-CO`) content only; do not add localization tables yet.
- Keep `frequency` singular because no indicator in `data/` currently has multiple frequencies.
- Store `unit`, `unitMult`, and `decimals` on `indicators` because current data shows these are stable per indicator.
- Compute "needs attention" in the admin UI instead of persisting review state.
- Build a simple `/admin` UI in this SvelteKit app, protected by basic auth (`ADMIN_USERNAME` + `ADMIN_PASSWORD`/`ADMIN_TOKEN`; dev defaults to `admin`/`admin`), using SvelteKit form actions.
- Update the public app immediately to use annotation names in the selector, chart traces, and metadata panel.
- Keep DuckDB as the core analytics layer for querying parquet observations and slicing indicators by observation dimensions; only metadata/annotation lookups should avoid requiring DuckDB at module load time.

See also: [ADR 0001](./adr/0001-relational-indicator-annotations.md).

## Data sources for bootstrap seeding

Priority order for initial values:

1. `data/metadata/metadata_with_collections.json`
   - good employment annotations
   - EMICRON source/unit/default visualization/group membership
   - `collections` become **Indicator groups** after normalization
2. Existing parquet/folder structure
   - ECV folders and parquet columns provide group/source-table context
   - `UNIT`, `UNIT_MULT`, `DECIMALS` seed measurement format
3. Rule-based Spanish humanization
   - especially for raw EMICRON codes like `NUM_SME_STARTED_BY_FAMILY`
4. Raw code fallback
   - displayed as needing attention in admin

Bootstrap seeding must be idempotent: it may create missing records, but must not overwrite existing annotation fields after they exist in the database.

## Schema target

### `areas`

Keep as top-level data domains with human names:

- `empleo` → `Empleo`
- `emicron` → `Empresas (EMICRON)`
- `calidad_vida` → `Calidad de vida`

### `indicator_groups`

Replacement for `categories`.

Columns:

- `id`
- `areaId`
- `code`
- `name`
- `description`
- `sourceType` (`folder`, `metadata_collection`, `source_table`, etc.)
- `filterWhitelist` JSON array
- timestamps

Unique by `(areaId, code)`.

### `indicators`

Columns:

- `code`
- `indicatorGroupId`
- `name`
- `shortName`
- `description`
- `methodology`
- `frequency`
- `source`
- `unit`
- `unitMult`
- `decimals`
- `defaultViz`
- `updated`
- timestamps

`metadata` JSON should stop being used.

## Admin UI target

- `/admin`: searchable/filterable indicator list with computed attention prompts.
- `/admin/indicators/[code]`: edit form for name, short name, description, methodology, source, unit, unit multiplier, decimals, default visualization, updated marker, and notes if added later.
- Group/source context should be visible; group data is mostly source-derived and not the primary editing target.

Attention prompts are computed from fields, e.g. title missing/raw/machine-like or description/methodology missing.

## Public app target

- `/api/indicators` returns human `name`, group, and area.
- Indicator selector displays `name`, with code as secondary text.
- Chart trace names use `shortName || name || code`.
- Metadata panel displays Spanish labels and DB-backed annotation fields.
- `/api/meta/[indicator]` reads unit/decimals/annotation fields from SQLite instead of querying parquet for measurement metadata.
