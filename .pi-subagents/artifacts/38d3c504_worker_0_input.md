# Task for worker

Act as the plan-feature `apply` sub-agent. First read and follow this role contract exactly:
/home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/agents/apply.md

feature_name: geih-batch-ingest
phase_id: 6
task_ids: ["6.7"]
repo_root: /home/gafe/Projects/colombia-en-datos
plan_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/plan.json
phase_file_path: /home/gafe/Projects/colombia-en-datos/plans/geih-batch-ingest/phase-6-admin-batch-ui.md
plan_state_script: /home/gafe/Projects/trii/ai-marketplace/.pi-plugin/resources/plan-feature/scripts/plan_state.py
relevant_docs: ["/home/gafe/Projects/colombia-en-datos/PRODUCT.md", "/home/gafe/Projects/colombia-en-datos/DESIGN.md"]
decisions_snapshot: {"decisions":["Use SvelteKit page-server form actions with durable ?batchId state.","The complete flow must preserve actionable retry context and WCAG 2.2 AA behavior.","Use the established Svelte 5, Vitest, TypeScript, Tailwind and component patterns without adding a new test framework."],"deviations":["Tasks 6.1-6.6 are complete in the current dirty tree.","Prior batches report npm run check and targeted tests passing, but npm run lint currently reaches an ESLint 9 configuration error because no eslint.config.js exists."]}

Implement task 6.7. Inspect existing workflow/route tests and add only meaningful missing coverage for this phase; do not add dependencies. Run targeted Phase 6 tests, npm run check, and npm run lint. Do not change repository-wide lint configuration unless Phase 6 code itself caused the failure; report a pre-existing infrastructure failure as a risk with exact command evidence. Preserve unrelated dirty-tree changes. Do not edit files under docs/. Use the provided plan_state_script for task status mutation. Return only the exact JSON Result Contract required by apply.md.