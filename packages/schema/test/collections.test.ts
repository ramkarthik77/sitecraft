import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createStarterDocument,
  diffDocuments,
  findCollection,
  listItems,
  outlineDocument,
  parseOperations,
  resolveRoute,
  siteRoutes,
  validateDocument,
  walk,
  type Operation,
  type SiteDocument,
  type SiteNode,
} from "../src/index.js";

const apply = (d: SiteDocument, ops: unknown[]) => {
  const parsed = parseOperations(ops);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyOperations(d, parsed.ops as Operation[]);
};

function withBlog() {
  const start = createStarterDocument({ name: "Acme", template: "landing" });
  const r = apply(start, [{ op: "add_collection", name: "Blog", preset: "blog" }]);
  return { doc: r.document, id: r.created[0]! };
}

const nodes = (root: SiteNode) => {
  const all: SiteNode[] = [];
  walk(root, (n) => all.push(n));
  return all;
};

describe("collections", () => {
  it("a preset adds fields, example items, a list page and a template page", () => {
    const { doc, id } = withBlog();
    const c = findCollection(doc, id)!;
    expect(c.slug).toBe("blog");
    expect(c.fields.map((f) => f.id)).toEqual(["title", "summary", "cover_image", "date", "author", "body"]);
    expect(c.items.map((i) => i.slug)).toEqual(["welcome-to-the-blog", "how-we-work"]);
    const list = doc.pages.find((p) => p.path === "/blog")!;
    const tpl = doc.pages.find((p) => p.collectionId === id)!;
    expect(tpl.path).toBe("/blog/:slug");
    // Both pages reuse the home page's navbar and footer.
    expect(list.root.children!.map((n) => n.name)).toEqual(["Navbar", "Blog", "Footer"]);
    expect(nodes(list.root).some((n) => n.type === "collection-list" && n.props.collectionId === id)).toBe(true);
    expect(nodes(tpl.root).some((n) => n.type === "richtext" && (n.props.bind as Record<string, string>).markdown === "body")).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("routes include one page per published item", () => {
    const { doc, id } = withBlog();
    const draft = apply(doc, [{ op: "update_item", collectionId: id, itemId: "how-we-work", draft: true }]).document;
    expect(siteRoutes(draft).map((r) => r.path)).toEqual(["/", "/blog", "/blog/welcome-to-the-blog"]);
    expect(siteRoutes(draft, { includeDrafts: true }).map((r) => r.path)).toContain("/blog/how-we-work");
    expect(resolveRoute(draft, "/blog/welcome-to-the-blog")?.item?.values.title).toBe("Welcome to the blog");
    expect(resolveRoute(draft, "/blog/how-we-work")).toBeUndefined();
  });

  it("adds, updates, moves and removes items, accepting field names and loose values", () => {
    const { doc, id } = withBlog();
    const r = apply(doc, [
      { op: "add_item", collectionId: "blog", values: { Title: "Launch day!", Date: "2026-11-02T09:00:00Z", Body: "We **launched**." } },
      { op: "add_item", collectionId: "Blog", values: { title: "Launch day!" } },
    ]);
    let c = findCollection(r.document, id)!;
    expect(c.items.slice(-2).map((i) => i.slug)).toEqual(["launch-day", "launch-day-2"]);
    expect(c.items[2]!.values.date).toBe("2026-11-02");

    const r2 = apply(r.document, [
      { op: "update_item", collectionId: id, itemId: "launch-day", values: { summary: "Big news", author: null }, slug: "launch" },
      { op: "move_item", collectionId: id, itemId: "launch", index: 0 },
      { op: "remove_item", collectionId: id, itemId: "launch-day-2" },
    ]);
    c = findCollection(r2.document, id)!;
    expect(c.items[0]!.slug).toBe("launch");
    expect(c.items[0]!.values.summary).toBe("Big news");
    expect(c.items).toHaveLength(3);
  });

  it("rejects bad values, unknown fields, duplicate slugs and slug clashes with pages", () => {
    const { doc, id } = withBlog();
    expect(() => apply(doc, [{ op: "add_item", collectionId: id, values: { cover_image: "javascript:alert(1)" } }])).toThrow(/image URL/);
    expect(() => apply(doc, [{ op: "add_item", collectionId: id, values: { colour: "red" } }])).toThrow(/no field "colour"/);
    expect(() => apply(doc, [{ op: "add_item", collectionId: id, values: { title: "x" }, slug: "how-we-work" }])).toThrow(/already has an item/);
    expect(() => apply(doc, [{ op: "add_item", collectionId: id, values: { date: "next tuesday" } }])).toThrow(/date like/);
    expect(() => apply(doc, [{ op: "add_page", path: "/blog/how-we-work", title: "Clash" }])).toThrow(/would use \/blog\/how-we-work/);
  });

  it("manages fields; the title field stays first and can't be removed", () => {
    const { doc, id } = withBlog();
    const r = apply(doc, [
      { op: "add_field", collectionId: id, name: "Reading time", type: "number" },
      { op: "update_field", collectionId: id, fieldId: "reading_time", name: "Minutes to read" },
      { op: "update_item", collectionId: id, itemId: "how-we-work", values: { reading_time: "4" } },
      { op: "remove_field", collectionId: id, fieldId: "author" },
    ]);
    const c = findCollection(r.document, id)!;
    expect(c.fields.find((f) => f.id === "reading_time")?.name).toBe("Minutes to read");
    expect(c.items[1]!.values.reading_time).toBe(4);
    expect(c.items.every((i) => !("author" in i.values))).toBe(true);
    expect(() => apply(doc, [{ op: "remove_field", collectionId: id, fieldId: "title" }])).toThrow(/title field/);
    expect(() => apply(doc, [{ op: "add_collection", name: "Bad", fields: [{ name: "Photo", type: "image" }] }])).toThrow(/first field/);
  });

  it("adds a list anywhere, sorted and limited", () => {
    const { doc, id } = withBlog();
    const home = doc.pages[0]!;
    const r = apply(doc, [{ op: "add_collection_list", parentId: home.root.id, index: 2, collectionId: id, headline: "Latest posts", limit: 1 }]);
    const section = r.document.pages[0]!.root.children![2]!;
    expect(section.name).toBe("Latest posts");
    const list = nodes(section).find((n) => n.type === "collection-list")!;
    expect(list.props).toMatchObject({ limit: 1, sortBy: "date", sortDir: "desc" });
    expect(listItems(r.document, list).items.map((i) => i.slug)).toEqual(["how-we-work"]);
  });

  it("removing a collection removes its template page and lists", () => {
    const { doc, id } = withBlog();
    const r = apply(doc, [
      { op: "add_collection_list", parentId: doc.pages[0]!.root.id, collectionId: id },
      { op: "remove_collection", collectionId: id },
    ]);
    expect(r.document.collections).toEqual([]);
    expect(r.document.pages.map((p) => p.path)).toEqual(["/", "/blog"]);
    const all = r.document.pages.flatMap((p) => nodes(p.root));
    expect(all.some((n) => n.type === "collection-list")).toBe(false);
  });

  it("a template page can be added later for an existing collection", () => {
    const r = apply(createStarterDocument({ template: "blank" }), [
      { op: "add_collection", name: "Team", preset: "team", pages: false },
    ]);
    const id = r.created[0]!;
    expect(r.document.pages).toHaveLength(1);
    const r2 = apply(r.document, [{ op: "add_page", path: "/people", title: "Person", collectionId: id }]);
    expect(r2.document.pages[1]!.path).toBe("/people/:slug");
    expect(siteRoutes(r2.document).map((x) => x.path)).toEqual(["/", "/people/alex-rivera", "/people/sam-lee"]);
    expect(() => apply(r2.document, [{ op: "add_page", path: "/team", title: "Again", collectionId: id }])).toThrow(/already has a template page/);
  });

  it("rejects unsafe bindings and paths", () => {
    const { doc } = withBlog();
    const bad = structuredClone(doc);
    bad.pages[0]!.root.children![0]!.props.bind = { onclick: "title" };
    expect(validateDocument(bad).ok).toBe(false);
    const bad2 = structuredClone(doc);
    bad2.pages.find((p) => p.collectionId)!.path = "/blog/post";
    expect(validateDocument(bad2).ok).toBe(false);
    const old = structuredClone(doc);
    delete old.collections;
    old.pages = old.pages.filter((p) => !p.collectionId);
    old.pages = old.pages.filter((p) => p.path !== "/blog");
    expect(validateDocument(old).ok).toBe(true); // sites from before collections still load
  });

  it("diffs and outlines describe content changes", () => {
    const { doc, id } = withBlog();
    const after = apply(doc, [
      { op: "add_item", collectionId: id, values: { title: "New post" }, draft: true },
      { op: "update_item", collectionId: id, itemId: "how-we-work", values: { summary: "Changed" } },
      { op: "remove_item", collectionId: id, itemId: "welcome-to-the-blog" },
    ]).document;
    const d = diffDocuments(doc, after);
    expect(d.content).toEqual(['~ Blog item "How we work"', '+ Blog item "New post" (draft)', '- Blog item "Welcome to the blog"']);
    expect(d.summary).toEqual(expect.arrayContaining(d.content));
    const fresh = diffDocuments(createStarterDocument({ template: "landing" }), doc);
    expect(fresh.content).toEqual(["+ collection Blog (2 items)"]);
    const outline = outlineDocument(doc);
    expect(outline).toContain("template for each Blog item");
    expect(outline).toMatch(/Blog \(col_\w+, slug blog\) — 2 items; fields: title:text, summary:text/);
    expect(outline).toContain("← text:title");
  });
});

describe("hidden pages", () => {
  it("are left out of published routes but kept for previews", () => {
    const d = createStarterDocument({ template: "landing" });
    const r = apply(d, [{ op: "add_page", path: "/secret", title: "Secret" }]);
    const hidden = apply(r.document, [{ op: "update_page", pageId: r.created[0], unpublished: true }]).document;
    expect(siteRoutes(hidden).map((x) => x.path)).toEqual(["/"]);
    expect(siteRoutes(hidden, { includeDrafts: true }).map((x) => x.path)).toEqual(["/", "/secret"]);
    expect(() => apply(hidden, [{ op: "update_page", pageId: hidden.pages[0]!.id, unpublished: true }])).toThrow(/home page/);
    expect(diffDocuments(r.document, hidden).summary).toContain("~ page settings /secret");
  });
});
