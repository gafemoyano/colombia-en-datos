# Phase 3 — definition drafts: turn batch profiles into saved definitions

## Goal

Generate editable Indicator frequency definition drafts from a batch profile, then save accepted definitions transactionally through the definition-save primitive. This bridges the observation half of a multi-indicator file with the metadata registry required by Explorer and publish validation.

## Prerequisites

- Phase 0 complete: definition-save primitive exists on the `main` schema.
- Phase 2 complete: analyzer returns stable batch profiles and derived slices.

## Scope

### In scope

- Convert analyzer slice summaries into definition-grid rows.
- Extract stable per-indicator `unit`, `unit_mult`, and `decimals` from measurement columns.
- Propose `dimensions` based on mapped dimension columns and fixed-total collapse policy.
- Save accepted definitions through the phase 0 module.
- Preserve existing-record safety rules: do not rename existing Data sources, groups, or Indicators accidentally.

### Out of scope for this phase

- Canonical row staging.
- DuckDB writes.
- Full admin UI; an API or server module seam is enough.
- Codelist editing UI.

## Files to create / modify

| Path | Action | Responsibility |
|---|---|---|
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/definition-drafts.ts` | create | Generate draft definition rows from analyzer output. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/batch-ingest/definition-drafts.test.ts` | create | Tests for measurement extraction, fixed-dimension policy, and save integration. |
| `/home/gafe/Projects/colombia-en-datos/src/lib/server/definition-ingest.ts` | modify | Add any small API needed to save generated rows without going through textarea-only plumbing. |
| `/home/gafe/Projects/colombia-en-datos/src/routes/api/admin/ingest/batches/stage/+server.ts` | create/modify | If introduced this phase, accept definitions and mappings before row staging. |

## Steps

### 3.1 — Define draft row format

Create a draft structure that can be rendered as a grid and converted into the phase 0 save input.

> Expand during implementation: include provenance fields such as source indicator code and analyzer warnings for admin review.

### 3.2 — Extract measurement fields

For each Indicator, require stable `UNIT`, `UNIT_MULT`, and `DECIMALS` values across all rows/frequencies in the batch before proposing metadata fields.

> Expand during implementation: reject mixed measurement values for the same Indicator unless a future model supports frequency/dimension-specific measurement metadata.

### 3.3 — Apply fixed-total dimension policy

If each candidate dimension has exactly one value for the file and the value is a total/default (`NAT`, `00`, `0000`, `T`, `TOTAL`, `NSA`), propose a dimensionless definition and preserve fixed values in profile metadata.

> Expand during implementation: make the recommendation visible so admins can override later if product chooses to support that.

### 3.4 — Save accepted definitions transactionally

Use the phase 0 definition-save primitive so generated definitions obey the same validation and existing-record safety rules as pasted definitions.

> Expand during implementation: decide whether accepted definition rows are saved before or during row staging; recommendation is before staging observations.

## Success criteria

- A GEIH-like profile generates one monthly definition draft per derived indicator.
- Measurement metadata is extracted into definition fields, not canonical observation rows.
- Fixed-total-only dimension columns can produce dimensionless definitions while preserving audit metadata.
- Accepted definitions save transactionally using current `main` schema names.
- Existing Indicators are not renamed or moved by generated drafts.

## Context budget

Single session.

## Notes for the implementing session

The old definition grid remains useful, but batch users should not have to hand-write it. They should review generated rows.
