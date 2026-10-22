import {
  allLocales,
  findCollection,
  isRtl,
  languageName,
  localePath,
  TRANSLATABLE,
  translated,
  formatValue,
  isSafeHref,
  isSafeSrc,
  itemPath,
  itemTitle,
  itemUrl,
  listItems,
  placeholderItem,
  type Collection,
  type CollectionField,
  type CollectionItem,
  type Page,
  type SiteDocument,
  type SiteNode,
} from "@sitecraft/schema";
import { assembleCss, motionAttrs, collectNodeCss, newCollector, nodeClass, type CssCollector } from "./css.js";
import { renderMarkdown } from "./markdown.js";

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
  /**
   * For a template page: the item (id or slug) to render. Without one, the
   * editor and previews show the first item, or example content.
   */
  itemId?: string;
  /** Cloudflare Turnstile site key: adds a bot check to forms. */
  turnstileSiteKey?: string;
  /**
   * Origins of Sitecraft itself (editor, API). Embeds from these never get
   * allow-same-origin, which together with allow-scripts would let the
   * embedded page script its way out of the sandbox.
   */
  selfOrigins?: string[];
  /** Language to render, one of the site's languages. Defaults to the main one. */
  locale?: string;
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
  /** The collection item bound elements read from (template page or list). */
  item?: { collection: Collection; item: CollectionItem };
  /** Set once a form is rendered, so the page loads the bot check script. */
  hasForm?: boolean;
  /** The route being rendered (without the language prefix), for the language switcher. */
  routePath?: string;
}

/** The language being rendered when it isn't the main one. */
function altLocale(ctx: Ctx): string | undefined {
  const l = ctx.opts.locale;
  return l && l !== ctx.doc.settings.lang && (ctx.doc.settings.locales ?? []).includes(l) ? l : undefined;
}

/** An item's value for a field, in the current language when the field is translated. */
function itemValue(ctx: Ctx, field: CollectionField | undefined, item: CollectionItem, key: string) {
  const l = altLocale(ctx);
  if (l && field?.localized) {
    const t = item.i18n?.[l]?.[key];
    if (typeof t === "string" && t) return t;
  }
  return item.values[key];
}

/** Element props in the current language (bound props come from the item instead). */
function translateProps(n: SiteNode, p: Record<string, unknown>, ctx: Ctx): Record<string, unknown> {
  const l = altLocale(ctx);
  const keys = TRANSLATABLE[n.type];
  if (!l || !keys || !n.props.i18n) return p;
  const bind = (n.props.bind ?? {}) as Record<string, string>;
  const out = { ...p };
  for (const k of keys) if (!(k in bind)) out[k] = translated(n.props, n.props.i18n, l, k);
  return out;
}

/** Props after applying field bindings for the current item. */
function boundProps(n: SiteNode, ctx: Ctx): Record<string, unknown> {
  const bind = n.props.bind as Record<string, string> | undefined;
  if (!bind || !ctx.item) return n.props;
  const { collection, item } = ctx.item;
  const out: Record<string, unknown> = { ...n.props };
  for (const [prop, key] of Object.entries(bind)) {
    if (key === "slug") out[prop] = item.slug;
    else if (key === "url") out[prop] = (item.id === "placeholder" ? null : itemUrl(ctx.doc, collection, item)) ?? "#";
    else {
      const field = collection.fields.find((f) => f.id === key);
      const raw = itemValue(ctx, field, item, key);
      out[prop] = prop === "src" || prop === "href" ? (typeof raw === "string" && raw ? raw : prop === "href" ? "#" : "") : formatValue(field, raw, ctx.opts.locale ?? ctx.doc.settings.lang);
    }
  }
  return out;
}

