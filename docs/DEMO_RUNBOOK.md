# Sitecraft live demo and author onboarding

**Audience:** a first-time author, MLR reviewer, publisher and platform admin.  
**Dataset:** invented Calvexa / Neurivo pharmaceutical brands, sample job codes and synthetic images.  
**Goal:** show one coherent lifecycle from authoring → changes requested → all three MLR signatures → merge → publish → history; then explore the remaining features.

This is a **live-app walkthrough**, not a static HTML mock. The GitHub video job records a **real Chromium test on an isolated disposable database**; it never uses the hosted production data.

## 1. Choose the right environment

| Mode | Suitable for | Approval-demo limitation |
| --- | --- | --- |
| `pnpm start` local single-user | Trying the visual editor and Claude branches | Local owner acts alone: the seed does **not** create independent reviewer identities |
| Docker / Postgres **team server** | **Recommended**: real multiple-person approvals and token switching | Use an empty disposable database only |
| Cloudflare deployment | Showcase the deployed application | Never seed or mutate a shared/live deployment just to demo |

With Node 24, pnpm 10 and Docker Desktop installed:

```bash
git clone https://github.com/ramkarthik77/sitecraft.git
cd sitecraft
cp .env.example .env
# Keep this demo on your own computer. Do not expose the sample tokens in .env.
docker compose up -d --build

# Seed only a BRAND-NEW throwaway workspace.
# All of these demo names and assets are fictional.
docker compose exec -e SITECRAFT_URL=http://localhost:4000 \
  -e SITECRAFT_TOKEN=dev-admin-token app node scripts/demo-seed.mjs
```

Open **http://localhost:4000**. Sign in with the admin token from your local `.env` (the example above assumes `dev-admin-token`). The seed prints four **30-day demo reviewer tokens** for Maya, Dr. Elena, Daniel and Priya; save them locally and **do not** commit or screen-record the tokens. If you customized `ADMIN_TOKEN` in `.env`, substitute the new value in the command. **Never run the seed twice** against the same workspace; it creates new sites.

For a clean restart on an *exclusively disposable* Docker workspace, see [LOCAL_SETUP.md](LOCAL_SETUP.md#start-over-with-empty-data). The reset can delete all local sites; do not run it on work you care about.

**Identity tip:** tokens live in browser storage. To switch roles cleanly, use separate browser profiles or sign out before signing in as another role. Keep actual token values out of the recording.

## 2. The 12-minute presenter script

| Time | Screen and action | Explain to the audience |
| --- | --- | --- |
| 00:00 | **Home → My work**; show pending reviews and upcoming releases | This is where a new user begins |
| 01:00 | **Sites**; filter Immunology → Calvexa → US → HCP; open **Calvexa US HCP** | Portfolio taxonomy is not a single giant list |
| 02:00 | **Pages → Open editor**; start/open an author branch, edit a headline; switch Desktop/Phone, inspect mobile style and use Undo/Redo | Changes are versioned; branch work is not live |
| 03:30 | **Assets**; inspect approval, job code, markets, rights expiry and alt text | Site-specific usage and shared DAM governance are separate |
| 04:30 | **Branches → Review changes → Request review**; title it “Demo efficacy copy update” | A review applies to an exact version |
| 05:30 | Sign in as **Dr. Elena Ruiz** → My work → Review → Approve and sign as Medical | The signature is attributable to one qualified person |
| 06:30 | Sign in as **Daniel Okafor** → review → Ask for changes: “Add balanced risk language” | A reviewer can stop publication and require a fix |
| 07:30 | Return as **Maya Chen** → update branch, add comment, **Send for review again** | Updating invalidates stale sign-offs |
| 08:30 | Sign in as **Dr. Elena**, **Daniel**, **Priya Nair**; sign current version as Medical, Legal and Regulatory | All required disciplines must sign current content |
| 10:00 | As authorized publisher, **Merge into main**, then **Publish** | Approval, merge and publish are distinct |
| 11:00 | Open published URL; show **History**, **Releases**, **Activity**, **Audit log → Verify** | Evidence and rollback are first-class |
| 12:00 | Invite questions; open **? → Take the tour** | New users can discover the product on their own |

**Note:** The seeded **Calvexa US HCP** has an existing “efficacy-update” branch and review. For a clean authoring demonstration, create a *new branch with a new name* instead of resubmitting or modifying the seeded review. The synthetic dataset also includes a review sent back for Neurivo UK Patient, so you can show the “changes requested” state without altering it.

## 3. A self-contained recorded sample

Run the isolated video workflow in **Actions → Record Sitecraft demo → Run workflow** (or inspect the artifact produced by a pull request). It:

1. Provisions a temporary Postgres 16 database and test-only admin/editor/reviewer tokens.
2. Builds Sitecraft and starts the actual editor and API.
3. Runs the existing automated browser suite **with video capture** (including editing, branch/review/merge/publish, history, CMS, navigation, assets, templates and MLR).
4. Uploads the Chromium `.webm` recordings as a GitHub Actions artifact named **sitecraft-browser-demo** even when a test fails. Failure means the recording is troubleshooting evidence, **not** a successful demo.

To record on your computer instead:

```bash
# Make sure PostgreSQL 16 is running and this DATABASE_URL is *disposable*.
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
E2E_VIDEO=1 DATABASE_URL=postgres://sitecraft:sitecraft@localhost:5432/sitecraft_e2e pnpm test:e2e
# Videos: test-results/<test-name>/video.webm
```

**Warning:** `pnpm test:e2e` drops the `public` schema of the target database! Never point it at the team/production database. The automated recordings intentionally use synthetic data and test tokens; they do **not** certify the hosted Cloudflare site's current state.

## 4. Guided exploration after the main story

- **Content:** CMS → create a collection, draft an item, list it on a page, publish; check draft exclusion.
- **Visual:** Insert sections, edit typography/layout, inspect phone overrides, motion and scroll-story preview.
- **Structure:** New page → nested pages → redirects after moving; Sites folders, Templates and Brands.
- **Governance:** Assets folder, rights expiry, market clearance, comments, author-vs-reviewer permissions, notifications, audit trail.
- **Operations:** Scheduled release, version compare, restore an earlier page, published-site rollback and export.
- **AI:** Ask Claude to update an agent branch through Sitecraft MCP; check the change highlights, diff and review request. Do not allow agents to approve or publish.

## 5. Presenter-ready talking points

- “**Branch** is an editable workspace; **main** is the approved candidate; **live** is the currently published release.”
- “MLR is **not one Approve button**. It is Medical, Legal and Regulatory decisions by separate people on a specific version.”
- “**Request changes** blocks merging. After a fix, reviewers must sign the new version.”
- “**Claude** drafts on a branch and can ask for review, but it never provides the human signature.”
- “**Compliance** requires organizational validation, procedures and identity controls beyond this demo.”

## 6. Share the recording and train a new author

Store the Actions artifact link beside this runbook. A `video.webm` is a **real browser recording**, not a narration or polished promotional film. Record a separate narrated presenter session for external audiences if desired. **Do not commit recordings containing real tokens, internal URLs, customer data or regulated claims.**

Use [APPROVALS_EXPLAINED.md](APPROVALS_EXPLAINED.md) as the author handout and [FEATURE_VERIFICATION.md](FEATURE_VERIFICATION.md) as the feature-by-feature QA checklist.
