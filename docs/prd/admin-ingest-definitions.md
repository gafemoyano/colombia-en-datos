> Status note, 2026-06-21: This PRD remains valid as the **definition-save primitive** and phase 0 of `plans/geih-batch-ingest/README.md` has now ported it onto the current `main` schema. The implemented slice adds `/admin/ingest`, a tested deep `definition-ingest` module, the admin definition catalog, and writes through `data_sources`, `indicator_groups.data_source_id`, `indicators.source_citation`, explicit `indicator_frequencies`, and `indicator_dimensions`. It is still not the recommended final user-facing GEIH workflow: the batch-first flow should analyze source-shaped multi-indicator Parquet files and generate reviewed definitions before staging or publishing observations.

## Problem Statement

Data scientists need a fast, reliable way to create many Indicator definitions for a Data source before uploading observations. Today, creating an Indicator is API-oriented and one-at-a-time, while the desired workflow is a Data-source-scoped admin page where a data scientist can paste around 20 Indicator frequency definitions from a spreadsheet, validate them all at once, and save them without exposing incomplete definitions to the public Explorer.

The platform now models provenance as **Data source → Indicator group → Indicator → Indicator frequency → Observations**. The next implementation slice should make that model usable in the admin UI for definition creation only. Uploading Parquet files and publishing observations are intentionally later slices.

## Solution

Build a single admin ingestion page for saving Indicator frequency definitions for one Data source at a time.

The page lets an admin/data scientist enter or select a Data source using a lowercase snake-case Data source code and a name, paste a header-based tabular definition grid, validate every row, and save the full set all-or-nothing. After saving, the page reloads scoped to the selected Data source and shows all Indicator frequencies defined for that Data source, including unpublished definitions that are hidden from the public Explorer.

The core parsing and validation logic should live in a deep, testable server module with a stable interface. The SvelteKit page action should be a thin orchestration layer around that module.

## User Stories

