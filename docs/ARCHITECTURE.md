# How Sitecraft works

## The pieces

```
 Browser editor ──┐                          ┌──> Postgres: sites, branches, versions,
 (apps/editor)    │                          │    deployments, forms, tokens, audit log
                  ├──> API (apps/api) ───────┤
 Claude Code ──> MCP server (apps/mcp) ──┘   └──> Storage (disk, S3, R2, MinIO):
                                                  published files, uploaded images
```

| Folder | What it is |
|---|---|
| `packages/schema` | The site document model, validation, edit operations, section blocks, outlines and diffs. Used by everything else |
| `packages/renderer` | Turns a document into HTML and CSS. The same code renders the canvas, previews and published sites |
| `apps/api` | Fastify server: REST API, tokens and roles, versions and branches, publishing, hosting published sites, previews, forms, images, live change events |
| `apps/mcp` | MCP server for Claude Code. Each tool calls the API with the caller's own token |
| `apps/editor` | React editor and sites dashboard (Vite) |
| `claude-plugin` | Claude Code plugin: MCP config, `build-site` skill, confirm-before-shipping hook |
| `scripts/local.mjs` | `pnpm start`: builds if needed and runs the API and MCP server as the local app |

### The local app

`pnpm start` runs the same API and MCP server with `SITECRAFT_LOCAL=1` and `DATABASE_URL=pglite:<folder>`:

- **Database.** [PGlite](https://pglite.dev) is Postgres compiled to WebAssembly, running inside the API process and saving to a folder. The same SQL and migrations run on it. `apps/api/src/db.ts` puts it behind the same interface as the `pg` pool and serializes queries, since PGlite has one connection. Live updates use PGlite's own `listen` in place of a second Postgres connection.
- **Sign-in.** Requests with no token count as the owner (an admin) only when the `Host` is a loopback name and the `Origin` is absent or loopback (`apps/api/src/auth.ts`). That blocks other computers (the server binds `127.0.0.1`), DNS rebinding and other websites. Requests with a token are checked as usual.
- **Claude Code.** The MCP server holds a per-computer agent token from `~/.sitecraft/config.json` and uses it for loopback requests that send no token, applying the same Host and Origin checks. Claude is still an agent, so `assertCanWrite` and `assertCanShip` apply unchanged.
- **Export.** `GET /api/sites/:id/export` renders the main branch with links from the site root (`/about`, `/media/...`), so the zip is meant for the root of a domain; copies the images it uses into `media/`, and returns a zip.
| `deploy/cloudflare` | Worker that fronts the app and MCP containers on Cloudflare |
| `e2e` | Browser tests (Playwright) |

## One document, changed only by operations

Each version of a site is one JSON document: a theme, reusable components, and pages made of nested elements (sections, stacks, grids, headings, text, images, buttons, forms…). Every element has content (`props`) and styles per screen size (`base`, `tablet`, `mobile`).

Documents change only through a small set of operations in `packages/schema/src/ops.ts`: `add_block`, `add_node`, `update_node`, `move_node`, `duplicate_node`, `remove_node`, `add_page`, `update_page`, `remove_page`, `set_theme` and `create_component`. A batch of operations either all apply and the result validates, or nothing changes.

The editor, the API and the MCP server all use these same operations. That's why an edit by Claude and an edit by a person look the same in history, diff the same way, and can be reviewed the same way.

Validation (`packages/schema/src/validate.ts`) rejects unknown style properties, unsafe CSS values, `javascript:` links, unsafe image sources and duplicate ids before anything is saved. The renderer escapes all text and re-checks values as it writes HTML.

## Versions and branches

- Every save writes a new row in `versions`; nothing is overwritten.
- A branch points at its latest version (`head_version_id`) and remembers where it started (`base_version_id`).
- Saves send the version they started from. If the branch moved meanwhile, the save is refused with `409`, so nobody silently overwrites anyone.
- **Merging** writes the branch's document as a new version on `main`. If `main` moved since the branch started, a person has to confirm.
- **Restoring** writes an old document as a new version, so history is never lost.

## Live updates

Every save, branch and publish sends a Postgres `NOTIFY` (on PGlite, the in-process equivalent). Each API instance listens and streams the event to open editors over server-sent events (`/api/sites/<id>/events`). The editor reloads the branch when it has no unsaved edits, or offers to load the new version when it does. This works across any number of API instances.

## Publishing and hosting

Publishing renders every page of `main` to static HTML, plus `sitemap.xml`, `robots.txt` and `404.html`, uploads them under a new deployment id, and points the site at that deployment. Rolling back just points the site at an older deployment.

The API serves published sites three ways:

- `PUBLIC_URL/s/<slug>/…`
- `<slug>.<SITES_DOMAIN>` when `SITES_DOMAIN` is set
- a custom domain saved in the site's settings (matched by the request's `Host`)

Previews of any branch are rendered on request at `/preview/<signed key>/<site>/<branch>/`. The key is an HMAC of the site, branch and an expiry, signed with `SECRET`, so preview links can be shared without a token and expire after seven days.

## Roles

| Role | Edit branches | Edit `main` | Merge, publish | Create tokens |
|---|---|---|---|---|
| `admin` | yes | yes | yes | yes |
| `editor` | yes | yes | yes | no |
| `agent` | yes | only with `AGENT_CAN_EDIT_MAIN` | only with `AGENT_CAN_PUBLISH` | no |

The checks live in `apps/api/src/routes/api.ts` (`assertCanWrite`, `assertCanShip`). The MCP server never bypasses them; it calls the API with the caller's token.

## Data

Tables (`apps/api/migrations`): `sites`, `branches`, `versions`, `deployments`, `form_submissions`, `assets`, `api_tokens` (hashed tokens only), `audit_log`. Migrations run automatically on startup, guarded by an advisory lock so several instances can start at once.

## Extending it

- **A new section block:** add a builder and description in `packages/schema/src/blocks.ts`. It appears in the editor's Insert panel and in Claude's `list_blocks` and `add_section` automatically.
- **A new kind of edit:** add an operation to `packages/schema/src/ops.ts` with validation and a test, then use it from the editor or a tool.
- **A new Claude tool:** register it in `apps/mcp/src/tools.ts`, calling an API route so roles keep applying.
- **A new style property:** add it to `STYLE_PROPERTIES` in `packages/schema/src/types.ts`, then expose it in `apps/editor/src/components/Inspector.tsx`.
