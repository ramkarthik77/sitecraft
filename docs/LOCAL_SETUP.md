# Running Sitecraft on your computer

## Demo quick start — Docker and PR #15

Use a **new, disposable** workspace. These exact commands are for the local
team walkthrough and include the PDF/DOCX/website importer from
[PR #15](https://github.com/ramkarthik77/sitecraft/pull/15) (not yet merged into `main`).

```bash
git clone https://github.com/ramkarthik77/sitecraft.git
cd sitecraft
git switch docs/demo-approval-onboarding-recording
cp .env.example .env
docker compose up -d --build
docker compose ps --all
curl --fail http://localhost:4000/healthz
docker compose exec app chromium --version
# Seed ONCE, only after confirming the workspace is empty.
docker compose exec -e SITECRAFT_URL=http://localhost:4000 -e SITECRAFT_TOKEN=dev-admin-token app node scripts/demo-seed.mjs
```

Open **http://localhost:4000**. Sign in with `dev-admin-token` (or
the value you set for `ADMIN_TOKEN`). The seed prints separate 30-day tokens
for Maya (author), Dr. Elena (Medical), Daniel (Legal) and Priya (Regulatory).
Keep the values private. For independent roles, use separate browser profiles
rather than changing tokens in a shared browser tab.

Run the **optional importer smoke** in the same disposable workspace. This
creates two extra sample imported sites, but does not publish them:

```bash
docker compose exec -e SITECRAFT_DEMO_SMOKE=1 -e SITECRAFT_URL=http://localhost:4000 -e SITECRAFT_TOKEN=dev-admin-token app node scripts/demo-import-smoke.mjs
docker compose cp app:/tmp/sitecraft-smoke.pdf ./sitecraft-smoke.pdf
docker compose cp app:/tmp/sitecraft-smoke.docx ./sitecraft-smoke.docx
```

The copied files can be dragged into **Import → PDF / Word file** during
the presentation. The smoke verifies authentication, Chromium, PDF and DOCX
extraction, a DOCX table and embedded image, a **DRAFT** DAM asset, and the
`import/...` review branch with unchanged `main`. To validate an actual
authorized public website too, append `--website https://YOUR-SITE.example`
to the smoke command; external network access and reuse permission are required.
The isolated Playwright import-fidelity workflow also covers a JavaScript
website with controlled fixtures.

**Do not re-seed an existing workspace.** The script now refuses to seed
when any site exists. `docker compose down -v` **permanently deletes** the
database and media volumes; run it only for an intentionally disposable demo.


Pick the way that fits:

| | The local app | Team server, Docker (A) | Team server, no Docker (B) |
|---|---|---|---|
| Best for | One person on their own computer | Testing the shared setup end to end | Changing the code (hot reload) |
| You install | Node 22+ (24 recommended), pnpm | Docker Desktop | Node 24, pnpm 10, Postgres 16 |
| Database | Built in (a folder) | Postgres in Docker | Your Postgres |
| Sign-in | None; only this computer can connect | Tokens | Tokens |
| Start | `pnpm start` | `docker compose up` | `pnpm dev` |
| Editor at | <http://localhost:4000> | <http://localhost:4000> | <http://localhost:5173> |

## The local app

```bash
git clone https://github.com/ramkarthik77/sitecraft
cd sitecraft
pnpm install
pnpm start
```

The first `pnpm start` builds everything (about a minute) and opens the editor at <http://localhost:4000>. After that it starts in a few seconds, and rebuilds by itself when you pull new code.

It prints:

```
  Sitecraft is running

  Editor        http://localhost:4000
  Your data     /Users/you/.sitecraft

  Connect Claude Code (once):
    claude mcp add --transport http --scope user sitecraft http://localhost:4100/mcp
```

Run that `claude mcp add` command once; from then on every Claude Code session can use Sitecraft while the app is running. Press Ctrl+C to stop.

**No sign-in, and why that's safe.** The app listens only on `127.0.0.1`, so other computers can't reach it. It also refuses requests whose `Host` or `Origin` isn't `localhost`, so a website open in your browser can't talk to it either. Claude Code still connects as an agent: it works on branches and can't change `main`, merge or publish. You do those in the editor.

**Your data.** Everything is in one folder, `~/.sitecraft` by default:

| Path | What |
|---|---|
| `db/` | The database (sites, versions, branches, form submissions) |
| `storage/` | Uploaded images and published files |
| `config.json` | This computer's secret and Claude's token. Keep it private |

