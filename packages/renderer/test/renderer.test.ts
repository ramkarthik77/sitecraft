import { describe, expect, it } from "vitest";
import { applyOperations, createStarterDocument } from "@sitecraft/schema";
import { renderPage, renderSite, styleToCss } from "../src/index.js";

describe("renderer", () => {
  it("renders a full page with SEO tags, responsive CSS and animations", () => {
    const doc = createStarterDocument({ name: "Acme", template: "saas" });
    const html = renderPage(doc, doc.pages[0]!, { mode: "publish", siteUrl: "https://acme.test" });
    expect(html).toContain("<title>Acme</title>");
    expect(html).toContain('<link rel="canonical" href="https://acme.test/">');
    expect(html).toContain("@media (max-width:767px)");
    expect(html).toContain("@media (max-width:1023px)");
    expect(html).toContain("data-sc-trigger=\"scroll\"");
    expect(html).toContain("--color-primary:#4f46e5");
    expect(html).not.toContain("data-node-id");
    expect(html).not.toContain("noindex");
  });

  it("editor mode tags nodes for selection and skips animations", () => {
    const doc = createStarterDocument({ template: "landing" });
    const html = renderPage(doc, doc.pages[0]!, { mode: "editor" });
    expect(html).toContain(`data-node-id="${doc.pages[0]!.root.id}"`);
    expect(html).not.toContain("sc-anim");
  });

  it("escapes text and drops unsafe values", () => {
    const doc = createStarterDocument({ template: "blank" });
    const { document } = applyOperations(doc, [
      { op: "add_node", parentId: doc.pages[0]!.root.id, node: { type: "text", props: { text: "<script>alert(1)</script>" }, style: {} } },
    ]);
    const html = renderPage(document, document.pages[0]!, { mode: "publish" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(styleToCss({ color: "red;}" as string, padding: 12 })).toBe("padding:12px");
  });

  it("renders every page plus sitemap, robots and 404", () => {
    const doc = createStarterDocument({ template: "landing" });
    const { document } = applyOperations(doc, [{ op: "add_page", path: "/pricing", title: "Pricing", blocks: ["pricing"] }]);
    const files = renderSite(document, { siteUrl: "https://acme.test", formAction: (f) => `/forms/x/${f}` });
    expect([...files.keys()].sort()).toEqual(["404.html", "index.html", "pricing/index.html", "robots.txt", "sitemap.xml"]);
    expect(files.get("sitemap.xml")).toContain("<loc>https://acme.test/pricing</loc>");
  });

  it("renders forms posting to the form endpoint", () => {
    const doc = createStarterDocument({ template: "blank" });
    const { document } = applyOperations(doc, [{ op: "add_block", parentId: doc.pages[0]!.root.id, block: "contact-form" }]);
    const html = renderPage(document, document.pages[0]!, { mode: "publish", formAction: (f) => `/forms/site1/${f}` });
    expect(html).toContain('action="/forms/site1/contact"');
    expect(html).toContain('type="email" name="email" required');
  });

  it("prefixes internal links when served under a base path", () => {
    const doc = createStarterDocument({ template: "landing" });
    const html = renderPage(doc, doc.pages[0]!, { mode: "preview", basePath: "/s/acme" });
    expect(html).toContain('href="/s/acme/"');
    expect(html).toContain('href="#features"');
  });
});

describe("motion", () => {
  const setup = (node: Record<string, unknown>) => {
    const doc = createStarterDocument({ template: "blank" });
    const { document, created } = applyOperations(doc, [
      { op: "add_node", parentId: doc.pages[0]!.root.id, node: { type: "stack", props: {}, style: {}, children: [{ type: "text", props: { text: "a" }, style: {} }, { type: "text", props: { text: "b" }, style: {} }] } },
    ]);
    const id = created[0]!;
    const r = applyOperations(document, [{ op: "update_node", nodeId: id, ...node } as never]);
    return { doc: r.document, id };
  };

  it("staggers children, sets timing as variables and keeps reduced-motion visitors still", () => {
    const { doc } = setup({ animation: { preset: "flip-up", trigger: "scroll", durationMs: 800, delayMs: 100, easing: "spring", staggerMs: 120 } });
    const html = renderPage(doc, doc.pages[0]!, { mode: "publish" });
    expect(html).toMatch(/sc-stagger sc-flip-up" style="--sc-dur:800ms;--sc-delay:100ms;--sc-step:120ms;--sc-ease:cubic-bezier\(\.34,1\.56,\.64,1\)" data-sc-trigger="scroll"/);
    const css = html.slice(html.indexOf("prefers-reduced-motion:no-preference"));
    expect(css).toContain(".sc-stagger>:nth-child(2){--sc-i:1}");
    expect(html).toContain("@media (prefers-reduced-motion:no-preference){.sc-anim");
  });

  it("hover presets render on the canvas too; tilt and parallax hooks only when published", () => {
    const { doc } = setup({ hover: { preset: "tilt" }, parallax: 0.2 });
    const pub = renderPage(doc, doc.pages[0]!, { mode: "publish" });
    expect(pub).toContain("sc-h sc-h-tilt");
    expect(pub).toContain("data-sc-tilt");
    expect(pub).toContain('data-sc-parallax="0.2"');
    const ed = renderPage(doc, doc.pages[0]!, { mode: "editor" });
    expect(ed).toContain("sc-h-tilt");
    expect(ed).not.toContain("data-sc-tilt");
    expect(ed).not.toContain("data-sc-parallax");
  });

  it("rejects motion outside the allowed range", () => {
    const doc = createStarterDocument({ template: "blank" });
    const id = doc.pages[0]!.root.id;
    expect(() => applyOperations(doc, [{ op: "update_node", nodeId: id, parallax: 3 }])).toThrow();
    expect(() => applyOperations(doc, [{ op: "update_node", nodeId: id, hover: { preset: "spin" } }])).toThrow();
    expect(() => applyOperations(doc, [{ op: "update_node", nodeId: id, animation: { preset: "rise", trigger: "scroll", staggerMs: 9000 } }])).toThrow();
    // Removing everything leaves no trace.
    const { document } = applyOperations(doc, [{ op: "update_node", nodeId: id, hover: { preset: "lift" }, parallax: 0.1 }]);
    const cleared = applyOperations(document, [{ op: "update_node", nodeId: id, hover: null, parallax: 0 }]).document;
    expect(cleared.pages[0]!.root.hover).toBeUndefined();
    expect(cleared.pages[0]!.root.parallax).toBeUndefined();
  });
});