1. As a Data scientist, I want to create a Data source with a code and name, so that the Indicators I define have clear provenance.
2. As a Data scientist, I want the Data source code to normalize to lowercase snake-case, so that I do not need to manually format slugs.
3. As a Data scientist, I want to see the normalized Data source code before saving, so that I know the stable identity being created.
4. As a Data scientist, I want to define many Indicator frequencies on one page, so that I do not have to use a one-Indicator-at-a-time workflow.
5. As a Data scientist, I want to paste rows from a spreadsheet using headers, so that I can prepare definitions in familiar tools.
6. As a Data scientist, I want header-based paste validation, so that column order mistakes do not silently corrupt definitions.
7. As a Data scientist, I want the required headers to be `indicator_code`, `freq`, `name`, and `dimensions`, so that the minimum definition contract is explicit.
8. As a Data scientist, I want optional headers for group, annotation, and measurement format fields, so that richer catalog data can be saved when I already have it.
9. As a Data scientist, I want an empty `dimensions` cell to mean no Observation dimensions, so that dimensionless Indicators are easy to define.
10. As a Data scientist, I want comma-separated dimension codes, so that the dimensions cell is concise and predictable.
11. As a Data scientist, I want pasted dimension codes to be trimmed and uppercased before validation, so that small casing or spacing differences do not fail unnecessarily.
12. As a Data scientist, I want unknown Observation dimension codes to be rejected, so that I do not create definitions the Explorer cannot support.
13. As a Data scientist, I want all row errors reported with row numbers and fields, so that I can fix my pasted grid quickly.
14. As a Data scientist, I want the save operation to be all-or-nothing, so that partial definition sets are not created when some rows are invalid.
15. As a Data scientist, I want blank group fields to default to a group named after the Data source, so that simple Data sources do not require meaningless grouping work.
16. As a Data scientist, I want source-native Indicator group codes to be preserved, so that source tables, sheets, and collection identifiers remain traceable.
17. As a Data scientist, I want Indicator codes to preserve casing, so that source-native or existing Indicator code conventions remain intact.
18. As a Data scientist, I want Indicator codes to remain globally unique, so that public URLs and query parameters can identify an Indicator unambiguously.
19. As a Data scientist, I want multiple frequencies for the same Indicator code to be allowed, so that monthly and annual observations can share Indicator identity.
20. As a Data scientist, I want Indicator annotations to be shared across frequencies of the same Indicator, so that the Indicator has one public identity.
21. As a Data scientist, I want v1 to require measurement format fields to match across rows for the same Indicator code, so that the current indicator-level storage remains consistent.
22. As a Data scientist, I want to add a new frequency to an existing Indicator in the same Data source, so that I can expand coverage without recreating the Indicator.
23. As a Data scientist, I want pasted annotation fields to be ignored for existing Indicators, so that curated annotations are not overwritten accidentally.
24. As a Data scientist, I want pasted group fields to be ignored for existing Indicators in the same Data source, so that ingestion does not move existing Indicators between groups.
25. As a Data scientist, I want the save action to reject an existing Indicator code from another Data source, so that ownership remains unambiguous.
26. As a Data scientist, I want existing Indicator frequency dimensions to be immutable in this ingest grid, so that replacing observations later cannot accidentally change the schema contract.
27. As a Data scientist, I want the ingest grid to reject redefining an existing Indicator frequency even if it has no observations, so that definition edits have a separate deliberate workflow.
28. As a Data scientist, I want the selected Data source page to show all Indicator frequencies for that Data source after save, so that I can verify what is defined.
29. As a Data scientist, I want the selected Data source page to show existing definitions after reload, so that the page can be used for maintenance later.
30. As a Curator, I want missing optional Indicator annotations to remain visible as attention needs, so that I can improve public context after definitions and observations are published.
31. As a Curator, I want ingest saves not to rename existing Data sources, so that curated Data source names are not changed accidentally.
32. As a Curator, I want ingest saves not to rename existing Indicator groups, so that curated group names are not changed accidentally.
33. As an Explorer user, I want unpublished definitions to remain hidden from public discovery, so that I only see chartable Indicators and frequencies.
34. As an Admin, I want unpublished definitions to be visible in admin, so that I can prepare data before observations are available.
35. As an Admin, I want public visibility to continue depending on published lineage and observations, so that saved definitions alone do not leak into public catalogs.
36. As an Engineer, I want the definition parser and validator extracted into a deep module, so that the rules can be tested without rendering the admin page.
37. As an Engineer, I want the SvelteKit action to call a stable save-definitions interface, so that UI details do not leak into domain validation.
38. As an Engineer, I want the new page to reuse existing Data source, Indicator group, Indicator, Indicator frequency, and Observation dimension registries, so that ingestion follows the current domain model.
39. As an Engineer, I want row-level validation to be deterministic, so that tests can assert exact validation outcomes.
40. As an Engineer, I want definition saving to happen in a database transaction, so that all-or-nothing behavior is guaranteed.

## Implementation Decisions

- Build one admin ingestion page for v1. It contains a Data source header, a header-based paste area/grid, a row-level error table, and a saved Indicator frequencies table for the selected Data source.
- Use SvelteKit form actions for the definition-save slice. Do not add a JSON endpoint for this slice because v1 is admin-web-only and no external integration is planned.
- Use a Data-source-scoped route state. After successful save, reload the page with the selected Data source in the URL and load all Indicator frequencies for that Data source from the database.
- Create a deep server module for definition parsing, validation, and saving. It should expose a small interface that accepts Data source input and pasted rows, then returns either row-level validation errors or a saved-definition summary.
- The deep module should own the definition grammar: required headers, optional headers, normalization, row-level validation, all-or-nothing save semantics, and existing-definition rules.
- Required paste headers are `indicator_code`, `freq`, `name`, and `dimensions`.
- Optional paste headers are `group_code`, `group_name`, `short_name`, `description`, `methodology`, `source_citation`, `unit`, `unit_mult`, `decimals`, `default_viz`, and `updated`.
- The `dimensions` header is required, but individual cells may be empty. An empty dimensions cell means the Indicator frequency has no Observation dimensions.
- Dimension codes are comma-separated only. Semicolons are not supported in v1.
- Dimension codes are trimmed and uppercased before validation.
- Unknown Observation dimension codes are rejected.
- Data source code is globally unique, stable, and lowercase snake-case. UI input should normalize to lowercase snake-case with preview.
- Indicator code casing is preserved after trimming. Indicator codes remain globally unique.
- Indicator group codes may preserve source-native table, sheet, or collection identifiers.
- If `group_code` is blank, use the Data source code as the default group code. If `group_name` is blank for the default group, use the Data source name.
- One save operation is scoped to exactly one Data source. Pasted rows cannot create or target multiple Data sources.
- If the Data source already exists, do not update its name from the ingest page.
- If an Indicator group already exists, do not update its name from the ingest page.
- If an Indicator code already exists under a different Data source, reject the row.
- If an Indicator code already exists under the same Data source, ignore pasted annotation and group fields and use the existing Indicator identity.
- Existing Indicators can receive new Indicator frequency definitions.
- Existing Indicator frequency definitions cannot be redefined from the ingest grid, even if they are unpublished or have no observations.
- The save operation is all-or-nothing. If any row is invalid, no Data source, group, Indicator, Indicator frequency, or dimension rows are created.
- Definition saving must create explicit Indicator frequency records, including for dimensionless Indicator frequencies.
- Definition saving must create Indicator dimension records only for non-empty dimensions cells.
- Public Explorer/API visibility remains separate from admin definitions. Saved definitions without published observations are visible in admin but hidden publicly.
- Public visibility for an Indicator frequency requires both published lineage records and observations in the canonical store.
- Uploading Parquet observations, multi-file validation, and publish-all behavior are later slices and should not be included in this implementation slice.

