import {
  BREAKPOINT_MAX_WIDTH,
  isSafeCssValue,
  STYLE_PROPERTIES,
  type Animation,
  type SiteDocument,
  type SiteNode,
  type Style,
} from "@sitecraft/schema";

const ALLOWED = new Set<string>(STYLE_PROPERTIES);
const UNITLESS = new Set(["fontWeight", "lineHeight", "opacity", "zIndex"]);

export function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

export function styleToCss(style: Style | undefined): string {
  if (!style) return "";
  const out: string[] = [];
  for (const [k, raw] of Object.entries(style)) {
    if (!ALLOWED.has(k) || raw === undefined || raw === null) continue;
    if (!isSafeCssValue(raw as string | number)) continue;
    const v = typeof raw === "number" && !UNITLESS.has(k) ? `${raw}px` : String(raw);
    out.push(`${kebab(k)}:${v}`);
  }
  return out.join(";");
}

export function nodeClass(id: string): string {
  return `n-${id}`;
}

export interface CssCollector {
  base: string[];
  tablet: string[];
  mobile: string[];
  hover: string[];
}

export function newCollector(): CssCollector {
  return { base: [], tablet: [], mobile: [], hover: [] };
}

export function collectNodeCss(n: SiteNode, c: CssCollector, seen: Set<string>): void {
  const key = n.id;
  if (seen.has(key)) return;
  seen.add(key);
  const sel = `.${nodeClass(n.id)}`;
  const base = styleToCss(n.style.base);
  if (base) c.base.push(`${sel}{${base}}`);
  const tablet = styleToCss(n.style.tablet);
  if (tablet) c.tablet.push(`${sel}{${tablet}}`);
  const mobile = styleToCss(n.style.mobile);
  if (mobile) c.mobile.push(`${sel}{${mobile}}`);
  if (n.hidden?.base) c.base.push(`${sel}{display:none!important}`);
  if (n.hidden?.tablet) c.tablet.push(`${sel}{display:none!important}`);
  if (n.hidden?.mobile) c.mobile.push(`${sel}{display:none!important}`);
  const hover = styleToCss(n.hover?.style);
  if (hover) c.hover.push(`${sel}:hover{${hover}}`);
}

export function themeCss(doc: SiteDocument): string {
  const vars: string[] = [];
  for (const [name, value] of Object.entries(doc.theme.colors)) {
    if (/^[a-z0-9-]+$/.test(name) && isSafeCssValue(value)) vars.push(`--color-${name}:${value}`);
  }
  if (isSafeCssValue(doc.theme.fonts.heading)) vars.push(`--font-heading:${doc.theme.fonts.heading}`);
  if (isSafeCssValue(doc.theme.fonts.body)) vars.push(`--font-body:${doc.theme.fonts.body}`);
  if (isSafeCssValue(doc.theme.radius)) vars.push(`--radius:${doc.theme.radius}`);
  return `:root{${vars.join(";")}}`;
}

export const RESET_CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%}",
  "body{margin:0;font-family:var(--font-body);color:var(--color-text);background:var(--color-background);line-height:1.5;-webkit-font-smoothing:antialiased}",
  "img{max-width:100%;display:block}",
  "a{color:inherit}",
  "h1,h2,h3,h4,h5,h6,p{overflow-wrap:break-word}",
  ".sc-field{display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--color-muted)}",
  ".sc-field input,.sc-field textarea{font:inherit;font-size:16px;padding:12px 14px;border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-background);color:var(--color-text)}",
  ".sc-field textarea{min-height:120px;resize:vertical}",
  ".sc-form-status{font-size:15px;color:var(--color-text)}",
  ".sc-lang{display:flex;gap:10px;flex-wrap:wrap;font-size:14px}.sc-lang a{color:var(--color-muted);text-decoration:none}.sc-lang a[aria-current]{color:var(--color-text);font-weight:600}",
  ".sc-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}",
  "button.sc-btn{font:inherit;cursor:pointer}",
  "a.sc-btn:hover,button.sc-btn:hover{opacity:.92}",
  ".sc-embed{width:100%;border:0;aspect-ratio:16/9}",
  ".sc-empty{grid-column:1/-1;margin:0;color:var(--color-muted)}",
  ".sc-img-empty{min-height:120px;background:repeating-linear-gradient(45deg,var(--color-surface),var(--color-surface) 8px,var(--color-border) 8px,var(--color-border) 9px)}",
  ".sc-rich>*{margin:0 0 1em}.sc-rich>*:last-child{margin-bottom:0}",
  ".sc-rich h2,.sc-rich h3,.sc-rich h4{font-family:var(--font-heading);line-height:1.25;margin-top:1.6em}",
  ".sc-rich h2{font-size:1.6em}.sc-rich h3{font-size:1.3em}.sc-rich h4{font-size:1.1em}",
  ".sc-rich ul,.sc-rich ol{padding-left:1.4em}.sc-rich li{margin:.3em 0}",
  ".sc-rich a{color:var(--color-primary)}.sc-rich img{border-radius:var(--radius);height:auto}",
  ".sc-rich blockquote{margin-left:0;padding-left:1em;border-left:3px solid var(--color-border);color:var(--color-muted)}",
  ".sc-rich pre{background:var(--color-surface);padding:16px;border-radius:var(--radius);overflow:auto;font-size:.9em}",
  ".sc-rich code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}",
  ".sc-rich hr{border:0;border-top:1px solid var(--color-border)}",
].join("");

export const ANIMATION_CSS = [
  "@media (prefers-reduced-motion:no-preference){",
  ".sc-anim{opacity:0;transition-property:opacity,transform;transition-timing-function:cubic-bezier(.2,.7,.2,1)}",
  ".sc-anim.sc-slide-up{transform:translateY(24px)}",
  ".sc-anim.sc-slide-left{transform:translateX(32px)}",
  ".sc-anim.sc-scale-in{transform:scale(.96)}",
  ".sc-anim.sc-in{opacity:1;transform:none}",
  "}",
].join("");

export function animationAttrs(a: Animation | undefined): { classes: string[]; style: string; attrs: string } {
  if (!a || a.preset === "none") return { classes: [], style: "", attrs: "" };
  const classes = ["sc-anim", `sc-${a.preset}`];
  const style = `transition-duration:${a.durationMs ?? 600}ms;transition-delay:${a.delayMs ?? 0}ms`;
  return { classes, style, attrs: ` data-sc-trigger="${a.trigger}"` };
}

export function assembleCss(doc: SiteDocument, c: CssCollector, withAnimations: boolean): string {
  const parts = [themeCss(doc), RESET_CSS];
  if (withAnimations) parts.push(ANIMATION_CSS);
  parts.push(c.base.join(""));
  if (c.hover.length) parts.push(`@media (hover:hover){${c.hover.join("")}}`);
  if (c.tablet.length) parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH.tablet}px){${c.tablet.join("")}}`);
  if (c.mobile.length) parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH.mobile}px){${c.mobile.join("")}}`);
  return parts.join("\n");
}
