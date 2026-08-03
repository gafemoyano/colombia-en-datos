# Task for delegate

Read-only design-context scan for Impeccable init. Do not edit files or invoke subagents.

Inspect enough of this repository to prepare a minimal PRODUCT.md interview for the Phase 6 admin batch-ingest UI. Start with README/AGENTS/project docs, package.json, src/app.css, src/routes/admin/+layout.svelte, one representative admin page, one representative public/app page, and relevant static brand assets. Also check whether PRODUCT.md, DESIGN.md, and .impeccable/live/config.json exist.

Return a compact English briefing with concrete file:line evidence covering:
1. register hypothesis (brand or product) and whether the repo is split-surface,
2. inferred users, purpose, and primary admin job,
3. evidenced brand personality and anti-patterns/references already encoded,
4. accessibility conventions or gaps,
5. existing visual system/tokens/components to preserve,
6. framework and served HTML entry for possible live config,
7. only the strategic PRODUCT.md questions that truly remain unanswered.

Keep the response under 900 words. No code changes, no tests.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```