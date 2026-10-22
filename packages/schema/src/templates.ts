import type { SiteDocument } from "./types.js";

/**
 * Saved site templates: a snapshot of a site that new sites start from.
 */

/** Turn a site into a template: keep pages, theme, components and collection fields; items only if asked. */
export function templateFromDocument(doc: SiteDocument, opts: { includeItems?: boolean } = {}): SiteDocument {
  const t: SiteDocument = structuredClone(doc);
  delete t.brand;
  t.components = t.components.map(({ brandId, ...c }) => (void brandId, c));
  if (!opts.includeItems) for (const c of t.collections ?? []) c.items = [];
  return t;
}

const SKIP = new Set(["id", "style", "path", "slug", "bind", "componentId", "collectionId", "src", "href", "url", "logo", "favicon", "ogImage", "theme"]);

/** Replace a name everywhere it appears as text (brand names in navbars, titles, footers). */
export function renameInDocument(doc: SiteDocument, from: string, to: string): SiteDocument {
  if (!from.trim() || from === to) return doc;
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return v.split(from).join(to);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      // Only change what people read: ids, paths and style values stay as they are.
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SKIP.has(k) ? x : visit(x);
      return out;
    }
    return v;
  };
  return visit(doc) as SiteDocument;
}
