# Task for worker

Act as the plan-feature `apply` sub-agent. First read and follow this role contract exactly:
/home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/agents/apply.md

feature_name: geih-batch-ingest
phase_id: 6
task_ids: ["6.3", "6.4"]
repo_root: /home/gafe/Projects/colombia-en-datos
plan_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/plan.json
phase_file_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/phase-6-admin-batch-ui.md
plan_state_script: /home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/scripts/plan_state.py
relevant_docs: ["/home/gafe/Projects/colombia-en-datos/PRODUCT.md", "/home/gafe/Projects/colombia-en-datos/DESIGN.md", "/home/gafe/Projects/colombia-en-datos/docs/target-data-architecture.md"]
decisions_snapshot: {"decisions":["Use SvelteKit page-server form actions calling server modules directly.","Persist workflow context at /admin/ingest/batches?batchId=<id>.","One shared Data source is created or reused at upload; fields are required code/name and optional description.","Existing source codes display stored metadata read-only and reject conflicts.","Use The Statistical Desk design system: sober, compact, evidence-first, WCAG 2.2 AA."],"deviations":["Treat current uncommitted Phase 2-5 backend as baseline.","Use focused admin components: BatchProfileSummary, DefinitionDraftEditor, MappingReview, BatchPublishSummary.","Tasks 6.1-6.2 added admin-workflow.ts and +page.server.ts and are complete."]}

Implement tasks strictly in order. Preserve unrelated dirty-tree changes. Do not edit files under docs/. Read PRODUCT.md and DESIGN.md as authoritative design context. Use Svelte 5 runes only. Use the provided plan_state_script for task status mutations. Return only the exact JSON Result Contract required by apply.md.