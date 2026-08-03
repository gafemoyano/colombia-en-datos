# Phase 6 — admin batch UI: review, stage, and publish natural multi-indicator files

## Goal

Build the admin UI that lets users upload one natural multi-indicator Parquet file, review analyzer output, accept/edit generated definitions and mappings, stage canonical slices, and publish the batch.

## Prerequisites

- Phase 0 complete: definition-save primitive exists.
- Phase 2 complete: analyzer exists.
- Phase 3 complete: definition drafts can be saved.
- Phase 4 complete: staging exists.
- Phase 5 complete: publish exists.

## Scope

### In scope

- Admin page/flow for batch upload and analysis.
- Profile summary: rows, indicators, frequencies, period coverage, dimensions, measurement fields, warnings.
- Definition draft review/edit UI.
- Mapping review UI for source-shaped files.
- Stage and publish actions.
- Clear messages explaining per-slice replacement semantics and lineage fan-out.

### Out of scope for this phase

- Non-admin access model.
- CSV/Excel upload.
- Mapping-template management.
- Rich spreadsheet-like editing beyond simple tables/forms.
- Public Explorer changes beyond visibility already handled by backend.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/ingest/batches/+page.server.ts` | create | Server load/actions or endpoint orchestration for batch flow. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/ingest/batches/+page.svelte` | create | Admin UI for upload, profile review, definitions, staging, and publish. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/admin/+layout.svelte` | modify | Add navigation for batch ingest. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/components/admin/_TBD_.svelte` | create | Optional extracted components for profile/definition/mapping tables. |

## Steps

### 6.1 — Create batch ingest route shell

Add an admin route that accepts file upload and displays analyzer results.

> Expand during implementation: choose form actions vs JSON endpoints based on what previous phases exposed.

### 6.2 — Show profile and slice summary

Render derived `indicator_code + freq` slices, row counts, periods, measurement fields, dimension candidates, duplicate-key status, and warnings.

> Expand during implementation: make the "file is already multi-indicator" model obvious to admins.

### 6.3 — Add definition and mapping review

Let admins edit generated definitions and accept explicit mappings before staging.

> Expand during implementation: avoid large grid complexity; prefer a simple review table that can be improved later.

### 6.4 — Add stage and publish controls

Wire stage and publish actions with clear confirmation copy: publish replaces only slices present in this batch and leaves other indicators untouched.

> Expand during implementation: display per-slice lineage outcomes after publish.

## Success criteria

- Admin can upload a GEIH-like multi-indicator file without splitting it.
- UI shows all derived indicators/frequencies from the file.
- UI does not ask the admin to type one global `indicatorCode` for the batch.
- Admin can review/edit generated definitions and mappings before staging.
- Admin can publish a staged batch and see per-slice results.
- Error states are actionable and preserve the batch context for retry.

## Context budget

Single session if backend phases are complete; otherwise split UI shell and final wiring.

## Notes for the implementing session

The UI should teach the new concept: uploaded file = batch; batch contains slices; publish replaces present slices and fans lineage out.
