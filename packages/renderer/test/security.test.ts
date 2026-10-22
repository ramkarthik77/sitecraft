import { applyOperations, createStarterDocument, type SiteDocument } from "@sitecraft/schema";
import { describe, expect, it } from "vitest";
import { renderPage } from "../src/index.js";

function withEmbeds(): SiteDocument {
  const doc = createStarterDocument({ template: "blank" });
  const root = doc.pages[0]!.root.id;
  return applyOperations(doc, [
    { op: "add_node", parentId: root, node: { type: "embed", props: { url: "https://www.youtube.com/embed/abc" }, style: {} } },
    { op: "add_node", parentId: root, node: { type: "embed", props: { url: "https://sitecraft.example/s/other" }, style: {} } },
    { op: "add_block", parentId: root, block: "contact-form" },
  ]).document;
}

describe("embeds", () => {
  it("never give Sitecraft's own pages, or anything in the editor, allow-same-origin", () => {
    const doc = withEmbeds();
    const pub = renderPage(doc, doc.pages[0]!, { mode: "publish", selfOrigins: ["https://sitecraft.example"] });
    const frames = [...pub.matchAll(/<iframe[^>]*src="([^"]+)"[^>]*sandbox="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(frames).toEqual([
      ["https://www.youtube.com/embed/abc", "allow-scripts allow-same-origin allow-popups allow-presentation"],
      ["https://sitecraft.example/s/other", "allow-scripts allow-popups allow-presentation"],
    ]);
    const ed = renderPage(doc, doc.pages[0]!, { mode: "editor" });
    expect(ed).not.toContain("allow-same-origin");
  });
});

describe("forms", () => {
  it("include a hidden trap field, and the bot check when configured", () => {
    const doc = withEmbeds();
    const plain = renderPage(doc, doc.pages[0]!, { mode: "publish" });
    expect(plain).toContain('name="_hp"');
    expect(plain).not.toContain("cf-turnstile");
    const checked = renderPage(doc, doc.pages[0]!, { mode: "publish", turnstileSiteKey: "0x4AAA" });
    expect(checked).toContain('<div class="cf-turnstile" data-sitekey="0x4AAA">');
    expect(checked).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(renderPage(doc, doc.pages[0]!, { mode: "editor", turnstileSiteKey: "0x4AAA" })).not.toContain("challenges.cloudflare.com");
  });
});
