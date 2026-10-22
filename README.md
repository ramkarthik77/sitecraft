# Sitecraft

A visual website builder where people and Claude Code edit the same site.

Designers work on a canvas in the browser. Claude Code works through an MCP server, always on its own branch. Every change, human or agent, is a versioned edit to one shared site document, so you can see what Claude did, preview it, merge it and publish it with one click.

## What's in the box

| | |
|---|---|
| **Visual editor** | Canvas that renders exactly what publishes, drag-and-drop sections and elements, double-click text editing, layers tree, inspector for layout, type, fill, border and motion, desktop/tablet/phone layouts with per-breakpoint overrides, undo/redo, reusable components, image uploads |
| **Sections library** | Navbar, hero, features, logos, testimonial, pricing, FAQ, call to action, contact form, text, image, footer — all responsive and driven by theme tokens |
| **Branches and history** | Every save is a version. Branches for experiments and agents, diff against main, merge, restore any version, roll back any deploy |
| **Claude Code integration** | MCP server with 20 tools, a site-building skill, and a hook that asks before anything ships. Agent edits show up live in open editors |
| **Guardrails** | Roles (admin, editor, agent). Agents can't edit main, merge or publish unless an admin allows it. Audit log of who did what |
| **Publishing** | Static HTML/CSS per page with SEO tags, sitemap, robots.txt and 404. Served at `/s/<slug>`, `<slug>.<your-domain>`, or a custom domain. Instant rollback |
| **Forms** | Form sections store submissions; view them in site settings |

## Run it locally (end to end)

You need Docker. Then:

```bash
git clone https://github.com/ramkarthik77/sitecraft && cd sitecraft
cp .env.example .env          # change the tokens if you like
docker compose up --build
```

- Editor: <http://localhost:4000> — sign in with `EDITOR_TOKEN` from `.env` (default `dev-editor-token`)
- MCP server for Claude Code: <http://localhost:4100/mcp>
- Published sites: <http://localhost:4000/s/your-site-slug>
- Storage console (MinIO): <http://localhost:9001> (`sitecraft` / `sitecraft-secret`)

### Without Docker (for development)

Needs Node 22, pnpm 10 and a Postgres 16 you can reach.

```bash
pnpm install
cp .env.example .env
pnpm build
set -a; . ./.env; set +a
pnpm seed          # optional demo site
pnpm dev           # API :4000, editor :5173 (hot reload), MCP :4100
```

Open <http://localhost:5173>.

## Connect Claude Code

Claude Code talks to the MCP server with a Sitecraft token, so every edit is attributed to that token and limited by its role.

**Quick start (this repo):** the repo ships a `.mcp.json`. Set your token and start Claude Code here:

```bash
export SITECRAFT_TOKEN=dev-agent-token
export SITECRAFT_MCP_URL=http://localhost:4100/mcp   # default
claude
```

Then ask, for example: *"Create a Sitecraft site for Northstar Coffee with a menu section and a contact form, then send me the review link."*

**As a plugin (any project):** this repo is also a plugin marketplace. In Claude Code:

```
/plugin marketplace add ramkarthik77/sitecraft
/plugin install sitecraft@sitecraft
```

The plugin adds the MCP server, the `build-site` skill and the confirm-before-publish hook.

**For your whole organization (Claude Code Enterprise):** deploy it (on Cloudflare: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md); elsewhere: [docs/DEPLOY.md](docs/DEPLOY.md)), mint one agent token per person (`pnpm --filter @sitecraft/api exec tsx src/cli.ts token "Jane Doe" agent`), and push the plugin and MCP allowlist through managed settings. [deploy/claude-code/managed-settings.example.json](deploy/claude-code/managed-settings.example.json) is a starting point.

### What Claude can do

`list_sites`, `create_site`, `get_site` (outline with node ids), `get_node`, `list_blocks`, `list_branches`, `create_branch`, `edit_site` (any batch of operations), `add_section`, `update_text`, `update_style`, `set_theme`, `add_page`, `get_diff`, `list_versions`, `restore_version`, `get_preview_url`, `request_review`, `merge_branch`, `publish_site`.

By default an agent token can do everything except edit `main`, merge or publish. Set `AGENT_CAN_PUBLISH=true` to let agents ship; the plugin's hook still asks the person first.

## Deploy

- **Cloudflare** (Containers, R2, edge cache) with Neon Postgres, at `https://sitecraft.guduriphaniram1988.workers.dev`: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md). Same GitHub Actions setup as pagefold; after adding the secrets, every push to `main` that passes CI deploys automatically.
- **Anywhere else** that runs containers: [docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```bash
pnpm test        # schema, renderer, API and MCP tests (needs Postgres; TEST_DATABASE_URL)
pnpm test:e2e    # builds everything and drives the editor in Chromium (needs Postgres; DATABASE_URL)
```

The browser test covers the whole loop: sign in, create a site, edit text on the canvas, insert a section, undo/redo, set a phone-only style, let an agent edit a branch while the editor is open, review and merge, publish, check the live site on a phone width, submit its contact form, restore an old version.

Run `pnpm exec playwright install chromium` once before the first e2e run.

## How it fits together

```
 Browser editor ──┐                         ┌──> Postgres (sites, branches, versions, audit, forms)
                  ├──> API (Fastify) ───────┤
 Claude Code ──> MCP server ──┘             └──> S3 / MinIO / disk (published files, images)
                                   │
                                   └──> serves published sites, previews, forms
```

```
packages/schema     Site document model, validation, edit operations, blocks, diff
packages/renderer   Document → HTML/CSS (same code for canvas, preview and publish)
apps/api            REST API, auth and roles, versions, publishing, hosting, forms
apps/mcp            MCP server (Streamable HTTP and stdio)
apps/editor         React editor (Vite)
claude-plugin       Claude Code plugin: MCP config, skill, hook
deploy/cloudflare   Cloudflare Worker and Containers config
e2e                 Playwright tests
```

The key design choice: one JSON document per site version, changed only through a small set of operations (`add_block`, `update_node`, `move_node`, …) that are validated and applied atomically. The editor, the API and the MCP server all use the same operations, which is why an agent's edit and a person's edit look the same in history and can be reviewed the same way.

## Not built yet

Real-time multi-cursor collaboration (edits sync on save and live-reload today), CMS collections, A/B tests, analytics, localization, SSO login for the editor (token sign-in today), code components, and a plugin API. The document model and operations were designed so these slot in without changing how agents work.
