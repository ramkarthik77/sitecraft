import type { Page, SiteDocument, SiteNode } from "./types.js";
import { newId } from "./ids.js";

export interface Located {
  node: SiteNode;
  parent: SiteNode | null;
  index: number;
}

/** Find a node and its parent inside a tree. */
export function findInTree(root: SiteNode, id: string): Located | null {
  if (root.id === id) return { node: root, parent: null, index: 0 };
  const stack: SiteNode[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const kids = cur.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      if (k.id === id) return { node: k, parent: cur, index: i };
      stack.push(k);
    }
  }
  return null;
}

export function walk(root: SiteNode, fn: (n: SiteNode, depth: number, parent: SiteNode | null) => void): void {
  const go = (n: SiteNode, d: number, p: SiteNode | null) => {
    fn(n, d, p);
    n.children?.forEach((c) => go(c, d + 1, n));
  };
  go(root, 0, null);
}

export function findPage(doc: SiteDocument, pageIdOrPath: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageIdOrPath || p.path === pageIdOrPath);
}

/** Locate a node anywhere in the document (pages and components). */
export function findNodeInDocument(
  doc: SiteDocument,
  id: string,
): (Located & { pageId?: string; componentId?: string }) | null {
  for (const p of doc.pages) {
    const hit = findInTree(p.root, id);
    if (hit) return { ...hit, pageId: p.id };
  }
  for (const c of doc.components) {
    const hit = findInTree(c.root, id);
    if (hit) return { ...hit, componentId: c.id };
  }
  return null;
}

/** All node ids currently used in a document. */
export function collectIds(doc: SiteDocument): Set<string> {
  const ids = new Set<string>();
  const add = (n: SiteNode) => walk(n, (x) => ids.add(x.id));
  doc.pages.forEach((p) => add(p.root));
  doc.components.forEach((c) => add(c.root));
  return ids;
}

/** Deep-copy a node giving every node in it a fresh id. */
export function cloneWithNewIds(node: SiteNode): SiteNode {
  const copy: SiteNode = structuredClone(node);
  walk(copy, (n) => {
    n.id = newId();
  });
  return copy;
}

/** Ensure ids in an incoming subtree don't collide with existing ones. */
export function ensureUniqueIds(node: SiteNode, taken: Set<string>): SiteNode {
  const copy: SiteNode = structuredClone(node);
  walk(copy, (n) => {
    if (!n.id || taken.has(n.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(n.id)) n.id = newId();
    taken.add(n.id);
    if (!n.props) n.props = {};
    if (!n.style) n.style = {};
  });
  return copy;
}
