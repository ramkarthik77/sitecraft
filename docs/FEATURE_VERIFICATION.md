# Sitecraft demo acceptance and verification matrix

**Baseline reviewed:** `main` at `4756a3270fd8a9fcd1de519746066dbf77fd19eb` (October 25, 2026).  
**Evidence:** [passing GitHub CI](https://github.com/ramkarthik77/sitecraft/actions/runs/40228682691), [passing deployment smoke verification](https://github.com/ramkarthik77/sitecraft/actions/runs/40228913752), existing `e2e/editor.spec.ts`, and API/schema tests.  
**Important:** Green CI does not demonstrate *every* feature in a real shared workspace. Current Cloudflare UI was **not** independently exercised during this audit.

Status meaning:
- **Automated:** a named existing browser or API test covers the core path, and the main CI baseline passed.
- **Documented only:** user-facing documentation or implementation exists, but no dedicated complete E2E case was confirmed.
- **Production validation needed:** requires separate identity/security/compliance verification; do not assume complete.

| Feature | Code / tests to start with | Status | Demonstrate / confirm |
| --- | --- | --- | --- |
| Sign in, create site | `e2e/editor.spec.ts`: sign in and create | Automated | Wrong token rejected, valid token admitted |
| Canvas inline text, insert, undo/redo | `e2e/editor.spec.ts`: edit text | Automated | Saved state persisted |
| Desktop / Phone style | `e2e/editor.spec.ts`: edit text | Automated | Phone-only font override |
| Claude agent branch / live changes | `e2e/editor.spec.ts`: Claude edits | Automated | Changes visible, human merges |
| Publish and live site | `e2e/editor.spec.ts`: Claude edits | Automated | Public HTML and form submission |
| CMS collection / draft / listing | `e2e/editor.spec.ts`: CMS | Automated | Draft excluded from published site |
| Motion / scroll stories | `e2e/editor.spec.ts`: motion and scroll story | Automated | Preview animations and reduced-motion setting manually |
| History / restore / named versions | `e2e/editor.spec.ts`: time machine | Automated | Restore without losing audit history |
| Quick find / navigation / page moves | `e2e/editor.spec.ts`: quick find and moving pages | Automated | Nested redirects preserved |
| Releases / activity / access screen | `e2e/editor.spec.ts`: calendar and activity | Automated | Schedule UI; real delivery timing separately |
| MLR request, sign, reject, resubmit, merge | `e2e/editor.spec.ts`: MLR review | Automated | Medical + Legal sign-offs, changes loop |
| Three-discipline requirement and signing failures | `apps/api/test/pharma.test.ts` | Automated | Medical + Legal + Regulatory sample |
| Self-approval / agent-delegation prohibition | `apps/api/test/pharma.test.ts` | Automated | Author and delegated agent cannot self-approve |
| Mandatory page job codes | `apps/api/test/pharma.test.ts` | Automated | Missing code blocks publication |
| Image rights / unapproved / market restriction | `apps/api/test/pharma.test.ts` | Automated | Invalid library image blocks publication |
| Audit integrity / tamper detection | `apps/api/test/pharma.test.ts` | Automated | Verify chain in Admin → Audit log |
| Assets, folders, templates, tour | `e2e/editor.spec.ts`: folders/templates/tour | Automated | Add a folder, move and save template |
| Website import | `e2e/editor.spec.ts`: import a website | Automated | Test uses a locally published synthetic site |
| Brands / locking | `docs/AUTHORING.md`, API/library tests | Documented only | Validate locked tokens across sites |
| CMS translations / language switching | `docs/AUTHORING.md`, renderer `i18n.test.ts` | Documented only | Verify in editor and deployed language URLs; README wording may be stale |
| Editor comments / @mentions | `docs/AUTHORING.md`, reviews tests | Documented only | Thread lifecycle, context and recipient notification |
| Scheduled publish execution and rollback | `apps/api/test/schedules.test.ts`, history tests | Automated (API) | Confirm time zone, missed run and rollback in staged deployment |
| Multiple users, SSO/IdP, permissions across teams | `docs/SECURITY.md` | Production validation needed | Tokens are used; editor SSO is not native |
| GxP/21 CFR Part 11 / Annex 11 compliance | `docs/GOVERNANCE.md` | Production validation needed | QMS validation, SOPs, signature policy and identity proofing |
| Scaling / availability / accessibility / browser matrix | no complete E2E proof identified | Production validation needed | Load, screen-reader, cross-browser, recovery testing |
| Analytics / A-B tests / code plugins | `README.md` explicitly excludes these | Not built | Do not include in live feature demonstration |

## Demo exit criteria

- [ ] Existing unit and browser CI pass on the current branch; no newly failing workflows.
- [ ] A **disposable team-server workspace** is seeded and all four fictional people can sign in individually.
- [ ] New editor can find the site and author a page without administrator help.
- [ ] “Changes requested” prevents merge; same branch can be edited and resubmitted.
- [ ] Medical, Legal and Regulatory must all sign the **current** version before merge.
- [ ] Author/Claude self-approval blocked; permissions and audit trail shown.
- [ ] Job-code and asset-rights publishing blockers shown.
- [ ] A human merges, publishes and verifies live output; History rollback shown.
- [ ] Video artifact contains actual browser footage; recordings have no real secrets.
- [ ] Any unchecked row is disclosed as not yet verified before an enterprise demo.

## Open documentation gaps

`README.md` currently lists “multiple languages” under “Not built yet”, while `docs/AUTHORING.md` documents a translation workflow. Reconcile this by testing the current editor and deployment before claiming that localization is ready. Similarly, the README's “26 MCP tools” count may lag the detailed tool list in `docs/CLAUDE_CODE.md`.