Back up by copying the folder while Sitecraft is stopped. To start over, stop Sitecraft and delete the folder.

**Publishing.** Published sites are served at `http://localhost:4000/s/<slug>`, which only you can see. To put a site online, open **Settings → Export**, optionally enter the address it will live at (this adds a sitemap and search-engine links), and download the .zip. It's plain HTML, CSS and images; upload it to Cloudflare Pages, Netlify or any web server.

**Moving to the cloud.** When your team moves to the Cloudflare setup, `pnpm move-to-cloud` copies your sites up, CMS content and images included. See [CLOUDFLARE.md](CLOUDFLARE.md#8-bring-your-local-sites-optional).

**Options**

| | |
|---|---|
| `pnpm start --no-open` | Don't open the browser |
| `pnpm start --rebuild` | Build again, for example after changing the code yourself |
| `SITECRAFT_DATA=/path pnpm start` | Keep data somewhere else |
| `SITECRAFT_PORT=4010 SITECRAFT_MCP_PORT=4110 pnpm start` | Use other ports. Change the port in the `claude mcp add` command to match |

## Run it as a team server

Options A and B run the full server with sign-in, for a team or to work on Sitecraft itself. Either way you get the same four pieces:

| Piece | Address | What it is |
|---|---|---|
| Editor | `localhost:4000` (A) or `localhost:5173` (B) | Where people design sites |
| API and published sites | `localhost:4000` | REST API, previews, sites at `/s/<slug>` |
| MCP server | `localhost:4100/mcp` | What Claude Code connects to |
| Postgres | `localhost:5432` | Sites, versions, branches, form submissions |

## Option A: Docker

### 1. Install Docker

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows) or Docker Engine with the Compose plugin (Linux), and start it. Check:

```bash
docker compose version
```

### 2. Get the code and settings

```bash
git clone https://github.com/ramkarthik77/sitecraft
cd sitecraft
cp .env.example .env
```

The defaults in `.env` are disposable demo values. Change the three tokens before anyone else can reach your computer, and use the matching admin value in seed/smoke commands.

### 3. Start everything

```bash
docker compose up --build
```

The first build downloads Node dependencies and Chromium plus PostgreSQL/MinIO images, so it takes longer than subsequent starts. Check `docker compose ps --all` for healthy `app`, `db` and `mcp`, and a successfully exited `storage-init`. Then check `curl --fail http://localhost:4000/healthz`. If startup fails, inspect `docker compose logs db storage storage-init app mcp`.

### 4. Sign in

Open <http://localhost:4000> and paste `dev-editor-token` (the `EDITOR_TOKEN` from `.env`). Create a site, edit it, then press **Publish**; the published site opens at `http://localhost:4000/s/<your-site-slug>`.

Compose also runs MinIO for storage. Its console is at <http://localhost:9001> (user `sitecraft`, password `sitecraft-secret`) if you want to see the published files. A one-shot `storage-init` container waits for MinIO and confirms the `sitecraft` bucket before the API starts. Demo ports bind to localhost; this is **not** a remotely exposed production environment.

### Everyday commands

```bash
docker compose up -d --build   # start in the background, rebuilding after a git pull
docker compose logs -f app     # follow the API log
docker compose down            # stop, keep your data
docker compose down -v         # DANGER: permanently delete demo sites, versions and all stored media
```

### Docker demo troubleshooting and imports

- **API not healthy / MinIO not ready:** `docker compose ps --all` and `docker compose logs --tail=100 storage storage-init app`. The MinIO client initializer must finish with exit code 0. Verify ports 4000, 4100, 5432, 9000 and 9001 are not already occupied.
- **Chromium not found / static fallback:** `docker compose exec app chromium --version` and `docker compose exec app printenv SITECRAFT_IMPORT_CHROMIUM_PATH`. The image sets `/usr/bin/chromium`; browser requests must pass the existing URL safety rules. Private/localhost source URLs are blocked by default.
- **No reviewer identity:** use the Docker **team server**, not `pnpm start` single-owner mode. Seed prints role-specific tokens; use a distinct browser profile for each reviewer. Never show token values in the recording.
- **File import appears missing:** open the returned site, choose the `import/...` branch (or open the resulting editor link). Imported file content is intentionally absent from `main` until an approved merge. **Assets** shows embedded images as DRAFT; review rights and alt text before publishing.
- **Scanned PDF / complex Word formatting:** OCR, embedded PDF media, complicated tables and perfect source layout reproduction are not supported. Read the import warnings and correct the editable sections.
- **Seed accidentally run again:** it refuses if any site exists. For an entirely fresh disposable demo only, `docker compose down -v` then `docker compose up -d --build` and seed once. Never reset a shared workspace.
- **CI/browser tests:** `pnpm test:e2e` wipes its configured database; **do not** run it against the Docker demo's `sitecraft` database. Use the isolated GitHub Actions smoke workflow or a separate `sitecraft_e2e` database.

