import { z } from "zod";
import { BLOCK_NAMES, buildBlock } from "./blocks.js";
import {
  buildCollectionList,
  buildListSection,
  buildTemplateSections,
  COLLECTION_PRESET_NAMES,
  fieldKey,
  pageRoot,
  presetFields,
  presetItems,
  siteChrome,
  slugify,
  uniqueName,
} from "./collections.js";
import { newId } from "./ids.js";
import { cloneWithNewIds, collectIds, ensureUniqueIds, findInTree, findNodeInDocument, findPage } from "./tree.js";
import { CONTAINER_TYPES, FIELD_TYPES, type Breakpoint, type Collection, type CollectionField, type FieldValue, type SiteDocument, type SiteNode, type Style } from "./types.js";
import { brandViolations } from "./brand.js";
import { LOCALE, PAGE_TRANSLATABLE, stripLocale, TRANSLATABLE } from "./i18n.js";
import { validateDocument } from "./validate.js";

/**
 * Edit operations. The editor, the API and the MCP server all change documents
 * through these, so an agent's edit and a person's edit are the same thing.
 */

const looseNode: z.ZodType<Partial<SiteNode> & { type: SiteNode["type"] }> = z.lazy(() =>
  z
    .object({
      id: z.string().optional(),
      type: z.string(),
      name: z.string().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
      style: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number()]))).optional(),
      animation: z.any().optional(),
      hover: z.any().optional(),
      parallax: z.number().optional(),
      scroll: z.any().optional(),
      hidden: z.any().optional(),
      children: z.array(looseNode).optional(),
    })
    .passthrough(),
) as never;

