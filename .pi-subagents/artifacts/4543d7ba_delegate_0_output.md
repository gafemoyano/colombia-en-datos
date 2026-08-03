## Impeccable design-context briefing

### 1. Register and surface hypothesis
**Recommended register: product-first for `/admin`, brand-led only on public marketing.** The repository is split-surface—effectively three surfaces:

- Spanish marketing landing page and interactive public dashboard are documented separately (`AGENTS.md:7-11`).
- A distinct administration shell now exists with its own navigation and subdued slate styling (`src/routes/admin/+layout.svelte:9-58`).

The Phase 6 batch-ingest UI should therefore optimize for operational clarity, density, validation, and trust rather than marketing expression. Preserve enough “Colombia en Datos” identity to maintain provenance (`src/routes/admin/+layout.svelte:16-19`).

### 2. Users, purpose, and primary admin job
**Inferred users:** internal data administrators or statistically/data-literate operators, likely comfortable with indicator codes, frequency codes, dimensions, spreadsheets, and publication states.

**Product purpose:** visualize Colombian demographic, economic, and statistical indicators (`README.md:1-3`), including interactive selection and Plotly visualization (`README.md:76-82`).

**Primary admin job:** select or create a data source, paste tab-separated indicator definitions from a spreadsheet, validate the entire grid atomically, save it, and inspect whether definitions have published observations (`src/routes/admin/ingest/+page.svelte:77-83, 139-160, 200-234, 273-327`). Stable normalized source codes and shareable route state are also explicit operational concerns (`src/routes/admin/ingest/+page.svelte:99-103, 334-338`).

### 3. Brand personality and encoded references
- **Personality:** sober, institutional, trustworthy, analytical, and utility-oriented. Admin UI uses restrained slate neutrals, compact typography, tables, status badges, and Lucide database/spreadsheet/shield metaphors (`src/routes/admin/+layout.svelte:1-19`; `src/routes/admin/ingest/+page.svelte:85-92, 242-327`).
- **Core palette:** deep institutional blue, warm gold, teal, pale blue/mint/coral, near-white page, dark ink (`src/app.css:8-24`).
- **Typography:** Inter Variable with smoothing and ligatures (`src/app.css:4, 62-75, 119`).
- **Encoded design reference:** shadcn-svelte/Tailwind token system and components, with Lucide icons (`src/app.css:1-4, 26-59`; `package.json:31-69`).
- **Anti-patterns implied by current work:** avoid decorative dashboard chrome, ambiguous save behavior, silently partial imports, or exposing unpublished definitions publicly. The copy explicitly says invalid grids save no rows and unpublished definitions belong only in admin (`src/routes/admin/ingest/+page.svelte:79-82, 214-220`).
- No `PRODUCT.md` or `DESIGN.md` exists, so these principles are inferred rather than formally governed.

### 4. Accessibility conventions and gaps
**Preserve:**
- Spanish document language (`src/app.html:2`).
- Explicit labels and matching control IDs throughout the ingest form (`src/routes/admin/ingest/+page.svelte:105-132`).
- Keyboard-visible focus treatment on the native source selector (`src/routes/admin/ingest/+page.svelte:107-114`).
- Icon-only Home action has an accessible name (`src/routes/admin/+layout.svelte:49-55`).

**Gaps — medium severity:**
- Success and validation feedback are visual blocks without an evident live region or focus transfer, so screen-reader users may miss post-submit results (`src/routes/admin/ingest/+page.svelte:88-92, 207-234`).
- Status relies partly on red/emerald color treatments; text mitigates this, but automated contrast and non-color checks remain needed.
- Wide tables depend on horizontal overflow and have no captions (`src/routes/admin/ingest/+page.svelte:153-177, 255-327`).
- Navigation hides text labels on small screens without adding equivalent labels to every icon/text link (`src/routes/admin/+layout.svelte:24-47`).

### 5. Visual system to preserve
Preserve Tailwind 4, semantic shadcn tokens, Inter, Lucide, approximately 10px radius, existing `Button`, `Card`, `Badge`, `Input`, `Label`, `Textarea`, and `Separator` components (`src/app.css:26-59, 112-153`; `src/routes/admin/ingest/+page.svelte:5-12`). Retain the admin shell’s `max-w-7xl`, slate background, white cards, compact tables, monospace codes, semantic status badges, responsive two-column layout, and visible validation summaries.

### 6. Framework and live entry
SvelteKit 2/Svelte 5, Vite 7, TypeScript, Tailwind 4, SSR via adapter-node (`package.json:31-60`; `AGENTS.md:17-25`). The served HTML template is `src/app.html`, with `%sveltekit.head%` and `%sveltekit.body%` (`src/app.html:1-10`). No `.impeccable/live/config.json` exists; `/admin/ingest` is the logical live-review route. Static contains only `static/departamentos.csv` and `static/robots.txt`; no repository brand mark/favicon was found.

### 7. Minimal PRODUCT.md interview questions
1. Who is the primary ingest operator, and what spreadsheet/data-engineering expertise can be assumed?
2. What exactly constitutes a Phase 6 “batch”: definitions only, observation files too, or a staged multi-step release?
3. What are the required review gates—preview, duplicate resolution, overwrite policy, approval, rollback, and publication?
4. Which outcome defines success: fastest valid import, safest publication, strongest auditability, or some ranked combination?
5. Should admin visually inherit the public brand palette, or intentionally remain a neutral internal tool?
6. What batch sizes, error rates, retry behavior, and audit/history requirements must the UI support?