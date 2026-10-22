import { applyOperations, createStarterDocument, parseOperations, splitLocale, translationStatus, type Operation, type SiteDocument } from "@sitecraft/schema";
import { describe, expect, it } from "vitest";
import { renderPage, renderSite } from "../src/index.js";

const apply = (d: SiteDocument, ops: unknown[]) => {
  const parsed = parseOperations(ops);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyOperations(d, parsed.ops as Operation[]);
};

function bilingual() {
  let doc = createStarterDocument({ name: "Acme", template: "landing" });
  doc = apply(doc, [
    { op: "add_page", path: "/about", title: "About us", blocks: ["text-section"] },
    { op: "add_collection", name: "Blog", preset: "blog" },
    { op: "set_locales", locales: ["fr", "ar"] },
  ]).document;
  const hero = doc.pages[0]!.root.children![1]!.children![0]!.children![1]!;
  const cta = doc.pages[0]!.root.children![1]!.children![0]!.children![3]!.children![0]!;
  doc = apply(doc, [
    { op: "set_translation", locale: "fr", nodeId: hero.id, values: { text: "Créez de beaux sites, plus vite" } },
    { op: "set_translation", locale: "fr", pageId: doc.pages[0]!.id, values: { title: "Acme (FR)" } },
    { op: "update_field", collectionId: "blog", fieldId: "title", localized: true },
    { op: "set_translation", locale: "fr", collectionId: "blog", itemId: "how-we-work", values: { Title: "Notre façon de travailler" } },
    { op: "add_node", parentId: doc.pages[0]!.root.children![0]!.children![0]!.id, node: { type: "language-switch", props: {}, style: {} } },
  ]).document;
  return { doc, hero, cta };
}

describe("languages", () => {
  it("publishes every page in every language, with links kept in the reader's language", () => {
    const { doc } = bilingual();
    const files = renderSite(doc, { siteUrl: "https://acme.test" });
    expect([...files.keys()]).toEqual(expect.arrayContaining(["index.html", "fr/index.html", "fr/about/index.html", "ar/blog/how-we-work/index.html", "fr/blog/how-we-work/index.html"]));
    const fr = files.get("fr/index.html")!;
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain("<title>Acme (FR)</title>");
    expect(fr).toContain("Créez de beaux sites, plus vite");
    expect(fr).toContain('<link rel="canonical" href="https://acme.test/fr">');
    expect(fr).toContain('hreflang="en" href="https://acme.test/"');
    expect(fr).toContain('hreflang="x-default" href="https://acme.test/"');
    // Untranslated text falls back to the main language.
    expect(fr).toContain("Design visually, let Claude handle the busywork");
    expect(files.get("ar/index.html")).toContain('<html lang="ar" dir="rtl">');
    expect(files.get("fr/blog/index.html")).toContain('href="/fr/blog/how-we-work"');
    expect(files.get("fr/blog/how-we-work/index.html")).toContain("<title>Notre façon de travailler</title>");
    expect(files.get("blog/how-we-work/index.html")).toContain("<title>How we work</title>");
    expect(files.get("sitemap.xml")).toContain("<loc>https://acme.test/fr/about</loc>");
  });

  it("the language switcher links to this page in each language", () => {
    const { doc } = bilingual();
    const html = renderPage(doc, doc.pages[0]!, { mode: "publish", locale: "fr", basePath: "/s/acme" });
    expect(html).toMatch(/<nav aria-label="Language"[^>]*><a href="\/s\/acme\/" hreflang="en" lang="en">English<\/a><a href="\/s\/acme\/fr" hreflang="fr" lang="fr" aria-current="true">Français<\/a><a href="\/s\/acme\/ar" hreflang="ar" lang="ar">/);
  });

  it("tracks what's missing and what's out of date", () => {
    const { doc, hero } = bilingual();
    const before = translationStatus(doc, "fr");
    expect(before.find((e) => e.id === hero.id)?.state).toBe("done");
    expect(before.filter((e) => e.state === "missing").length).toBeGreaterThan(5);
    const changed = apply(doc, [{ op: "update_node", nodeId: hero.id, props: { text: "Build sites faster" } }]).document;
    expect(translationStatus(changed, "fr").find((e) => e.id === hero.id)?.state).toBe("stale");
    expect(translationStatus(changed, "fr").find((e) => e.kind === "item")).toMatchObject({ where: "Blog › welcome-to-the-blog › Title", state: "missing" });
  });

  it("rejects bad translations and removes a language's text with it", () => {
    const { doc, hero } = bilingual();
    expect(() => apply(doc, [{ op: "set_translation", locale: "de", nodeId: hero.id, values: { text: "x" } }])).toThrow(/add de/);
    expect(() => apply(doc, [{ op: "set_translation", locale: "fr", nodeId: hero.id, values: { onclick: "x" } }])).toThrow(/can't be translated/);
    expect(() => apply(doc, [{ op: "set_locales", locales: ["english!"] }])).toThrow(/language code/);
    const gone = apply(doc, [{ op: "set_locales", locales: ["ar"] }]).document;
    expect(JSON.stringify(gone)).not.toContain("Créez");
    expect(splitLocale(doc, "/fr/about")).toEqual({ locale: "fr", path: "/about" });
    expect(splitLocale(doc, "/fred")).toEqual({ locale: "en", path: "/fred" });
  });
});
