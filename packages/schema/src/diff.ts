import { itemTitle } from "./collections.js";
import { walk } from "./tree.js";
import type { Collection, SiteDocument, SiteNode } from "./types.js";
import { describeNode } from "./outline.js";

export interface DocumentDiff {
  added: string[];
  removed: string[];
  changed: string[];
  pagesAdded: string[];
  pagesRemoved: string[];
  pagesChanged: string[];
  themeChanged: boolean;
  /** One line per changed collection, field set or item. */
  content: string[];
  /** Human-readable lines, used for review screens and agent summaries. */
  summary: string[];
}

/** JSON with sorted keys, so key order never counts as a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function index(doc: SiteDocument) {
  const nodes = new Map<string, { sig: string; node: SiteNode; parent: string | null; siblings: string[] }>();
  const add = (root: SiteNode) =>
    walk(root, (n, _d, parent) => {
      const { children, ...rest } = n;
      nodes.set(n.id, { sig: stable(rest), node: n, parent: parent?.id ?? null, siblings: parent?.children?.map((c) => c.id) ?? [] });
      void children;
    });
  doc.pages.forEach((p) => add(p.root));
  doc.components.forEach((c) => add(c.root));
  return nodes;
}

/** True when a node changed position among the siblings present in both versions. */
function moved(id: string, before: string[], after: string[]): boolean {
  const common = new Set(before.filter((x) => after.includes(x)));
  const a = before.filter((x) => common.has(x));
  const b = after.filter((x) => common.has(x));
  return a.indexOf(id) !== b.indexOf(id);
}

/** What changed between two versions of a site. */
export function diffDocuments(before: SiteDocument, after: SiteDocument): DocumentDiff {
  const a = index(before);
  const b = index(after);
  const d: DocumentDiff = { added: [], removed: [], changed: [], pagesAdded: [], pagesRemoved: [], pagesChanged: [], themeChanged: false, content: diffCollections(before.collections ?? [], after.collections ?? []), summary: [] };
  for (const [id, x] of b) {
    const old = a.get(id);
    if (!old) d.added.push(id);
    else if (old.sig !== x.sig || old.parent !== x.parent || moved(id, old.siblings, x.siblings)) d.changed.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) d.removed.push(id);
  const pa = new Map(before.pages.map((p) => [p.id, p]));
  const pb = new Map(after.pages.map((p) => [p.id, p]));
  for (const [id, p] of pb) {
    const old = pa.get(id);
    if (!old) d.pagesAdded.push(p.path);
    else if (old.path !== p.path || old.title !== p.title || old.description !== p.description || old.ogImage !== p.ogImage || !!old.unpublished !== !!p.unpublished) d.pagesChanged.push(p.path);
  }
  for (const [id, p] of pa) if (!pb.has(id)) d.pagesRemoved.push(p.path);
  d.themeChanged = stable(before.theme) !== stable(after.theme);

  // Only report the top-most added/removed nodes, not every descendant.
  const topOnly = (ids: string[], idx: typeof a) => {
    const set = new Set(ids);
    return ids.filter((id) => !set.has(idx.get(id)?.parent ?? ""));
  };
  for (const p of d.pagesAdded) d.summary.push(`+ page ${p}`);
  for (const p of d.pagesRemoved) d.summary.push(`- page ${p}`);
  for (const p of d.pagesChanged) d.summary.push(`~ page settings ${p}`);
  if (d.themeChanged) d.summary.push("~ theme");
  d.summary.push(...d.content);
  for (const id of topOnly(d.added, b)) d.summary.push(`+ ${describeNode(b.get(id)!.node)}`);
  for (const id of topOnly(d.removed, a)) d.summary.push(`- ${describeNode(a.get(id)!.node)}`);
  for (const id of d.changed) d.summary.push(`~ ${describeNode(b.get(id)!.node)}`);
  return d;
}

const MAX_ITEM_LINES = 25;

