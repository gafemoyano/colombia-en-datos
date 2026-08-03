# Self-service upload feasibility review

## Review

### Scope caveat

The requested `plan.md`, `progress.md`, `docs/adr/0005*`, `docs/adr/0006*`, and `src/lib/server/batch-ingest` do **not exist in this worktree at HEAD `ab9e506c`**. `docs/adr/` ends at ADR 0004, and the only ingestion module is `src/lib/server/ingest.ts`. This review therefore assesses the implementation actually present, rather than assuming the missing batch design exists.

### Maturity estimate

- **Requested flow — one consolidated Parquet plus metadata JSON, safely handled end-to-end by a data scientist: ~25% complete (2/5, foundation/prototype).** It cannot currently accept the EMICRON pair without a custom transformation/importer, cannot create all definitions from the JSON, has no upload UI, and lacks safety controls needed for broad self-service.
- **Narrow existing flow — one already-defined indicator/frequency and one pre-normalized canonical Parquet, used by a trusted technical admin through direct API calls: ~55% complete.** Upload, basic validation, preview, checksum, publish, and lineage foundations exist, but validation, atomicity, durability, rollback, and operational controls are incomplete.

This distinction matters: the current upload API is deliberately one `indicatorCode + freq` at a time (`src/routes/api/admin/ingest/upload/+server.ts:5-29`), while the sample Parquet contains 133 annual indicators in one file (944,667 rows, verified with DuckDB during review). The metadata JSON likewise has a top-level indicator map and per-indicator definitions (`/home/gafe/Projects/colombia-en-datos/data/emicron-single/metadata_emicron.json:31-54`).

### Correct / reusable pieces

- **Relational definition model is reusable.** Data sources, groups, globally unique indicators, explicit indicator frequencies, per-frequency dimensions, releases, and release/source coverage are represented with useful uniqueness constraints (`src/lib/db/schema/indicators.ts:4-69`, `src/lib/db/schema/indicators.ts:102-177`, `src/lib/db/schema/indicators.ts:183-223`). This is a sound target for metadata-derived definitions.
- **Single-indicator definition creation already demonstrates transactional writes.** `POST /api/indicators` validates known dimensions, then creates/reuses the data source and group and inserts indicator, frequencies, and dimensions inside one SQLite transaction (`src/routes/api/indicators/+server.ts:219-283`, `src/routes/api/indicators/+server.ts:285-329`). The parsing and persistence logic should be extracted/reused rather than called 133 times over HTTP.
- **Upload foundation is meaningful.** The service generates opaque UUIDs, writes a staged file, computes SHA-256, reads Parquet through DuckDB, returns a ten-row preview, and removes invalid staged files (`src/lib/server/ingest.ts:123-161`, `src/lib/server/ingest.ts:360-403`).
- **SQL construction is comparatively careful.** Values used in row validation and destructive deletes are parameterized, paths are escaped, and file-provided identifiers are quoted (`src/lib/server/ingest.ts:97-103`, `src/lib/server/ingest.ts:293-347`, `src/lib/server/ingest.ts:451-458`). No direct SQL-injection blocker was found in this ingestion slice.
- **Publication visibility has the right two-part gate.** Public frequency discovery intersects published metadata lineage with frequencies actually present in DuckDB (`src/lib/server/duckdb.ts:454-494`), while the admin catalog can display unpublished status (`src/routes/admin/+page.server.ts:68-86`; `src/routes/admin/+page.svelte:312-324`). This can support a draft/validate/publish workflow.
- **A process-local write queue and DuckDB transaction exist.** Publication serializes calls in one Node process and wraps replacement of one indicator/frequency in a DuckDB transaction (`src/lib/server/ingest.ts:451-463`, `src/lib/server/ingest.ts:558-566`). These are useful primitives, though insufficient across instances.
- **Admin routes are protected.** The hook covers both `/admin` and `/api/admin` (`src/hooks.server.ts:35-40`, `src/hooks.server.ts:59-69`), and Fly forces HTTPS (`fly.toml:24-29`).
- **The definitions PRD sets strong domain semantics.** It requires deterministic row errors, all-or-nothing saving, immutable existing frequency definitions, and separation of unpublished definitions from public discovery (`docs/prd/admin-ingest-definitions.md:23-56`, `docs/prd/admin-ingest-definitions.md:60-86`). These rules are a good basis for a batch module.

### Blockers and findings

