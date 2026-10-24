import type { Redirect, SiteDocument } from "./types.js";

/** Most redirects a site keeps; the oldest go first. */
export const MAX_REDIRECTS = 500;

/**
 * Where an old address now lives, or null. Pages always win over redirects,
 * so callers check for a page first. "/news/:slug" carries the item on.
 */
export function resolveRedirect(doc: SiteDocument, path: string): string | null {
  const clean = path === "/" ? "/" : path.replace(/\/+$/, "");
  for (const r of doc.settings.redirects ?? []) {
    if (r.from === clean) return r.to;
    if (r.from.endsWith("/:slug")) {
      const base = r.from.slice(0, -"/:slug".length);
      const m = clean.startsWith(base + "/") ? clean.slice(base.length + 1) : null;
      if (m && !m.includes("/") && r.to.endsWith("/:slug")) return r.to.slice(0, -":slug".length) + m;
    }
  }
  return null;
}

/**
 * Add redirects for moved addresses: existing redirects that pointed at an old
 * address now point at the new one (no chains), and nothing redirects away
 * from an address a page uses.
 */
export function addRedirects(current: Redirect[], moves: Redirect[], pagePaths: Set<string>): Redirect[] {
  const map = new Map(current.map((r) => [r.from, r.to]));
  for (const m of moves) {
    if (m.from === m.to) continue;
    for (const [from, to] of map) if (to === m.from) map.set(from, m.to);
    map.set(m.from, m.to);
  }
  for (const [from, to] of map) if (pagePaths.has(from) || from === to) map.delete(from);
  const out = [...map].map(([from, to]) => ({ from, to }));
  return out.slice(Math.max(0, out.length - MAX_REDIRECTS));
}