/** Content changes: collections added or removed, fields, and items. */
function diffCollections(before: Collection[], after: Collection[]): string[] {
  const out: string[] = [];
  const old = new Map(before.map((c) => [c.id, c]));
  for (const c of after) {
    const o = old.get(c.id);
    if (!o) {
      out.push(`+ collection ${c.name} (${c.items.length} ${c.items.length === 1 ? "item" : "items"})`);
      continue;
    }
    if (o.name !== c.name || o.slug !== c.slug) out.push(`~ collection ${c.name} settings`);
    if (stable(o.fields) !== stable(c.fields)) out.push(`~ ${c.name} fields`);
    const items: string[] = [];
    const oi = new Map(o.items.map((x) => [x.id, x]));
    const ni = new Set(c.items.map((x) => x.id));
    for (const item of c.items) {
      const prev = oi.get(item.id);
      if (!prev) items.push(`+ ${c.name} item "${itemTitle(c, item)}"${item.draft ? " (draft)" : ""}`);
      else if (stable(prev) !== stable(item)) {
        const note = prev.draft && !item.draft ? " (no longer a draft)" : !prev.draft && item.draft ? " (now a draft)" : "";
        items.push(`~ ${c.name} item "${itemTitle(c, item)}"${note}`);
      }
    }
    for (const item of o.items) if (!ni.has(item.id)) items.push(`- ${c.name} item "${itemTitle(o, item)}"`);
    const common = c.items.filter((x) => oi.has(x.id)).map((x) => x.id);
    const was = o.items.filter((x) => ni.has(x.id)).map((x) => x.id);
    if (common.join() !== was.join()) items.push(`~ ${c.name} item order`);
    out.push(...items.slice(0, MAX_ITEM_LINES));
    if (items.length > MAX_ITEM_LINES) out.push(`~ ${c.name}: ${items.length - MAX_ITEM_LINES} more item changes`);
  }
  const now = new Set(after.map((c) => c.id));
  for (const c of before) if (!now.has(c.id)) out.push(`- collection ${c.name}`);
  return out;
}

/** What one saved version changed, kept with the version for the history timeline. */
export interface VersionChanges {
  /** Pages whose content or settings changed, with how many elements. */
  pages: { id: string; path: string; title: string; added: number; changed: number; removed: number; status?: "added" | "removed" }[];
  pageIds: string[];
  added: number;
  changed: number;
  removed: number;
  theme: boolean;
  components: boolean;
  /** Collection and item changes, first few. */
  content: string[];
  /** Language, redirect and other settings. */
  settings: boolean;
}

export function summarizeChanges(before: SiteDocument, after: SiteDocument): VersionChanges {
  const d = diffDocuments(before, after);
  const where = (doc: SiteDocument) => {
    const m = new Map<string, string>();
    for (const p of doc.pages) walk(p.root, (n) => void m.set(n.id, p.id));
    for (const c of doc.components) walk(c.root, (n) => void m.set(n.id, `component:${c.id}`));
    return m;
  };
  const wa = where(before);
  const wb = where(after);
  const pages = new Map<string, VersionChanges["pages"][number]>();
  const pageOf = (id: string) => {
    const p = after.pages.find((x) => x.id === id) ?? before.pages.find((x) => x.id === id);
    if (!p) return null;
    let e = pages.get(id);
    if (!e) pages.set(id, (e = { id, path: p.path, title: p.title, added: 0, changed: 0, removed: 0 }));
    return e;
  };
  let components = false;
  const count = (ids: string[], map: Map<string, string>, key: "added" | "changed" | "removed") => {
    for (const id of ids) {
      const owner = map.get(id);
      if (!owner) continue;
      if (owner.startsWith("component:")) components = true;
      else {
        const e = pageOf(owner);
        if (e) e[key]++;
      }
    }
  };
  count(d.added, wb, "added");
  count(d.changed, wb, "changed");
  count(d.removed, wa, "removed");
  const beforeIds = new Set(before.pages.map((p) => p.id));
  const afterIds = new Set(after.pages.map((p) => p.id));
  for (const p of after.pages) if (!beforeIds.has(p.id)) pageOf(p.id)!.status = "added";
  for (const p of before.pages) if (!afterIds.has(p.id)) pageOf(p.id)!.status = "removed";
  for (const p of after.pages) {
    const o = before.pages.find((x) => x.id === p.id);
    if (o && (o.path !== p.path || o.title !== p.title || o.description !== p.description || stable(o.i18n) !== stable(p.i18n) || !!o.unpublished !== !!p.unpublished)) pageOf(p.id);
  }
  const list = [...pages.values()];
  return {
    pages: list,
    pageIds: list.map((p) => p.id),
    added: d.added.length,
    changed: d.changed.length,
    removed: d.removed.length,
    theme: d.themeChanged,
    components,
    content: d.content.slice(0, 8),
    settings: stable(before.settings) !== stable(after.settings) || stable(before.brand) !== stable(after.brand),
  };
}