function resolveHref(href: string, ctx: Ctx): string {
  if (!isSafeHref(href)) return "#";
  // Links between pages stay in the reader's language.
  const l = altLocale(ctx);
  if (l && href.startsWith("/") && !href.startsWith("//") && !/^\/(media|forms)\//.test(href)) href = localePath(href, l, ctx.doc);
  const base = ctx.opts.basePath ?? "";
  if (base && href.startsWith("/") && !href.startsWith("//")) return base + (href === "/" ? "/" : href);
  return href;
}

function attrs(n: SiteNode, ctx: Ctx, extraClass: string[] = [], editorId?: string): string {
  const anim = motionAttrs(n, ctx.opts.mode !== "editor");
  const cls = [nodeClass(n.id), ...extraClass, ...anim.classes].join(" ");
  let out = ` class="${cls}"`;
  if (anim.style) out += ` style="${anim.style}"`;
  out += anim.attrs;
  if (ctx.opts.mode === "editor") {
    out += ` data-node-id="${escapeHtml(editorId ?? n.id)}" data-node-type="${n.type}"`;
    if (n.props.bind && ctx.item) out += ` data-bound="1"`;
  }
  return out;
}

function children(n: SiteNode, ctx: Ctx): string {
  return (n.children ?? []).map((c) => renderNode(c, ctx)).join("");
}

export function renderNode(n: SiteNode, ctx: Ctx, editorId?: string): string {
  collectNodeCss(n, ctx.css, ctx.seen);
  const p = translateProps(n, boundProps(n, ctx), ctx);
  const a = (extra: string[] = []) => attrs(n, ctx, extra, editorId);
  switch (n.type) {
    case "section": {
      const anchor = typeof p.anchor === "string" && /^[a-z0-9-]+$/i.test(p.anchor) ? ` id="${p.anchor}"` : "";
      return `<section${anchor}${a()}>${children(n, ctx)}</section>`;
    }
    case "story": {
      // First child holds the visuals (one per step); the rest are the steps.
      const [visuals, ...steps] = n.children ?? [];
      const edit = ctx.opts.mode === "editor";
      const side = p.side === "left" ? "left" : "right";
      const stage = visuals ? renderNode(visuals, ctx) : "";
      return `<div${a(edit ? ["sc-story", "sc-story-edit"] : ["sc-story"])} data-side="${side}"${edit ? "" : " data-sc-story"}><div class="sc-story-steps">${steps.map((c) => renderNode(c, ctx)).join("")}</div><div class="sc-story-stage"><div class="sc-story-sticky">${stage}</div></div></div>`;
    }
    case "progress":
      return `<div${a(ctx.opts.mode === "editor" ? ["sc-progress", "sc-progress-edit"] : ["sc-progress"])} data-sc-progress aria-hidden="true"></div>`;
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
      // A bound image whose item has no picture: leave it out (a placeholder in the editor).
      if (!src && n.props.bind && ctx.item) return ctx.opts.mode === "editor" ? `<div${a(["sc-img-empty"])}></div>` : "";
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
      ctx.hasForm = true;
      // A field people never see: bots that fill every field get dropped.
      const trap = `<label class="sc-hp" aria-hidden="true">Leave this empty<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label>`;
      const bot = ctx.opts.turnstileSiteKey && ctx.opts.mode !== "editor" ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(ctx.opts.turnstileSiteKey)}"></div>` : "";
      return `<form method="post" action="${escapeHtml(action)}" data-sc-form data-sc-success="${success}"${a()}>${children(n, ctx)}${trap}${bot}<p class="sc-form-status" role="status" aria-live="polite"></p></form>`;
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
      let embedOrigin = "";
      try {
        embedOrigin = url ? new URL(url).origin : "";
      } catch {
        /* invalid URL: rendered empty */
      }
      // In the editor the canvas shares the editor's origin, so embeds there never get allow-same-origin.
      const trusted = ctx.opts.mode !== "editor" && embedOrigin && !(ctx.opts.selfOrigins ?? []).includes(embedOrigin);
      const sandbox = `allow-scripts${trusted ? " allow-same-origin" : ""} allow-popups allow-presentation`;
      return `<iframe${a(["sc-embed"])} src="${escapeHtml(url)}" title="${escapeHtml(p.title ?? "Embedded content")}" loading="lazy" sandbox="${sandbox}" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    }
    case "language-switch": {
      const langs = allLocales(ctx.doc);
      const current = ctx.opts.locale ?? ctx.doc.settings.lang;
      const links = langs
        .map((l) => {
          const href = resolveHref(localePath(ctx.routePath ?? "/", l, ctx.doc), { ...ctx, opts: { ...ctx.opts, locale: undefined } });
          return `<a href="${escapeHtml(href)}" hreflang="${escapeHtml(l)}" lang="${escapeHtml(l)}"${l === current ? ' aria-current="true"' : ""}>${escapeHtml(nativeName(l))}</a>`;
        })
        .join("");
      return `<nav aria-label="Language"${a(["sc-lang"])}>${links}</nav>`;
    }
    case "richtext": {
      const md = typeof p.markdown === "string" ? p.markdown : "";
      return `<div${a(["sc-rich"])}>${renderMarkdown(md, (h) => resolveHref(h, ctx))}</div>`;
    }
    case "collection-list": {
      const { collection, items } = listItems(ctx.doc, n, { includeDrafts: ctx.opts.mode !== "publish" });
      if (!collection || items.length === 0) return `<div${a()}><p class="sc-empty">${escapeHtml(p.empty ?? "Nothing here yet.")}</p></div>`;
      const outer = ctx.item;
      const html = items
        .map((item) => {
          ctx.item = { collection, item };
          return children(n, ctx);
        })
        .join("");
      ctx.item = outer;
      return `<div${a()}>${html}</div>`;
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

/** The only inline script on published pages; servers allow it by hash in their CSP. */
export const RUNTIME_SCRIPT = `(function(){
var Q=function(q){return [].slice.call(document.querySelectorAll(q))};
var calm=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;
function done(e){e.classList.remove('sc-anim','sc-stagger');e.style.removeProperty('--sc-delay')}
function show(e){e.classList.add('sc-in');var t=(parseFloat(getComputedStyle(e).getPropertyValue('--sc-dur'))||600)+(parseFloat(e.style.getPropertyValue('--sc-delay'))||0)+(parseFloat(e.style.getPropertyValue('--sc-step'))||0)*e.children.length;setTimeout(function(){done(e)},t+80)}
var els=Q('[data-sc-trigger]');
if(calm||!('IntersectionObserver' in window)){els.forEach(show)}else{
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){show(x.target);io.unobserve(x.target)}})},{threshold:.12});
els.forEach(function(e){if(e.getAttribute('data-sc-trigger')==='load'){requestAnimationFrame(function(){show(e)})}else{io.observe(e)}})}
if(!calm&&window.matchMedia&&matchMedia('(hover:hover)').matches){Q('[data-sc-tilt]').forEach(function(e){
e.addEventListener('pointermove',function(v){var r=e.getBoundingClientRect();var x=(v.clientX-r.left)/r.width-.5,y=(v.clientY-r.top)/r.height-.5;e.style.setProperty('--sc-rx',(-y*10).toFixed(2)+'deg');e.style.setProperty('--sc-ry',(x*12).toFixed(2)+'deg')});
e.addEventListener('pointerleave',function(){e.style.setProperty('--sc-rx','0deg');e.style.setProperty('--sc-ry','0deg')})})}
var px=calm?[]:Q('[data-sc-parallax]');if(px.length){var busy=0;function move(){busy=0;var h=innerHeight;px.forEach(function(e){var s=parseFloat(e.getAttribute('data-sc-parallax'))||0;var r=e.getBoundingClientRect();var top=r.top-(e._sc||0);if(top+r.height<-h||top>2*h)return;e._sc=(top+r.height/2-h/2)*s;e.style.translate='0 '+e._sc.toFixed(1)+'px'})}
addEventListener('scroll',function(){if(!busy){busy=1;requestAnimationFrame(move)}},{passive:true});addEventListener('resize',move);move()}
var native=window.CSS&&CSS.supports&&CSS.supports('animation-timeline:view()');
var scrub=calm||native?[]:Q('[data-sc-scrub]'),bars=Q('[data-sc-progress]');
if(scrub.length||bars.length){var due=0;function tick(){due=0;var h=innerHeight;scrub.forEach(function(e){var r=e.getBoundingClientRect();var c=(h-r.top)/(h+r.height),m=e.getAttribute('data-sc-scrub'),p=m==='both'?c:m==='out'?(c-.55)/.45:c/.45;e.style.setProperty('--sc-p',Math.min(.999,Math.max(0,p)).toFixed(4))});
if(!(window.CSS&&CSS.supports&&CSS.supports('animation-timeline:scroll()'))){var d=document.documentElement,t=d.scrollHeight-h;bars.forEach(function(b){b.style.setProperty('--sc-p',t>0?(scrollY/t).toFixed(4):'0')})}}
addEventListener('scroll',function(){if(!due){due=1;requestAnimationFrame(tick)}},{passive:true});addEventListener('resize',tick);tick()}
Q('[data-sc-story]').forEach(function(s){var st=s.querySelector('.sc-story-steps'),vs=s.querySelector('.sc-story-sticky');if(!st||!vs||!vs.firstElementChild||!('IntersectionObserver' in window))return;
var steps=[].slice.call(st.children),frames=[].slice.call(vs.firstElementChild.children);if(!frames.length)return;s.classList.add('sc-live');
function on(i){steps.forEach(function(x,j){x.classList.toggle('sc-on',j===i)});frames.forEach(function(x,j){x.classList.toggle('sc-on',j===Math.min(i,frames.length-1))})}on(0);
var so=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting)on(steps.indexOf(x.target))})},{rootMargin:'-45% 0px -45% 0px'});steps.forEach(function(x){so.observe(x)})});
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

