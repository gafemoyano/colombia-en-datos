# Task for worker

Act as the plan-feature `apply` sub-agent. First read and follow this role contract exactly:
/home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/agents/apply.md

feature_name: geih-batch-ingest
phase_id: 6
task_ids: ["6.5", "6.6"]
repo_root: /home/gafe/Projects/colombia-en-datos
plan_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/plan.json
phase_file_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/phase-6-admin-batch-ui.md
plan_state_script: /home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/scripts/plan_state.py
relevant_docs: ["/home/gafe/Projects/colombia-en-datos/PRODUCT.md", "/home/gafe/Projects/colombia-en-datos/DESIGN.md", "/home/gafe/Projects/colombia-en-datos/docs/target-data-architecture.md", "/home/gafe/Projects/colombia-en-datos/docs/adr/0006-file-based-batch-staging-on-data-path.md"]
decisions_snapshot: {"decisions":["Use page-server form actions and durable ?batchId state.","Accepted mappings are immutable; mapping correction after acceptance or staging requires a new uploaded batch, while transient retries reuse the batch.","Apply generated fixed-total collapse automatically and show collapsed values as read-only audit evidence.","Publish is all-or-nothing, replaces only present indicator+frequency slices, leaves absent slices untouched, and must show lineage outcomes.","Use The Statistical Desk design system and WCAG 2.2 AA."],"deviations":["Use focused components DefinitionDraftEditor.svelte, MappingReview.svelte, and BatchPublishSummary.svelte; route page owns workflow state/forms.","Tasks 6.1-6.4 are complete in the current dirty tree."]}

Implement tasks strictly in order. Preserve unrelated dirty-tree changes. Do not edit files under docs/. Read PRODUCT.md and DESIGN.md as authoritative. Use Svelte 5 runes only. Ensure errors are actionable and announced accessibly; do not use decorative wizard motion. Use the provided plan_state_script for task status mutations. Return only the exact JSON Result Contract required by apply.md.