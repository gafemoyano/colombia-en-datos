# Task for worker

Create the Impeccable design-system documentation only. Do not modify application source, plan files, package files, or existing docs.

Read and follow:
- /home/gafe/.agents/skills/impeccable/reference/document.md
- /home/gafe/.agents/skills/impeccable/reference/product.md
- /home/gafe/Projects/colombia-en-datos/PRODUCT.md

Scan the actual design tokens and canonical components in src/app.css, src/routes/admin/+layout.svelte, src/routes/admin/ingest/+page.svelte, and src/lib/components/ui/. Use the existing system only; do not invent a redesign.

Confirmed qualitative direction:
- Creative North Star: "The Statistical Desk"
- Mood: analytical, calm, methodical
- Color character: Survey Blue, Paper White, Measured Slate, Validation Teal
- Elevation: quiet tonal layering with minimal ambient shadow
- Component philosophy: "Dense enough for work, quiet enough for scrutiny."

Deliverables:
1. Create root DESIGN.md with valid YAML frontmatter and exactly the six required body sections, in order: Overview, Colors, Typography, Elevation, Components, Do's and Don'ts. Preserve actual hex/OKLCH tokens, Inter, current radius/spacing, component variants, and PRODUCT.md anti-references. Document precedence between brand tokens and semantic UI tokens.
2. Create .impeccable/design.json with schemaVersion 2, token metadata/extensions, actual breakpoints/motion, 5-8 self-contained component examples with ds- class names and literal CSS/token references, and narrative copied verbatim from DESIGN.md.
3. Validate the JSON parses. Check DESIGN.md headings/frontmatter mechanically. Do not run application tests.

Return a concise summary listing files changed and validation commands. No other changes.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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