# Deploying Sitecraft

On Cloudflare? Follow [CLOUDFLARE.md](CLOUDFLARE.md) instead; it's automated end to end. This page covers other container hosts.

## What you need

| Piece | Local | Production |
|---|---|---|
| App container (API, editor, hosting) | `docker compose` | Any container host: AWS ECS/Fargate, Google Cloud Run, Fly.io, Render, Kubernetes |
| MCP container | `docker compose` | Same host, its own service and URL |
| Postgres 16 | Compose `db` | Managed: PlanetScale, RDS, Cloud SQL, Neon, Supabase |
| Object storage | Compose MinIO | S3, GCS (S3 API), Cloudflare R2 |
| TLS and DNS | Not needed | Domains for the app, the MCP server and published sites (wildcard for subdomains) |
| CDN (optional) | — | CloudFront or Cloudflare in front of the app for published sites |
| Secrets | `.env` | Your host's secret manager |

Start small: one app container (1 vCPU, 1–2 GB), one MCP container (0.5 vCPU, 512 MB), the smallest managed Postgres, one bucket. The app is stateless, so scale it horizontally; change events between instances go through Postgres `LISTEN/NOTIFY`.

## Images

Every push to `main` builds and pushes two images to GitHub Container Registry (`.github/workflows/release.yml`):

- `ghcr.io/ramkarthik77/sitecraft:<sha>` (and `:latest`) — the app
- `ghcr.io/ramkarthik77/sitecraft-mcp:<sha>` (and `:latest`) — the MCP server

Make the packages private or public under GitHub → Packages, and give your host pull access.

## Configuration

App container:

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set in the image |
| `DATABASE_URL` | `postgres://…` | Migrations run on startup |
| `SECRET` | 64 random hex chars | Signs preview links. Required (32+ chars) in production |
| `PUBLIC_URL` | `https://sitecraft.example.com` | Where the app is reachable |
| `EDITOR_URL` | `https://sitecraft.example.com` | Same as `PUBLIC_URL` when the app serves the editor |
| `CORS_ORIGINS` | `https://sitecraft.example.com` | Comma-separated |
| `SITES_DOMAIN` | `sites.example.com` | Optional. Publishes to `https://<slug>.sites.example.com`; needs `*.sites.example.com` DNS and certificate |
| `STORAGE_DRIVER` | `s3` | |
| `S3_BUCKET`, `S3_REGION` | `sitecraft-prod`, `us-east-1` | |
| `S3_ENDPOINT` | — | Only for non-AWS S3 (R2, MinIO) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | Omit to use the host's IAM role |
| `ADMIN_TOKEN` | random | Bootstrap admin. Mint other tokens with it, then rotate |
| `AGENT_CAN_PUBLISH`, `AGENT_CAN_EDIT_MAIN` | `false` | Leave off unless you want agents shipping without review |

MCP container:

| Variable | Example |
|---|---|
| `SITECRAFT_API_URL` | `http://sitecraft-app.internal:4000` (private network is best) |
| `PORT` | `4100` |

## Tokens

Seed tokens are for bootstrapping. For real users, mint one per person:

```bash
curl -X POST https://sitecraft.example.com/api/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe (Claude Code)","role":"agent"}'
```

Each person puts their agent token in `SITECRAFT_TOKEN` for Claude Code, and uses an editor token to sign in to the editor.

## Custom domains

1. In site settings, set the domain (for example `www.acme.com`) and publish again.
2. Point `www.acme.com` at the app with a CNAME.
3. Terminate TLS for that domain at your load balancer or CDN (Cloudflare and Fly can issue certificates automatically).

The app routes requests by `Host` header to the right site.

## Example: AWS

- ECS Fargate service for each image behind an Application Load Balancer, with ACM certificates for `sitecraft.example.com`, `mcp.sitecraft.example.com` and `*.sites.example.com`
- RDS Postgres 16 (db.t4g.micro to start) in private subnets
- S3 bucket; give the app task role `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on it
- Secrets Manager for `SECRET`, `ADMIN_TOKEN` and the database URL
- Optional CloudFront in front of the ALB for published sites

## Example: Google Cloud

- Two Cloud Run services from the GHCR images (or mirror to Artifact Registry)
- Cloud SQL for Postgres, connected over the Cloud SQL connector
- GCS bucket through its S3-compatible API with HMAC keys (`S3_ENDPOINT=https://storage.googleapis.com`)
- Secret Manager for secrets; domain mappings or a load balancer for custom domains

## Rolling out to Claude Code Enterprise

1. Deploy the MCP service at a stable HTTPS URL, such as `https://mcp.sitecraft.example.com/mcp`.
2. Add the plugin marketplace and the MCP allowlist to your managed settings (see `deploy/claude-code/managed-settings.example.json`), and set `SITECRAFT_MCP_URL` there.
3. Give each person an agent token for `SITECRAFT_TOKEN`.
4. Watch the audit log (`GET /api/sites/<id>/audit`) and Claude Code's own telemetry for MCP usage.
