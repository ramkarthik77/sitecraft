# Using Sitecraft with Claude Code

Claude Code builds and edits Sitecraft sites through Sitecraft's MCP server. It works on its own branch, its changes appear live in any open editor, and a person reviews, merges and publishes.

```
You: "Add a pricing page to the Northstar site"
 └─ Claude Code ── MCP server ── Sitecraft API
       1. reads the site outline        get_site
       2. creates agent/pricing-page    create_branch
       3. adds the page and sections    add_page, add_section, update_text
       4. checks the preview            get_preview_url
       5. hands you a review link       request_review
 You: open the link, check the canvas, Merge into main, Publish
```

## Using the local app?

If you run Sitecraft with `pnpm start`, skip the token. Connect once:

```bash
claude mcp add --transport http --scope user sitecraft http://localhost:4100/mcp
```

Claude Code on your computer connects without a token, as an agent named "Claude Code". The server only accepts requests from this computer and refuses web pages, so nothing else can use that access. Then go to [Ask for things](#3-ask-for-things).

For a team server, follow the steps below.

## 1. Get a token

Claude Code acts with a Sitecraft token, so every change is attributed to that token and limited by its role. Use an **agent** token for Claude Code; it can do everything except edit `main`, merge and publish.

- **Team server on your computer (Docker or `pnpm dev`):** `dev-agent-token` from your `.env`.
- **Your deployment:** ask an admin, or mint one yourself with the admin token:

```bash
curl -X POST https://sitecraft.guduriphaniram1988.workers.dev/api/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe (Claude Code)","role":"agent"}'
```

Give each person their own agent token so the history shows whose Claude made each change.

## 2. Connect

Pick one of these.

### From the Sitecraft repo

The repo ships a `.mcp.json`. From the repo folder:

```bash
export SITECRAFT_TOKEN=<your agent token>
export SITECRAFT_MCP_URL=http://localhost:4100/mcp    # or https://sitecraft.guduriphaniram1988.workers.dev/mcp
claude
```

Claude Code asks you to approve the project's `sitecraft` server the first time.

### From any project

Add the server once for yourself:

```bash
claude mcp add --transport http --scope user sitecraft https://sitecraft.guduriphaniram1988.workers.dev/mcp \
  --header "Authorization: Bearer <your agent token>"
```

Use `http://localhost:4100/mcp` for a local Sitecraft.

### As a plugin

The repo is also a plugin marketplace. The plugin adds the MCP server, a `build-site` skill that teaches Claude how to build good Sitecraft pages, and a hook that asks you before Claude merges or publishes. In Claude Code:

```
/plugin marketplace add ramkarthik77/sitecraft
/plugin install sitecraft@sitecraft
```

Set `SITECRAFT_TOKEN` (and `SITECRAFT_MCP_URL` if not local) in your shell before starting Claude Code.

### Without HTTP (stdio)

Claude Code can also start the MCP server itself, talking to the API directly:

```bash
pnpm --filter @sitecraft/mcp build
claude mcp add --env SITECRAFT_TOKEN=<token> --env SITECRAFT_API_URL=http://localhost:4000 --transport stdio sitecraft \
  -- node /path/to/sitecraft/apps/mcp/dist/main.js
```

### Check the connection

In Claude Code, run `/mcp`: `sitecraft` should be listed as connected. Then ask *"List my Sitecraft sites."*

## 3. Ask for things

Plain requests work. Some to try:

- *"Create a Sitecraft site for Northstar Coffee using the landing template, rebrand it in roast brown with a serif heading font, and add a menu section with three drinks."*
- *"On the Northstar site, add a /pricing page with three plans and an FAQ, then send me the preview."*
- *"Make every hero headline on the Ledgerline site smaller on phones."*
- *"What changed on the agent/menu branch?"*
- *"Add a blog to the Northstar site and write three posts about our new seasonal drinks, as drafts. Show the latest three on the home page."*
- *"Here's our product list (pasted CSV). Put it in a Products collection with name, price, image and a buy link."*
- *"Rewrite the summaries of every Journal post to be under 140 characters."*

Keep the editor open on Claude's branch to watch: the sections Claude adds get a dashed outline and a "Claude" tag, and the bar at the bottom of the canvas lists its latest changes.

## 4. Review and publish

Claude finishes with a review link. Open it (or go to **Reviews** on the dashboard), then:

1. Check the changes on the canvas at desktop, tablet and phone widths.
2. **Review changes** lists every addition and edit compared to `main`.
3. **Merge into main** puts the changes on `main`. If someone changed `main` in the meantime, you're asked before the branch replaces it.
4. **Publish** puts `main` on the live site. **History → Make live** rolls back to any earlier publish.

## The tools

| Tool | What it does |
|---|---|
| `list_sites` | Sites with ids, slugs and live addresses |
| `create_site` | New site from a template: `blank`, `landing`, `saas` or `blog` |
| `get_site` | Outline of a site's pages and elements, with the ids edits need |
| `get_node` | Full detail of one element: content, styles per screen size, children |
| `list_blocks` | The ready-made sections and the content each one takes |
| `list_branches` | Branches and whether they have unmerged changes |
| `create_branch` | Start a branch for a task, for example `agent/new-pricing` |
| `edit_site` | Any batch of edits, applied together or not at all |
| `add_section` | Insert a ready-made section with real content |
| `update_text` | Change a heading, paragraph or button label |
| `update_style` | Set styles on an element for desktop, tablet or phone |
| `set_theme` | Change brand colors, fonts or corner radius across the site |
| `add_page` | Add a page with starting sections |
| `get_collection` | A collection's fields and items |
| `create_collection` | New CMS collection from a preset (`blog`, `team`, `products`, `jobs`) or your own fields, with a list page and an item page template |
| `add_items` | Add up to 100 items in one save |
| `update_item` | Change an item's values, slug or draft status |
| `remove_item` | Delete an item |
| `add_collection_list` | Show a collection's items on a page, sorted and limited |
| `get_diff` | What a branch changes compared to `main` |
| `list_versions` | Recent saved versions of a branch |
| `restore_version` | Go back to an earlier version (saved as a new one) |
| `get_preview_url` | Shareable preview link and editor link for a branch |
| `request_review` | Summary and review link for the person |
| `merge_branch` | Merge into `main` (people only, unless an admin allows agents) |
| `publish_site` | Publish `main` (people only, unless an admin allows agents) |

## Guardrails

- **Agents work on branches.** An agent token can't edit `main`. Claude gets a clear error and creates a branch instead.
- **People ship.** Agent tokens can't merge or publish. Claude gets a review link to hand over. An admin can change this with `AGENT_CAN_PUBLISH=true` and `AGENT_CAN_EDIT_MAIN=true`.
- **Ask before shipping.** With the plugin installed, Claude Code asks you before every merge or publish, even when agents are allowed to.
- **Everything is reversible.** Every save is a version, every publish can be rolled back, and the audit log records who did what.
- **Unsafe content is refused.** Script links, unsafe CSS and unknown style properties are rejected before anything is saved.

## Rolling out to your organization (Claude Code Enterprise)

1. Deploy Sitecraft ([CLOUDFLARE.md](CLOUDFLARE.md)).
2. Mint an agent token for each person.
3. Push the plugin and an MCP allowlist to everyone through managed settings. [deploy/claude-code/managed-settings.example.json](../deploy/claude-code/managed-settings.example.json) is a starting point; `allowedMcpServers` is an allowlist, so include your other approved servers or drop that key.
4. People set `SITECRAFT_TOKEN` to their own token.

## When something goes wrong

| What Claude reports | Why | Fix |
|---|---|---|
| `401` / "Missing API token" | `SITECRAFT_TOKEN` isn't set in the shell that started Claude Code | Export it and restart Claude Code |
| `401` / "Invalid API token" | The token was mistyped or doesn't exist on this server | Check it with `curl -H "Authorization: Bearer $SITECRAFT_TOKEN" <api>/api/me` |
| `403` "Agents edit on a branch" | It tried to edit `main` | Expected; Claude should create a branch and continue |
| `403` on merge or publish | Agents can't ship | Expected; open the review link and do it yourself |
| `400` with a field name | An edit was invalid (unknown style, unsafe link, missing element) | Claude usually fixes it on the next try; ask it to re-read the site with `get_site` |
| `409` | Someone saved the same branch at the same moment | Ask Claude to re-read the site and redo the change |
| `sitecraft` missing from `/mcp` | The server isn't reachable or wasn't approved | Check `curl <mcp>/healthz`, then approve it in `/mcp` |
