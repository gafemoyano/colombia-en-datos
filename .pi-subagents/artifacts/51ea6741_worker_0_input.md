# Task for worker

Act as the plan-feature `apply` sub-agent. First read and follow this role contract exactly:
/home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/agents/apply.md

feature_name: geih-batch-ingest
phase_id: 6
task_ids: ["6.1", "6.2"]
repo_root: /home/gafe/Projects/colombia-en-datos
plan_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/plan.json
phase_file_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/phase-6-admin-batch-ui.md
plan_state_script: /home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/scripts/plan_state.py
relevant_docs: ["/home/gafe/Projects/colombia-en-datos/docs/target-data-architecture.md", "/home/gafe/Projects/colombia-en-datos/docs/adr/0006-file-based-batch-staging-on-data-path.md"]
decisions_snapshot: {"decisions":["Use SvelteKit page-server form actions calling server modules directly; no intermediate JSON endpoints.","Persist workflow context at /admin/ingest/batches?batchId=<id> with durable loader reconstruction.","Accepted mapping artifacts stay immutable; corrections require a new batch, transient retries reuse the batch.","Auto-apply fixed-total collapse and show audit values read-only.","One shared Data source is created or reused at upload and linked before analysis.","Data source fields are required code/name plus optional description.","Existing source codes use stored metadata read-only and reject conflicts."],"deviations":["Treat current uncommitted Phase 2-5 backend as baseline.","Add tested batch-ingest/admin-workflow.ts composition seam.","Analyze endpoint currently accepts only existing optional dataSourceCode; upload orchestration must create/reuse source first."]}

Implement tasks strictly in order. Preserve unrelated dirty-tree changes. Do not edit files under docs/. Use the provided external plan_state_script for task status mutations. Return only the exact JSON Result Contract required by apply.md.