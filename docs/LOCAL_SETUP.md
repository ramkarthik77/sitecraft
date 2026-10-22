# Running Sitecraft on your computer

Two ways to run it:

| | Option A: Docker | Option B: without Docker |
|---|---|---|
| Best for | Trying it out, testing end to end | Changing the code (hot reload) |
| You install | Docker Desktop | Node 22, pnpm 10, Postgres 16 |
| Editor at | <http://localhost:4000> | <http://localhost:5173> |
| Time | About 5 minutes | About 10 minutes |

Either way you get the same four pieces:

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

The defaults in `.env` work as they are. Change the three tokens before anyone else can reach your computer.

### 3. Start everything

```bash
docker compose up --build
```

The first build takes a few minutes. It's ready when the log shows `Sitecraft API on http://localhost:4000`.

### 4. Sign in

Open <http://localhost:4000> and paste `dev-editor-token` (the `EDITOR_TOKEN` from `.env`). Create a site, edit it, then press **Publish**; the published site opens at `http://localhost:4000/s/<your-site-slug>`.

Compose also runs MinIO for storage. Its console is at <http://localhost:9001> (user `sitecraft`, password `sitecraft-secret`) if you want to see the published files.

### Everyday commands

```bash
docker compose up -d --build   # start in the background, rebuilding after a git pull
docker compose logs -f app     # follow the API log
docker compose down            # stop, keep your data
docker compose down -v         # stop and delete all sites, versions and files
```

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

With Sitecraft running, from the repo folder:

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
