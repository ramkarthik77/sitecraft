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
  return `${n.type}${label} (${n.id})${detail}`;
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
  const pages = opts.pageId ? doc.pages.filter((p) => p.id === opts.pageId || p.path === opts.pageId) : doc.pages;
  for (const page of pages) {
    lines.push(`Page ${page.path} "${page.title}" (${page.id})`);
    walk(page.root, (n, depth) => {
      if (depth > maxDepth) return;
      lines.push(`${"  ".repeat(depth + 1)}${describeNode(n)}`);
    });
  }
  if (!opts.pageId && doc.components.length) {
    lines.push("Components:");
    for (const c of doc.components) lines.push(`  ${c.name} (${c.id}) root ${c.root.id}`);
  }
  return lines.join("\n");
}
