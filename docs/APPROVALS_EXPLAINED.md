# Approvals in Sitecraft — a new author's guide

Sitecraft separates **drafting**, **reviewing**, **merging**, and **publishing**. An approved branch is *not* the live website. Use this guide for both standard approvals and medical/legal/regulatory (MLR) review.

> Training only: use invented claims, fictional brands, and disposable demo tokens. Do not treat an electronic signature or audit trail by itself as 21 CFR Part 11 / Annex 11 validation.

## Who does what

| Person | Can do | Cannot do |
| --- | --- | --- |
| Author / editor (Maya Chen) | Create a branch, edit pages and CMS content, preview, request review, respond to changes | Approve their own edits |
| Medical reviewer (Dr. Elena Ruiz) | Inspect a version, request changes, sign medical approval | Sign legal or regulatory approval without those permissions |
| Legal reviewer (Daniel Okafor) | Inspect, request changes, sign legal approval | Approve their own edits |
| Regulatory reviewer (Priya Nair) | Inspect and sign regulatory approval | Publish automatically just by signing |
| Publisher (a permitted person) | Merge an approved branch, publish or schedule a release | Bypass configured requirements without an explicit admin override |
| Claude Code agent | Draft on its own branch, preview, request review and resubmit | Sign a review; by default edit `main`, merge, or publish |
| Admin | Manage roles and policies; emergency merge override with audit entry | Replace formal quality-system validation |

Reviewers use **separate accounts/tokens**. An agent is attributed to the person it works for, so that person cannot approve the agent's changes.

## The normal happy path

1. **Author**: Sites → Calvexa US HCP → Pages / Open editor. Start a task branch, not `main` (example: `efficacy-update`). Update a headline or paragraph.
2. **Author**: Preview on Desktop, Tablet and Phone. Use **Review changes** to inspect the branch diff. Check page job codes, image rights, market clearance, spelling, links and alt text.
3. **Author**: Site → **Branches → Request review** (or editor review panel). Enter a descriptive title, optional job code, reviewer notes and deadline; click **Send for review**.
4. **Reviewer**: Sign in as a reviewer → **My work → Review**. Read **What changed**, preview and comments. Choose **Approve and sign** or **Ask for changes**.
5. **MLR reviewer**: For sign-off, enter your own full name, the same sign-in token again if prompted, and confirm the electronic signature statement. Each required discipline signs the **latest branch version**.
6. **Publisher**: When the review says **Approved**, click **Merge into main**. This changes the editable main version, *not* the public site.
7. **Publisher**: Open the site and click **Publish**, or schedule it. Verify the live URL and check **History**, **Activity**, and **Audit log**.

### What “changes requested” means

If Daniel (Legal) asks for changes, the review shows **Changes requested**, with his reason in the trail. The branch **cannot merge**. Maya updates the same branch, adds a response in a comment, then selects **Send for review again**. Reviewers review the changed document and sign again. **All signatures must belong to the current version.** That includes Dr. Elena even if she signed the previous version.

### Important states

| State | Meaning | Next action |
| --- | --- | --- |
| Draft branch | Work is isolated from `main`; not live | Edit and preview |
| Waiting for review | Reviewers have been asked; signatures outstanding | Open My work |
| Changes requested | A reviewer rejected the current submission | Fix and resubmit |
| Approved / Ready to merge | Required signatures on current version are complete | Authorized person merges |
| Merged | Approved branch moved to `main` | Publish or schedule |
| Published | Live site generated from main | Check live URL and History |
| Blocked | Readiness check found missing job code or unapproved/expired/out-of-market library image | Fix the blocker, recheck |

## Approval versus publishing checks

Two independent gates protect a regulated site:

- **Review gate**: A site may require Medical + Legal + Regulatory signatures, or 1–3 ordinary approvals. Authors cannot approve their own branch; changing a branch invalidates its previous approvals.
- **Publish-readiness gate**: Where job codes are mandatory, *every page* needs one. A library image must be approved, within usage rights and cleared for the site's market. These checks also apply to scheduled releases.

A completed MLR review does **not** make missing job codes or expired rights acceptable. A green readiness status does **not** replace MLR sign-off.

## Five failure cases to demonstrate

1. Try to approve your own branch → blocked.
2. Try to merge while Legal is outstanding → blocked.
3. Ask for changes, then attempt to merge → blocked.
4. Edit after Medical signs → the old signature no longer counts.
5. Use an expired / unapproved / wrong-market image or omit a mandatory page job code → publishing blocked.

Also show that Claude cannot sign, and show **Audit log → Verify integrity** after the walkthrough.

## Where to find things

- **Home / My work**: what needs action and who is waiting.
- **Sites → [site] → Branches**: drafts, diffs, request for review.
- **Reviews**: cross-site MLR inbox; **[site] → Reviews**: that site's reviews.
- **[site] → Pages**: authoring; **[site] → History**: versions and rollback.
- **[site] → Releases**: scheduling; **Assets**: rights and market metadata.
- **Access / Settings** (admin): reviewer identities and per-site MLR rules.

For a complete training scenario, see [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). For code/test evidence, see [FEATURE_VERIFICATION.md](FEATURE_VERIFICATION.md).