/** The item a template page renders: the one asked for, else the first, else example content. */
export function pageItem(doc: SiteDocument, page: Page, itemId: string | undefined, includeDrafts: boolean): Ctx["item"] {
  if (!page.collectionId) return undefined;
  const collection = findCollection(doc, page.collectionId);
  if (!collection) return undefined;
  const items = collection.items.filter((i) => includeDrafts || !i.draft);
  const item = (itemId && items.find((i) => i.id === itemId || i.slug === itemId)) || (itemId ? undefined : items[0]) || placeholderItem(collection);
  return { collection, item };
}

/** A language's own name ("Français", "Deutsch"), for the language switcher. */
function nativeName(code: string): string {
  try {
    const n = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (n && n !== code) return n[0]!.toLocaleUpperCase(code) + n.slice(1);
  } catch {
    /* unknown code */
  }
  return languageName(code);
}

/** Title, description, share image and path for a page, in the current language, taken from its item on a template page. */
function pageMeta(page: Page, item: Ctx["item"], ctx: Ctx) {
  const l = altLocale(ctx);
  const pt = l ? page.i18n?.[l] : undefined;
  const title = pt?.title || page.title;
  const description = pt?.description || page.description;
  if (!item) return { title, description, ogImage: page.ogImage, path: page.path };
  const { collection: c, item: it } = item;
  const val = (f: CollectionField) => itemValue(ctx, f, it, f.id);
  const text = c.fields.slice(1).find((f) => f.type === "text" && typeof val(f) === "string" && val(f));
  const image = c.fields.find((f) => f.type === "image" && typeof it.values[f.id] === "string" && it.values[f.id]);
  const first = c.fields[0];
  return {
    title: first && typeof val(first) === "string" && val(first) ? String(val(first)) : itemTitle(c, it),
    description: text ? String(val(text)) : description,
    ogImage: image ? String(it.values[image.id]) : page.ogImage,
    path: itemPath(page.path, it.slug),
  };
}

