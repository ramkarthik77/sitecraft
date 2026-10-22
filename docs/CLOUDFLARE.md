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
 │    everything else   │  └───> Container: app (×2)       │
 │                      │             ├──> R2 (sites, images)
 │               edge cache           └──> PlanetScale Postgres,
 │                                         created and billed in Cloudflare
 └─────────────────────────────────────────────────────────┘
```

| Piece | Product | Cost to start |
|---|---|---|
| App and MCP servers | Cloudflare Containers behind one Worker | Workers Paid plan, $5/month, then usage |
| Published sites and images | R2 (bucket `sitecraft`) | Free tier covers 10 GB |
| Edge cache | Workers Cache API | Included |
| Database | PlanetScale Postgres, created from the Cloudflare dashboard | From $5/month for one node |

Everything is set up from your Cloudflare account. Cloudflare planned to bill PlanetScale databases created there on your Cloudflare invoice from May 2026; the dashboard shows which applies to yours. Any other Postgres 16+ (Neon, Supabase, RDS) also works with the same `DATABASE_URL` secret.

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

Cloudflare creates Postgres databases through its PlanetScale partnership.

1. In the Cloudflare dashboard, open **Storage & databases → Hyperdrive → Create configuration** and pick **PlanetScale** as the provider, then **Postgres**. Connect or create the PlanetScale account when asked, choose a region close to your users (for example `us-east-1`) and the smallest size to start.
2. Open the new database in PlanetScale (the dashboard links to it) and create a **role** with full access under **Connect**. Sitecraft creates its own tables on first start, so the role needs to create tables.
3. Build the connection URL from what it shows, using **port 5432**:

   ```
   postgresql://<role>.<branch-id>:<password>@<host>.horizon.psdb.cloud:5432/<database>?sslmode=verify-full
   ```

   - Use port **5432** (direct), not 6432 (PgBouncer). Sitecraft uses Postgres `LISTEN/NOTIFY` to push Claude's edits into open editors, and poolers drop those. The deploy refuses a pooled URL.
   - Use the `postgresql://` form above, not the `psql 'host=… port=…'` form. Extras copied from PlanetScale's examples (`sslrootcert=system`, `sslnegotiation=direct`) are fine; Sitecraft ignores them.
   - Sitecraft's containers connect to the database directly. The Hyperdrive configuration from step 1 isn't used by Sitecraft; you can keep it or delete it.

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

### 8. Bring your local sites (optional)

If you built sites in the local app (`pnpm start`), copy them up. With the local app running:

```bash
SITECRAFT_TOKEN=<admin or editor token> pnpm move-to-cloud --dry-run   # see what would be copied
SITECRAFT_TOKEN=<admin or editor token> pnpm move-to-cloud --publish   # copy, and publish what was live locally
```

Each site's current `main` comes across: pages, design, CMS collections and items, and its uploaded images (copied to R2 and re-linked). Branches, history and form submissions stay on your computer, and your local copies aren't changed.

| Option | |
|---|---|
| `--site <slug>` | Only this site; repeat for more |
| `--rename` | A site whose address is already used in the cloud gets a new one (`blog-2`) instead of being skipped |
| `--to <url>` | Another Sitecraft, if not `sitecraft.guduriphaniram1988.workers.dev` |
| `--from <url>` | The local app, if not on `localhost:4000` |

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
