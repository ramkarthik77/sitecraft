import { parse, type HTMLElement, type Node } from "node-html-parser";
import { isSafeHref, isSafeSrc, type Operation } from "@sitecraft/schema";
import { safeFetch, type SafeFetchOptions } from "./safefetch.js";
import { captureRenderedPage, launchImportBrowser, type RenderedCapture } from "./rendered-import.js";
import type { Browser } from "playwright-core";

/**
 * Bring an existing website into Sitecraft: read its pages and rebuild each
 * as ordinary, editable sections (headings, text, images, buttons, links),
 * with the site's main colour and fonts. It's a starting point for a
 * migration or a template, not a pixel copy: scripts, forms, embeds and
 * styling details are left behind.
 */

type N = { type: string; props: Record<string, unknown>; style?: Record<string, Record<string, string>>; name?: string; children?: N[] };

export interface ImportedPage {
  /** The page's address on the source site. */
  source: string;
  path: string;
  title: string;
  description?: string;
  sections: N[];
}
export interface ImportResult {
  origin: string;
  name: string;
  pages: ImportedPage[];
  theme: { colors: Record<string, string>; fonts: { heading?: string; body?: string } };
  warnings: string[];
  /** Internal-only browser capture evidence. Stored privately by the API, never returned inline. */
  captures?: Map<string, RenderedCapture>;
}

const SKIP = new Set(["script", "style", "noscript", "svg", "template", "iframe", "form", "button", "select", "textarea", "input", "canvas", "video", "audio", "object", "picture>source", "source", "link", "meta", "head"]);
const SECTIONISH = new Set(["section", "header", "footer", "article", "aside", "nav"]);
const MAX_SECTIONS = 30;
const MAX_ITEMS = 40;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Decode HTML entities in one pass, so "&amp;lt;" stays "&lt;". */
const decode = (s: string) => s.replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,6});/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(Math.min(0x10ffff, e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))) : (ENTITIES[e.toLowerCase()] ?? m)));
const textOf = (el: HTMLElement) => clean(decode(el.text ?? ""));
const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;

