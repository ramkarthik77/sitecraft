import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BLOCK_DESCRIPTIONS, BLOCK_NAMES, COLLECTION_PRESET_NAMES, FIELD_TYPES, STYLE_PROPERTIES } from "@sitecraft/schema";
import { z } from "zod";
import { ApiError, enc, SitecraftClient } from "./client.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

async function run(fn: () => Promise<string>): Promise<Result> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ApiError) return fail(`Sitecraft API error (${e.status}): ${e.message}`);
    return fail(`Error: ${(e as Error).message}`);
  }
}

const site = z.string().describe("Site id or slug");
const branch = z.string().describe("Branch name. Agents edit on their own branch (for example agent/new-pricing), never main.");

const OPS_HELP = `Each operation is an object with an "op" field:
- add_block {parentId, block, content?, index?} — insert a ready-made section. Blocks: ${BLOCK_NAMES.join(", ")}
- add_node {parentId, node:{type, props, style:{base?,tablet?,mobile?}, children?}, index?}
- update_node {nodeId, props?, style?, breakpoint?: base|tablet|mobile, name?, animation?:{preset,trigger,durationMs?}|null, hidden?}
  (props/style merge; set a key to null to remove it)
- remove_node {nodeId} · move_node {nodeId, parentId, index?} · duplicate_node {nodeId}
- add_page {path, title, description?, blocks?[]} · update_page {pageId, path?, title?, description?, ogImage?} · remove_page {pageId}
- set_theme {colors?:{primary,on-primary,background,surface,text,muted,border}, fonts?:{heading,body}, radius?}
- create_component {nodeId, name}
- CMS: add_collection {name, preset?, fields?[{name,type}], sampleItems?, pages?} · update_collection {collectionId, name?, slug?} · remove_collection {collectionId}
  add_field {collectionId, name, type, index?} · update_field {collectionId, fieldId, name} · remove_field {collectionId, fieldId}
  add_item {collectionId, values, slug?, draft?, index?} · update_item {collectionId, itemId, values?, slug?, draft?} · remove_item · move_item {collectionId, itemId, index}
  add_collection_list {parentId, collectionId, headline?, section?, limit?, sortBy?, sortDir?} · add_page {path, title, collectionId} makes a template page (/blog/:slug)
  Field types: ${FIELD_TYPES.join(", ")}. collectionId/itemId/fieldId also accept the slug or name.
Node types: section, stack, grid, heading{text,level}, text{text}, image{src,alt}, button{label,href}, link{href}, divider, spacer, form{formName}, input{name,label,inputType,required}, embed{url}, instance{componentId}, richtext{markdown}, collection-list{collectionId,limit?,sortBy?,sortDir?} (children are the card repeated per item).
Inside a template page or a collection-list, props.bind maps a prop to a field: {text:"title"}, {src:"cover_image"}, {href:"url"} (the item's page), {markdown:"body"}.
Containers (can have children): section, stack, grid, form, link, collection-list.
Style keys (camelCase CSS): ${STYLE_PROPERTIES.join(", ")}. Use theme tokens like var(--color-primary), var(--font-heading), var(--radius).
All operations in one call apply atomically.`;

interface BranchInfo {
  name: string;
  hasChanges: boolean;
  lastChangeBy: string;
  lastMessage: string;
  updatedAt: string;
}

