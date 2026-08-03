# Phase 0 — port definition save: bring the primitive onto the main schema

## Goal

Port the useful definition-save behavior from the old `dev` branch onto the current `main` schema. This phase creates the reusable primitive that later batch phases call after the analyzer proposes Indicator frequency definitions.

## Prerequisites

None — first phase.

## Scope

### In scope

- Create a tested server module for parsing, validating, and saving definition grids.
- Target `main` schema names: `dataSources`, `indicatorGroups.dataSourceId`, `indicators.sourceCitation`, and `indicatorFrequencies`.
- Preserve all-or-nothing saves and existing-record safety rules from the old branch.
- Add the admin definition page shell only if it can be ported without pulling unrelated old-branch changes.

### Out of scope for this phase

- Batch Parquet analysis.
- Observation staging or publish.
- Source-to-canonical mapping.
- Any schema rename back to legacy `areas` / `source`.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/definition-ingest.ts` | create | Deep module for definition grid parsing, validation, and transactional saves. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/definition-ingest.test.ts` | create | Unit tests for parser/validator behavior. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/definition-ingest.save.test.ts` | create | DB-backed tests for transactional save and safety rules. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/admin-definition-catalog.ts` | create | Admin-only listing of definition frequencies, including unpublished definitions. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/ingest/definitions.ts` | create | Data source code normalization helper. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/ingest/+page.server.ts` | create | Thin SvelteKit load/action wrapper around the server module. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/ingest/+page.svelte` | create | Admin definition-save page. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/+layout.svelte` | modify | Add navigation to the ingest page if absent. |

## Steps

### 0.1 — Port module with schema corrections

Use the old `dev` branch as reference, but replace legacy imports/fields with `main` schema names.

> Expand during implementation: compare `dev:src/lib/server/definition-ingest.ts` with `main:src/lib/db/schema/indicators.ts` and port only relevant logic.

### 0.2 — Restore validation coverage

Port tests for required headers, optional fields, duplicate frequencies, dimension normalization, unknown dimensions, all-or-nothing behavior, and existing-record safety.

> Expand during implementation: adapt test database setup to the current `data_sources` and `source_citation` schema.

### 0.3 — Port admin listing and page shell

Add an admin route that saves definitions and lists existing definitions for one Data source, including unpublished definitions hidden from public discovery.

> Expand during implementation: keep UI simple; later batch UI may reuse but should not depend on this page being final.

### 0.4 — Verify public visibility remains gated

Ensure public indicator catalogs continue to require both published lineage and canonical observations.

> Expand during implementation: add or port a small unit test around catalog filtering if the helper exists.

## Success criteria

- `npm run check` passes.
- Definition-ingest tests pass.
- Saving a definition creates Data source, Indicator group, Indicator, `indicator_frequencies`, and `indicator_dimensions` rows using current schema names.
- Definition-only frequencies are visible in admin but not public Explorer/catalog surfaces.
- No code imports or writes legacy `areas` / `source` for new definition-save behavior.

## Context budget

Single session.

## Notes for the implementing session

The old `dev` branch had good behavior but stale schema. Treat it as reference, not a merge base.
