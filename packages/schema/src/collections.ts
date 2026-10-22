import { newId } from "./ids.js";
import { cloneWithNewIds } from "./tree.js";
import type { Collection, CollectionField, CollectionItem, FieldValue, Page, SiteDocument, SiteNode, Style, StyleSet } from "./types.js";

/**
 * Collections: structured content rendered through template pages and lists.
 * Pure helpers shared by ops, the renderer, the editor and the MCP server.
 */

export const collectionsOf = (doc: SiteDocument): Collection[] => doc.collections ?? [];

export function findCollection(doc: SiteDocument, idOrSlug: string): Collection | undefined {
  return collectionsOf(doc).find((c) => c.id === idOrSlug || c.slug === idOrSlug);
}

/** "Hello, World!" -> "hello-world". */
export function slugify(s: string, max = 80): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "item"
  );
}

/** "Cover image" -> "cover_image". Always starts with a letter. */
export function fieldKey(name: string): string {
  const k = slugify(name, 40).replace(/-/g, "_");
  return /^[a-z]/.test(k) ? k : `f_${k}`.slice(0, 40);
}

export function uniqueName(base: string, taken: Set<string>, sep = "-"): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const s = `${base}${sep}${i}`;
    if (!taken.has(s)) return s;
  }
}

/** The title of an item: its first field. */
export function itemTitle(c: Collection, item: CollectionItem): string {
  const v = item.values[c.fields[0]?.id ?? ""];
  return v === undefined || v === "" ? "Untitled" : String(v);
}

export function templatePageOf(doc: SiteDocument, collectionId: string): Page | undefined {
  return doc.pages.find((p) => p.collectionId === collectionId);
}

export const itemPath = (templatePath: string, slug: string) => templatePath.replace(":slug", slug);

/** Root-relative URL of an item's page, or null when its collection has no template page. */
export function itemUrl(doc: SiteDocument, c: Collection, item: CollectionItem): string | null {
  const page = templatePageOf(doc, c.id);
  return page && !page.unpublished ? itemPath(page.path, item.slug) : null;
}

export interface Route {
  path: string;
  page: Page;
  collection?: Collection;
  item?: CollectionItem;
}

/** Every URL a site serves: ordinary pages, plus one per item of each template page. */
export function siteRoutes(doc: SiteDocument, opts: { includeDrafts?: boolean } = {}): Route[] {
  const out: Route[] = [];
  for (const page of doc.pages) {
    if (page.unpublished && !opts.includeDrafts) continue;
    if (!page.collectionId) {
      out.push({ path: page.path, page });
      continue;
    }
    const c = findCollection(doc, page.collectionId);
    for (const item of c?.items ?? []) {
      if (item.draft && !opts.includeDrafts) continue;
      out.push({ path: itemPath(page.path, item.slug), page, collection: c, item });
    }
  }
  return out;
}

export function resolveRoute(doc: SiteDocument, path: string, opts: { includeDrafts?: boolean } = {}): Route | undefined {
  return siteRoutes(doc, opts).find((r) => r.path === path);
}

/** Items a collection-list node shows, after sorting and the limit. */
export function listItems(doc: SiteDocument, node: SiteNode, opts: { includeDrafts?: boolean } = {}): { collection?: Collection; items: CollectionItem[] } {
  const c = findCollection(doc, String(node.props.collectionId ?? ""));
  if (!c) return { items: [] };
  let items = c.items.filter((i) => opts.includeDrafts || !i.draft);
  const sortBy = typeof node.props.sortBy === "string" ? node.props.sortBy : "";
  if (sortBy) {
    const dir = node.props.sortDir === "desc" ? -1 : 1;
    const val = (i: CollectionItem) => (sortBy === "slug" ? i.slug : i.values[sortBy]);
    items = [...items].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === undefined || x === "") return 1;
      if (y === undefined || y === "") return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  const limit = Number(node.props.limit);
  if (Number.isInteger(limit) && limit > 0) items = items.slice(0, limit);
  return { collection: c, items };
}