See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for author → MLR → publish, and
[IMPORT_SOURCES.md](IMPORT_SOURCES.md) for the file upload API and limitations.

## Option B: without Docker

### 1. Install the tools

- **Node.js 22**: from [nodejs.org](https://nodejs.org), or `nvm install 22`.
- **pnpm 10**: run `corepack enable` (comes with Node), then check `pnpm -v`.
- **Postgres 16**, one of:
  - macOS: `brew install postgresql@16 && brew services start postgresql@16`
  - Ubuntu/Debian: `sudo apt install postgresql` (starts automatically)
  - Any OS with Docker: `docker run -d --name sitecraft-db -p 5432:5432 -e POSTGRES_USER=sitecraft -e POSTGRES_PASSWORD=sitecraft -e POSTGRES_DB=sitecraft postgres:16-alpine`

On Windows, use Option A or run these steps inside WSL.

### 2. Create the database

Skip this if you used the Docker one-liner above.

```bash
# macOS (Homebrew)
psql postgres -c "CREATE USER sitecraft WITH PASSWORD 'sitecraft' CREATEDB;"
psql postgres -c "CREATE DATABASE sitecraft OWNER sitecraft;"

# Linux
sudo -u postgres psql -c "CREATE USER sitecraft WITH PASSWORD 'sitecraft' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE sitecraft OWNER sitecraft;"
```

`CREATEDB` lets the browser tests create their own throwaway database later.

### 3. Install, configure and build

```bash
git clone https://github.com/ramkarthik77/sitecraft
cd sitecraft
pnpm install
cp .env.example .env
pnpm build
```

`.env` already points at `postgres://sitecraft:sitecraft@localhost:5432/sitecraft`. Change `DATABASE_URL` if your database lives elsewhere.

### 4. Load the settings into your shell

```bash
set -a; . ./.env; set +a
```

Do this in every new terminal before the commands below.

### 5. Add a demo site (optional) and start

```bash
pnpm seed   # creates a demo site called Acme
pnpm dev    # API :4000, editor :5173, MCP server :4100
```

Tables are created automatically on first start. Open <http://localhost:5173> and sign in with `dev-editor-token`.

### What reloads by itself

| You change | What happens |
|---|---|
| `apps/editor` | The browser updates instantly |
| `apps/api`, `apps/mcp` | The server restarts by itself |
| `packages/schema`, `packages/renderer` | Run `pnpm build` (or `pnpm --filter @sitecraft/schema build`); the API restarts and the editor reloads |

## Tokens and roles

Sign-in and Claude Code both use API tokens. Each token has a role:

| Role | Can do | Local token from `.env` |
|---|---|---|
| `admin` | Everything, including creating tokens | `dev-admin-token` |
| `editor` | Edit any branch, merge, publish | `dev-editor-token` |
| `agent` | Edit branches, preview, request review. Can't edit `main`, merge or publish | `dev-agent-token` |

Make a token for a real person (with the settings loaded, as in step 4):

```bash
pnpm --filter @sitecraft/api exec tsx src/cli.ts token "Jane Doe" editor
pnpm --filter @sitecraft/api exec tsx src/cli.ts token "Jane Doe (Claude Code)" agent
```

It prints the token once. Only a hash of it is stored.

## Connect Claude Code

With the local app, run the `claude mcp add` command that `pnpm start` prints; no token is needed.

With a team server running, from the repo folder:

```bash
export SITECRAFT_TOKEN=dev-agent-token
claude
```

The repo's `.mcp.json` points Claude Code at `http://localhost:4100/mcp`; approve the `sitecraft` server when Claude Code asks. Then try: *"Create a Sitecraft site for a coffee shop called Northstar, with a menu section, and send me the review link."* Open the editor while it works to watch the changes appear.

[CLAUDE_CODE.md](CLAUDE_CODE.md) covers connecting from other projects, the plugin, and every tool.

## Run the tests

The tests need Postgres. Create a test database once:

```bash
psql postgres://sitecraft:sitecraft@localhost:5432/postgres -c "CREATE DATABASE sitecraft_test;"
pnpm exec playwright install chromium   # once, for the browser tests
```

Then:

```bash
pnpm test        # schema, renderer, Cloudflare routing, API and MCP tests
pnpm test:e2e    # builds everything and drives the editor in Chromium
```

`pnpm test` uses `TEST_DATABASE_URL` (default `postgres://sitecraft:sitecraft@localhost:5432/sitecraft_test`). `pnpm test:e2e` uses `DATABASE_URL` and wipes it, so point it at a throwaway database:

```bash
DATABASE_URL=postgres://sitecraft:sitecraft@localhost:5432/sitecraft_e2e pnpm test:e2e
```

## Start over with empty data

Local app: stop it, then delete `~/.sitecraft` (or your `SITECRAFT_DATA` folder).

Docker: `docker compose down -v`, then `docker compose up`.

Without Docker:

```bash
psql postgres://sitecraft:sitecraft@localhost:5432/postgres -c "DROP DATABASE sitecraft;" -c "CREATE DATABASE sitecraft;"
rm -rf data/storage
```

## Settings reference

All settings are environment variables. `.env.example` lists the common ones.

**API and editor server** (`apps/api`)

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgres://sitecraft:sitecraft@localhost:5432/sitecraft` | Postgres connection. Use a direct connection, not a pooler |
| `PORT`, `HOST` | `4000`, `0.0.0.0` | Where the API listens |
| `PUBLIC_URL` | `http://localhost:<PORT>` | Public address of the API; used in preview, form and image links |
| `EDITOR_URL` | `http://localhost:5173` | Where the editor runs; used in review links handed to Claude |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API |
| `EDITOR_DIST` | unset | Folder of the built editor; when set, the API serves the editor itself |
| `SECRET` | dev value | Signs preview links. Required, 32+ characters, when `NODE_ENV=production` |
| `ADMIN_TOKEN`, `EDITOR_TOKEN`, `AGENT_TOKEN` | unset | Tokens created on startup |
| `AGENT_CAN_PUBLISH` | `false` | Let agent tokens merge and publish |
| `AGENT_CAN_EDIT_MAIN` | `false` | Let agent tokens edit `main` directly |
| `SITES_DOMAIN` | unset | Serve published sites at `<slug>.<SITES_DOMAIN>` |
| `STORAGE_DRIVER` | `fs` | `fs` (local folder) or `s3` (S3, R2, MinIO) |
| `STORAGE_DIR` | `./data/storage` | Folder for `fs` storage |
| `S3_BUCKET`, `S3_REGION` | `sitecraft`, `us-east-1` | Bucket for `s3` storage |
| `S3_ENDPOINT` | unset | Needed for MinIO and R2 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | Omit to use the machine's cloud credentials |
| `S3_FORCE_PATH_STYLE` | on when `S3_ENDPOINT` is set | Path-style bucket URLs |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

**MCP server** (`apps/mcp`)

| Variable | Default | What it does |
|---|---|---|
| `SITECRAFT_API_URL` | `http://localhost:4000` | Where the API is |
| `PORT` | `4100` | Where the MCP server listens (HTTP mode) |
| `SITECRAFT_TOKEN` | unset | The token to act as, in stdio mode only |

**Editor dev server** (`apps/editor`)

| Variable | Default | What it does |
|---|---|---|
| `SITECRAFT_API_URL` | `http://localhost:4000` | Where `pnpm dev` forwards `/api`, previews and sites |

**Tests**

| Variable | Default | What it does |
|---|---|---|
| `TEST_DATABASE_URL` | `postgres://sitecraft:sitecraft@localhost:5432/sitecraft_test` | Database for `pnpm test` (wiped each run) |
| `TEST_S3_ENDPOINT` | unset | Run the API tests against S3-compatible storage instead of a folder |
| `DATABASE_URL` | `…/sitecraft_e2e` | Database for `pnpm test:e2e` (wiped each run) |
| `E2E_PORT` | `4300` | Port for the browser test server |
| `PW_CHROMIUM_PATH` | unset | Use an already-installed Chromium for the browser tests |

Something not working? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
