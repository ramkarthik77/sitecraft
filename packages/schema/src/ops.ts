import { z } from "zod";
import { BLOCK_NAMES, buildBlock } from "./blocks.js";
import { newId } from "./ids.js";
import { cloneWithNewIds, collectIds, ensureUniqueIds, findInTree, findNodeInDocument, findPage } from "./tree.js";
import { CONTAINER_TYPES, type Breakpoint, type SiteDocument, type SiteNode, type Style } from "./types.js";
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
      hidden: z.any().optional(),
      children: z.array(looseNode).optional(),
    })
    .passthrough(),
) as never;

const breakpoint = z.enum(["base", "tablet", "mobile"]);
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
  }),
  z.object({
    op: z.literal("update_page"),
    pageId: z.string(),
    path: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
  }),
  z.object({ op: z.literal("remove_page"), pageId: z.string() }),
  z.object({
    op: z.literal("set_theme"),
    colors: z.record(z.string(), z.string()).optional(),
    fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
    radius: z.string().optional(),
  }),
  z.object({ op: z.literal("create_component"), nodeId: z.string(), name: z.string() }),
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
        if (op.hover === null) delete n.hover;
        else n.hover = op.hover;
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
  return { document: v.document, created };
}

/** Parse untrusted operation input. */
export function parseOperations(value: unknown): { ok: true; ops: Operation[] } | { ok: false; error: string } {
  const r = z.array(operationSchema).min(1).max(200).safeParse(value);
  if (r.success) return { ok: true, ops: r.data };
  return { ok: false, error: r.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") };
}