1. **Blocker — [critical] The requested batch/JSON ingestion implementation is absent.** The current PRD explicitly scopes itself to pasted definition rows and defers Parquet upload, multi-file handling, and publish-all (`docs/prd/admin-ingest-definitions.md:60-87`, `docs/prd/admin-ingest-definitions.md:117-135`). Its proposed deep definition module and admin page have not landed; there is no `batch-ingest` directory and no admin ingest link/page—the admin navigation exposes only indicators and Explorer (`src/routes/admin/+layout.svelte:24-35`). The existing JSON indicator API creates one new indicator and rejects any existing code (`src/routes/api/indicators/+server.ts:189-217`), so it neither parses `metadata_emicron.json` nor implements the PRD rule allowing a new frequency on an existing same-source indicator.

2. **Blocker — [critical] The sample Parquet is not compatible with the upload contract.** The endpoint requires an external `indicatorCode` and `freq` for one homogeneous file (`src/routes/api/admin/ingest/upload/+server.ts:5-29`); validation rejects any row with a different indicator or frequency (`src/lib/server/ingest.ts:293-311`). The inspected sample is a consolidated file with 133 indicators. It also uses uppercase source columns named `INDICATOR`, `FREQ`, `REF_AREA`, `TIME_PERIOD`, and `OBS_VALUE`, whereas validation requires lowercase `indicator_code`, `freq`, `ref_area`, `time_period`, and `obs_value`, and explicitly rejects non-lowercase names (`src/lib/server/ingest.ts:16-29`, `src/lib/server/ingest.ts:248-280`). A content-derived mapping/splitting step is therefore mandatory; the current PRD explicitly excludes it (`docs/prd/admin-ingest-definitions.md:119-126`).

3. **Blocker — [critical, data correctness] EMICRON dimensions cannot be represented safely by the current canonical table.** The metadata declares observation dimensions including `AREA`, `CATEGORY`, and `CLASE`, plus total-only `DOMAIN` and `HEAD_SEX` (`/home/gafe/Projects/colombia-en-datos/data/emicron-single/metadata_emicron.json:43-70`). The canonical table only has geography fields, `urban_rural`, `sex`, `age`, `adjustment`, and three anonymous extension columns (`scripts/create-canonical-store.ts:29-47`); the online publisher inserts exactly that fixed set (`src/lib/server/ingest.ts:31-48`, `src/lib/server/ingest.ts:406-430`). The inspected Parquet also contains `CATEGORY`, `CATEGORY_LABEL`, `AREA`, `CLASE`, `DOMAIN`, and `HEAD_SEX`. Dropping these fields would collapse distinct observations into indistinguishable rows; accepting them currently fails the extra-column check. Decide and migrate the canonical dimension representation before building upload UI.

4. **Blocker — [high, data correctness] Core validation is knowingly incomplete.** The architecture calls for required registered-dimension columns, codelist enforcement, and duplicate observation-key rejection (`docs/target-data-architecture.md:255-280`) and explicitly says those items must be hardened before broad self-service (`docs/target-data-architecture.md:621-622`). The implementation only limits columns to an allowlist; it never verifies that every registered dimension is present, never checks dimension values against `dimension_values`, and never detects duplicate observation identities (`src/lib/server/ingest.ts:229-285`). Missing dimensions are subsequently inserted as `NULL` (`src/lib/server/ingest.ts:406-424`). This can publish structurally invalid or ambiguous data.

5. **Blocker — [high, consistency] Publish is not atomic across DuckDB, SQLite, and the manifest.** DuckDB deletes/reinserts and commits first (`src/lib/server/ingest.ts:451-463`), then SQLite creates release/source metadata in a separate transaction (`src/lib/server/ingest.ts:503-543`), then the JSON manifest is marked published (`src/lib/server/ingest.ts:545-548`). A SQLite failure leaves replaced observations without matching lineage; a manifest-write failure permits a retry and duplicate release records. There is no compensating transaction or recovery state machine.

6. **Blocker — [high, operational durability] Staging is written outside the mounted production volume.** Uploads/manifests go to `process.cwd()/data/ingest/uploads` (`src/lib/server/ingest.ts:85-95`), while Fly mounts persistent storage at `/data` (`fly.toml:12-22`) and the canonical DuckDB resolves there. A restart/deploy can lose validated uploads between upload and publish. If the app scales, upload and publish may also land on different machines. Valid and published files/manifests have no expiry or cleanup path (`src/lib/server/ingest.ts:384-403`, `src/lib/server/ingest.ts:545-548`).

7. **Blocker — [high, recovery] “Full replacement” has no usable rollback.** Publication deletes all existing observations for the indicator/frequency before inserting the new file (`src/lib/server/ingest.ts:451-459`). Although `data_releases.status` exists (`src/lib/db/schema/indicators.ts:183-197`), old observation versions are not retained and no rollback endpoint or routine exists. The documented risk mitigation claiming releases support rollback is therefore not implemented (`docs/target-data-architecture.md:575-583`). A bad-but-valid upload is irreversible without restoring the whole DuckDB backup.

