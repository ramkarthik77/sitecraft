import { describe, expect, it } from "vitest";
import {
  applyOperations,
  resolveRedirect,
  summarizeChanges,
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
    for (const template of ["blank", "landing", "saas", "blog"] as const) {
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
    expect(cta.name).toBe("Join us");
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

describe("history and moving pages", () => {
  const base = () => {
    const doc = createStarterDocument({ template: "landing" });
    return applyOperations(doc, [
      { op: "add_page", path: "/about", title: "About", blocks: ["text-section"] },
      { op: "add_page", path: "/about/team", title: "Team", blocks: ["text-section"] },
      { op: "add_node", parentId: doc.pages[0]!.root.id, node: { type: "button", props: { label: "Team", href: "/about/team#people" }, style: {} } },
    ]).document;
  };

  it("summarizes what a version changed, by page", () => {
    const a = base();
    const home = a.pages[0]!;
    const b = applyOperations(a, [
      { op: "update_page", pageId: home.id, title: "New title" },
      { op: "remove_page", pageId: "/about/team" },
      { op: "set_theme", colors: { primary: "#111111" } },
    ]).document;
    const c = summarizeChanges(a, b);
    expect(c.theme).toBe(true);
    expect(c.pageIds).toContain(home.id);
    expect(c.pages.find((p) => p.path === "/about/team")).toMatchObject({ status: "removed" });
  });

  it("moves a page with the pages under it, retargets links and adds redirects", () => {
    const a = base();
    const about = a.pages.find((p) => p.path === "/about")!;
    const b = applyOperations(a, [{ op: "move_page", pageId: about.id, path: "/company" }]).document;
    expect(b.pages.map((p) => p.path)).toEqual(expect.arrayContaining(["/company", "/company/team"]));
    expect(JSON.stringify(b)).toContain('"href":"/company/team#people"');
    expect(b.settings.redirects).toEqual([
      { from: "/about", to: "/company" },
      { from: "/about/team", to: "/company/team" },
    ]);
    expect(resolveRedirect(b, "/about/team/")).toBe("/company/team");
    // Moving back removes the redirect that would hide the page again.
    const c = applyOperations(b, [{ op: "move_page", pageId: about.id, path: "/about" }]).document;
    expect(c.settings.redirects?.some((r) => r.from === "/about")).toBe(false);
    expect(resolveRedirect(c, "/company")).toBe("/about");
    expect(() => applyOperations(a, [{ op: "move_page", pageId: about.id, path: "/about/team/x" }])).toThrow(/inside itself/);
    expect(() => applyOperations(a, [{ op: "move_page", pageId: a.pages[0]!.id, path: "/x" }])).toThrow(/home page/);
    const other = applyOperations(a, [{ op: "add_page", path: "/company", title: "Taken" }]).document;
    expect(() => applyOperations(other, [{ op: "move_page", pageId: about.id, path: "/company" }])).toThrow(/already uses/);
  });

  it("puts back a page or an element from an earlier version", () => {
    const a = base();
    const about = a.pages.find((p) => p.path === "/about")!;
    const removed = applyOperations(a, [{ op: "remove_page", pageId: about.id }]).document;
    const back = applyOperations(removed, [{ op: "put_page", page: about as never }]).document;
    expect(back.pages.find((p) => p.id === about.id)?.title).toBe("About");
    const section = about.root.children![0]!;
    const gone = applyOperations(a, [{ op: "remove_node", nodeId: section.id }]).document;
    const restored = applyOperations(gone, [{ op: "restore_node", node: section as never, parentId: about.root.id, index: 0 }]).document;
    expect(restored.pages.find((p) => p.id === about.id)!.root.children![0]!.id).toBe(section.id);
    // Restoring an element that still exists replaces it in place.
    const edited = applyOperations(a, [{ op: "update_node", nodeId: section.id, name: "Edited" }]).document;
    const replaced = applyOperations(edited, [{ op: "restore_node", node: section as never }]).document;
    expect(JSON.stringify(replaced)).not.toContain('"name":"Edited"');
  });

  it("rejects unsafe redirects", () => {
    const a = base();
    expect(() => applyOperations(a, [{ op: "set_redirects", redirects: [{ from: "/x", to: "javascript:alert(1)" }] }])).toThrow();
    const ok = applyOperations(a, [{ op: "set_redirects", redirects: [{ from: "/old", to: "https://example.com/new" }, { from: "/about", to: "/elsewhere" }] }]).document;
    // A page at /about wins, so that redirect is dropped.
    expect(ok.settings.redirects).toEqual([{ from: "/old", to: "https://example.com/new" }]);
  });
});
