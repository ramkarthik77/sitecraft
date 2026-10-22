import { findCollection } from "./collections.js";
import { walk } from "./tree.js";
import type { SiteDocument, SiteNode } from "./types.js";

/** One-line summary of a node, used in outlines agents and people read. */
export function describeNode(n: SiteNode): string {
  const label = n.name ? ` "${n.name}"` : "";
  const p = n.props;
  let detail = "";
  if (typeof p.text === "string") detail = ` — ${truncate(p.text, 60)}`;
  else if (typeof p.label === "string") detail = ` — [${truncate(p.label, 40)}]${p.href ? ` → ${p.href}` : ""}`;
  else if (typeof p.src === "string") detail = ` — ${truncate(String(p.alt ?? p.src), 40)}`;
  else if (n.type === "instance") detail = ` — component ${p.componentId}`;
  else if (n.type === "collection-list") detail = ` — items of ${p.collectionId}${p.limit ? `, up to ${p.limit}` : ""}`;
  else if (typeof p.markdown === "string" && p.markdown) detail = ` — ${truncate(p.markdown, 60)}`;
  const bind = p.bind && typeof p.bind === "object" ? Object.entries(p.bind as Record<string, string>) : [];
  const bound = bind.length ? ` ← ${bind.map(([k, v]) => `${k}:${v}`).join(", ")}` : "";
  const motion = [
    n.animation ? `${n.animation.preset}${n.animation.staggerMs ? " staggered" : ""}` : "",
    n.hover?.preset ? `hover ${n.hover.preset}` : "",
    n.parallax ? `parallax ${n.parallax}` : "",
  ].filter(Boolean);
  return `${n.type}${label} (${n.id})${bound}${bind.length ? "" : detail}${motion.length ? ` {${motion.join(", ")}}` : ""}`;
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Compact text outline of a document: pages and their node trees with ids.
 * Small enough to hand to an agent instead of the full JSON.
 */
export function outlineDocument(doc: SiteDocument, opts: { pageId?: string; maxDepth?: number } = {}): string {
  const lines: string[] = [];
  const maxDepth = opts.maxDepth ?? 8;
  if (doc.brand && !opts.pageId) {
    lines.push(`Brand: ${doc.brand.name}${doc.brand.locked ? " (locked: use only theme colors var(--color-*) and fonts var(--font-heading|body); brand components can't be edited here)" : ""}`);
    if (doc.brand.guidelines) lines.push(`Brand guidelines (follow these when writing or designing):\n${doc.brand.guidelines.trim().slice(0, 4000)}`);
    lines.push("");
  }
  const pages = opts.pageId ? doc.pages.filter((p) => p.id === opts.pageId || p.path === opts.pageId) : doc.pages;
  for (const page of pages) {
    const tpl = page.collectionId ? findCollection(doc, page.collectionId) : undefined;
    lines.push(`Page ${page.path} "${page.title}" (${page.id})${tpl ? ` — template for each ${tpl.name} item` : ""}`);
    walk(page.root, (n, depth) => {
      if (depth > maxDepth) return;
      lines.push(`${"  ".repeat(depth + 1)}${describeNode(n)}`);
    });
  }
  if (!opts.pageId && doc.collections?.length) {
    lines.push("Collections:");
    for (const c of doc.collections) {
      lines.push(`  ${c.name} (${c.id}, slug ${c.slug}) — ${c.items.length} items; fields: ${c.fields.map((f) => `${f.id}:${f.type}`).join(", ")}`);
    }
  }
  if (!opts.pageId && doc.components.length) {
    lines.push("Components:");
    for (const c of doc.components) lines.push(`  ${c.name} (${c.id}) root ${c.root.id}`);
  }
  return lines.join("\n");
}
