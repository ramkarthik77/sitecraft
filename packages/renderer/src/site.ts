import { allLocales, localePath, siteRoutes, type SiteDocument } from "@sitecraft/schema";
import { resolveRedirect } from "@sitecraft/schema";
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

/** A tiny page at an old address that sends people (and search engines) to the new one. */
export function renderRedirect(to: string, lang = "en"): string {
  const t = escapeHtml(to);
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>Moved</title><meta http-equiv="refresh" content="0; url=${t}"><link rel="canonical" href="${t}"><meta name="robots" content="noindex"></head><body><p>This page has moved to <a href="${t}">${t}</a>.</p></body></html>\n`;
}

/** Old addresses to publish redirect pages at, with where each goes, in every language. */
export function redirectFiles(doc: SiteDocument, basePath = ""): Map<string, string> {
  const out = new Map<string, string>();
  const pages = new Set(siteRoutes(doc).map((r) => r.path));
  const base = basePath.replace(/\/$/, "");
  const abs = (path: string) => (/^https?:/.test(path) ? path : base + path);
  for (const r of doc.settings.redirects ?? []) {
    // "/news/:slug" redirects get one page per published item of the template they now point at.
    const olds = r.from.endsWith("/:slug")
      ? siteRoutes(doc)
          .filter((x) => x.item && r.to.endsWith("/:slug") && x.path.startsWith(r.to.slice(0, -":slug".length)))
          .map((x) => r.from.slice(0, -":slug".length) + x.path.slice(r.to.length - ":slug".length))
      : [r.from];
    for (const old of olds) {
      if (pages.has(old)) continue;
      const to = resolveRedirect(doc, old);
      if (!to) continue;
      for (const locale of allLocales(doc)) {
        const target = /^https?:/.test(to) ? to : localePath(to, locale, doc);
        out.set(pageFileName(localePath(old, locale, doc)), renderRedirect(abs(target), locale));
      }
    }
  }
  return out;
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
  for (const [file, html] of redirectFiles(doc, opts.basePath)) if (!files.has(file)) files.set(file, html);
  if (opts.siteUrl) files.set("sitemap.xml", renderSitemap(doc, opts.siteUrl));
  files.set("robots.txt", renderRobots(opts.siteUrl));
  files.set("404.html", renderNotFound(doc));
  return files;
}
