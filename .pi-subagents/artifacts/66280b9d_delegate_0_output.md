## DESIGN.md extraction draft

### 1. Reusable colors

**Canonical source format:** preserve CSS values as authored. Brand tokens are **hex sRGB**; shadcn semantic tokens are **OKLCH**. Do not silently convert or merge these systems (`src/app.css:8-66`).

**Brand/application palette** (`src/app.css:9-20`):

- Institutional blue: `--c-primary: #1f4e79`
- Deep blue: `--c-primary-600: #173d60`
- Midnight blue: `--c-primary-900: #0f2a43`
- Warm amber: `--c-warm: #d89a2b`
- Amber wash: `--c-warm-soft: #fff4de`
- Data-blue wash: `--c-soft: #eaf2f8`
- Page white: `--c-page: #fcfdfe`
- Ink: `--c-ink: #111827`
- Muted slate: `--c-muted: #52616b`
- Cool border: `--c-border: #d7e3ec`
- Statistical teal: `--c-accent: #2a9d8f`
- Teal wash: `--c-accent-soft` and `--c-mint-soft: #e5f5f2`
- Coral wash: `--c-coral-soft: #fdece8`

**Semantic light scheme:** white backgrounds/cards/popovers; near-black foreground `oklch(0.141 0.005 285.823)`; blue primary `oklch(0.488 0.243 264.376)`; pale neutral secondary/muted/accent `oklch(0.967 0.001 286.375)`; red destructive `oklch(0.577 0.245 27.325)`; border/input `oklch(0.92 0.004 286.32)` (`src/app.css:21-53`). A complete dark semantic scheme exists (`src/app.css:86-127`), although the inspected admin surface explicitly uses a light slate canvas (`src/routes/admin/+layout.svelte:9-12`).

### 2. Typography evidenced

- **Family:** Inter Variable, sans-serif; ligatures and contextual alternates enabled (`src/app.css:73-78,132-133`; `package.json:29`).
- **Page title:** 1.875rem, bold, tight tracking (`src/routes/admin/ingest/+page.svelte:65-69`).
- **Section/title:** 0.875–1rem, semibold; compact operational hierarchy.
- **Body/help:** 0.875rem regular, muted; supporting text constrained to `max-w-2xl`.
- **Label:** 0.875rem medium, tight line-height, slate text (`src/lib/components/ui/Label.svelte:12-19`).
- **Tabular/technical:** 0.75rem monospace for codes, dimensions and pasted data.
- **Eyebrow/table header:** 0.75rem medium, uppercase, wide tracking (`src/routes/admin/ingest/+page.svelte:151-159,238-246`).
- **Badge:** 0.75rem semibold (`src/lib/components/ui/Badge.svelte:6-19`).

### 3. Radius and spacing

The radius base is `0.625rem`/10px. Derived scale: **sm 6px, md 8px, lg 10px, xl 14px, 2xl 18px, 3xl 22px, 4xl 26px** (`src/app.css:48,163-169`). Pills use a fully rounded shape.

Evidenced spacing steps: **4, 6, 8, 10, 12, 16, 20, 24, 32 and 40px**. Admin gutters progress from **16px → 24px → 32px** at responsive widths; cards commonly use 20px padding and forms use 8–16px vertical rhythm (`src/routes/admin/+layout.svelte:11,54`; `src/routes/admin/ingest/+page.svelte:57-59,93-116`).

### 4. Elevation vocabulary

Depth is primarily **structural**: white/slate tonal layers plus 1px cool borders. `shadow-sm` is reserved for the brand icon and cards; the header uses translucent white with backdrop blur (`src/routes/admin/+layout.svelte:10-17`; `src/lib/components/ui/Card.svelte:10-15`). No custom shadow scale is declared.

### 5. Existing variants worth documenting

1. **Card:** white surface, slate-200 border, slate-950 text, 14px corners, restrained small shadow.
2. **Input:** 40px high, 8px corners, white fill, 1px slate border, 12px horizontal padding; dark 2px focus ring with 2px offset; disabled cursor and 50% opacity (`Input.svelte:10-17`).
3. **Textarea:** same field treatment, 96px minimum height; ingest editor raises this to 176px and uses 12px monospace (`Textarea.svelte:10-17`; ingest page around `174-184`).
4. **Badge—secondary:** pale slate fill, dark text, transparent border; pill shape.
5. **Badge—outline:** transparent fill with inherited border and dark text.
6. **Badge—status:** amber warning, emerald success, and red destructive pair tinted backgrounds with explicit text labels (`Badge.svelte:9-17`; ingest page around `290-295`).
7. **Separator:** 1px slate-200 rule; horizontal full width or vertical full height (`Separator.svelte:12-20`).
8. **Button/link controls:** ghost, outline, small and icon variants are canonical usage; icons are 16px, mobile labels hide below `sm`, and icon-only Home has `aria-label` (`admin/+layout.svelte:25-49`). **Residual:** the inspected `button.ts` is only a barrel, so literal button padding/color states remain unattested (`src/lib/components/ui/button.ts:1`).

### 6. Responsive and motion conventions

- Tailwind’s standard `sm` **640px** and `lg` **1024px** are implied by the installed Tailwind 4 system and repeated responsive utilities (`package.json:44-58`; `admin/+layout.svelte:11,27-42`; ingest page `57,93`).
- Motion is restrained: smooth document scrolling, badge color transitions, row hover tint, and header backdrop blur (`src/app.css:68-71`; `Badge.svelte:6`; ingest page around `251`).
- No choreographed or ornamental progress motion is evidenced.

### 7. Accessibility details

Spanish document language and responsive viewport are declared (`src/app.html:2-6`). Fields have explicit labels/IDs, controls have visible focus rings, disabled styles are distinct, tables use semantic headings, and statuses include text rather than color alone. The product explicitly requires WCAG 2.2 AA, keyboard support, screen-reader status/error announcements and reduced-motion preferences (`PRODUCT.md:29-31`).

**Review findings**
- **Medium:** validation/success messages lack evidenced `role="status"`, `role="alert"` or `aria-live`, despite the product requirement (`ingest/+page.svelte:87-91,190-205`; `PRODUCT.md:31`).
- **Medium:** global smooth scrolling has no evidenced `prefers-reduced-motion` override (`src/app.css:68-71`).
- **Low:** two color systems coexist—hex brand tokens and OKLCH semantic tokens—without documented precedence.

## Qualitative bundles for selection

1. **The Audit Ledger** — *exact, composed, accountable*. Key colors: **Institutional Ledger Blue**, **Document Ink**, **Evidence Teal**, **Caution Amber**. Elevation: flat by default; borders establish custody, shadows only indicate containment. Component philosophy: **“Bounded, explicit, evidence-first.”**

2. **The Statistical Desk** — *analytical, calm, methodical*. Key colors: **Survey Blue**, **Paper White**, **Measured Slate**, **Validation Teal**. Elevation: quiet tonal layering with minimal ambient shadow. Component philosophy: **“Dense enough for work, quiet enough for scrutiny.”**

3. **The Public Record** — *civic, sober, dependable*. Key colors: **Civic Navy**, **Archive Ink**, **Registry Teal**, **Review Gold**. Elevation: structural rules and surface contrast, never decorative lift. Component philosophy: **“Every control states its consequence.”**

All three reject the PRODUCT.md anti-reference: decorative SaaS onboarding, oversized generic cards, ornamental progress, hidden technical detail and ambiguous saves (`PRODUCT.md:17-19`).