## Testing Decisions

- Tests should focus on external behavior of the deep definition module, not implementation details or UI internals.
- The primary test target should be the definition parsing/validation/save module because it encapsulates the most business rules behind the smallest interface.
- Tests should cover successful parsing of required and optional headers.
- Tests should cover missing required headers.
- Tests should cover empty dimensions cells producing dimensionless Indicator frequencies.
- Tests should cover comma-separated dimensions and normalization of whitespace/casing.
- Tests should cover rejection of semicolon-delimited dimensions if they do not match known codes.
- Tests should cover rejection of unknown Observation dimension codes.
- Tests should cover Data source code normalization to lowercase snake-case.
- Tests should cover preserving Indicator code casing.
- Tests should cover blank group defaulting to Data source code/name.
- Tests should cover all-or-nothing behavior: one invalid row prevents every row from saving.
- Tests should cover duplicate Indicator frequency rows in the same paste.
- Tests should cover multiple frequencies for one new Indicator.
- Tests should cover shared Indicator annotation consistency across multiple frequency rows for the same new Indicator.
- Tests should cover v1 measurement format consistency across multiple frequency rows for the same new Indicator.
- Tests should cover existing Data source name not being updated.
- Tests should cover existing Indicator group name not being updated.
- Tests should cover rejecting an existing Indicator code owned by another Data source.
- Tests should cover adding a new frequency to an existing Indicator in the same Data source.
- Tests should cover ignoring pasted annotation fields for existing Indicators in the same Data source.
- Tests should cover rejecting redefinition of an existing Indicator frequency.
- Tests should cover creating explicit Indicator frequency rows for dimensionless definitions.
- There is currently no strong test prior art in the codebase; Vitest is configured but the project has few or no tests. This module should establish the testing pattern for ingestion business rules.
- Svelte component tests are not required for this slice unless the team wants additional coverage. The UI can rely on the server module tests plus SvelteKit type checking.

## Out of Scope

- Parquet file upload UI.
- Content-derived upload matching.
- Multi-file upload form action.
- Publish-all-valid action.
- Zip upload support.
- CSV or Excel observation upload.
- Programmatic ingest API.
- Creating new Observation dimensions from the ingest flow.
- Editing codelists from the ingest flow.
- Redefining dimensions for existing Indicator frequencies.
- Moving existing Indicators between Indicator groups or Data sources.
- Updating existing Data source names from ingest.
- Updating existing Indicator group names from ingest.
- Updating existing Indicator annotations from ingest.
- Frequency-specific Measurement format storage beyond the current v1 consistency rule.
- Role-based access beyond existing admin protection.
- Draft/batch persistence beyond saved definitions.

## Further Notes

- The domain glossary now uses **Data source** instead of Area and **Source citation** instead of source for indicator-specific provenance text.
- ADR 0004 records the decision to replace areas with data sources and rename indicator provenance text to source citation.
- The current database already has explicit `indicator_frequencies`, `data_sources`, and `source_citation` support from the prior preparation work.
- Existing upload/publish foundations are available but should be left for the next slice.
- The first implementation should prioritize a reliable definition-save workflow and a well-tested deep module over advanced grid interactions.
