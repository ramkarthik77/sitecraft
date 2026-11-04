# Website import and visual fidelity — implementation and QA

**Branch:** `docs/demo-approval-onboarding-recording` / PR #15.

## What changed

Sitecraft imports real page content into **editable, validated** Sitecraft documents.

| Stage | Input | Output | Safety / guarantee |
| --- | --- | --- | --- |
| 1. Public address validation | An authorized URL | Resolved entry page | `safeFetch` validates DNS, redirects, IPs, ports, time and sizes |
| 2. Bounded crawl | Navigation links, then nested pages | Up to 25 same-origin paths | Navigation-first, skip non-HTML resources |
| 3. Render | HTML, JS, CSS and GET resources | Rendered DOM, computed styles and a viewport screenshot | Playwright routes **all GETs** through `safeFetchBytes`; POST, websockets, service workers blocked; fallback to static |
| 4. Structural layout conversion | Rendered DOM | Editable hero split rows, card grids, headings, links, image elements | Inferred layout hints; no arbitrary scripts imported |
| 5. Optional Claude classification | Bounded section inventory | Suggested named Section types only | Opt-in; no model keys or output needed for deterministic mode; model output labels are allowlisted |
| 6. Sitecraft Section mapping | Semantic content | `add_block` for lossless fits; `add_node` otherwise | Preserve all meaningful media and paired headings/descriptions |
| 7. Assets | Source image URLs | PNG/JPEG/GIF/WebP in Sitecraft DAM as **DRAFT** | Sniff bytes and cap size; failed copies stay remote with warnings; never automatically approve |
| 8. Shared chrome | Equivalent nav and footers across imported pages | Shared components and instances | `create_component`, `remove_node`, `add_node` via validated operations |
| 9. Versioning and evidence | Mapped pages and screenshots | Site + audit events + protected screenshot endpoints | `repo.applyOps` and schema validation; require site permission to read screenshots |

### Actual user-facing behavior

Import dialog → paste authorized site URL → choose pages → keep **Render JavaScript and capture source layout** enabled → optionally select **Claude suggestions** → confirm ownership/reuse rights → **Import**.

The completion dialog shows counts for rendered pages, mapped Sections, preserved editable structures, shared components, imported draft assets and remaining remote images. In the editor, review the results *before* requesting approval or publishing.

The import starts on `main` by the authenticated editor, as the old feature did. Enterprise sites should require a post-import review and publish gate and use separate draft branches for subsequent changes. Do **not** present imported content as compliant or approved simply because import succeeded.

### Runtime configuration

- Server container now includes Chromium and exposes `SITECRAFT_IMPORT_CHROMIUM_PATH=/usr/bin/chromium`.
- Standalone/local Node must have a compatible Chromium executable; set `SITECRAFT_IMPORT_CHROMIUM_PATH`, or Playwright falls back to static parsing and warns.
- Claude is **disabled by default**. To opt in, configure `SITECRAFT_IMPORT_CLAUDE_API_KEY`, optional `SITECRAFT_IMPORT_CLAUDE_URL` (HTTPS), and optional `SITECRAFT_IMPORT_CLAUDE_MODEL` on the server. Only bounded section summaries are sent to Claude. Never expose these keys in the editor or PR.
- Review source rights before allowing import. Imported assets are **drafts**, not cleared for regulated markets.

### Test cases and video evidence

Workflow: [Record website import fidelity](../.github/workflows/record-import.yml). Run it from Actions or read its PR result. It tests three distinct fixture site archetypes, not arbitrary externally hosted websites:

1. **JavaScript-rendered marketing site**: hero with two columns, three feature cards, images, Playwright computed style and source/editor screenshots. It must verify each card's **correct title-to-description pairing**.
2. **Multi-page corporate site**: crawl an About page and Services page, identify repeated navigation/footer and reuse Sitecraft components.
3. **Pricing and FAQ page**: preserve editable titles, prices and answers without importing arbitrary JS.

The workflow uploads a source screenshot, Sitecraft editor screenshot, and Chromium `.webm` recordings for comparison. Check the workflow **passed**; an attached artifact from a failing run is diagnostic only.

## Important limitations and release blockers

This is a significant improvement, **not a pixel-perfect website cloning engine or a validated enterprise migration service**:

- Some third-party sites block scraping or require authentication; importing them requires appropriate authorization and provider support.
- Dynamic application state, cart/checkout, personalization, search, embedded forms and authenticated flows are **not recreated** simply by capturing rendered DOM.
- Screenshots are viewport captures at desktop size; full visual-diff CI for mobile/tablet and true pixel-difference thresholds are not yet built.
- Imported assets can lack licensing metadata and need human approval; remote images that could not be fetched remain remote.
- Browser security should be hardened further: isolated non-privileged worker runtime, resource quotas, safe egress at infrastructure level, per-job queue, rate limiting, and failure cleanup before broad untrusted enterprise usage.
- Claude currently classifies **block types**, not arbitrary pixel layouts; the deterministic converter remains the source of content, and classifying a section never authorizes unvalidated operations.
- The importer operates as one synchronous API request. Durable job state, retry/resume and per-page progress need a follow-up architecture for hundreds-of-sites industrial-scale migration.
- Regulated pharmaceutical publishing requires a separate validated quality management and MLR process, documented identity controls, accessibility checks, rights review and visual QA.

### Acceptance criteria for a future enterprise hardening PR

- [ ] Browser in a dedicated network-restricted worker, not the primary API process.
- [ ] Durable job queue, 10–25-page batch limits with retry, cancellation and progress.
- [ ] Capture DOM, CSS tokens, typography and assets at desktop/tablet/mobile with measured visual diffs.
- [ ] Structural/visual matching report per page, minimum-content and broken-link checks.
- [ ] Assets approved only after identity, market/rights, expiry and job-code validation.
- [ ] Import into a review branch rather than directly into `main` on governed sites.
- [ ] Real authorized-site benchmark corpus and baseline screenshots; record before/after and review manually.

See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the general author/approval demo and [FEATURE_VERIFICATION.md](FEATURE_VERIFICATION.md) for wider product coverage.
