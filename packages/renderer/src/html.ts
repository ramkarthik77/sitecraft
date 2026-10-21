import { isSafeHref, isSafeSrc, type Page, type SiteDocument, type SiteNode } from "@sitecraft/schema";
import { animationAttrs, assembleCss, collectNodeCss, newCollector, nodeClass, type CssCollector } from "./css.js";

export type RenderMode = "publish" | "preview" | "editor";

export interface RenderOptions {
  mode: RenderMode;
  /** Absolute site URL used for canonical links and the sitemap, e.g. https://acme.com */
  siteUrl?: string;
  /** Prefix for internal page links (e.g. "/s/acme" when served under a path). */
  basePath?: string;
  /** URL forms post to. Receives the form name. */
  formAction?: (formName: string) => string;
  /** Extra HTML injected before </body> (the editor bridge script). */
  bodyEnd?: string;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);
}

function escapeText(s: unknown): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

interface Ctx {
  doc: SiteDocument;
  opts: RenderOptions;
  css: CssCollector;
  seen: Set<string>;
  /** Guards against components that (indirectly) contain themselves. */
  componentStack: string[];
}

function resolveHref(href: string, ctx: Ctx): string {
  if (!isSafeHref(href)) return "#";
  const base = ctx.opts.basePath ?? "";
  if (base && href.startsWith("/") && !href.startsWith("//")) return base + (href === "/" ? "/" : href);
  return href;
}

function attrs(n: SiteNode, ctx: Ctx, extraClass: string[] = [], editorId?: string): string {
  const anim = ctx.opts.mode === "editor" ? { classes: [], style: "", attrs: "" } : animationAttrs(n.animation);
  const cls = [nodeClass(n.id), ...extraClass, ...anim.classes].join(" ");
  let out = ` class="${cls}"`;
  if (anim.style) out += ` style="${anim.style}"`;
  out += anim.attrs;
  if (ctx.opts.mode === "editor") out += ` data-node-id="${escapeHtml(editorId ?? n.id)}" data-node-type="${n.type}"`;
  return out;
}

function children(n: SiteNode, ctx: Ctx): string {
  return (n.children ?? []).map((c) => renderNode(c, ctx)).join("");
}

