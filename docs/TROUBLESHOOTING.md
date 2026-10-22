# Troubleshooting

## Starting up

**`pnpm start`: "Port 4000 is already in use"** (or 4100)
Sitecraft is probably already running in another terminal; use that one, or stop it with Ctrl+C. If something else has the port, pick others: `SITECRAFT_PORT=4010 SITECRAFT_MCP_PORT=4110 pnpm start`, and use port 4110 in the `claude mcp add` command.

**`pnpm start`: "Sitecraft didn't start" with a database message**
The database folder may be damaged, for example after the computer lost power mid-write. Stop Sitecraft, move `~/.sitecraft/db` somewhere else, and start again (you get an empty database). If you have a backup of the folder, copy it back instead.

**`pnpm start`: "config.json isn't valid JSON"**
The file was edited by hand. Fix it, or delete it and a new one is made. Then run the `claude mcp add` command again; Claude's old access stops working.

**The editor shows a sign-in screen with the local app**
You opened it by an address other than `localhost` or `127.0.0.1` (for example your computer's network name). Use <http://localhost:4000>.

**Changed the code but `pnpm start` runs the old version**
It rebuilds when the git commit changes. For uncommitted changes run `pnpm start --rebuild`.

**`docker compose up` fails with "port is already allocated" (5432, 4000, 4100 or 9000)**
Something else is using that port, often a local Postgres. Stop it (`brew services stop postgresql@16`, or `sudo systemctl stop postgresql`), or change the left-hand number of that port in `docker-compose.yml`, for example `"5433:5432"`.

**`ECONNREFUSED 127.0.0.1:5432`**
Postgres isn't running, or isn't on that port. Start it, then check with `pg_isready -h localhost`.

**`password authentication failed for user "sitecraft"`** or **`database "sitecraft" does not exist`**
The user or database wasn't created. Run step 2 of [LOCAL_SETUP.md](LOCAL_SETUP.md#2-create-the-database), or fix `DATABASE_URL` in `.env`.

**`SECRET must be at least 32 characters in production`**
`NODE_ENV=production` is set (the Docker images set it) and `SECRET` is short or missing. Put a long random value in `.env`: `openssl rand -hex 32`.

**`Cannot find module '@sitecraft/schema'` or `.../dist/index.js` when running `pnpm dev`**
The shared packages aren't built yet. Run `pnpm build`.

**Settings in `.env` are ignored without Docker**
The shell didn't load them. Run `set -a; . ./.env; set +a` in that terminal, then start again.

## Editor

**"That token wasn't accepted"**
Use a token the server knows: `EDITOR_TOKEN` or `ADMIN_TOKEN` from `.env` locally, or one an admin created for you. A token made on one server doesn't work on another.

**Blank page after rebuilding the editor**
The server keeps the editor page it loaded at startup. Restart it after `pnpm build` (`docker compose up -d --build` rebuilds and restarts).

**"Someone else saved this branch after you opened it"**
Claude or a teammate saved the same branch first, so your last edit wasn't saved. Choose **Load the latest version**, then redo the edit. To avoid it, edit on your own branch while Claude works on its own.

**Claude's changes don't appear live**
Live updates use Postgres `LISTEN/NOTIFY`. A connection pooler in `DATABASE_URL` (Neon's `-pooler` host, PgBouncer in transaction mode) drops them. Use the direct connection string. Reloading the page always shows the latest version.

**Fonts on the canvas look different from the published site**
Theme fonts load from Google Fonts. If your network blocks `fonts.googleapis.com`, the canvas and site fall back to system fonts.

## Publishing and sites

**A published site shows "This site hasn't been published yet"**
Press **Publish** on `main`. Only `main` publishes; merge a branch first.

**The live site doesn't show the latest publish**
On Cloudflare, published pages are cached at the edge for 60 seconds. Wait a minute, or add `?v=2` to the address to skip the cache.

**A custom domain shows the wrong site or nothing**
Check that the domain is saved in the site's settings, that its CNAME points at your Sitecraft host, and that you published after saving the domain.

**Form submissions don't arrive**
Forms post to `PUBLIC_URL/forms/...`. If `PUBLIC_URL` isn't the address visitors can reach, set it correctly and publish again. Submissions show under **Settings → Form submissions** for editors and admins.

## Claude Code

See the table at the end of [CLAUDE_CODE.md](CLAUDE_CODE.md#when-something-goes-wrong).

## Cloudflare deploy

**The workflow stops at "Check required secrets"**
It names the missing secret. Add it under Settings → Secrets and variables → Actions in the sitecraft repo.

**"Containers" or "Durable Objects" errors during deploy**
The account needs the Workers Paid plan, and the API token needs Containers: Edit. See [CLOUDFLARE.md](CLOUDFLARE.md#2-api-token).

**`/healthz` doesn't answer within 10 minutes**
The first rollout downloads the image and can be slow. If it keeps failing, open Workers & Pages → sitecraft → Logs. A database error there usually means `DATABASE_URL` is wrong or uses the pooled host.

**Images or published pages return errors on Cloudflare**
The R2 keys need Object Read & Write on the `sitecraft` bucket, and `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` must be the R2 keys, not the Cloudflare API token.

## Tests

**`database "sitecraft_test" does not exist`**
Create it once: `psql postgres://sitecraft:sitecraft@localhost:5432/postgres -c "CREATE DATABASE sitecraft_test;"`.

**`pnpm test:e2e` says "Executable doesn't exist"**
Install the test browser once: `pnpm exec playwright install chromium`. Or point `PW_CHROMIUM_PATH` at a Chromium you already have.

**`permission denied to create database` in the e2e run**
The e2e script creates its database. Give the user that right (`ALTER USER sitecraft CREATEDB;`) or create `sitecraft_e2e` yourself.
