import { walk } from "./tree.js";
import type { SiteDocument, SiteNode } from "./types.js";
import { describeNode } from "./outline.js";

export interface DocumentDiff {
  added: string[];
  removed: string[];
  changed: string[];
  pagesAdded: string[];
  pagesRemoved: string[];
  pagesChanged: string[];
  themeChanged: boolean;
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
  const d: DocumentDiff = { added: [], removed: [], changed: [], pagesAdded: [], pagesRemoved: [], pagesChanged: [], themeChanged: false, summary: [] };
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
    else if (old.path !== p.path || old.title !== p.title || old.description !== p.description || old.ogImage !== p.ogImage) d.pagesChanged.push(p.path);
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
  for (const id of topOnly(d.added, b)) d.summary.push(`+ ${describeNode(b.get(id)!.node)}`);
  for (const id of topOnly(d.removed, a)) d.summary.push(`- ${describeNode(a.get(id)!.node)}`);
  for (const id of d.changed) d.summary.push(`~ ${describeNode(b.get(id)!.node)}`);
  return d;
}
