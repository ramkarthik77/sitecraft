import { allLocales, localePath, siteRoutes, type SiteDocument } from "@sitecraft/schema";
import { escapeHtml, renderPage, type RenderOptions } from "./html.js";

/** The storage key a page path publishes to: "/" -> "index.html", "/pricing" -> "pricing/index.html". */
export function pageFileName(path: string): string {
  return path === "/" ? "index.html" : `${path.replace(/^\//, "")}/index.html`;
}

export function renderSitemap(doc: SiteDocument, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const urls = allLocales(doc)
    .flatMap((l) => siteRoutes(doc).map((r) => localePath(r.path, l, doc)))
    .map((p) => `  <url><loc>${escapeHtml(base + p)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobots(siteUrl?: string): string {
  const sitemap = siteUrl ? `Sitemap: ${siteUrl.replace(/\/$/, "")}/sitemap.xml\n` : "";
  return `User-agent: *\nAllow: /\n${sitemap}`;
}

export function renderNotFound(doc: SiteDocument): string {
  return `<!doctype html><html lang="${escapeHtml(doc.settings.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}a{color:#4f46e5}</style></head><body><main style="text-align:center"><h1>Page not found</h1><p><a href="./">Go to the home page</a></p></main></body></html>\n`;
}

/**
 * Render every file a published site needs. Without a siteUrl (an export whose
 * final address isn't known yet) the sitemap and canonical links are left out.
 */
export function renderSite(doc: SiteDocument, opts: Omit<RenderOptions, "mode">): Map<string, string> {
  const files = new Map<string, string>();
  // One file per page, and one per published item of each template page, in every language.
  for (const locale of allLocales(doc)) {
    for (const r of siteRoutes(doc)) {
      files.set(pageFileName(localePath(r.path, locale, doc)), renderPage(doc, r.page, { ...opts, mode: "publish", itemId: r.item?.id, locale }));
    }
  }
  if (opts.siteUrl) files.set("sitemap.xml", renderSitemap(doc, opts.siteUrl));
  files.set("robots.txt", renderRobots(opts.siteUrl));
  files.set("404.html", renderNotFound(doc));
  return files;
}
