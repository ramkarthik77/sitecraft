import { describe, expect, it } from "vitest";
import {
  applyOperations,
  BLOCK_NAMES,
  buildBlock,
  createStarterDocument,
  findNodeInDocument,
  isSafeCssValue,
  outlineDocument,
  parseOperations,
  validateDocument,
  type SiteDocument,
} from "../src/index.js";

const doc = () => createStarterDocument({ name: "Test Co", template: "saas" });

describe("document model", () => {
  it("starter templates validate", () => {
    for (const template of ["blank", "landing", "saas"] as const) {
      const v = validateDocument(createStarterDocument({ template }));
      expect(v.ok, JSON.stringify(v)).toBe(true);
    }
  });

  it("every block builds and validates", () => {
    const d = createStarterDocument({ template: "blank" });
    for (const name of BLOCK_NAMES) d.pages[0]!.root.children!.push(buildBlock(name));
    expect(validateDocument(d).ok).toBe(true);
  });

  it("rejects unsafe CSS, links and unknown style keys", () => {
    expect(isSafeCssValue("red;} body{display:none")).toBe(false);
    expect(isSafeCssValue("url(javascript:alert(1))")).toBe(false);
    expect(isSafeCssValue("url(https://x.com/a.png)")).toBe(true);
    const d = doc();
    const n = d.pages[0]!.root.children![0]!;
    n.props.href = "javascript:alert(1)";
    expect(validateDocument(d).ok).toBe(false);
    const d2 = doc();
    (d2.pages[0]!.root.style.base as Record<string, unknown>).behavior = "x";
    expect(validateDocument(d2).ok).toBe(false);
  });

  it("rejects duplicate ids and paths", () => {
    const d = doc();
    const kids = d.pages[0]!.root.children!;
    kids[1]!.id = kids[0]!.id;
    expect(validateDocument(d).ok).toBe(false);
  });
});

describe("operations", () => {
  it("adds a block and updates text and style per breakpoint", () => {
    const d = doc();
    const rootId = d.pages[0]!.root.id;
    const { document: d2, created } = applyOperations(d, [{ op: "add_block", parentId: rootId, block: "cta", content: { headline: "Join us" } }]);
    const cta = findNodeInDocument(d2, created[0]!)!.node;
    expect(JSON.stringify(cta)).toContain("Join us");
    const headingId = cta.children![0]!.children![0]!.id;
    const { document: d3 } = applyOperations(d2, [
      { op: "update_node", nodeId: headingId, props: { text: "Join the beta" } },
      { op: "update_node", nodeId: headingId, breakpoint: "mobile", style: { fontSize: "28px" } },
    ]);
    const h = findNodeInDocument(d3, headingId)!.node;
    expect(h.props.text).toBe("Join the beta");
    expect(h.style.mobile?.fontSize).toBe("28px");
    // Original untouched (immutability).
    expect(findNodeInDocument(d2, headingId)!.node.props.text).not.toBe("Join the beta");
  });

  it("is atomic: a failing op leaves nothing applied", () => {
    const d = doc();
    const rootId = d.pages[0]!.root.id;
    expect(() =>
      applyOperations(d, [
        { op: "add_block", parentId: rootId, block: "faq" },
        { op: "remove_node", nodeId: "does-not-exist" },
      ]),
    ).toThrow(/Operation 2/);
  });

  it("rejects edits that produce invalid documents", () => {
    const d = doc();
    const textNode = findNodeInDocument(d, d.pages[0]!.root.children![1]!.children![0]!.children![1]!.id)!.node;
    expect(() => applyOperations(d, [{ op: "update_node", nodeId: textNode.id, style: { color: "red;}" } }])).toThrow(/not a valid site/);
  });

  it("moves, duplicates and removes nodes", () => {
    const d = doc();
    const root = d.pages[0]!.root;
    const [first, second] = [root.children![0]!.id, root.children![1]!.id];
    const { document: d2 } = applyOperations(d, [{ op: "move_node", nodeId: first, parentId: root.id, index: 2 }]);
    expect(d2.pages[0]!.root.children![0]!.id).toBe(second);
    const { document: d3, created } = applyOperations(d2, [{ op: "duplicate_node", nodeId: second }]);
    expect(d3.pages[0]!.root.children!.length).toBe(root.children!.length + 1);
    const { document: d4 } = applyOperations(d3, [{ op: "remove_node", nodeId: created[0]! }]);
    expect(d4.pages[0]!.root.children!.length).toBe(root.children!.length);
    expect(() => applyOperations(d, [{ op: "move_node", nodeId: first, parentId: first }])).toThrow();
  });

  it("manages pages and components", () => {
    const d: SiteDocument = doc();
    const { document: d2, created } = applyOperations(d, [{ op: "add_page", path: "About", title: "About us", blocks: ["navbar", "text-section"] }]);
    expect(d2.pages.find((p) => p.id === created[0])!.path).toBe("/about");
    expect(() => applyOperations(d2, [{ op: "add_page", path: "/about", title: "Dup" }])).toThrow(/already/);
    const navId = d2.pages[0]!.root.children![0]!.id;
    const { document: d3 } = applyOperations(d2, [{ op: "create_component", nodeId: navId, name: "Navbar" }]);
    expect(d3.components).toHaveLength(1);
    expect(d3.pages[0]!.root.children![0]!.type).toBe("instance");
  });

  it("parses untrusted operation input", () => {
    expect(parseOperations([{ op: "nope" }]).ok).toBe(false);
    expect(parseOperations([{ op: "remove_node", nodeId: "x" }]).ok).toBe(true);
  });

  it("outlines a document with ids", () => {
    const out = outlineDocument(doc());
    expect(out).toMatch(/^Page \/ "Test Co"/);
    expect(out).toContain('section "Hero"');
  });
});

describe("diff", () => {
  it("reports inserted sections without flagging shifted siblings", async () => {
    const { diffDocuments } = await import("../src/index.js");
    const d = doc();
    const root = d.pages[0]!.root;
    const { document: d2 } = applyOperations(d, [{ op: "add_block", parentId: root.id, block: "contact-form", index: 2 }]);
    const diff = diffDocuments(d, d2);
    expect(diff.summary).toHaveLength(1);
    expect(diff.summary[0]).toMatch(/^\+ section "Contact"/);
    const { document: d3 } = applyOperations(d2, [{ op: "move_node", nodeId: root.children![0]!.id, parentId: root.id, index: 3 }]);
    expect(diffDocuments(d2, d3).changed).toContain(root.children![0]!.id);
  });
});
