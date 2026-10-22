# Deploying Sitecraft on Cloudflare

Everything runs on Cloudflare except the database.

```
                       Cloudflare
 ┌──────────────────────────────────────────────────────────────┐
 │  sitecraft.<domain>      ─┐                                   │
 │  sitecraft-mcp.<domain>  ─┼─> Worker ──> Container: app (×2) ─┼──> Neon Postgres
 │  *.sites.<domain>        ─┘   (edge cache)  Container: mcp    │
 │  customer domains (Cloudflare for SaaS)          │            │
 │                                                  └──> R2      │
 └──────────────────────────────────────────────────────────────┘
```

| Piece | Cloudflare product | Cost to start |
|---|---|---|
| App and MCP servers | Containers (behind one Worker) | Workers Paid plan, $5/month, then usage |
| Published sites and images | R2 | Free tier covers 10 GB |
| Domains, TLS, CDN | DNS, Universal SSL, cache | Included |
| Customer custom domains | Cloudflare for SaaS (optional) | Free allowance, then per hostname |
| Database | Neon (not Cloudflare) | Free tier to start |

## One-time setup (about 20 minutes)

You'll end up with:

- the editor at `https://sitecraft.<domain>`
- the MCP server at `https://sitecraft-mcp.<domain>/mcp`
- published sites at `https://<slug>.sites.<domain>`

### 1. Cloudflare account

1. Your domain must be on Cloudflare DNS (it is, if Cloudflare already serves it).
2. Turn on **Workers Paid** under Workers & Pages → Plans. Containers need it.
3. Copy your **Account ID** from the dashboard sidebar.

### 2. DNS for published sites

Add one DNS record so `*.sites.<domain>` reaches the Worker:

| Type | Name | Content | Proxy |
|---|---|---|---|
| AAAA | `*.sites` | `100::` | Proxied (orange cloud) |

`sitecraft.<domain>` and `sitecraft-mcp.<domain>` are created for you by the deploy.

If your plan doesn't cover a certificate for `*.sites.<domain>` (Universal SSL covers one level of subdomain only), either buy Advanced Certificate Manager, or delete the `SITES_DOMAIN` line and the `*.sites` route in `deploy/cloudflare/wrangler.jsonc` so sites are served at `https://sitecraft.<domain>/s/<slug>`.

### 3. R2 credentials

1. R2 → Overview → **Manage R2 API tokens** → Create API token.
2. Permission: **Object Read & Write**, applied to the bucket `sitecraft` (the deploy creates it if it doesn't exist; you can create it first in R2 → Create bucket).
3. Copy the **Access Key ID** and **Secret Access Key**.

### 4. Database

1. Create a project at [neon.tech](https://neon.tech) in the region nearest your users.
2. Copy the **direct** connection string (not the pooled one; Sitecraft uses `LISTEN/NOTIFY` for live editor updates, which poolers break). It looks like `postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.

Tables are created automatically on first start.

### 5. Cloudflare API token for GitHub

My Profile → API Tokens → Create token → **Custom token** with:

- Account: Workers Scripts **Edit**, Containers **Edit**, Workers R2 Storage **Edit**, Account Settings **Read**
- Zone (your domain): Workers Routes **Edit**, DNS **Edit**

### 6. GitHub settings

In github.com/ramkarthik77/sitecraft → Settings → Secrets and variables → Actions:

**Variables**

| Name | Value |
|---|---|
| `CLOUDFLARE_DOMAIN` | your domain, e.g. `acme.com` |
| `CLOUDFLARE_ACCOUNT_ID` | from step 1 |

**Secrets**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | from step 5 |
| `DATABASE_URL` | from step 4 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from step 3 |
| `SITECRAFT_SECRET` | output of `openssl rand -hex 32` |
| `SITECRAFT_ADMIN_TOKEN` | output of `openssl rand -hex 24` (keep it; it mints everyone else's tokens) |

Also create an **Environment** named `production` (Settings → Environments). Add required reviewers there if you want a person to approve each deploy.

### 7. Deploy

Actions → **Deploy to Cloudflare** → Run workflow. From then on, every push to `main` that passes CI deploys automatically.

The first rollout takes a few minutes while Cloudflare pulls the image. The workflow waits and checks `https://sitecraft.<domain>/healthz`.

### 8. Create people's tokens

```bash
ADMIN=<your SITECRAFT_ADMIN_TOKEN>
# A person who uses the editor
curl -X POST https://sitecraft.<domain>/api/tokens -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" -d '{"name":"Jane Doe","role":"editor"}'
# The same person's Claude Code
curl -X POST https://sitecraft.<domain>/api/tokens -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" -d '{"name":"Jane Doe (Claude Code)","role":"agent"}'
```

Each person signs in to the editor with their editor token, and sets `SITECRAFT_TOKEN` to their agent token and `SITECRAFT_MCP_URL=https://sitecraft-mcp.<domain>/mcp` for Claude Code.

## Customer custom domains (optional)

To let a site live at `www.customer.com`:

1. Turn on **SSL/TLS → Custom Hostnames** (Cloudflare for SaaS) for your zone and set the fallback origin to `sitecraft.<domain>`.
2. Add a Worker route `*/*` on your zone pointing at the `sitecraft` Worker, so custom hostnames reach it.
3. For each customer: add their hostname under Custom Hostnames, have them CNAME `www.customer.com` to `sitecraft.<domain>`, set the domain in the site's settings in the editor, and publish.

## Running it

- **Logs:** Workers & Pages → sitecraft → Logs, or `npx wrangler tail` in `deploy/cloudflare`.
- **Containers:** `npx wrangler containers list`.
- **Scale:** raise `APP_INSTANCES` and `max_instances` in `wrangler.jsonc`. Instances are stateless, so any number works.
- **Cold starts:** a cron trigger pings every instance every five minutes, and instances sleep only after 30 minutes idle.
- **Caching:** published pages are cached at the edge for 60 seconds, so a publish can take up to a minute to show everywhere. Uploaded images are cached for a year (their URLs never change).
- **Rollback:** in the editor (History → Published versions → Make live) for site content; Workers & Pages → Deployments for the platform itself.
