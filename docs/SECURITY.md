# Security

How Sitecraft protects sites, people and data, and the settings to turn on when you deploy it.

## Before going live

Do these once, in this order:

1. **New secrets.** Generate `SITECRAFT_SECRET` and `SITECRAFT_ADMIN_TOKEN` fresh (`openssl rand -hex 32` each) and put them only in GitHub secrets. Never reuse values that were pasted in a chat, ticket or doc.
2. **Company sign-in in front of the editor.** Cloudflare Zero Trust → Access → Applications → **Self-hosted**, for `sitecraft.<you>.workers.dev` (or your editor domain). Require your identity provider and MFA. Then add one more self-hosted application per path below, on the same hostname, each with a **Bypass** policy for everyone, so the public and Claude Code can still reach them:

   | Path | Why |
   |---|---|
   | `/s/*` | Published sites |
   | `/media/*` | Their images |
   | `/forms/*` | Form submissions from visitors |
   | `/preview/*` | Signed preview links (they carry their own signature) |
   | `/mcp` | Claude Code, which signs in with its own agent token |

   With this, nobody reaches the editor or API without passing your company sign-in first, and Sitecraft's tokens are a second layer.
3. **Published sites on their own domains.** Put each live site on its own domain (Site settings → Domain, plus a CNAME), so public pages never share an address with the editor. See [CLOUDFLARE.md](CLOUDFLARE.md#use-your-own-domain-optional-later).
4. **Rate limiting at the edge.** Cloudflare → Security → WAF → Rate limiting rules: for example 300 requests per minute per IP to `/api/*`, and 10 per minute to `/forms/*`. Sitecraft also limits each server on its own.
5. **Bot check on forms (recommended).** Cloudflare → Turnstile → Add widget for your site domains. Add the keys as the `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` repository secrets; the next deploy turns the check on.
6. **Backups.** In the database dashboard, turn on point-in-time recovery. In R2, turn on object versioning for the `sitecraft` bucket (or a lifecycle rule that keeps deleted objects for 30 days).
7. **Tokens for people.** Give each person their own editor token, and each person's Claude Code its own agent token (Access page). Limit agent tokens to the sites they need.

## What's built in

### Pages can't carry code
Everything rendered into a page passes the checks in `packages/schema/src/validate.ts`: links must be `https:`, `mailto:`, `tel:`, `/` or `#`; images `https:`, `/` or `data:image/…`; CSS values can't break out of their declaration or load scripts; only known style properties are allowed. All text is escaped. Rich text is a Markdown subset that never renders raw HTML. Uploads are PNG, JPEG, GIF or WebP only, up to 10 MB, served with `Content-Security-Policy: sandbox`.

### Content-Security-Policy everywhere
- **Published pages and previews:** scripts are limited to Sitecraft's one runtime script (allowed by its hash) and Turnstile. No other inline script can run, and no plugins or `<base>` tricks.
- **Editor:** scripts only from the editor itself, no framing by other sites (`frame-ancestors 'none'`), connections only to its own API.
- **Embeds** (videos, maps) are sandboxed. Embeds of Sitecraft's own addresses, and every embed inside the editor canvas, never get `allow-same-origin`, so they can't script their way out.

The browser tests fail on any CSP violation, so a change that would weaken this shows up in CI.

### Sign-in and roles
- **Tokens** are random 192-bit values; only their SHA-256 hash is stored. New tokens expire after 90 days unless you choose otherwise. Admins list, create and revoke them on the **Access** page; a revoked token stops working within seconds.
- **Roles:** admin (everything), editor (edit, merge, publish), agent (Claude Code: edits on branches only). Agents can't edit `main`, merge or publish unless an admin sets `AGENT_CAN_EDIT_MAIN` / `AGENT_CAN_PUBLISH`. These checks live in the API (`assertCanWrite`, `assertCanShip`), so no client can skip them.
- **Site-limited tokens:** an editor or agent token can be limited to some sites; it can't see, edit or create anything else.
- **Live updates** sign in with a one-minute ticket for one site, so long-lived tokens never appear in URLs or logs.
- **Repeated failed sign-ins** from one address are blocked for 10 minutes after 30 failures.
- **The local app** accepts requests only from the same computer and refuses other websites and DNS-rebinding tricks.

### Claude Code
- Claude works on branches; a person reviews the diff and merges.
- Tool results that contain site content are marked as data written by others, so instructions hidden in a page or CMS item aren't treated as requests.
- Each person's Claude gets its own agent token, limited to the sites it needs, so history shows whose Claude did what.

### Visitors' data
- Form submissions keep only the fields sent, up to 5,000 characters each. A hidden trap field drops most bots; Turnstile stops the rest.
- Submissions are deleted after `FORM_RETENTION_DAYS` (default 365; `0` keeps them).
- Site settings → Form submissions: **Download CSV** (cells are escaped so spreadsheets don't run them as formulas) and **Delete** by a value, such as an email address, for data deletion requests.

### Audit
Every create, merge, publish, rollback, token change, form export and deletion is recorded with who did it. **Access → Download audit log** exports it all as CSV for a review or a security tool.

### Supply chain
- Dependabot opens weekly updates for npm packages, GitHub Actions and the Docker base image.
- The Security workflow runs `pnpm audit` (fails on high or critical advisories in shipped code) and CodeQL on every push and weekly.

## Settings

| Variable | Default | |
|---|---|---|
| `SECRET` | — | Signs preview links and live-update tickets. 32+ characters in production |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | off | Bot check on forms |
| `FORM_RETENTION_DAYS` | `365` | `0` keeps submissions |
| `RATE_LIMIT_PER_MINUTE` | `600` | API requests per IP per minute, per server |
| `AGENT_CAN_EDIT_MAIN`, `AGENT_CAN_PUBLISH` | `false` | Loosen Claude's limits |

## Known limits

- Tokens are kept in the browser's storage. The strict CSP makes stealing them through the page very hard; Cloudflare Access in front adds a session that a stolen token alone can't use.
- The per-server rate limits reset when a server restarts and aren't shared between servers; the Cloudflare rules in step 4 are the shared limit.
- Roles apply to whole sites. Per-page or per-brand permissions come with the brands work.

## Reporting a problem

Email the Sitecraft admins at your company with steps to reproduce. Don't open a public issue for security problems.