export function createSitecraftServer(client: SitecraftClient): McpServer {
  const server = new McpServer(
    { name: "sitecraft", version: "0.1.0" },
    {
      instructions:
        "Sitecraft is a visual website builder with a CMS. Workflow: get_site to read the outline (node ids and collections), create_branch for your task, make edits with edit_site or the helper tools, check get_preview_url, then request_review so a person can merge and publish. Prefer add_block for new sections so pages stay on-brand, and theme tokens over hard-coded colors. For repeated content (posts, products, people, jobs) use a collection: create_collection, then add_items; its template page and lists update by themselves. Write rich text fields in Markdown. Add new items as drafts unless asked to make them live.",
    },
  );

  const resolveId = async (s: string) => (await client.get<{ id: string }>(`/sites/${enc(s)}`)).id;
  const previewUrl = async (id: string, b: string) => (await client.get<{ url: string }>(`/sites/${id}/branches/${enc(b)}/preview-url`)).url;

  const applyOps = async (s: string, b: string, ops: unknown[], message?: string) => {
    const id = await resolveId(s);
    const r = await client.post<{ versionId: number; created: (string | null)[] }>(`/sites/${id}/branches/${enc(b)}/ops`, { ops, message });
    const created = r.created.filter(Boolean);
    return `Saved version ${r.versionId} on ${b}.${created.length ? `\nCreated ids: ${created.join(", ")}` : ""}\nPreview: ${await previewUrl(id, b)}`;
  };

  server.registerTool(
    "list_sites",
    { title: "List sites", description: "List all sites with their ids, slugs and live URLs.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () =>
      run(async () => {
        const sites = await client.get<{ id: string; name: string; slug: string; liveUrl: string | null }[]>("/sites");
        if (!sites.length) return "No sites yet. Create one with create_site.";
        return sites.map((s) => `- ${s.name} (slug ${s.slug}, id ${s.id})${s.liveUrl ? ` live at ${s.liveUrl}` : " — not published"}`).join("\n");
      }),
  );

  server.registerTool(
    "create_site",
    {
      title: "Create site",
      description: "Create a new site from a template: blank, landing (navbar, hero, features, cta, footer) or saas (adds logos, testimonial, pricing, faq).",
      inputSchema: { name: z.string().min(1), template: z.enum(["blank", "landing", "saas", "blog"]).optional(), slug: z.string().optional() },
    },
    ({ name, template, slug }) =>
      run(async () => {
        const s = await client.post<{ id: string; slug: string }>("/sites", { name, template, slug });
        return `Created site "${name}" (slug ${s.slug}, id ${s.id}). Next: create_branch, then edit.`;
      }),
  );

  server.registerTool(
    "get_site",
    {
      title: "Read site outline",
      description: "Read a site's pages and element tree with node ids. Use the ids in edits. Optionally limit to one page (id or path).",
      inputSchema: { site, branch: branch.default("main"), page: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ site: s, branch: b, page }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ versionId: number; outline: string }>(`/sites/${id}/branches/${enc(b)}?format=outline${page ? `&page=${enc(page)}` : ""}`);
        return `Site ${s}, branch ${b}, version ${r.versionId}\n\n${r.outline}`;
      }),
  );

  server.registerTool(
    "get_node",
    {
      title: "Read element",
      description: "Get the full JSON for one element (props, styles per breakpoint, children).",
      inputSchema: { site, branch: branch.default("main"), nodeId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ site: s, branch: b, nodeId }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ document: unknown }>(`/sites/${id}/branches/${enc(b)}`);
        const found = findNode(r.document, nodeId);
        if (!found) throw new Error(`Node ${nodeId} not found`);
        return JSON.stringify(found, null, 2);
      }),
  );

  server.registerTool(
    "list_blocks",
    { title: "List section blocks", description: "List the ready-made sections add_block can insert, with the content fields each accepts.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => run(async () => BLOCK_NAMES.map((b) => `- ${b}: ${BLOCK_DESCRIPTIONS[b]}`).join("\n")),
  );

  server.registerTool(
    "list_branches",
    { title: "List branches", description: "List a site's branches and whether they have unmerged changes.", inputSchema: { site }, annotations: { readOnlyHint: true } },
    ({ site: s }) =>
      run(async () => {
        const id = await resolveId(s);
        const list = await client.get<BranchInfo[]>(`/sites/${id}/branches`);
        return list.map((b) => `- ${b.name}${b.hasChanges ? " (unmerged changes)" : ""} — last: "${b.lastMessage}" by ${b.lastChangeBy}`).join("\n");
      }),
  );

  server.registerTool(
    "create_branch",
    {
      title: "Create branch",
      description: "Create a branch to work on, copied from main (or another branch). Name it for the task, e.g. agent/pricing-page.",
      inputSchema: { site, name: z.string(), from: z.string().optional() },
    },
    ({ site: s, name, from }) =>
      run(async () => {
        const id = await resolveId(s);
        await client.post(`/sites/${id}/branches`, { name, from });
        return `Created branch ${name}. Preview: ${await previewUrl(id, name)}`;
      }),
  );

  server.registerTool(
    "edit_site",
    {
      title: "Edit site",
      description: `Apply one or more edit operations to a branch in a single atomic save.\n${OPS_HELP}`,
      inputSchema: {
        site,
        branch,
        operations: z.array(z.object({ op: z.string() }).passthrough()).min(1).describe("Operations to apply, in order"),
        message: z.string().optional().describe("Short description of the change for the version history"),
      },
    },
    ({ site: s, branch: b, operations, message }) => run(() => applyOps(s, b, operations, message)),
  );

  server.registerTool(
    "add_section",
    {
      title: "Add section",
      description: "Insert a ready-made section (see list_blocks) into a page. Defaults to the end of the home page.",
      inputSchema: {
        site,
        branch,
        block: z.enum(BLOCK_NAMES as [string, ...string[]]),
        content: z.record(z.string(), z.unknown()).optional().describe("Block content such as headline, subheadline, items"),
        page: z.string().optional().describe("Page id or path, default /"),
        index: z.number().int().min(0).optional().describe("Position among the page's sections"),
      },
    },
    ({ site: s, branch: b, block, content, page, index }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ document: { pages: { id: string; path: string; root: { id: string } }[] } }>(`/sites/${id}/branches/${enc(b)}`);
        const p = r.document.pages.find((x) => x.id === page || x.path === (page ?? "/"));
        if (!p) throw new Error(`Page ${page ?? "/"} not found`);
        return applyOps(s, b, [{ op: "add_block", parentId: p.root.id, block, content, index }], `Add ${block} section`);
      }),
  );

  server.registerTool(
    "update_text",
    { title: "Update text", description: "Change the text of a heading or text element, or the label of a button.", inputSchema: { site, branch, nodeId: z.string(), text: z.string() } },
    ({ site: s, branch: b, nodeId, text }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ document: unknown }>(`/sites/${id}/branches/${enc(b)}`);
        const n = findNode(r.document, nodeId) as { type?: string } | null;
        if (!n) throw new Error(`Node ${nodeId} not found`);
        const key = n.type === "button" ? "label" : "text";
        return applyOps(s, b, [{ op: "update_node", nodeId, props: { [key]: text } }], "Edit text");
      }),
  );

  server.registerTool(
    "update_style",
    {
      title: "Update style",
      description: `Set CSS styles on an element for a breakpoint (base = desktop and up, tablet ≤1023px, mobile ≤767px). Set a value to null to remove it. Keys: ${STYLE_PROPERTIES.join(", ")}`,
      inputSchema: {
        site,
        branch,
        nodeId: z.string(),
        style: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        breakpoint: z.enum(["base", "tablet", "mobile"]).default("base"),
      },
    },
    ({ site: s, branch: b, nodeId, style, breakpoint }) => run(() => applyOps(s, b, [{ op: "update_node", nodeId, style, breakpoint }], "Restyle")),
  );

  server.registerTool(
    "set_theme",
    {
      title: "Set theme",
      description: "Change brand colors (primary, on-primary, background, surface, text, muted, border), fonts (CSS font-family) or corner radius for the whole site.",
      inputSchema: {
        site,
        branch,
        colors: z.record(z.string(), z.string()).optional(),
        fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
        radius: z.string().optional(),
      },
    },
    ({ site: s, branch: b, colors, fonts, radius }) => run(() => applyOps(s, b, [{ op: "set_theme", colors, fonts, radius }], "Update theme")),
  );

  server.registerTool(
    "add_page",
    {
      title: "Add page",
      description: "Add a page at a path (e.g. /pricing) with optional starting blocks, such as [\"navbar\",\"pricing\",\"faq\",\"footer\"].",
      inputSchema: { site, branch, path: z.string(), title: z.string(), description: z.string().optional(), blocks: z.array(z.enum(BLOCK_NAMES as [string, ...string[]])).optional() },
    },
    ({ site: s, branch: b, path, title, description, blocks }) => run(() => applyOps(s, b, [{ op: "add_page", path, title, description, blocks }], `Add page ${path}`)),
  );

  server.registerTool(
    "get_diff",
    { title: "Show changes", description: "Summarize what a branch changes compared to main.", inputSchema: { site, branch }, annotations: { readOnlyHint: true } },
    ({ site: s, branch: b }) =>
      run(async () => {
        const id = await resolveId(s);
        const d = await client.get<{ summary: string[] }>(`/sites/${id}/branches/${enc(b)}/diff`);
        return d.summary.length ? d.summary.join("\n") : "No differences from main.";
      }),
  );

  server.registerTool(
    "list_versions",
    { title: "Version history", description: "List recent saved versions of a branch.", inputSchema: { site, branch: branch.default("main") }, annotations: { readOnlyHint: true } },
    ({ site: s, branch: b }) =>
      run(async () => {
        const id = await resolveId(s);
        const v = await client.get<{ id: number; message: string; actor: string; createdAt: string }[]>(`/sites/${id}/branches/${enc(b)}/versions?limit=20`);
        return v.map((x) => `- v${x.id} ${x.createdAt} ${x.actor}: ${x.message}`).join("\n");
      }),
  );

  server.registerTool(
    "restore_version",
    { title: "Restore version", description: "Restore a branch to an earlier version (saved as a new version, nothing is lost).", inputSchema: { site, branch, versionId: z.number().int() } },
    ({ site: s, branch: b, versionId }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.post<{ versionId: number }>(`/sites/${id}/branches/${enc(b)}/restore`, { versionId });
        return `Restored. New version ${r.versionId}.`;
      }),
  );


  // --- CMS -----------------------------------------------------------------

  const collectionArg = z.string().describe("Collection id, slug or name, e.g. blog");
  const valuesArg = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).describe("Field values by field key or name. Rich text is Markdown; dates are YYYY-MM-DD; images are https:// URLs.");

  server.registerTool(
    "get_collection",
    {
      title: "Read collection",
      description: "List a collection's fields and items (slug, draft, values). Long rich text is shortened unless full is true.",
      inputSchema: { site, branch: branch.default("main"), collection: collectionArg, full: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ site: s, branch: b, collection, full }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ document: { collections?: { id: string; name: string; slug: string; fields: { id: string; name: string; type: string }[]; items: { id: string; slug: string; draft?: boolean; values: Record<string, unknown> }[] }[]; pages: { path: string; collectionId?: string }[] } }>(
          `/sites/${id}/branches/${enc(b)}`,
        );
        const cols = r.document.collections ?? [];
        const c = cols.find((x) => x.id === collection || x.slug === collection || x.name.toLowerCase() === collection.toLowerCase());
        if (!c) throw new Error(`No collection "${collection}". Collections: ${cols.map((x) => `${x.name} (${x.slug})`).join(", ") || "none yet"}`);
        const tpl = r.document.pages.find((p) => p.collectionId === c.id);
        const short = (v: unknown) => (typeof v === "string" && !full && v.length > 160 ? `${v.slice(0, 157)}…` : v);
        const items = c.items.map((i) => ({ id: i.id, slug: i.slug, ...(i.draft ? { draft: true } : {}), ...(tpl ? { url: tpl.path.replace(":slug", i.slug) } : {}), values: Object.fromEntries(Object.entries(i.values).map(([k, v]) => [k, short(v)])) }));
        return JSON.stringify({ id: c.id, name: c.name, slug: c.slug, templatePage: tpl?.path ?? null, fields: c.fields, items }, null, 2);
      }),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create collection",
      description:
        "Add a CMS collection. A preset gives ready-made fields and example items: blog (title, summary, cover_image, date, author, body), team, products, jobs, or blank. Unless pages is false it also adds a list page (/<slug>) and a template page (/<slug>/:slug) for each item, with the site's navbar and footer.",
      inputSchema: {
        site,
        branch,
        name: z.string().min(1),
        preset: z.enum(COLLECTION_PRESET_NAMES as [string, ...string[]]).optional(),
        fields: z
          .array(z.object({ name: z.string(), type: z.enum(FIELD_TYPES) }))
          .optional()
          .describe("Your own fields instead of the preset's. The first is the title and must be text."),
        sampleItems: z.boolean().optional().describe("Include the preset's example items (default true with a preset). Use false when you'll add real items."),
        pages: z.boolean().optional(),
      },
    },
    ({ site: s, branch: b, name, preset, fields, sampleItems, pages }) => run(() => applyOps(s, b, [{ op: "add_collection", name, preset, fields, sampleItems, pages }], `Add ${name} collection`)),
  );

  server.registerTool(
    "add_items",
    {
      title: "Add collection items",
      description: "Add up to 100 items to a collection in one save. Slugs come from the title unless given. Each item's page and every list showing the collection update automatically.",
      inputSchema: {
        site,
        branch,
        collection: collectionArg,
        items: z.array(z.object({ values: valuesArg, slug: z.string().optional(), draft: z.boolean().optional() })).min(1).max(100),
        message: z.string().optional(),
      },
    },
    ({ site: s, branch: b, collection, items, message }) =>
      run(() => applyOps(s, b, items.map((i) => ({ op: "add_item", collectionId: collection, ...i })), message ?? `Add ${items.length} ${items.length === 1 ? "item" : "items"} to ${collection}`)),
  );

  server.registerTool(
    "update_item",
    {
      title: "Update collection item",
      description: "Change an item's values (null clears one), slug or draft status. Set draft false to make it publishable.",
      inputSchema: { site, branch, collection: collectionArg, item: z.string().describe("Item id or slug"), values: valuesArg.optional(), slug: z.string().optional(), draft: z.boolean().optional() },
    },
    ({ site: s, branch: b, collection, item, values, slug, draft }) =>
      run(() => applyOps(s, b, [{ op: "update_item", collectionId: collection, itemId: item, values, slug, draft }], `Update ${item}`)),
  );

  server.registerTool(
    "remove_item",
    {
      title: "Remove collection item",
      description: "Delete an item from a collection. Its page goes away the next time the site is published.",
      inputSchema: { site, branch, collection: collectionArg, item: z.string().describe("Item id or slug") },
      annotations: { destructiveHint: true },
    },
    ({ site: s, branch: b, collection, item }) => run(() => applyOps(s, b, [{ op: "remove_item", collectionId: collection, itemId: item }], `Remove ${item}`)),
  );

  server.registerTool(
    "add_collection_list",
    {
      title: "Add collection list",
      description: "Show a collection's items on a page: a section with a heading and a responsive grid of cards bound to the fields, linking to each item's page. Sorted by date (newest first) when the collection has a date field.",
      inputSchema: {
        site,
        branch,
        collection: collectionArg,
        page: z.string().optional().describe("Page id or path, default /"),
        index: z.number().int().min(0).optional().describe("Position among the page's sections"),
        headline: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        sortBy: z.string().optional().describe("Field key, or slug"),
        sortDir: z.enum(["asc", "desc"]).optional(),
      },
    },
    ({ site: s, branch: b, collection, page, index, headline, limit, sortBy, sortDir }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ document: { pages: { id: string; path: string; root: { id: string } }[] } }>(`/sites/${id}/branches/${enc(b)}`);
        const p = r.document.pages.find((x) => x.id === page || x.path === (page ?? "/"));
        if (!p) throw new Error(`Page ${page ?? "/"} not found`);
        return applyOps(s, b, [{ op: "add_collection_list", parentId: p.root.id, collectionId: collection, index, headline, limit, sortBy, sortDir }], `Add ${headline ?? collection} list`);
      }),
  );

  server.registerTool(
    "get_preview_url",
    { title: "Preview link", description: "Get a shareable preview link for a branch and the editor link to review it.", inputSchema: { site, branch }, annotations: { readOnlyHint: true } },
    ({ site: s, branch: b }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.get<{ url: string; editorUrl: string }>(`/sites/${id}/branches/${enc(b)}/preview-url`);
        return `Preview: ${r.url}\nOpen in editor: ${r.editorUrl}`;
      }),
  );

  server.registerTool(
    "request_review",
    {
      title: "Request review",
      description: "Finish your task: returns the change summary and the review link to give the person, who merges and publishes.",
      inputSchema: { site, branch, summary: z.string().describe("What you changed and why, in a few sentences") },
      annotations: { readOnlyHint: true },
    },
    ({ site: s, branch: b, summary }) =>
      run(async () => {
        const id = await resolveId(s);
        const [d, links] = await Promise.all([
          client.get<{ summary: string[] }>(`/sites/${id}/branches/${enc(b)}/diff`),
          client.get<{ url: string; editorUrl: string }>(`/sites/${id}/branches/${enc(b)}/preview-url`),
        ]);
        return `Ready for review.\n\n${summary}\n\nChanges:\n${d.summary.join("\n") || "(none)"}\n\nPreview: ${links.url}\nReview and merge: ${links.editorUrl}&review=1`;
      }),
  );

  server.registerTool(
    "merge_branch",
    {
      title: "Merge branch",
      description: "Merge a branch into main. Usually reserved for people; agents get a review link instead unless the admin allows it.",
      inputSchema: { site, branch, force: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    ({ site: s, branch: b, force }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.post<{ versionId: number }>(`/sites/${id}/branches/${enc(b)}/merge`, { force });
        return `Merged ${b} into main (version ${r.versionId}).`;
      }),
  );

  server.registerTool(
    "publish_site",
    {
      title: "Publish site",
      description: "Publish main to the live URL. Usually reserved for people; agents get a review link instead unless the admin allows it.",
      inputSchema: { site },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ site: s }) =>
      run(async () => {
        const id = await resolveId(s);
        const r = await client.post<{ url: string; versionId: number }>(`/sites/${id}/publish`, {});
        return `Published version ${r.versionId} to ${r.url}`;
      }),
  );

  return server;
}

function findNode(doc: unknown, id: string): unknown {
  const stack: unknown[] = [doc];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) stack.push(...cur);
    else if (cur && typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      if (o.id === id && typeof o.type === "string") return o;
      stack.push(...Object.values(o).filter((v) => v && typeof v === "object"));
    }
  }
  return null;
}