/** Render one page to a complete HTML document. */
export function renderPage(doc: SiteDocument, page: Page, opts: RenderOptions): string {
  const item = pageItem(doc, page, opts.itemId, opts.mode !== "publish");
  const ctx: Ctx = { doc, opts, css: newCollector(), seen: new Set(), componentStack: [], item };
  const meta = pageMeta(page, item, ctx);
  ctx.routePath = meta.path;
  const body = renderNode(page.root, ctx);
  const withAnim = opts.mode !== "editor";
  const css = assembleCss(doc, ctx.css, withAnim);
  const lang = altLocale(ctx) ?? doc.settings.lang;
  const site = opts.siteUrl?.replace(/\/$/, "");
  const here = localePath(meta.path, lang, doc);
  const canonical = site ? `${site}${here}` : "";
  // Every language version of this page, so search engines link them.
  const alternates =
    site && (doc.settings.locales ?? []).length
      ? [...allLocales(doc).map((l) => `<link rel="alternate" hreflang="${escapeHtml(l)}" href="${escapeHtml(site + localePath(meta.path, l, doc))}">`), `<link rel="alternate" hreflang="x-default" href="${escapeHtml(site + meta.path)}">`].join("")
      : "";
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(meta.title)}</title>`,
    meta.description ? `<meta name="description" content="${escapeHtml(meta.description)}">` : "",
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    meta.description ? `<meta property="og:description" content="${escapeHtml(meta.description)}">` : "",
    meta.ogImage && isSafeSrc(meta.ogImage) ? `<meta property="og:image" content="${escapeHtml(meta.ogImage)}">` : "",
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:url" content="${escapeHtml(canonical)}">` : "",
    alternates,
    doc.settings.favicon && isSafeSrc(doc.settings.favicon) ? `<link rel="icon" href="${escapeHtml(doc.settings.favicon)}">` : "",
    opts.mode !== "publish" ? `<meta name="robots" content="noindex">` : "",
    `<meta name="generator" content="Sitecraft">`,
    fontLinks(doc),
    `<style>${css}</style>`,
    withAnim ? `<noscript><style>.sc-anim{opacity:1!important;transform:none!important}</style></noscript>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const turnstile = ctx.hasForm && opts.turnstileSiteKey && opts.mode !== "editor" ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";
  const script = opts.mode === "editor" ? "" : `<script>${RUNTIME_SCRIPT}</script>${turnstile}`;
  return `<!doctype html>\n<html lang="${escapeHtml(lang)}"${isRtl(lang) ? ' dir="rtl"' : ""}>\n<head>\n${head}\n</head>\n<body>\n${body}\n${script}${opts.bodyEnd ?? ""}\n</body>\n</html>\n`;
}

/** Render just the body markup and stylesheet (used for live editor updates). */
export function renderPageParts(doc: SiteDocument, page: Page, opts: RenderOptions): { body: string; css: string } {
  const item = pageItem(doc, page, opts.itemId, opts.mode !== "publish");
  const ctx: Ctx = { doc, opts, css: newCollector(), seen: new Set(), componentStack: [], item };
  ctx.routePath = pageMeta(page, item, ctx).path;
  const body = renderNode(page.root, ctx);
  return { body, css: assembleCss(doc, ctx.css, opts.mode !== "editor") };
}