const breakpoint = z.enum(["base", "tablet", "mobile"]);
const fieldInput = z.object({ name: z.string().min(1).max(80), type: z.enum(FIELD_TYPES), id: z.string().optional() });
const valuesInput = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const styleValues = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    parentId: z.string(),
    index: z.number().int().min(0).optional(),
    node: looseNode,
  }),
  z.object({
    op: z.literal("add_block"),
    parentId: z.string(),
    index: z.number().int().min(0).optional(),
    block: z.enum(BLOCK_NAMES as [string, ...string[]]),
    content: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    op: z.literal("update_node"),
    nodeId: z.string(),
    name: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    style: styleValues.optional(),
    breakpoint: breakpoint.optional(),
    animation: z.any().optional(),
    hover: z.any().optional(),
    parallax: z.number().nullable().optional(),
    scroll: z.any().optional(),
    hidden: z.any().optional(),
  }),
  z.object({ op: z.literal("remove_node"), nodeId: z.string() }),
  z.object({
    op: z.literal("move_node"),
    nodeId: z.string(),
    parentId: z.string(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal("duplicate_node"), nodeId: z.string() }),
  z.object({
    op: z.literal("add_page"),
    path: z.string(),
    title: z.string(),
    description: z.string().optional(),
    blocks: z.array(z.enum(BLOCK_NAMES as [string, ...string[]])).optional(),
    /** Make a template page that renders each item of this collection; path ends in /:slug. */
    collectionId: z.string().optional(),
  }),
  z.object({
    op: z.literal("update_page"),
    pageId: z.string(),
    path: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
    /** Hide the page from the published site (true) or show it again (false). */
    unpublished: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove_page"), pageId: z.string() }),
  z.object({
    op: z.literal("set_theme"),
    colors: z.record(z.string(), z.string()).optional(),
    fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
    radius: z.string().optional(),
  }),
  z.object({ op: z.literal("create_component"), nodeId: z.string(), name: z.string() }),
  z.object({
    op: z.literal("add_collection"),
    name: z.string().min(1).max(80),
    slug: z.string().optional(),
    /** Ready-made fields and example items: blog, team, products, jobs or blank. */
    preset: z.enum(COLLECTION_PRESET_NAMES as [string, ...string[]]).optional(),
    /** Fields to use instead of the preset's. The first is the title and must be text. */
    fields: z.array(fieldInput).min(1).max(40).optional(),
    /** Add the preset's example items (default true with a preset). */
    sampleItems: z.boolean().optional(),
    /** Also add a list page (/blog) and a template page (/blog/:slug). Default true. */
    pages: z.boolean().optional(),
  }),
  z.object({ op: z.literal("update_collection"), collectionId: z.string(), name: z.string().min(1).max(80).optional(), slug: z.string().optional() }),
  z.object({ op: z.literal("remove_collection"), collectionId: z.string() }),
  z.object({
    op: z.literal("add_field"),
    collectionId: z.string(),
    name: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    id: z.string().optional(),
    index: z.number().int().min(1).optional(),
    localized: z.boolean().optional(),
  }),
  /** The site's extra languages (the main one is settings.lang). Removing one deletes its translations. */
  z.object({ op: z.literal("set_locales"), locales: z.array(z.string()).max(20), main: z.string().optional() }),
  /** Set (or clear with null) translations of one element, page or CMS item. */
  z.object({
    op: z.literal("set_translation"),
    locale: z.string(),
    nodeId: z.string().optional(),
    pageId: z.string().optional(),
    collectionId: z.string().optional(),
    itemId: z.string().optional(),
    values: z.record(z.string(), z.union([z.string(), z.null()])),
  }),
  z.object({ op: z.literal("update_field"), collectionId: z.string(), fieldId: z.string(), name: z.string().min(1).max(80).optional(), localized: z.boolean().optional() }),
  z.object({ op: z.literal("remove_field"), collectionId: z.string(), fieldId: z.string() }),
  z.object({
    op: z.literal("add_item"),
    collectionId: z.string(),
    /** Values by field key or field name. */
    values: valuesInput,
    slug: z.string().optional(),
    draft: z.boolean().optional(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("update_item"),
    collectionId: z.string(),
    /** Item id or slug. */
    itemId: z.string(),
    /** Values to change; null clears a value. */
    values: valuesInput.optional(),
    slug: z.string().optional(),
    draft: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove_item"), collectionId: z.string(), itemId: z.string() }),
  z.object({ op: z.literal("move_item"), collectionId: z.string(), itemId: z.string(), index: z.number().int().min(0) }),
  z.object({
    op: z.literal("add_collection_list"),
    parentId: z.string(),
    index: z.number().int().min(0).optional(),
    collectionId: z.string(),
    /** Wrap the list in a section with this heading (default: the collection name). */
    headline: z.string().optional(),
    /** false adds just the list, for placing inside an existing section. */
    section: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    sortBy: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

export class OperationError extends Error {
  constructor(
    message: string,
    public readonly opIndex: number,
  ) {
    super(`Operation ${opIndex + 1}: ${message}`);
  }
}

export interface ApplyResult {
  document: SiteDocument;
  /** Ids created by each operation (new node, page or component id). */
  created: (string | null)[];
}

function locateParent(doc: SiteDocument, parentId: string, i: number): SiteNode {
  const hit = findNodeInDocument(doc, parentId);
  if (!hit) throw new OperationError(`parent "${parentId}" not found`, i);
  if (!CONTAINER_TYPES.has(hit.node.type)) {
    throw new OperationError(`"${parentId}" is a ${hit.node.type} and can't contain other elements`, i);
  }
  return hit.node;
}

function insertAt(parent: SiteNode, node: SiteNode, index?: number) {
  parent.children ??= [];
  const at = index === undefined ? parent.children.length : Math.min(index, parent.children.length);
  parent.children.splice(at, 0, node);
}

function mergeStyle(target: Style, patch: Record<string, string | number | null>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") delete (target as Record<string, unknown>)[k];
    else (target as Record<string, unknown>)[k] = v;
  }
}

function normalizePath(path: string): string {
  const p = path.trim().toLowerCase();
  if (p === "" || p === "/") return "/";
  return "/" + p.replace(/^\/+|\/+$/g, "");
}

function getCollection(doc: SiteDocument, idOrSlug: string, i: number): Collection {
  const c = (doc.collections ?? []).find((x) => x.id === idOrSlug || x.slug === idOrSlug || x.name.toLowerCase() === idOrSlug.toLowerCase());
  if (!c) throw new OperationError(`collection "${idOrSlug}" not found`, i);
  return c;
}

function getItemIndex(c: Collection, idOrSlug: string, i: number): number {
  const at = c.items.findIndex((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (at < 0) throw new OperationError(`${c.name} has no item "${idOrSlug}"`, i);
  return at;
}

function getField(c: Collection, idOrName: string, i: number): CollectionField {
  const f = c.fields.find((x) => x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase());
  if (!f) throw new OperationError(`${c.name} has no field "${idOrName}". Fields: ${c.fields.map((x) => x.id).join(", ")}`, i);
  return f;
}

/** Accept values by key or name, and the obvious conversions (\"12\" for a number, a full timestamp for a date). */
function coerceValues(c: Collection, values: Record<string, FieldValue | null>, i: number): Record<string, FieldValue | null> {
  const out: Record<string, FieldValue | null> = {};
  for (const [k, raw] of Object.entries(values)) {
    const f = getField(c, k, i);
    let v = raw;
    if (v !== null) {
      if (f.type === "number" && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) v = Number(v);
      if (f.type === "boolean" && (v === "true" || v === "false")) v = v === "true";
      if (f.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) v = v.slice(0, 10);
      if ((f.type === "text" || f.type === "richtext") && typeof v === "number") v = String(v);
    }
    out[f.id] = v;
  }
  return out;
}

function cleanSlug(raw: string, i: number): string {
  const s = slugify(raw);
  if (!s) throw new OperationError(`"${raw}" can't be used as a slug`, i);
  return s;
}

function addPageWithRoot(doc: SiteDocument, path: string, title: string, children: SiteNode[], collectionId?: string) {
  const page: SiteDocument["pages"][number] = { id: newId("p"), path, title, root: ensureUniqueIds(pageRoot(children), collectIds(doc)) };
  if (collectionId) page.collectionId = collectionId;
  doc.pages.push(page);
  return page;
}

/** Remove every node matching a test from all pages and components. */
function removeNodesWhere(doc: SiteDocument, test: (n: SiteNode) => boolean) {
  const prune = (n: SiteNode) => {
    if (n.children) n.children = n.children.filter((c) => !test(c));
    n.children?.forEach(prune);
  };
  doc.pages.forEach((p) => prune(p.root));
  doc.components.forEach((c) => prune(c.root));
}

function applyOne(doc: SiteDocument, op: Operation, i: number): string | null {
  switch (op.op) {
    case "add_node": {
      const parent = locateParent(doc, op.parentId, i);
      const node = ensureUniqueIds(op.node as SiteNode, collectIds(doc));
      insertAt(parent, node, op.index);
      return node.id;
    }
    case "add_block": {
      const parent = locateParent(doc, op.parentId, i);
      const node = ensureUniqueIds(buildBlock(op.block, op.content ?? {}), collectIds(doc));
      // Name the layer after its headline so layers and reviews read "Today's menu", not "Features".
      const headline = op.content?.headline;
      if (typeof headline === "string" && headline.trim()) node.name = headline.trim().slice(0, 60);
      insertAt(parent, node, op.index);
      return node.id;
    }
    case "update_node": {
      const hit = findNodeInDocument(doc, op.nodeId);
      if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
      const n = hit.node;
      if (op.name !== undefined) n.name = op.name;
      if (op.props) {
        for (const [k, v] of Object.entries(op.props)) {
          if (v === null) delete n.props[k];
          else n.props[k] = v;
        }
      }
      if (op.style) {
        const bp: Breakpoint = op.breakpoint ?? "base";
        n.style[bp] ??= {};
        mergeStyle(n.style[bp]!, op.style);
        if (Object.keys(n.style[bp]!).length === 0) delete n.style[bp];
      }
      if (op.animation !== undefined) {
        if (op.animation === null || op.animation?.preset === "none") delete n.animation;
        else n.animation = op.animation;
      }
      if (op.hover !== undefined) {
        if (op.hover === null || (!op.hover?.preset && !Object.keys(op.hover?.style ?? {}).length)) delete n.hover;
        else n.hover = op.hover;
      }
      // An element either follows the scroll or plays an entrance; setting one clears the other.
      if (op.scroll !== undefined) {
        if (op.scroll === null || op.scroll?.effect === "none") delete n.scroll;
        else {
          n.scroll = { effect: op.scroll.effect, range: op.scroll.range ?? "in" };
          if (!op.animation) delete n.animation;
        }
      }
      if (op.animation && op.animation.preset !== "none" && op.scroll === undefined) delete n.scroll;
      if (op.parallax !== undefined) {
        if (op.parallax === null || op.parallax === 0) delete n.parallax;
        else n.parallax = Math.round(op.parallax * 100) / 100;
      }
      if (op.hidden !== undefined) {
        if (op.hidden === null) delete n.hidden;
        else n.hidden = op.hidden;
      }
      return n.id;
    }
    case "remove_node": {
      const hit = findNodeInDocument(doc, op.nodeId);
      if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
      if (!hit.parent) throw new OperationError("the page root can't be removed", i);
      hit.parent.children!.splice(hit.index, 1);
      return null;
    }
    case "move_node": {
      const hit = findNodeInDocument(doc, op.nodeId);
      if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
      if (!hit.parent) throw new OperationError("the page root can't be moved", i);
      if (findInTree(hit.node, op.parentId)) throw new OperationError("can't move a node inside itself", i);
      const parent = locateParent(doc, op.parentId, i);
      hit.parent.children!.splice(hit.index, 1);
      insertAt(parent, hit.node, op.index);
      return hit.node.id;
    }
    case "duplicate_node": {
      const hit = findNodeInDocument(doc, op.nodeId);
      if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
      if (!hit.parent) throw new OperationError("the page root can't be duplicated", i);
      const copy = cloneWithNewIds(hit.node);
      hit.parent.children!.splice(hit.index + 1, 0, copy);
      return copy.id;
    }
    case "add_page": {
      if (op.collectionId) {
        const c = getCollection(doc, op.collectionId, i);
        if (doc.pages.some((p) => p.collectionId === c.id)) throw new OperationError(`${c.name} already has a template page`, i);
        let path = op.path.trim().toLowerCase().replace(/\/+$/, "");
        if (!path.endsWith("/:slug")) path = `${normalizePath(path)}/:slug`.replace(/^\/\//, "/");
        const chrome = siteChrome(doc);
        const list = doc.pages.find((p) => p.path === path.replace(/\/:slug$/, ""));
        return addPageWithRoot(doc, path, op.title, [...chrome.top, ...buildTemplateSections(c, list?.path), ...chrome.bottom], c.id).id;
      }
      const path = normalizePath(op.path);
      if (doc.pages.some((p) => p.path === path)) throw new OperationError(`a page already uses ${path}`, i);
      const root: SiteNode = { id: newId(), type: "stack", name: "Page", props: {}, style: { base: { display: "flex", flexDirection: "column", minHeight: "100vh" } }, children: [] };
      for (const b of op.blocks ?? []) root.children!.push(buildBlock(b, {}));
      const page = { id: newId("p"), path, title: op.title, description: op.description, root: ensureUniqueIds(root, collectIds(doc)) };
      if (page.description === undefined) delete page.description;
      doc.pages.push(page);
      return page.id;
    }
    case "update_page": {
      const page = findPage(doc, op.pageId);
      if (!page) throw new OperationError(`page "${op.pageId}" not found`, i);
      if (op.path !== undefined) {
        const path = normalizePath(op.path);
        if (doc.pages.some((p) => p !== page && p.path === path)) throw new OperationError(`a page already uses ${path}`, i);
        page.path = path;
      }
      if (op.title !== undefined) page.title = op.title;
      if (op.description !== undefined) page.description = op.description;
      if (op.ogImage !== undefined) page.ogImage = op.ogImage;
      if (op.unpublished !== undefined) {
        if (op.unpublished) page.unpublished = true;
        else delete page.unpublished;
      }
      return page.id;
    }
    case "remove_page": {
      const idx = doc.pages.findIndex((p) => p.id === op.pageId || p.path === op.pageId);
      if (idx < 0) throw new OperationError(`page "${op.pageId}" not found`, i);
      if (doc.pages.length === 1) throw new OperationError("a site needs at least one page", i);
      doc.pages.splice(idx, 1);
      return null;
    }
    case "set_theme": {
      if (op.colors) Object.assign(doc.theme.colors, op.colors);
      if (op.fonts?.heading) doc.theme.fonts.heading = op.fonts.heading;
      if (op.fonts?.body) doc.theme.fonts.body = op.fonts.body;
      if (op.radius) doc.theme.radius = op.radius;
      return null;
    }
    case "create_component": {
      const hit = findNodeInDocument(doc, op.nodeId);
      if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
      if (!hit.parent) throw new OperationError("a page root can't become a component", i);
      if (hit.componentId) throw new OperationError("node is already inside a component", i);
      const id = newId("c");
      doc.components.push({ id, name: op.name, root: hit.node });
      hit.parent.children![hit.index] = { id: newId(), type: "instance", name: op.name, props: { componentId: id }, style: {} };
      return id;
    }
    case "add_collection": {
      doc.collections ??= [];
      const preset = op.preset ?? "blank";
      const taken = new Set(doc.collections.map((c) => c.slug));
      const slug = uniqueName(cleanSlug(op.slug ?? op.name, i), taken);
      let fields: CollectionField[];
      if (op.fields) {
        const keys = new Set<string>();
        fields = op.fields.map((f) => {
          const id = uniqueName(fieldKey(f.id ?? f.name), keys, "_");
          keys.add(id);
          return { id, name: f.name, type: f.type };
        });
      } else fields = presetFields(preset);
      if (fields[0]!.type !== "text") throw new OperationError("the first field is the title and must be text", i);
      const c: Collection = { id: newId("col"), name: op.name, slug, fields, items: [] };
      if (!op.fields && (op.sampleItems ?? Boolean(op.preset))) c.items = presetItems(preset, c);
      doc.collections.push(c);
      if (op.pages ?? true) {
        const chrome = siteChrome(doc);
        const listPath = `/${slug}`;
        const hasList = doc.pages.some((p) => p.path === listPath);
        if (!hasList) addPageWithRoot(doc, listPath, op.name, [...chrome.top, buildListSection(c), ...chrome.bottom]);
        const singular = op.name.replace(/ies$/i, "y").replace(/s$/i, "");
        addPageWithRoot(doc, `${listPath}/:slug`, `${singular} page`, [...chrome.top, ...buildTemplateSections(c, listPath), ...chrome.bottom], c.id);
      }
      return c.id;
    }
    case "update_collection": {
      const c = getCollection(doc, op.collectionId, i);
      if (op.name !== undefined) c.name = op.name;
      if (op.slug !== undefined) {
        const slug = cleanSlug(op.slug, i);
        if ((doc.collections ?? []).some((x) => x !== c && x.slug === slug)) throw new OperationError(`another collection uses the slug ${slug}`, i);
        c.slug = slug;
      }
      return c.id;
    }
    case "remove_collection": {
      const c = getCollection(doc, op.collectionId, i);
      doc.collections = (doc.collections ?? []).filter((x) => x !== c);
      doc.pages = doc.pages.filter((p) => p.collectionId !== c.id);
      if (doc.pages.length === 0) throw new OperationError("a site needs at least one page", i);
      removeNodesWhere(doc, (n) => n.type === "collection-list" && n.props.collectionId === c.id);
      return null;
    }
    case "add_field": {
      const c = getCollection(doc, op.collectionId, i);
      const id = uniqueName(fieldKey(op.id ?? op.name), new Set(c.fields.map((f) => f.id)), "_");
      const at = Math.min(op.index ?? c.fields.length, c.fields.length);
      const field: CollectionField = { id, name: op.name, type: op.type };
      if (op.localized) field.localized = true;
      c.fields.splice(Math.max(1, at), 0, field);
      return id;
    }
    case "update_field": {
      const c = getCollection(doc, op.collectionId, i);
      const f = getField(c, op.fieldId, i);
      if (op.name !== undefined) f.name = op.name;
      if (op.localized !== undefined) {
        if (op.localized && f.type !== "text" && f.type !== "richtext") throw new OperationError(`only text and rich text fields can be translated`, i);
        if (op.localized) f.localized = true;
        else {
          delete f.localized;
          for (const item of c.items) for (const t of Object.values(item.i18n ?? {})) (delete t[f.id], delete t[`~${f.id}`]);
        }
      }
      return null;
    }
    case "remove_field": {
      const c = getCollection(doc, op.collectionId, i);
      const f = getField(c, op.fieldId, i);
      if (c.fields[0] === f) throw new OperationError("the title field can't be removed", i);
      c.fields = c.fields.filter((x) => x !== f);
      for (const item of c.items) delete item.values[f.id];
      return null;
    }
    case "add_item": {
      const c = getCollection(doc, op.collectionId, i);
      const values: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(coerceValues(c, op.values, i))) if (v !== null) values[k] = v;
      const taken = new Set(c.items.map((x) => x.slug));
      let slug: string;
      if (op.slug) {
        slug = cleanSlug(op.slug, i);
        if (taken.has(slug)) throw new OperationError(`${c.name} already has an item with the slug ${slug}`, i);
      } else slug = uniqueName(slugify(String(values[c.fields[0]!.id] ?? "item")), taken);
      const item = { id: newId("i"), slug, values, ...(op.draft ? { draft: true } : {}) };
      c.items.splice(Math.min(op.index ?? c.items.length, c.items.length), 0, item);
      return item.id;
    }
    case "update_item": {
      const c = getCollection(doc, op.collectionId, i);
      const item = c.items[getItemIndex(c, op.itemId, i)]!;
      if (op.values) {
        for (const [k, v] of Object.entries(coerceValues(c, op.values, i))) {
          if (v === null) delete item.values[k];
          else item.values[k] = v;
        }
      }
      if (op.slug !== undefined) {
        const slug = cleanSlug(op.slug, i);
        if (c.items.some((x) => x !== item && x.slug === slug)) throw new OperationError(`${c.name} already has an item with the slug ${slug}`, i);
        item.slug = slug;
      }
      if (op.draft !== undefined) {
        if (op.draft) item.draft = true;
        else delete item.draft;
      }
      return item.id;
    }
    case "remove_item": {
      const c = getCollection(doc, op.collectionId, i);
      c.items.splice(getItemIndex(c, op.itemId, i), 1);
      return null;
    }
    case "move_item": {
      const c = getCollection(doc, op.collectionId, i);
      const [item] = c.items.splice(getItemIndex(c, op.itemId, i), 1);
      c.items.splice(Math.min(op.index, c.items.length), 0, item!);
      return item!.id;
    }
    case "set_locales": {
      const main = op.main ?? doc.settings.lang;
      if (!/^[a-zA-Z-]{2,10}$/.test(main)) throw new OperationError(`"${main}" isn't a language code`, i);
      const next = [...new Set(op.locales.map((l) => l.trim()))].filter((l) => l && l !== main);
      for (const l of next) if (!LOCALE.test(l)) throw new OperationError(`"${l}" isn't a language code like fr, de or pt-BR`, i);
      if (main !== doc.settings.lang && (doc.settings.locales ?? []).includes(main)) {
        throw new OperationError("to make a translated language the main one, remove it first; its translations don't replace the main text", i);
      }
      for (const old of doc.settings.locales ?? []) if (!next.includes(old)) stripLocale(doc, old);
      doc.settings.lang = main;
      if (next.length) doc.settings.locales = next;
      else delete doc.settings.locales;
      return null;
    }
    case "set_translation": {
      if (!(doc.settings.locales ?? []).includes(op.locale)) throw new OperationError(`add ${op.locale} to the site's languages first`, i);
      const write = (target: { i18n?: Record<string, Record<string, string>> }, source: Record<string, unknown>, allowed: readonly string[]) => {
        for (const [k, v] of Object.entries(op.values)) {
          if (!allowed.includes(k)) throw new OperationError(`"${k}" can't be translated here. Translatable: ${allowed.join(", ") || "nothing"}`, i);
          target.i18n ??= {};
          const t = (target.i18n[op.locale] ??= {});
          if (v === null || v === "") {
            delete t[k];
            delete t[`~${k}`];
          } else {
            t[k] = v;
            // Remember what it was translated from, to spot when the original changes.
            if (typeof source[k] === "string") t[`~${k}`] = source[k] as string;
          }
          if (!Object.keys(t).length) delete target.i18n[op.locale];
          if (!Object.keys(target.i18n).length) delete target.i18n;
        }
      };
      if (op.nodeId) {
        const hit = findNodeInDocument(doc, op.nodeId);
        if (!hit) throw new OperationError(`node "${op.nodeId}" not found`, i);
        const holder = hit.node.props as { i18n?: Record<string, Record<string, string>> };
        write(holder, hit.node.props, TRANSLATABLE[hit.node.type] ?? []);
        return hit.node.id;
      }
      if (op.pageId) {
        const page = findPage(doc, op.pageId);
        if (!page) throw new OperationError(`page "${op.pageId}" not found`, i);
        write(page, page as unknown as Record<string, unknown>, PAGE_TRANSLATABLE);
        return page.id;
      }
      if (op.collectionId && op.itemId) {
        const c = getCollection(doc, op.collectionId, i);
        const item = c.items[getItemIndex(c, op.itemId, i)]!;
        const keys = Object.fromEntries(Object.entries(op.values).map(([k, v]) => [getField(c, k, i).id, v]));
        op.values = keys;
        write(item, item.values, c.fields.filter((f) => f.localized).map((f) => f.id));
        return item.id;
      }
      throw new OperationError("say what to translate: nodeId, pageId, or collectionId and itemId", i);
    }
    case "add_collection_list": {
      const c = getCollection(doc, op.collectionId, i);
      const parent = locateParent(doc, op.parentId, i);
      const sortBy = op.sortBy && op.sortBy !== "slug" ? getField(c, op.sortBy, i).id : op.sortBy;
      const opts = { limit: op.limit, sortBy, sortDir: op.sortDir };
      const built = op.section === false ? buildCollectionList(c, opts) : buildListSection(c, { headline: op.headline, ...opts });
      const node = ensureUniqueIds(built, collectIds(doc));
      insertAt(parent, node, op.index);
      return node.id;
    }
  }
}

/**
 * Apply operations atomically: either all succeed and the result validates,
 * or nothing changes and an error explains why.
 */
export function applyOperations(doc: SiteDocument, ops: Operation[]): ApplyResult {
  const next: SiteDocument = structuredClone(doc);
  const created: (string | null)[] = [];
  ops.forEach((op, i) => created.push(applyOne(next, op, i)));
  const v = validateDocument(next);
  if (!v.ok) throw new OperationError(`result is not a valid site: ${v.errors.join("; ")}`, ops.length - 1);
  const off = brandViolations(doc, v.document);
  if (off.length) throw new OperationError(off.join(" "), ops.length - 1);
  return { document: v.document, created };
}

/** Parse untrusted operation input. */
export function parseOperations(value: unknown): { ok: true; ops: Operation[] } | { ok: false; error: string } {
  const r = z.array(operationSchema).min(1).max(200).safeParse(value);
  if (r.success) return { ok: true, ops: r.data };
  return { ok: false, error: r.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") };
}