/** A value as display text: dates formatted for the site's language, booleans as Yes/No. */
export function formatValue(field: CollectionField | undefined, value: FieldValue | undefined, lang = "en"): string {
  if (value === undefined || value === null) return "";
  if (field?.type === "boolean") return value ? "Yes" : "No";
  if (field?.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (!Number.isNaN(d.getTime())) {
      try {
        return new Intl.DateTimeFormat(lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
      } catch {
        return value.slice(0, 10);
      }
    }
  }
  return String(value);
}

/** Example values for an empty collection, so its template page has something to show. */
export function placeholderItem(c: Collection): CollectionItem {
  const values: Record<string, FieldValue> = {};
  for (const f of c.fields) {
    if (f.type === "text") values[f.id] = f.name;
    else if (f.type === "richtext") values[f.id] = `Write the ${f.name.toLowerCase()} here.`;
    else if (f.type === "date") values[f.id] = new Date().toISOString().slice(0, 10);
    else if (f.type === "number") values[f.id] = 0;
  }
  return { id: "placeholder", slug: "example", values };
}

// ---------------------------------------------------------------------------
// Presets and the layouts made for a new collection.

interface Preset {
  name: string;
  slug: string;
  fields: Array<[name: string, type: CollectionField["type"]]>;
  items: Array<Record<string, FieldValue>>;
}

/** Example cover art drawn inline, so new collections look right offline too. */
const IMG = (a: string, b: string) =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="930" cy="190" r="160" fill="#fff" fill-opacity=".16"/><circle cx="240" cy="540" r="260" fill="#fff" fill-opacity=".09"/></svg>`,
  );

export const COLLECTION_PRESETS: Record<string, Preset> = {
  blog: {
    name: "Blog",
    slug: "blog",
    fields: [["Title", "text"], ["Summary", "text"], ["Cover image", "image"], ["Date", "date"], ["Author", "text"], ["Body", "richtext"]],
    items: [
      {
        title: "Welcome to the blog",
        summary: "What we'll be writing about, and why.",
        cover_image: IMG("#6366f1", "#22d3ee"),
        date: "2026-10-01",
        author: "The team",
        body: "This is the first post. Edit it in the **CMS** tab, or ask Claude to write the next one.\n\n## What's next\n\n- Product updates\n- Guides and how-tos\n- Stories from customers",
      },
      {
        title: "How we work",
        summary: "A short look at our process.",
        cover_image: IMG("#f97316", "#f43f5e"),
        date: "2026-10-15",
        author: "The team",
        body: "Every post is an item in the Blog collection. Its page uses the **Blog post** template, so changing the template changes every post.",
      },
    ],
  },
  team: {
    name: "Team",
    slug: "team",
    fields: [["Name", "text"], ["Role", "text"], ["Photo", "image"], ["Bio", "richtext"]],
    items: [
      { name: "Alex Rivera", role: "Founder", photo: IMG("#0ea5e9", "#a78bfa"), bio: "Alex started the company in 2024." },
      { name: "Sam Lee", role: "Design lead", photo: IMG("#10b981", "#facc15"), bio: "Sam leads design across the product." },
    ],
  },
  products: {
    name: "Products",
    slug: "products",
    fields: [["Name", "text"], ["Price", "text"], ["Image", "image"], ["Description", "richtext"], ["Buy link", "link"]],
    items: [
      { name: "Starter kit", price: "$49", image: IMG("#64748b", "#38bdf8"), description: "Everything you need to begin.", buy_link: "https://example.com/buy/starter" },
      { name: "Pro kit", price: "$129", image: IMG("#7c3aed", "#ec4899"), description: "For teams that ship every week.", buy_link: "https://example.com/buy/pro" },
    ],
  },
  jobs: {
    name: "Jobs",
    slug: "jobs",
    fields: [["Title", "text"], ["Location", "text"], ["Team", "text"], ["Description", "richtext"], ["Apply link", "link"]],
    items: [{ title: "Product designer", location: "Remote", team: "Design", description: "Help shape how people build websites.", apply_link: "mailto:jobs@example.com" }],
  },
  blank: { name: "Collection", slug: "items", fields: [["Title", "text"]], items: [] },
};

export const COLLECTION_PRESET_NAMES = Object.keys(COLLECTION_PRESETS);

export function presetFields(preset: string): CollectionField[] {
  const p = COLLECTION_PRESETS[preset] ?? COLLECTION_PRESETS.blank!;
  return p.fields.map(([name, type]) => ({ id: fieldKey(name), name, type }));
}

export function presetItems(preset: string, c: Collection): CollectionItem[] {
  const p = COLLECTION_PRESETS[preset] ?? COLLECTION_PRESETS.blank!;
  const taken = new Set<string>();
  return p.items.map((values) => {
    const slug = uniqueName(slugify(String(values[c.fields[0]!.id] ?? "item")), taken);
    taken.add(slug);
    return { id: newId("i"), slug, values: { ...values } };
  });
}

function el(type: SiteNode["type"], props: Record<string, unknown>, style: StyleSet = {}, children?: SiteNode[], name?: string): SiteNode {
  const node: SiteNode = { id: newId(), type, props, style };
  if (name) node.name = name;
  if (children) node.children = children;
  return node;
}

const muted: Style = { color: "var(--color-muted)", margin: "0" };
const singular = (name: string) => (/ies$/i.test(name) ? name.replace(/ies$/i, "y") : name.replace(/s$/i, ""));

/** The repeated card inside a collection list, bound to the collection's fields. */
export function buildCard(c: Collection): SiteNode {
  const title = c.fields[0]!;
  const image = c.fields.find((f) => f.type === "image");
  const date = c.fields.find((f) => f.type === "date");
  const extra = c.fields.find((f) => f !== title && f.type === "text");
  const kids: SiteNode[] = [];
  if (image) kids.push(el("image", { alt: "", bind: { src: image.id, alt: title.id } }, { base: { width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: "var(--radius)" } }, undefined, image.name));
  const body: SiteNode[] = [];
  if (date) body.push(el("text", { text: "", bind: { text: date.id } }, { base: { ...muted, fontSize: "14px" } }, undefined, date.name));
  body.push(el("heading", { text: "", level: 3, bind: { text: title.id } }, { base: { margin: "0", fontSize: "22px", fontFamily: "var(--font-heading)", color: "var(--color-text)" } }, undefined, title.name));
  if (extra) body.push(el("text", { text: "", bind: { text: extra.id } }, { base: { ...muted, fontSize: "16px", lineHeight: "1.5" } }, undefined, extra.name));
  kids.push(el("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "8px" } }, body, "Text"));
  return el(
    "link",
    { href: "#", bind: { href: "url" } },
    { base: { display: "flex", flexDirection: "column", gap: "16px", textDecoration: "none", color: "inherit" } },
    kids,
    `${singular(c.name)} card`,
  );
}

export interface ListOptions {
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/** A collection-list node: a responsive grid repeating one card per item. */
export function buildCollectionList(c: Collection, opts: ListOptions = {}): SiteNode {
  const props: Record<string, unknown> = { collectionId: c.id, empty: `No ${c.name.toLowerCase()} yet.` };
  if (opts.limit) props.limit = opts.limit;
  const date = c.fields.find((f) => f.type === "date");
  const sortBy = opts.sortBy ?? date?.id;
  if (sortBy) {
    props.sortBy = sortBy;
    props.sortDir = opts.sortDir ?? (sortBy === date?.id ? "desc" : "asc");
  }
  return el(
    "collection-list",
    props,
    { base: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "32px" }, tablet: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, mobile: { gridTemplateColumns: "1fr" } },
    [buildCard(c)],
    `${c.name} list`,
  );
}

function sectionWrap(name: string, children: SiteNode[], maxWidth = "1120px"): SiteNode {
  return el(
    "section",
    {},
    { base: { padding: "96px 24px", display: "flex", flexDirection: "column" }, mobile: { padding: "56px 20px" } },
    [el("stack", {}, { base: { width: "100%", maxWidth, margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" } }, children, "Container")],
    name,
  );
}

/** A section with a heading and a list of the collection's items. */
export function buildListSection(c: Collection, content: { headline?: string; subheadline?: string } & ListOptions = {}): SiteNode {
  const kids: SiteNode[] = [
    el("heading", { text: content.headline || c.name, level: 2 }, { base: { margin: "0", fontSize: "44px", lineHeight: "1.1", fontFamily: "var(--font-heading)", color: "var(--color-text)" }, mobile: { fontSize: "32px" } }),
  ];
  if (content.subheadline) kids.push(el("text", { text: content.subheadline }, { base: { ...muted, fontSize: "18px" } }));
  kids.push(buildCollectionList(c, content));
  return sectionWrap(content.headline || c.name, kids);
}

/** Navbar and footer copied from the home page, so new pages match the site. */
export function siteChrome(doc: SiteDocument): { top: SiteNode[]; bottom: SiteNode[] } {
  const home = doc.pages.find((p) => p.path === "/") ?? doc.pages[0];
  const kids = home?.root.children ?? [];
  const first = kids[0];
  const last = kids[kids.length - 1];
  return {
    top: first && /nav/i.test(first.name ?? "") ? [cloneWithNewIds(first)] : [],
    bottom: last && last !== first && /footer/i.test(last.name ?? "") ? [cloneWithNewIds(last)] : [],
  };
}

export function pageRoot(children: SiteNode[]): SiteNode {
  return el("stack", {}, { base: { display: "flex", flexDirection: "column", minHeight: "100vh" } }, children, "Page");
}

/** The template page layout: every field of an item, bound, in reading order. */
export function buildTemplateSections(c: Collection, listPath?: string): SiteNode[] {
  const kids: SiteNode[] = [];
  if (listPath) {
    kids.push(el("link", { href: listPath }, { base: { color: "var(--color-muted)", textDecoration: "none", fontSize: "15px" } }, [el("text", { text: `← Back to ${c.name.toLowerCase()}` }, { base: { margin: "0" } })], "Back link"));
  }
  const [title, ...rest] = c.fields;
  for (const f of rest.filter((x) => x.type === "date")) kids.push(el("text", { text: "", bind: { text: f.id } }, { base: { ...muted, fontSize: "15px" } }, undefined, f.name));
  kids.push(el("heading", { text: "", level: 1, bind: { text: title!.id } }, { base: { margin: "0", fontSize: "52px", lineHeight: "1.08", letterSpacing: "-0.02em", fontFamily: "var(--font-heading)", color: "var(--color-text)" }, mobile: { fontSize: "36px" } }, undefined, title!.name));
  for (const f of rest) {
    if (f.type === "text" || f.type === "number") kids.push(el("text", { text: "", bind: { text: f.id } }, { base: { ...muted, fontSize: "20px", lineHeight: "1.5" } }, undefined, f.name));
  }
  for (const f of rest.filter((x) => x.type === "image")) {
    kids.push(el("image", { alt: "", bind: { src: f.id, alt: title!.id } }, { base: { width: "100%", borderRadius: "var(--radius)", marginTop: "16px" } }, undefined, f.name));
  }
  for (const f of rest.filter((x) => x.type === "richtext")) kids.push(el("richtext", { markdown: "", bind: { markdown: f.id } }, { base: { fontSize: "18px", lineHeight: "1.7", color: "var(--color-text)" } }, undefined, f.name));
  for (const f of rest.filter((x) => x.type === "link")) {
    kids.push(
      el("button", { label: f.name, href: "#", bind: { href: f.id } }, { base: { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: 600, textDecoration: "none", display: "flex", width: "fit-content" } }, undefined, f.name),
    );
  }
  return [sectionWrap(`${singular(c.name)} content`, kids, "760px")];
}
