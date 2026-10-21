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