8. **Note — [high, availability/security] Uploads are fully buffered with no application limit.** The route parses all multipart form data (`src/routes/api/admin/ingest/upload/+server.ts:5-7`), and the service calls `file.arrayBuffer()` and makes another `Buffer` before writing (`src/lib/server/ingest.ts:360-372`). There is no file-size, extension, MIME, row-count, decompression/scan-time, timeout, disk-quota, or rate limit. The 6.27 MB sample is manageable, but the unrestricted endpoint lets an authenticated or CSRF-assisted client exhaust memory, disk, or shared CPU.

9. **Note — [high, concurrency] Serialization is only process-local.** The module-level promise queue (`src/lib/server/ingest.ts:558-566`) does not coordinate multiple Node processes or Fly machines. Concurrent publishers can interleave destructive replacements and SQLite lineage writes. The architecture’s “serialized writes” decision (`docs/target-data-architecture.md:603-605`) is not satisfied in a horizontally scaled deployment.

10. **Note — [medium-high, access/audit] Authentication is a shared Basic secret, not self-service identity.** The guard compares a single username/password and has only all-or-nothing admin access (`src/hooks.server.ts:16-32`). `data_releases.uploadedBy` exists (`src/lib/db/schema/indicators.ts:183-196`) but publish never sets it (`src/lib/server/ingest.ts:503-517`). There is no actor-level audit, role separation, revocation per scientist, rate limiting, or explicit Origin/CSRF validation on the multipart upload endpoint. This is acceptable for a tiny trusted operator group, not broad self-service.

11. **Note — [medium, integrity] The staged checksum is not reverified at publish.** SHA-256 is calculated at upload (`src/lib/server/ingest.ts:367-370`) and copied into lineage (`src/lib/server/ingest.ts:507-516`), but publish only reruns schema/content validation, not the checksum (`src/lib/server/ingest.ts:433-449`). A modified/corrupted staged file could be published under the checksum of the original.

12. **Blocker — [high, regression risk] There are no tests.** The worktree contains no `*.test.*` or `*.spec.*` files. This is especially material because the PRD requires deterministic parser, ownership, immutability, and all-or-nothing tests (`docs/prd/admin-ingest-definitions.md:89-115`), while publication performs destructive replacement.

### Sample compatibility evidence

Read-only DuckDB inspection of `/home/gafe/Projects/colombia-en-datos/data/emicron-single/EMICRON_indicadores_SDMX.parquet` found:

- 944,667 rows, 133 distinct indicators, one frequency (`A`), periods 2019–2024.
- 36 source columns, including uppercase `INDICATOR` rather than canonical `indicator_code`.
- Source dimensions/attributes beyond the canonical table: `AREA`, `DOMAIN`, `CLASE`, `HEAD_SEX`, `CATEGORY`, `CATEGORY_LABEL`, `WEIGHT_TYPE`, and others.

Read-only JSON inspection found 133 metadata indicators and 11 collections. Thus the Parquet and JSON agree at indicator-count level, but no code currently cross-validates them, proves one-to-one indicator coverage, validates metadata codelists against observations, or derives the 133 definition/upload units.

### Phased recommendation

**Phase 0 — Reconcile the design before implementation.**

1. Restore/review the missing ADR 0005/0006 and proposed `batch-ingest` design, or explicitly confirm they were never committed. Align them with the definitions PRD, which currently declares uploads out of scope.
2. Define a versioned JSON contract for this metadata shape, including maximum size, unknown-field behavior, data-source/group mapping (`survey`, `theme`, `collection`), indicator annotation mapping, and whether JSON or pasted rows is the supported self-service input.
3. Resolve the canonical dimension model first. Named arbitrary dimensions are preferable to silently mapping EMICRON semantics into `ext_1..3`; migrate query/Explorer support and define observation identity across all registered dimensions.

**Phase 1 — Build a dry-run batch importer, initially operator-only.**

1. Implement a deep server module that parses metadata JSON, discovers distinct `(indicator, freq)` partitions in Parquet, normalizes source names (`INDICATOR` → `indicator_code`), and returns a deterministic batch report without mutating either database.
2. Cross-check JSON/Parquet indicator sets, frequency, units/decimals, dimension columns, codelists, time ranges, nullability, duplicate full keys, and counts. Reject all on any definition or observation error.
3. Reuse the existing transactional definition logic and relational tables, but save all 133 definitions in one SQLite transaction. Do not expose observations publicly yet.

**Phase 2 — Make staging and validation production-safe.**

