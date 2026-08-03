# Task for delegate

Read-only DESIGN.md extraction for Impeccable scan mode. Do not edit files or invoke subagents.

Read /home/gafe/.agents/skills/impeccable/reference/document.md, then inspect PRODUCT.md, src/app.css, src/app.html, package.json, src/routes/admin/+layout.svelte, src/routes/admin/ingest/+page.svelte, and the canonical UI primitives used there (button, card, input, badge, textarea, label, separator). Stay within 12 project files by grouping barrel/style files intelligently.

Return a compact structured draft with:
- exact reusable colors and canonical format from CSS,
- typography roles actually evidenced,
- radius and spacing scales actually evidenced,
- elevation/shadow vocabulary,
- 5-8 existing component variants worth documenting, including literal style behavior (not Tailwind names only),
- breakpoints and motion conventions evidenced,
- accessibility design details,
- three coherent qualitative bundles for user choice. Each bundle must include a Creative North Star name, 2-3 mood adjectives, descriptive names for the key colors, elevation philosophy, and one phrase for component philosophy. Respect PRODUCT.md's sober/precise/trustworthy personality and decorative-SaaS anti-reference.

Cite file:line evidence. Do not invent tokens and do not write DESIGN.md yet. Keep under 1,200 words.

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