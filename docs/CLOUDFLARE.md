# Deploying Sitecraft on Cloudflare

Same setup as pagefold: one Worker on your `guduriphaniram1988.workers.dev` subdomain, deployed from GitHub Actions with `cloudflare/wrangler-action`, secrets kept in GitHub. No DNS changes needed.

| | URL |
|---|---|
| Editor and API | https://sitecraft.guduriphaniram1988.workers.dev |
| Claude Code (MCP) | https://sitecraft.guduriphaniram1988.workers.dev/mcp |
| Published sites | https://sitecraft.guduriphaniram1988.workers.dev/s/&lt;slug&gt; |

```
                       Cloudflare
 ┌─────────────────────────────────────────────────────────┐
 │  sitecraft.<you>.workers.dev                            │
 │    /mcp ─────────> Worker ──> Container: mcp            │
 │    everything else   │  └───> Container: app (×2) ──────┼──> Neon Postgres
 │                      │             │                    │
 │               edge cache           └──> R2 (sites, images)
 └─────────────────────────────────────────────────────────┘
```

| Piece | Product | Cost to start |
|---|---|---|
| App and MCP servers | Cloudflare Containers behind one Worker | Workers Paid plan, $5/month, then usage |
| Published sites and images | R2 (bucket `sitecraft`) | Free tier covers 10 GB |
| Edge cache | Workers Cache API | Included |
| Database | Neon Postgres (Cloudflare doesn't host Postgres) | Free tier |

## One-time setup (about 15 minutes)

### 1. Workers Paid

Containers need the Workers Paid plan: dashboard → Workers & Pages → Plans. If pagefold already runs Browser Rendering or AI on this account, you may already have it.

### 2. API token

The `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets from pagefold can be reused if that token has these permissions; otherwise create a new token (My Profile → API Tokens → Create token → Custom token):

- Account → Workers Scripts: **Edit**
- Account → Containers: **Edit**
- Account → Workers R2 Storage: **Edit**
- Account → Account Settings: **Read**

### 3. R2 access keys

The app container reaches R2 through its S3-compatible API, which uses its own keys:

1. R2 → Overview → **Manage R2 API tokens** → Create API token
2. Permission **Object Read & Write**, bucket `sitecraft` (create the bucket first under R2 → Create bucket, or let the workflow create it)
3. Copy the **Access Key ID** and **Secret Access Key**

### 4. Database

1. Create a project at [neon.tech](https://neon.tech), region close to your users (for example AWS us-east-1).
2. Copy the **direct** connection string, not the pooled one. Sitecraft uses Postgres `LISTEN/NOTIFY` to push Claude's edits into open editors, and connection poolers break that. It looks like `postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`.

Tables are created on first start.

### 5. GitHub secrets

In github.com/ramkarthik77/sitecraft → Settings → Secrets and variables → Actions → **Repository secrets**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | from step 2 (same as pagefold if reused) |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID (same as pagefold) |
| `DATABASE_URL` | from step 4 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from step 3 |
| `SITECRAFT_SECRET` | output of `openssl rand -hex 32` |
| `SITECRAFT_ADMIN_TOKEN` | output of `openssl rand -hex 24`. Keep it: it mints everyone else's tokens |

The workflow stops with a clear error naming any secret that's missing.

### 6. Deploy

Actions → **Deploy Sitecraft to Cloudflare** → Run workflow. After that, every push to `main` that passes CI deploys on its own.

The workflow checks the bucket, deploys the Worker, both Containers and the secrets, then waits for the app (the first rollout takes a few minutes while Cloudflare pulls the image) and checks that the editor loads, the API accepts the admin token, and the MCP server lists its tools. The run summary shows the URLs.

### 7. Give people access

```bash
URL=https://sitecraft.guduriphaniram1988.workers.dev
ADMIN=<your SITECRAFT_ADMIN_TOKEN>

# Editor sign-in for a person
curl -X POST $URL/api/tokens -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe","role":"editor"}'

# The same person's Claude Code
curl -X POST $URL/api/tokens -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe (Claude Code)","role":"agent"}'
```

For Claude Code, each person sets:

```bash
export SITECRAFT_MCP_URL=https://sitecraft.guduriphaniram1988.workers.dev/mcp
export SITECRAFT_TOKEN=<their agent token>
```

## Use your own domain (optional, later)

Once a domain is on Cloudflare DNS, add to `deploy/cloudflare/wrangler.jsonc`:

```jsonc
"vars": {
  "APP_HOST": "sitecraft.example.com",
  // optional: published sites at https://<slug>.sites.example.com
  "SITES_DOMAIN": "sites.example.com"
},
"routes": [
  { "pattern": "sitecraft.example.com", "custom_domain": true },
  // only with SITES_DOMAIN; also add a proxied AAAA record *.sites → 100::
  { "pattern": "*.sites.example.com/*", "zone_name": "example.com" }
]
```

Then update `SITECRAFT_URL` in the workflow. Universal SSL covers one level of subdomain, so `*.sites.example.com` needs Advanced Certificate Manager; `sitecraft.example.com` does not. Give the token Zone → Workers Routes: Edit and DNS: Edit for that zone.

**Customer domains** (a site at `www.customer.com`): turn on SSL/TLS → Custom Hostnames (Cloudflare for SaaS) with `sitecraft.example.com` as the fallback origin, add a Worker route `*/*` for the zone, add each customer's hostname, have them CNAME it to `sitecraft.example.com`, then set the domain in the site's settings and publish.

## Running it

- **Logs:** Workers & Pages → sitecraft → Logs, or `npx wrangler tail` in `deploy/cloudflare`
- **Containers:** `npx wrangler containers list`
- **Scale:** raise `APP_INSTANCES` and `max_instances` in `wrangler.jsonc`; app instances are stateless
- **Cold starts:** a cron trigger pings every instance every five minutes; instances sleep only after 30 idle minutes
- **Caching:** published pages are cached at the edge for 60 seconds, so a publish can take up to a minute to show everywhere; uploaded images are cached for a year (their URLs never change)
- **Rollback:** site content from the editor (History → Published versions → Make live); the platform from Workers & Pages → sitecraft → Deployments