export function renderNode(n: SiteNode, ctx: Ctx, editorId?: string): string {
  collectNodeCss(n, ctx.css, ctx.seen);
  const p = n.props;
  const a = (extra: string[] = []) => attrs(n, ctx, extra, editorId);
  switch (n.type) {
    case "section": {
      const anchor = typeof p.anchor === "string" && /^[a-z0-9-]+$/i.test(p.anchor) ? ` id="${p.anchor}"` : "";
      return `<section${anchor}${a()}>${children(n, ctx)}</section>`;
    }
    case "stack":
    case "grid":
    case "spacer":
      return `<div${a()}>${children(n, ctx)}</div>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(p.level) || 2));
      return `<h${level}${a()}>${escapeText(p.text)}</h${level}>`;
    }
    case "text":
      return `<p${a()}>${escapeText(p.text)}</p>`;
    case "image": {
      const src = typeof p.src === "string" && isSafeSrc(p.src) ? p.src : "";
      return `<img${a()} src="${escapeHtml(src)}" alt="${escapeHtml(p.alt ?? "")}" loading="lazy" decoding="async">`;
    }
    case "button": {
      if (p.submit) return `<button type="submit"${a(["sc-btn"])}>${escapeHtml(p.label ?? "Submit")}</button>`;
      const href = resolveHref(String(p.href ?? "#"), ctx);
      const target = p.newTab ? ` target="_blank" rel="noopener noreferrer"` : "";
      return `<a href="${escapeHtml(href)}"${target}${a(["sc-btn"])}>${escapeHtml(p.label ?? "Button")}</a>`;
    }
    case "link": {
      const href = resolveHref(String(p.href ?? "#"), ctx);
      const target = p.newTab ? ` target="_blank" rel="noopener noreferrer"` : "";
      return `<a href="${escapeHtml(href)}"${target}${a()}>${children(n, ctx)}</a>`;
    }
    case "divider":
      return `<hr${a()}>`;
    case "form": {
      const name = String(p.formName ?? "form").replace(/[^a-z0-9-_]/gi, "") || "form";
      const action = ctx.opts.formAction ? ctx.opts.formAction(name) : "#";
      const success = escapeHtml(p.successMessage ?? "Thanks!");
      return `<form method="post" action="${escapeHtml(action)}" data-sc-form data-sc-success="${success}"${a()}>${children(n, ctx)}<p class="sc-form-status" role="status" aria-live="polite"></p></form>`;
    }
    case "input": {
      const name = String(p.name ?? "field").replace(/[^a-z0-9-_]/gi, "") || "field";
      const label = escapeHtml(p.label ?? name);
      const req = p.required ? " required" : "";
      const ph = p.placeholder ? ` placeholder="${escapeHtml(p.placeholder)}"` : "";
      const kind = String(p.inputType ?? "text");
      const field =
        kind === "textarea"
          ? `<textarea name="${name}"${req}${ph}></textarea>`
          : `<input type="${["email", "tel", "number", "url"].includes(kind) ? kind : "text"}" name="${name}"${req}${ph}>`;
      return `<label${a(["sc-field"])}><span>${label}</span>${field}</label>`;
    }
    case "embed": {
      const url = typeof p.url === "string" && /^https:\/\//i.test(p.url) ? p.url : "";
      return `<iframe${a(["sc-embed"])} src="${escapeHtml(url)}" title="${escapeHtml(p.title ?? "Embedded content")}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allowfullscreen></iframe>`;
    }
    case "instance": {
      const comp = ctx.doc.components.find((c) => c.id === p.componentId);
      if (!comp || ctx.componentStack.includes(comp.id)) return `<div${a()}></div>`;
      ctx.componentStack.push(comp.id);
      const root = applyOverrides(comp.root, p.overrides);
      // The instance's own style layers on top of the component root.
      collectNodeCss(n, ctx.css, ctx.seen);
      const html = renderNode(root, ctx, editorId ?? n.id).replace(/class="/, `class="${nodeClass(n.id)} `);
      ctx.componentStack.pop();
      return html;
    }
  }
}

function applyOverrides(root: SiteNode, overrides: unknown): SiteNode {
  if (!overrides || typeof overrides !== "object") return root;
  const map = overrides as Record<string, Record<string, unknown>>;
  const visit = (n: SiteNode): SiteNode => ({
    ...n,
    props: map[n.id] ? { ...n.props, ...map[n.id] } : n.props,
    children: n.children?.map(visit),
  });
  return visit(root);
}

const RUNTIME_SCRIPT = `(function(){
var els=[].slice.call(document.querySelectorAll('[data-sc-trigger]'));
function show(e){e.classList.add('sc-in')}
if(!('IntersectionObserver' in window)){els.forEach(show)}else{
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){show(x.target);io.unobserve(x.target)}})},{threshold:.12});
els.forEach(function(e){if(e.getAttribute('data-sc-trigger')==='load'){requestAnimationFrame(function(){show(e)})}else{io.observe(e)}})}
[].slice.call(document.querySelectorAll('form[data-sc-form]')).forEach(function(f){f.addEventListener('submit',function(ev){
if(!window.fetch)return;ev.preventDefault();var s=f.querySelector('.sc-form-status');var d={};new FormData(f).forEach(function(v,k){d[k]=v});
fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){
if(!r.ok)throw 0;f.reset();if(s)s.textContent=f.getAttribute('data-sc-success')}).catch(function(){if(s)s.textContent='Something went wrong. Please try again.'})})})})();`;

function fontLinks(doc: SiteDocument): string {
  const families = new Set<string>();
  for (const f of [doc.theme.fonts.heading, doc.theme.fonts.body]) {
    const m = /'([^']+)'/.exec(f) ?? /"([^"]+)"/.exec(f);
    if (m && /^[A-Za-z0-9 ]+$/.test(m[1]!)) families.add(m[1]!);
  }
  const sys = new Set(["system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman"]);
  const fams = [...families].filter((f) => !sys.has(f));
  if (!fams.length) return "";
  const q = fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

/** Render one page to a complete HTML document. */
export function renderPage(doc: SiteDocument, page: Page, opts: RenderOptions): string {
  const ctx: Ctx = { doc, opts, css: newCollector(), seen: new Set(), componentStack: [] };
  const body = renderNode(page.root, ctx);
  const withAnim = opts.mode !== "editor";
  const css = assembleCss(doc, ctx.css, withAnim);
  const canonical = opts.siteUrl ? `${opts.siteUrl.replace(/\/$/, "")}${page.path === "/" ? "/" : page.path}` : "";
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(page.title)}</title>`,
    page.description ? `<meta name="description" content="${escapeHtml(page.description)}">` : "",
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    page.description ? `<meta property="og:description" content="${escapeHtml(page.description)}">` : "",
    page.ogImage && isSafeSrc(page.ogImage) ? `<meta property="og:image" content="${escapeHtml(page.ogImage)}">` : "",
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:url" content="${escapeHtml(canonical)}">` : "",
    doc.settings.favicon && isSafeSrc(doc.settings.favicon) ? `<link rel="icon" href="${escapeHtml(doc.settings.favicon)}">` : "",
    opts.mode !== "publish" ? `<meta name="robots" content="noindex">` : "",
    `<meta name="generator" content="Sitecraft">`,
    fontLinks(doc),
    `<style>${css}</style>`,
    withAnim ? `<noscript><style>.sc-anim{opacity:1!important;transform:none!important}</style></noscript>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const script = opts.mode === "editor" ? "" : `<script>${RUNTIME_SCRIPT}</script>`;
  return `<!doctype html>\n<html lang="${escapeHtml(doc.settings.lang)}">\n<head>\n${head}\n</head>\n<body>\n${body}\n${script}${opts.bodyEnd ?? ""}\n</body>\n</html>\n`;
}

/** Render just the body markup and stylesheet (used for live editor updates). */
export function renderPageParts(doc: SiteDocument, page: Page, opts: RenderOptions): { body: string; css: string } {
  const ctx: Ctx = { doc, opts, css: newCollector(), seen: new Set(), componentStack: [] };
  const body = renderNode(page.root, ctx);
  return { body, css: assembleCss(doc, ctx.css, opts.mode !== "editor") };
}