1. Add persisted batch/upload records with actor, state, timestamps, source filenames, checksums, validation report, and per-indicator status; store staged artifacts on `/data` or durable object storage with quotas and TTL cleanup.
2. Stream uploads to disk; enforce request/file/row limits, Parquet-only validation, scan timeout/resource limits, rate limiting, and checksum revalidation.
3. Implement required-dimension, dimension-value/codelist, duplicate-key, null/blank, finite-number, supported-frequency/time-format, and metadata/observation consistency checks. Add tests before any destructive publish path.
4. Replace shared Basic auth for this surface with named accounts/roles, audit `uploadedBy`, CSRF/Origin protection, and explicit permissions for validate versus publish.

**Phase 3 — Design recoverable publication.**

1. Avoid deleting the live partition before cross-store success. Prefer immutable release-scoped observations plus an active-release pointer, or a copy-on-write DuckDB file/partition with an explicit recoverable state machine.
2. Use a cross-process lock/job worker, idempotency key, and restart recovery. Make retry safe at every state transition.
3. Keep prior releases and provide tested rollback. Back up both DuckDB and SQLite metadata consistently before broad rollout.
4. For this consolidated dataset, support “validate all, publish all” only after an atomic or recoverable batch activation design exists; partial activation should be explicit and visible.

**Phase 4 — Add UI and graduate access.**

1. Add an admin ingest page with metadata + Parquet selection, preflight summary, actionable row/indicator errors, sample preview, explicit destructive-replacement confirmation, progress/status, and post-publish verification.
2. Pilot with trusted technical users, monitor resource use and failure recovery, then widen access only after restore/rollback and concurrent-publish drills pass.

### Bottom line

The system has reusable schema, canonical-store, validation, preview, checksum, lineage, visibility, and auth primitives. It is **not close to safe self-service for the EMICRON single-file pair** because the target input is multi-indicator and source-shaped, key dimensions are not representable, the batch/metadata implementation is absent, and destructive publication is neither cross-store atomic nor recoverable. The safest next deliverable is a tested, read-only batch dry run and dimension-model decision—not an upload UI.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete severity-ranked findings cite ingest, admin, schema, PRD, architecture, deployment, and sample metadata paths/lines; residual security, consistency, and operational risks are enumerated."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short; git ls-tree/find/grep/read inspections",
      "result": "passed",
      "summary": "Initial status was clean and requested plan/progress, ADR 0005/0006, and batch-ingest artifacts were absent; final status showed an externally appearing untracked data/emicron-single directory, with no staged files."
    },
    {
      "command": "Node JSON inspection of metadata_emicron.json",
      "result": "passed",
      "summary": "Found 133 indicators, 11 collections, annual frequency metadata, and the source dimension set."
    },
    {
      "command": "DuckDB DESCRIBE and aggregate inspection of EMICRON_indicadores_SDMX.parquet",
      "result": "passed",
      "summary": "Found 36 columns, 944667 rows, 133 indicators, frequency A, and periods 2019-2024."
    },
    {
      "command": "Automated test suite",
      "result": "not-run",
      "summary": "Read-only feasibility review; no code was changed, and no test files exist in the worktree."
    }
  ],
  "validationOutput": [
    "Current flow only accepts one pre-existing indicator/frequency with canonical lowercase columns.",
    "Sample Parquet consolidates 133 indicators and contains dimensions absent from the canonical table.",
    "No batch-ingest implementation or upload UI exists in the reviewed worktree."
  ],
  "residualRisks": [
    "Critical data-semantic loss unless AREA, CATEGORY, CLASE, DOMAIN, HEAD_SEX and other dimensions receive an explicit canonical representation.",
    "Cross-store partial publication can leave DuckDB observations and SQLite lineage inconsistent.",
    "Staged uploads are ephemeral, unbounded, unexpired, and serialized only within one process.",
    "Missing codelist, required-dimension, duplicate-key, rollback, audit, and automated-test safeguards block broad self-service."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only; no files in the reviewed worktree were modified.",
  "reviewFindings": [
    "critical: missing batch-ingest/ADR implementation and no JSON or upload UI flow",
    "critical: sample consolidated Parquet is incompatible with the one-indicator canonical upload contract",
    "critical: canonical schema cannot preserve multiple EMICRON dimensions",
    "high: validation omits codelists, required dimensions, and duplicate identities",
    "high: publish is destructive and non-atomic across DuckDB, SQLite, and manifest state",
    "high: staging durability, cleanup, limits, concurrency, rollback, and test coverage are insufficient"
  ],
  "manualNotes": "The authoritative output artifact is outside the reviewed worktree. plan.md and progress.md requested by the task were absent, so no claims were inferred from them. An untracked data/emicron-single directory appeared in the worktree during review; it was not created, edited, staged, or removed by this read-only review."
}
```
