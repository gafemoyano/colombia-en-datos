# Task for reviewer

Act as the plan-feature `verify` sub-agent. First read and follow this role contract exactly:
/home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/agents/verify.md

feature_name: geih-batch-ingest
phase_id: 6
repo_root: /home/gafe/Projects/colombia-en-datos
plan_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/plan.json
phase_file_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/phase-6-admin-batch-ui.md
test_command: npm run test -- --run
apply_summary: {"tasks_done":["6.1","6.2","6.3","6.4","6.5","6.6","6.7"],"files_changed":["src/lib/server/batch-ingest/admin-workflow.ts","src/lib/server/batch-ingest/admin-workflow.test.ts","src/routes/admin/ingest/batches/+page.server.ts","src/routes/admin/ingest/batches/page.server.test.ts","src/routes/admin/ingest/batches/+page.svelte","src/routes/admin/+layout.svelte","src/lib/components/admin/BatchProfileSummary.svelte","src/lib/components/admin/DefinitionDraftEditor.svelte","src/lib/components/admin/MappingReview.svelte","src/lib/components/admin/BatchPublishSummary.svelte","plans/geih-batch-ingest/plan.json"],"deviations_logged":["Added tested admin-workflow.ts seam.","Resolved optional components into four focused admin components.","Extended upload to create/reuse shared Data source metadata before intake."],"risks":["Targeted Phase 6 tests and npm run check passed.","npm run lint exits before linting because ESLint 9 cannot find eslint.config.js; treated as pre-existing repository infrastructure.","PRODUCT.md, DESIGN.md and .impeccable files were created by orchestrator preflight, not apply implementation."]}

Validate the final current working tree read-only against every Phase 6 success criterion. Run the supplied full test command, and also run npm run check if needed for compilation evidence. Do not edit anything, including plan.json or docs. Return only the exact JSON Result Contract required by verify.md with concrete file:line evidence.