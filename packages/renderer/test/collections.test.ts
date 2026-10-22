import { applyOperations, createStarterDocument, parseOperations, type Operation, type SiteDocument } from "@sitecraft/schema";
import { describe, expect, it } from "vitest";
import { renderMarkdown, renderPage, renderSite } from "../src/index.js";

const apply = (d: SiteDocument, ops: unknown[]) => {
  const parsed = parseOperations(ops);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyOperations(d, parsed.ops as Operation[]);
};

function blogSite() {
  const r = apply(createStarterDocument({ name: "Acme", template: "landing" }), [{ op: "add_collection", name: "Blog", preset: "blog" }]);
  const id = r.created[0]!;
  const doc = apply(r.document, [
    { op: "add_item", collectionId: id, values: { title: "Secret plans", date: "2026-12-01", body: "Not yet." }, draft: true },
    { op: "add_collection_list", parentId: r.document.pages[0]!.root.id, index: 2, collectionId: id, headline: "Latest", limit: 1 },
  ]).document;
  return { doc, id };
}

describe("rich text", () => {
  it("renders the Markdown subset", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and *italic* with `code`.\n\n- one\n- two\n\n1. first\n\n> quoted\n\n```\n<b>x</b>\n```\n\n---\n\n![Alt](https://img.example/a.png) [Docs](/docs)");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong> and <em>italic</em> with <code>code</code>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
    expect(html).toContain("<hr>");
    expect(html).toContain('<img src="https://img.example/a.png" alt="Alt"');
    expect(html).toContain('<a href="/docs">Docs</a>');
  });

  it("never renders raw HTML or unsafe links", () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) ![y](javascript:1) <img src=x onerror=alert(1)> "quote"');
    expect(html).not.toMatch(/<script|<img src=x|href="javascript/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quote&quot;");
  });

  it("uses the page's link prefix", () => {
    expect(renderMarkdown("[About](/about)", (h) => `/s/acme${h}`)).toContain('href="/s/acme/about"');
  });
});

describe("collections", () => {
  it("publishes a page per published item, lists, and a sitemap with item URLs", () => {
    const { doc } = blogSite();
    const files = renderSite(doc, { siteUrl: "https://acme.test" });
    expect([...files.keys()].sort()).toEqual(["404.html", "blog/how-we-work/index.html", "blog/index.html", "blog/welcome-to-the-blog/index.html", "index.html", "robots.txt", "sitemap.xml"]);
    const post = files.get("blog/welcome-to-the-blog/index.html")!;
    expect(post).toContain("<title>Welcome to the blog</title>");
    expect(post).toContain('<meta name="description" content="What we&#39;ll be writing about, and why.">');
    expect(post).toMatch(/<meta property="og:image" content="data:image\/svg\+xml;charset=utf-8,/);
    expect(post).toContain('<link rel="canonical" href="https://acme.test/blog/welcome-to-the-blog">');
    expect(post).toContain("October 1, 2026");
    expect(post).toMatch(/<h1[^>]*>Welcome to the blog<\/h1>/);
    expect(post).toContain("<strong>CMS</strong>");
    expect(post).toContain('href="/blog"'); // back link

    const list = files.get("blog/index.html")!;
    expect(list).toContain('href="/blog/how-we-work"');
    expect(list).toContain('href="/blog/welcome-to-the-blog"');
    expect(list).not.toContain("Secret plans"); // drafts stay unpublished
    // Newest first by date.
    expect(list.indexOf("How we work")).toBeLessThan(list.indexOf("Welcome to the blog"));

    const home = files.get("index.html")!;
    expect(home).toContain("How we work");
    expect(home).not.toContain("Welcome to the blog"); // limit 1
    expect(files.get("sitemap.xml")).toContain("<loc>https://acme.test/blog/how-we-work</loc>");
    expect(files.get("sitemap.xml")).not.toContain(":slug");
  });

  it("previews and the editor include drafts and show the chosen item", () => {
    const { doc, id } = blogSite();
    const tpl = doc.pages.find((p) => p.collectionId === id)!;
    const editor = renderPage(doc, tpl, { mode: "editor", itemId: "secret-plans" });
    expect(editor).toMatch(/<h1[^>]*data-bound="1"[^>]*>Secret plans<\/h1>/);
    expect(editor).toContain("sc-img-empty"); // no cover image: placeholder to select
    const list = doc.pages.find((p) => p.path === "/blog")!;
    expect(renderPage(doc, list, { mode: "preview" })).toContain("Secret plans");
    expect(renderPage(doc, tpl, { mode: "publish", itemId: "secret-plans" })).not.toContain("Secret plans");
  });

  it("an empty collection shows its empty message and example content on the template", () => {
    const r = apply(createStarterDocument({ template: "blank" }), [{ op: "add_collection", name: "Jobs", preset: "jobs", sampleItems: false }]);
    const list = r.document.pages.find((p) => p.path === "/jobs")!;
    expect(renderPage(r.document, list, { mode: "publish" })).toContain('<p class="sc-empty">No jobs yet.</p>');
    const tpl = r.document.pages.find((p) => p.collectionId)!;
    expect(renderPage(r.document, tpl, { mode: "editor" })).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(renderSite(r.document, {}).has("jobs/example/index.html")).toBe(false);
  });
});
