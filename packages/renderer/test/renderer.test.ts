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

describe("scroll stories", () => {
  const withBlocks = () => {
    const doc = createStarterDocument({ template: "blank" });
    const root = doc.pages[0]!.root.id;
    return applyOperations(doc, [
      { op: "add_block", parentId: root, block: "story" },
      { op: "add_block", parentId: root, block: "statement" },
      { op: "add_block", parentId: root, block: "stacked-cards" },
      { op: "add_node", parentId: root, index: 0, node: { type: "progress", props: {}, style: {} } },
    ]).document;
  };

  it("renders a pinned story, scroll-linked effects and a progress bar on the published page", () => {
    const doc = withBlocks();
    const html = renderPage(doc, doc.pages[0]!, { mode: "publish" });
    expect(html).toMatch(/class="[^"]*sc-story"[^>]*data-side="right" data-sc-story><div class="sc-story-steps">/);
    expect(html).toContain('<div class="sc-story-stage"><div class="sc-story-sticky">');
    expect(html).toMatch(/sc-scrub sc-s-reveal" data-sc-scrub="in"/);
    expect(html).toContain("data-sc-progress");
    // Native scroll timelines where supported, a scrubbed paused animation elsewhere, nothing for reduced motion.
    expect(html).toContain("@supports (animation-timeline:view()){.sc-scrub{animation-timeline:view()");
    expect(html).toContain("animation-delay:calc(var(--sc-p,0) * -1s)");
    expect(html).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{@keyframes sc-s-fade/);
    // Stacked cards are plain sticky positioning.
    expect(html).toContain("position:sticky;top:120px");
  });

  it("lays everything out in normal flow on the canvas so nothing depends on the window height", () => {
    const doc = withBlocks();
    const html = renderPage(doc, doc.pages[0]!, { mode: "editor" });
    expect(html).toContain("sc-story sc-story-edit");
    expect(html).not.toContain("data-sc-story");
    expect(html).not.toContain("sc-scrub");
    expect(html).toContain("sc-progress sc-progress-edit");
  });

  it("validates story structure and keeps scroll and entrance exclusive", () => {
    const doc = withBlocks();
    const story = JSON.stringify(doc).match(/"id":"([^"]+)","type":"story"/)![1]!;
    let visuals = "";
    for (const p of doc.pages) {
      const find = (n: any): void => {
        if (n.id === story) visuals = n.children[0].id;
        n.children?.forEach(find);
      };
      find(p.root);
    }
    expect(() => applyOperations(doc, [{ op: "remove_node", nodeId: visuals }, { op: "remove_node", nodeId: visuals }])).toThrow();
    const root = doc.pages[0]!.root.id;
    const a = applyOperations(doc, [{ op: "update_node", nodeId: root, animation: { preset: "rise", trigger: "scroll" } }]).document;
    const b = applyOperations(a, [{ op: "update_node", nodeId: root, scroll: { effect: "zoom", range: "both" } }]).document;
    expect(b.pages[0]!.root.animation).toBeUndefined();
    expect(b.pages[0]!.root.scroll).toEqual({ effect: "zoom", range: "both" });
    const c = applyOperations(b, [{ op: "update_node", nodeId: root, animation: { preset: "fade-in", trigger: "load" } }]).document;
    expect(c.pages[0]!.root.scroll).toBeUndefined();
    expect(() => applyOperations(doc, [{ op: "update_node", nodeId: root, scroll: { effect: "spin", range: "in" } }])).toThrow();
  });
});

describe("redirects", () => {
  it("publishes a page at each old address that sends people on", () => {
    const doc = createStarterDocument({ template: "landing" });
    const moved = applyOperations(doc, [
      { op: "add_page", path: "/about", title: "About", blocks: ["text-section"] },
      { op: "set_locales", locales: ["fr"] },
    ]).document;
    const about = moved.pages.find((p) => p.path === "/about")!;
    const after = applyOperations(moved, [{ op: "move_page", pageId: about.id, path: "/company" }]).document;
    const files = renderSite(after, { basePath: "/s/acme" });
    expect(files.get("about/index.html")).toContain('content="0; url=/s/acme/company"');
    expect(files.get("about/index.html")).toContain('rel="canonical" href="/s/acme/company"');
    expect(files.get("fr/about/index.html")).toContain("/s/acme/fr/company");
    expect(files.get("company/index.html")).toContain("<!doctype html>");
    expect(files.get("about/index.html")).not.toContain("<script");
  });
});