/** Map a page address on the source site to a Sitecraft page path. */
export function toPath(u: URL): string {
  const parts = u.pathname
    .replace(/\.(html?|php|aspx?)$/i, "")
    .split("/")
    .filter(Boolean)
    .slice(0, 3)
    .map((p) => decodeURIComponent(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((p) => p && p !== "index");
  return parts.length ? `/${parts.join("/")}` : "/";
}

// ── Styles for what's rebuilt, in the site's theme ──────────────────────

const headingStyle = (level: number): N["style"] => ({
  base: { fontFamily: "var(--font-heading)", color: "var(--color-text)", margin: "0", fontSize: level === 1 ? "48px" : level === 2 ? "34px" : "24px", lineHeight: "1.15" },
  mobile: { fontSize: level === 1 ? "34px" : level === 2 ? "26px" : "20px" },
});
const textStyle: N["style"] = { base: { color: "var(--color-muted)", fontSize: "17px", lineHeight: "1.6", margin: "0", maxWidth: "760px" } };
const container = (children: N[]): N => ({
  type: "stack",
  name: "Container",
  props: {},
  style: { base: { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" } },
  children,
});
const section = (name: string, children: N[], tone: "hero" | "plain" | "footer" | "nav" = "plain"): N => ({
  type: "section",
  name,
  props: {},
  style:
    tone === "nav"
      ? { base: { padding: "18px 24px", display: "flex", flexDirection: "column", borderBottom: "1px solid var(--color-border)" } }
      : tone === "footer"
        ? { base: { padding: "48px 24px", display: "flex", flexDirection: "column", backgroundColor: "var(--color-surface)" } }
        : tone === "hero"
          ? { base: { padding: "112px 24px", display: "flex", flexDirection: "column" }, mobile: { padding: "72px 20px" } }
          : { base: { padding: "72px 24px", display: "flex", flexDirection: "column" }, mobile: { padding: "52px 20px" } },
  children: [container(children)],
});

export interface Ctx {
  base: URL;
  /** Source page address → Sitecraft path, for pages being imported. */
  pagePaths: Map<string, string>;
}

/** A link's target: a Sitecraft page when it's one being imported, else the absolute address. */
function hrefFor(raw: string | undefined, ctx: Ctx): string | null {
  if (!raw) return null;
  const h = raw.trim();
  if (/^(mailto:|tel:)/i.test(h)) return h;
  if (h.startsWith("#")) return h.length > 1 ? h : null;
  let u: URL;
  try {
    u = new URL(h, ctx.base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const key = u.origin + u.pathname.replace(/\/$/, "");
  const local = ctx.pagePaths.get(key) ?? (u.origin === ctx.base.origin && (u.pathname === "/" || u.pathname === "") ? "/" : undefined);
  const out = local ?? u.toString();
  return isSafeHref(out) ? out : null;
}

function srcFor(img: HTMLElement, ctx: Ctx): string | null {
  const raw = img.getAttribute("src") || img.getAttribute("data-src") || (img.getAttribute("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0] || "";
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const u = new URL(raw, ctx.base).toString();
    return /^https?:\/\//.test(u) && isSafeSrc(u) ? u : null;
  } catch {
    return null;
  }
}

const looksLikeButton = (a: HTMLElement) => /\b(btn|button|cta)\b/i.test(`${a.getAttribute("class") ?? ""} ${a.getAttribute("role") ?? ""}`);

/** Recognise layouts before flattening their children into a column.
 * This preserves editable two-column heroes and repeated card grids without
 * copying arbitrary source CSS/JS into the published site.
 */
const GRID_HINT = /(?:^|[\s_-])(grid|cards|tiles|benefits|feature-list|feature-grid|service-list|service-grid|product-grid)(?:$|[\s_-])/i;
const SPLIT_HINT = /(?:^|[\s_-])(hero|split|two-col|two-column|media-row|media-object|feature-row)(?:$|[\s_-])/i;
const classOf = (el: HTMLElement) => `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
const childrenOf = (el: HTMLElement) => el.childNodes.filter(isEl).filter((c) => !SKIP.has(c.tagName?.toLowerCase() ?? "") && c.getAttribute("hidden") === undefined && c.getAttribute("aria-hidden") !== "true");
const hasImage = (el: HTMLElement) => !!el.querySelector("img");
const hasWords = (el: HTMLElement) => !!el.querySelector("h1,h2,h3,h4,p,blockquote") || textOf(el).length > 60;
const hasHeading = (el: HTMLElement) => !!el.querySelector("h1,h2,h3,h4");
const isLayoutContainer = (el: HTMLElement) => ["div", "section", "article", "ul"].includes(el.tagName?.toLowerCase() ?? "");

/** Extract a row/grid, but only if its child grouping is unambiguous. */
function layoutFor(el: HTMLElement, ctx: Ctx, seen: Set<HTMLElement>): N | null {
  if (!isLayoutContainer(el) || el.querySelector("nav,form")) return null;
  let parts = childrenOf(el);
  // Two layers of decorative wrappers are common in Bootstrap and CMS markup.
  if (parts.length === 1 && ["div", "ul"].includes(parts[0]!.tagName?.toLowerCase() ?? "")) {
    const nested = parts[0]!;
    if (GRID_HINT.test(classOf(nested)) || SPLIT_HINT.test(classOf(nested))) return layoutFor(nested, ctx, seen);
  }
  if (parts.length < 2 || parts.length > 6) return null;
  const cls = classOf(el);
  const inline = el.getAttribute("style") ?? "";
  const computed = el.getAttribute("data-sitecraft-layout");
  const grid = computed === "grid" || GRID_HINT.test(cls) || (/display\s*:\s*grid/i.test(inline) && parts.length > 2);
  const split = parts.length === 2 &&
    (computed === "split" || SPLIT_HINT.test(cls) || /display\s*:\s*(?:flex|grid)/i.test(inline)) &&
    parts.some(hasImage) && parts.some(hasWords);
  if (!grid && !split) return null;
  // A page-wide wrapper containing multiple sections is not a card grid.
  if (parts.some((p) => ["header", "footer", "main", "section"].includes(p.tagName?.toLowerCase() ?? ""))) return null;
  if (grid && parts.filter((p) => hasHeading(p) || hasImage(p) || textOf(p).length > 45).length < 2) return null;
  const cards: N[] = [];
  for (const p of parts) {
    const items: N[] = [];
    collect(p, ctx, items, seen);
    if (!items.length && p.tagName?.toLowerCase() === "img") addImage(p, ctx, items);
    if (!items.length && textOf(p).length > 12) items.push({ type: "text", props: { text: textOf(p).slice(0, 2000) }, style: textStyle });
    if (!items.length) continue;
    cards.push({
      type: "stack",
      name: split ? (hasImage(p) && !hasHeading(p) ? "Media" : "Copy") : `Card ${cards.length + 1}`,
      props: {},
      style: {
        base: { display: "flex", flexDirection: "column", gap: "14px", padding: "24px", borderRadius: "16px", backgroundColor: "var(--color-surface)", minWidth: "0" },
      },
      children: items,
    });
  }
  if (cards.length < 2) return null;
  if (split) {
    // Keep the original media/text order, but collapse gracefully on phones.
    for (const card of cards) {
      card.style = { base: { flexDirection: "column", display: "flex", gap: "18px", width: "50%", minWidth: "0" }, mobile: { width: "100%" } };
      for (const child of card.children ?? []) if (child.type === "image") child.style = { base: { width: "100%", maxWidth: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "18px" } };
    }
    return {
      type: "stack", name: "Two-column layout", props: {},
      style: { base: { width: "100%", display: "flex", flexDirection: "row", gap: "48px", alignItems: "center" }, tablet: { gap: "28px" }, mobile: { flexDirection: "column", gap: "24px" } },
      children: cards,
    };
  }
  return {
    type: "grid", name: "Cards", props: {},
    style: { base: { width: "100%", display: "grid", gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr))`, gap: "20px" }, tablet: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, mobile: { gridTemplateColumns: "minmax(0, 1fr)", gap: "14px" } },
    children: cards,
  };
}

/** The content inside an element, in order, as Sitecraft nodes. */
function collect(el: HTMLElement, ctx: Ctx, out: N[], seen: Set<HTMLElement>) {
  for (const child of el.childNodes) {
    if (out.length >= MAX_ITEMS) return;
    if (!isEl(child)) continue;
    const tag = child.tagName?.toLowerCase() ?? "";
    if (SKIP.has(tag) || child.getAttribute("aria-hidden") === "true" || child.getAttribute("hidden") !== undefined) continue;
    if (seen.has(child)) continue;
    const layout = layoutFor(child, ctx, seen);
    if (layout) { out.push(layout); continue; }
    if (/^h[1-6]$/.test(tag)) {
      const t = textOf(child);
      if (t) out.push({ type: "heading", props: { text: t.slice(0, 300), level: Math.min(Number(tag[1]), 4) }, style: headingStyle(Number(tag[1])) });
      continue;
    }
    if (tag === "p" || tag === "blockquote" || tag === "dd" || tag === "dt" || tag === "figcaption") {
      // A paragraph that's only a link styled as a button becomes a button.
      const only = child.childNodes.filter((x) => isEl(x) || clean(x.rawText));
      if (only.length === 1 && isEl(only[0]!) && only[0]!.tagName?.toLowerCase() === "a" && looksLikeButton(only[0]!)) {
        addLink(only[0]!, ctx, out);
        continue;
      }
      const t = textOf(child);
      if (t) out.push({ type: "text", props: { text: t.slice(0, 2000) }, style: textStyle });
      for (const img of child.querySelectorAll("img")) addImage(img, ctx, out);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items = child.querySelectorAll("li").map(textOf).filter(Boolean).slice(0, 12);
      // Lists of links (menus) are handled by the nav; content lists become lines of text.
      if (items.length && child.querySelectorAll("a").length < items.length) out.push({ type: "text", props: { text: items.map((x) => `• ${x}`).join("\n").slice(0, 2000) }, style: textStyle });
      else if (items.length) for (const a of child.querySelectorAll("a").slice(0, 8)) addLink(a, ctx, out);
      continue;
    }
    if (tag === "img") {
      addImage(child, ctx, out);
      continue;
    }
    if (tag === "a") {
      if (child.querySelector("h1,h2,h3,h4,p,img")) collect(child, ctx, out, seen);
      else addLink(child, ctx, out);
      continue;
    }
    if (tag === "table") {
      const rows = child.querySelectorAll("tr").map((tr) => tr.querySelectorAll("th,td").map(textOf).join(" · ")).filter(Boolean).slice(0, 15);
      if (rows.length) out.push({ type: "text", props: { text: rows.join("\n").slice(0, 2000) }, style: textStyle });
      continue;
    }
    // Plain text directly inside a div (no paragraph tags).
    const direct = clean(decode(child.childNodes.filter((x) => x.nodeType === 3).map((x) => x.rawText).join(" ")));
    if (direct.length > 40 && !child.querySelector("p,h1,h2,h3,h4")) {
      out.push({ type: "text", props: { text: direct.slice(0, 2000) }, style: textStyle });
      continue;
    }
    collect(child, ctx, out, seen);
  }
}

function addImage(img: HTMLElement, ctx: Ctx, out: N[]) {
  const src = srcFor(img, ctx);
  if (!src) return;
  const w = Number(img.getAttribute("width") ?? 0);
  if (w && w < 40) return; // icons and tracking pixels
  out.push({ type: "image", props: { src, alt: clean(img.getAttribute("alt") ?? "").slice(0, 300) }, style: { base: { width: "100%", maxWidth: "100%", height: "auto", borderRadius: "var(--radius)", objectFit: "cover" } } });
}

function addLink(a: HTMLElement, ctx: Ctx, out: N[]) {
  const label = textOf(a).slice(0, 80);
  const href = hrefFor(a.getAttribute("href"), ctx);
  if (!label || !href) return;
  out.push({ type: "button", props: { label, href }, style: buttonStyle(false) });
}

const buttonStyle = (primary: boolean): N["style"] => ({
  base: primary
    ? { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: "600", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }
    : { background: "transparent", color: "var(--color-text)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: "600", textDecoration: "none", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" },
});

/** A block that's mostly links and no headings reads as a menu. */
function isMenu(el: HTMLElement): boolean {
  const links = el.querySelectorAll("a");
  if (links.length < 3 || el.querySelector("h1,h2,h3")) return false;
  const linkText = links.map(textOf).join(" ").length;
  return linkText >= textOf(el).length * 0.7;
}

/** The navigation bar: the site name and its main links. */
function navSection(doc: HTMLElement, ctx: Ctx, siteName: string, el?: HTMLElement): N | null {
  const nav = el ?? doc.querySelector("header nav") ?? doc.querySelector("nav") ?? doc.querySelector("header");
  if (!nav) return null;
  const links = nav
    .querySelectorAll("a")
    .map((a) => ({ label: textOf(a).slice(0, 40), href: hrefFor(a.getAttribute("href"), ctx) }))
    .filter((l) => l.label && l.href && l.label.length <= 40 && l.label.toLowerCase() !== siteName.toLowerCase() && l.href !== "/")
    .filter((l, i, all) => all.findIndex((x) => x.label === l.label) === i)
    .slice(0, 8);
  if (!links.length) return null;
  return {
    type: "section",
    name: "Navigation",
    props: {},
    style: { base: { padding: "18px 24px", display: "flex", flexDirection: "column", borderBottom: "1px solid var(--color-border)" } },
    children: [
      {
        type: "stack",
        name: "Container",
        props: {},
        style: { base: { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" } },
        children: [
          { type: "link", props: { href: "/" }, style: { base: { color: "var(--color-text)", textDecoration: "none", fontWeight: "700", fontSize: "18px" } }, children: [{ type: "text", props: { text: siteName.slice(0, 60) }, style: { base: { margin: "0", color: "var(--color-text)" } } }] },
          {
            type: "stack",
            name: "Links",
            props: {},
            style: { base: { display: "flex", flexDirection: "row", gap: "20px", flexWrap: "wrap", alignItems: "center" } },
            children: links.map((l) => ({ type: "link", props: { href: l.href }, style: { base: { color: "var(--color-muted)", textDecoration: "none", fontSize: "15px" } }, children: [{ type: "text", props: { text: l.label }, style: { base: { margin: "0", color: "var(--color-muted)", fontSize: "15px" } } }] })),
          },
        ],
      },
    ],
  };
}

/** Rebuild one page's content as sections. */
export function convertPage(html: string, ctx: Ctx, siteName: string, isHome: boolean): { title: string; description?: string; sections: N[] } {
  const doc = parse(html, { blockTextElements: { script: false, noscript: false, style: false, pre: true } });
  const title = clean(decode(doc.querySelector("title")?.text ?? "")) || ctx.base.hostname;
  const description = clean(doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "") || undefined;
  const body = doc.querySelector("body") ?? doc;
  const main = body.querySelector("main") ?? body.querySelector('[role="main"]') ?? body;
  const sections: N[] = [];
  const nav = navSection(body, ctx, siteName);
  if (nav) sections.push(nav);

  // The parts of the page that read as sections: semantic ones, or blocks that start with a heading.
  const blocks: HTMLElement[] = [];
  const visit = (el: HTMLElement, depth: number) => {
    for (const c of el.childNodes) {
      if (!isEl(c)) continue;
      const tag = c.tagName?.toLowerCase() ?? "";
      if (SKIP.has(tag) || tag === "nav") continue;
      if (tag === "header" && c.querySelector("nav") && !c.querySelector("h1,h2,p")) continue;
      if (tag === "footer") continue;
      const own = c.childNodes.filter(isEl).map((x) => x.tagName?.toLowerCase());
      const headed = own.some((t) => /^h[1-3]$/.test(t ?? ""));
      if ((SECTIONISH.has(tag) || headed || depth >= 4) && c.text.trim()) blocks.push(c);
      else if (depth < 6) visit(c, depth + 1);
    }
  };
  visit(main, 0);
  if (!blocks.length) blocks.push(main);
  // No <nav>: a menu-like first block is the navigation.
  if (!nav && blocks[0] && isMenu(blocks[0])) {
    const own = navSection(body, ctx, siteName, blocks.shift()!);
    if (own) sections.push(own);
  }

  for (const [i, b] of blocks.entries()) {
    if (sections.length >= MAX_SECTIONS) break;
    const items: N[] = [];
    const seen = new Set<HTMLElement>();
    const layout = layoutFor(b, ctx, seen);
    if (layout) items.push(layout);
    else collect(b, ctx, items, seen);
    // A block that's only text, with no paragraph tags.
    if (!items.length && textOf(b).length > 20) items.push({ type: "text", props: { text: textOf(b).slice(0, 2000) }, style: textStyle });
    if (!items.length) continue;
    const first = items.find((x) => x.type === "heading");
    const hero = isHome && i === 0 && !!items.find((x) => x.type === "heading" && x.props.level === 1);
    const label = first ? String(first.props.text).slice(0, 40) : `Section ${sections.length + 1}`;
    // Buttons after each other sit in a row.
    const grouped: N[] = [];
    for (const it of items) {
      const prev = grouped.at(-1);
      if (it.type === "button" && prev?.name === "Buttons") prev.children!.push(it);
      else if (it.type === "button") grouped.push({ type: "stack", name: "Buttons", props: {}, style: { base: { display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" } }, children: [{ ...it, style: buttonStyle(true) }] });
      else grouped.push(it);
    }
    if (hero && !grouped.some((x) => x.type === "stack" && x.name === "Two-column layout")) {
      const images = grouped.filter((x) => x.type === "image");
      const copy = grouped.filter((x) => x.type !== "image");
      if (images.length === 1 && copy.some((x) => x.type === "heading") && copy.length <= 8) {
        images[0]!.style = { base: { width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "18px" } };
        grouped.splice(0, grouped.length, {
          type: "stack", name: "Two-column layout", props: {},
          style: { base: { width: "100%", display: "flex", flexDirection: "row", alignItems: "center", gap: "48px" }, mobile: { flexDirection: "column", gap: "24px" } },
          children: [
            { type: "stack", name: "Copy", props: {}, style: { base: { display: "flex", flexDirection: "column", width: "55%", gap: "20px" }, mobile: { width: "100%" } }, children: copy },
            { type: "stack", name: "Media", props: {}, style: { base: { display: "flex", flexDirection: "column", width: "45%" }, mobile: { width: "100%" } }, children: images },
          ],
        });
      }
    }
    sections.push(section(label, grouped, hero ? "hero" : "plain"));
  }

  const footer = body.querySelector("footer");
  if (footer) {
    const items: N[] = [];
    collect(footer, ctx, items, new Set());
    const small = items.filter((x) => x.type !== "image").slice(0, 12).map((x) => (x.type === "heading" ? { ...x, style: { base: { margin: "0", fontSize: "15px", color: "var(--color-text)" } } } : x.type === "text" ? { ...x, style: { base: { margin: "0", fontSize: "13px", color: "var(--color-muted)" } } } : x));
    if (small.length) sections.push(section("Footer", small, "footer"));
  }
  return { title: title.slice(0, 200), description: description?.slice(0, 500), sections };
}

// ── Colours and fonts ───────────────────────────────────────────────────

const hexRe = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
function toHex(c: string): string {
  const h = c.replace("#", "").toLowerCase();
  return `#${h.length === 3 ? h.split("").map((x) => x + x).join("") : h}`;
}
function hsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}
const GENERIC = new Set(["sans-serif", "serif", "monospace", "system-ui", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "ui-sans-serif", "ui-serif", "segoe ui", "arial", "helvetica", "helvetica neue", "roboto", "var"]);

export function themeFrom(css: string, html: string): ImportResult["theme"] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(hexRe)) {
    const h = toHex(m[0]);
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const meta = /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,6})["']/i.exec(html)?.[1];
  if (meta) counts.set(toHex(meta), (counts.get(toHex(meta)) ?? 0) + 50);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const colors: Record<string, string> = {};
  const primary = ranked.find((h) => {
    const { s, l } = hsl(h);
    return s > 0.35 && l > 0.2 && l < 0.65;
  });
  if (primary) {
    colors.primary = primary;
    colors["on-primary"] = hsl(primary).l > 0.6 ? "#111111" : "#ffffff";
  }
  const text = ranked.find((h) => hsl(h).l < 0.25);
  if (text) colors.text = text;
  const fonts: { heading?: string; body?: string } = {};
  const fam = [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1]!.split(",")[0]!.trim().replace(/^["']|["']$/g, "")).filter((f) => f && !GENERIC.has(f.toLowerCase()) && /^[A-Za-z0-9 ]{2,40}$/.test(f));
  const famCount = new Map<string, number>();
  for (const f of fam) famCount.set(f, (famCount.get(f) ?? 0) + 1);
  const topFonts = [...famCount.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  const head = [...css.matchAll(/h[1-3][^{]*\{[^}]*font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1]!.split(",")[0]!.trim().replace(/^["']|["']$/g, "")).find((f) => /^[A-Za-z0-9 ]{2,40}$/.test(f) && !GENERIC.has(f.toLowerCase()));
  if (topFonts[0]) fonts.body = `'${topFonts[0]}', system-ui, sans-serif`;
  if (head ?? topFonts[0]) fonts.heading = `'${head ?? topFonts[0]}', system-ui, sans-serif`;
  return { colors, fonts };
}

// ── The whole import ────────────────────────────────────────────────────

export async function importWebsite(start: string, opts: { maxPages?: number; fetch?: SafeFetchOptions; render?: "auto" | "off" } = {}): Promise<ImportResult> {
  const max = Math.max(1, Math.min(25, opts.maxPages ?? 1));
  const f = { accept: /text\/html|application\/xhtml/i, ...opts.fetch };
  const warnings: string[] = [];
  const first = await safeFetch(start, f);
  const base = new URL(first.url);
  const homeDoc = parse(first.body);
  const siteName =
    clean(homeDoc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? "") ||
    clean(decode(homeDoc.querySelector("title")?.text ?? "")).split(/\s[|–—-]\s/)[0]!.trim() ||
    base.hostname.replace(/^www\./, "");

  // Which other pages to bring: links in the navigation first, then the rest of the page, same site only.
  const pageUrls = [first.url];
  const want = (raw: string | undefined) => {
    if (!raw || pageUrls.length >= max) return;
    try {
      const u = new URL(raw, base);
      u.hash = "";
      u.search = "";
      if (u.origin !== base.origin || /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) return;
      const s = u.toString();
      if (!pageUrls.some((p) => toPath(new URL(p)) === toPath(u))) pageUrls.push(s);
    } catch {
      /* not a link */
    }
  };
  for (const a of [...homeDoc.querySelectorAll("nav a, header a"), ...homeDoc.querySelectorAll("a")].slice(0, 200)) want(a.getAttribute("href"));

  // Bounded, navigation-first breadth-first discovery: an inner page may link
  // to the rest of a site even when the homepage doesn't. Each result is
  // downloaded through safeFetch; no cross-domain navigation is followed.
  const htmlCache = new Map<string, string>([[first.url, first.body]]);
  for (let i = 1; i < pageUrls.length && pageUrls.length < max; i++) {
    const u = pageUrls[i]!;
    try {
      const child = await safeFetch(u, f);
      htmlCache.set(u, child.body);
      const parsed = parse(child.body);
      for (const a of [...parsed.querySelectorAll("nav a, header a"), ...parsed.querySelectorAll("main a")].slice(0, 150)) want(a.getAttribute("href"));
    } catch (e) {
      warnings.push(`Could not crawl links in ${new URL(u).pathname}: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  const pagePaths = new Map<string, string>();
  for (const u of pageUrls) {
    const x = new URL(u);
    pagePaths.set(x.origin + x.pathname.replace(/\/$/, ""), u === first.url ? "/" : toPath(x));
  }

  // Stylesheets for colours and fonts: inline ones and up to three linked ones.
  let css = homeDoc.querySelectorAll("style").map((s) => s.text).join("\n") + "\n" + homeDoc.querySelectorAll("[style]").map((e) => e.getAttribute("style")).join(";");
  for (const l of homeDoc.querySelectorAll('link[rel="stylesheet"]').slice(0, 4)) {
    const href = l.getAttribute("href");
    if (!href) continue;
    try {
      const u = new URL(href, base);
      // Google Fonts: the families are in the address, no need to fetch it.
      if (u.hostname === "fonts.googleapis.com") {
        for (const fam of u.searchParams.getAll("family")) css += `\nbody{font-family:'${fam.split(":")[0]!.replace(/\+/g, " ")}'}`;
        continue;
      }
      if (u.origin !== base.origin) continue;
      css += "\n" + (await safeFetch(u.toString(), { ...opts.fetch, accept: /text\/css/i, maxBytes: 800_000 })).body;
    } catch {
      warnings.push(`Couldn't read the stylesheet ${href}.`);
    }
  }

  const pages: ImportedPage[] = [];
  const captures = new Map<string, RenderedCapture>();
  let browser: Browser | undefined;
  if (opts.render !== "off") {
    try {
      browser = await launchImportBrowser();
    } catch (e) {
      warnings.push(`Chromium was unavailable; safely falling back to static HTML: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  try {
  const deadline = Date.now() + 120_000;
  for (const u of pageUrls) {
    if (Date.now() > deadline) {
      warnings.push("The 120-second import capture budget was reached; remaining pages were not processed.");
      break;
    }
    try {
      let html = htmlCache.get(u) ?? (await safeFetch(u, f)).body;
      const path = pagePaths.get(new URL(u).origin + new URL(u).pathname.replace(/\/$/, "")) ?? "/";
      if (browser) {
        try {
          const captured = await captureRenderedPage(u, { fetch: opts.fetch }, browser);
          html = captured.html;
          captures.set(path, captured);
          warnings.push(...captured.warnings.map((w) => `${path}: ${w}`));
        } catch (e) {
          warnings.push(`${path}: Rendered capture unavailable; used safe static HTML (${(e as Error).message.slice(0, 120)}).`);
        }
      }
      const conv = convertPage(html, { base: new URL(u), pagePaths }, siteName, path === "/");
      if (!conv.sections.length) warnings.push(`${path === "/" ? "The home page" : path} had no content Sitecraft could read. It may be built with JavaScript.`);
      pages.push({ source: u, path, ...conv, title: path === "/" ? conv.title : conv.title.split(/\s[|–—-]\s/)[0]!.trim() || conv.title });
    } catch (e) {
      warnings.push(`Skipped ${u}: ${(e as Error).message}`);
    }
  }
  } finally {
    await browser?.close();
  }
  if (!pages.length) throw new Error("No pages could be imported.");
  if (pages.some((p) => p.sections.some((s) => JSON.stringify(s).includes('"type":"image"')))) {
    warnings.push("Images still load from the original site. Replace them with approved images from the asset library before publishing.");
  }
  return { origin: base.origin, name: siteName.slice(0, 80), pages, theme: themeFrom(css, first.body), warnings, captures };
}

/** The operations that build an imported site, given the new site's home page id. */
export function opsForImport(r: ImportResult, homePageId: string): Operation[] {
  const ops: Operation[] = [];
  if (Object.keys(r.theme.colors).length || r.theme.fonts.heading || r.theme.fonts.body) {
    ops.push({ op: "set_theme", colors: r.theme.colors, fonts: r.theme.fonts } as Operation);
  }
  const home = r.pages.find((p) => p.path === "/");
  if (home) ops.push({ op: "update_page", pageId: homePageId, title: home.title, ...(home.description ? { description: home.description } : {}) } as Operation);
  for (const p of r.pages) {
    if (p.path === "/") continue;
    ops.push({ op: "add_page", path: p.path, title: p.title || p.path, ...(p.description ? { description: p.description } : {}) } as Operation);
  }
  return ops;
}
