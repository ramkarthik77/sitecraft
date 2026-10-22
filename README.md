# Sitecraft

A visual website builder where people and Claude Code edit the same site.

Designers work on a canvas in the browser. Claude Code works through an MCP server, always on its own branch. Every change, human or agent, is a versioned edit to one shared site document, so you can see what Claude did, preview it, merge it and publish it with one click.

## What's in the box

| | |
|---|---|
| **Visual editor** | Canvas that renders exactly what publishes, drag-and-drop sections and elements, double-click text editing, layers tree, inspector for layout, type, fill, border and motion, desktop/tablet/phone layouts with per-breakpoint overrides, undo/redo, reusable components, image uploads |
| **CMS** | Collections for posts, products, people or jobs, with your own fields (text, rich text, image, date, link, number, yes/no). A template page gives every item its own page; lists show items anywhere, sorted and limited. Drafts stay unpublished |
| **Sections library** | Navbar, hero, features, logos, testimonial, pricing, FAQ, call to action, contact form, text, image, footer — all responsive and driven by theme tokens |
| **Branches and history** | Every save is a version. Branches for experiments and agents, diff against main, merge, restore any version, roll back any deploy |
| **Claude Code integration** | MCP server with 26 tools (including the CMS), a site-building skill, and a hook that asks before anything ships. Agent edits show up live in open editors |
| **Guardrails** | Roles (admin, editor, agent). Agents can't edit main, merge or publish unless an admin allows it. Audit log of who did what |
| **Publishing** | Static HTML/CSS per page with SEO tags, sitemap, robots.txt and 404. Served at `/s/<slug>`, `<slug>.<your-domain>`, or a custom domain. Instant rollback |
| **Forms** | Form sections store submissions; view them in site settings |

## Guides

| Guide | For |
|---|---|
| [Local setup](docs/LOCAL_SETUP.md) | Running Sitecraft on your computer, with or without Docker; tokens; tests; every setting |
| [CMS](docs/CMS.md) | Collections, item pages, lists, drafts |
| [Claude Code](docs/CLAUDE_CODE.md) | Connecting Claude Code, the plugin, example requests, every tool, guardrails |
| [Deploy on Cloudflare](docs/CLOUDFLARE.md) | The live setup at `sitecraft.guduriphaniram1988.workers.dev`, deployed from GitHub Actions |
| [Deploy elsewhere](docs/DEPLOY.md) | AWS, Google Cloud or any container host |
| [How it works](docs/ARCHITECTURE.md) | The document model, branches, live updates, publishing, roles, extending it |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common problems and fixes |

## Quick start: the local app

Needs Node 20+ and pnpm. No Docker, no database to install, no sign-in.

```bash
git clone https://github.com/ramkarthik77/sitecraft && cd sitecraft
pnpm install
pnpm start
```

The first run builds Sitecraft (about a minute), then opens <http://localhost:4000>. Later starts take a few seconds. Your sites, images and published files live in `~/.sitecraft`; copy that folder to back up.

Connect Claude Code once, with the command `pnpm start` prints:

```bash
claude mcp add --transport http --scope user sitecraft http://localhost:4100/mcp
```

Then ask Claude: *"Create a Sitecraft site for Northstar Coffee with a menu section and a contact form, then send me the review link."* Keep the editor open to watch its changes arrive. Claude works on a branch; you merge and publish.

To put a site online, open **Settings → Export** and download a .zip of plain HTML you can host anywhere (Cloudflare Pages, Netlify, any web server).

For a shared server with sign-in for a team, see [Local setup](docs/LOCAL_SETUP.md#run-it-as-a-team-server) (Docker or Postgres) and [Deploy on Cloudflare](docs/CLOUDFLARE.md).

## Deploy

- **Cloudflare** (Containers, R2, edge cache) with Neon Postgres, at `https://sitecraft.guduriphaniram1988.workers.dev`: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md). Same GitHub Actions setup as pagefold; after adding the secrets, every push to `main` that passes CI deploys automatically.
- **Anywhere else** that runs containers: [docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```bash
pnpm test        # schema, renderer, Cloudflare routing, API and MCP tests
pnpm test:e2e    # builds everything and drives the editor in Chromium
```

Both need Postgres; [Local setup](docs/LOCAL_SETUP.md#run-the-tests) has the one-time steps. The browser test covers the whole loop: sign in, create a site, edit text on the canvas, insert a section, undo/redo, set a phone-only style, let an agent edit a branch while the editor is open (and check its changes are highlighted), review and merge, publish, check the live site at phone width, submit its contact form, restore an old version.

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

Real-time multi-cursor collaboration (edits sync on save and live-reload today), scheduled publishing for CMS items, a content API, A/B tests, analytics, multiple languages, SSO login for the editor (token sign-in today), code components, and a plugin API. The document model and operations were designed so these slot in without changing how agents work.
