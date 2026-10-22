import {
  BREAKPOINT_MAX_WIDTH,
  isSafeCssValue,
  STYLE_PROPERTIES,
  type Animation,
  type HoverEffect,
  type ScrollEffect,
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

/** Where each entrance effect starts; every one ends at its natural place. */
const FROM: Record<string, string> = {
  "fade-in": "",
  "slide-up": "transform:translateY(24px)",
  "slide-down": "transform:translateY(-24px)",
  "slide-left": "transform:translateX(32px)",
  "slide-right": "transform:translateX(-32px)",
  "scale-in": "transform:scale(.96)",
  "zoom-out": "transform:scale(1.08)",
  "blur-in": "filter:blur(12px);transform:scale(1.02)",
  "flip-up": "transform:perspective(900px) rotateX(22deg) translateY(18px);transform-origin:50% 100%",
  rise: "transform:translateY(64px) scale(.94)",
};

export const EASING_CSS: Record<string, string> = {
  smooth: "cubic-bezier(.2,.7,.2,1)",
  spring: "cubic-bezier(.34,1.56,.64,1)",
  "ease-out": "ease-out",
  linear: "linear",
};

/** How many children a stagger numbers; later ones share the last delay. */
const STAGGER_MAX = 24;

export const ANIMATION_CSS = [
  "@media (prefers-reduced-motion:no-preference){",
  ".sc-anim,.sc-stagger>:not(.sc-anim){transition-property:opacity,transform,filter;transition-timing-function:var(--sc-ease,cubic-bezier(.2,.7,.2,1));transition-duration:var(--sc-dur,600ms);transition-delay:var(--sc-delay,0ms)}",
  ".sc-anim:not(.sc-in),.sc-stagger:not(.sc-in)>:not(.sc-anim){opacity:0}",
  ...Object.entries(FROM)
    .filter(([, v]) => v)
    .map(([k, v]) => `.sc-anim.sc-${k}:not(.sc-in),.sc-stagger.sc-${k}:not(.sc-in)>:not(.sc-anim){${v}}`),
  ".sc-stagger>:not(.sc-anim){transition-delay:calc(var(--sc-delay,0ms) + var(--sc-step,0ms) * var(--sc-i,0))}",
  ...Array.from({ length: STAGGER_MAX - 1 }, (_, i) => `.sc-stagger>:nth-child(${i + 2}){--sc-i:${i + 1}}`),
  `.sc-stagger>:nth-child(n+${STAGGER_MAX + 1}){--sc-i:${STAGGER_MAX}}`,
  "}",
].join("");

/** Where each scroll-linked effect starts; the element ends in its natural place. */
const SCROLL_FROM: Record<string, string> = {
  fade: "opacity:0",
  rise: "opacity:0;transform:translateY(80px)",
  scale: "opacity:0;transform:scale(.86)",
  reveal: "clip-path:inset(0 0 100% 0);transform:translateY(24px)",
  "slide-left": "opacity:0;transform:translateX(120px)",
  "slide-right": "opacity:0;transform:translateX(-120px)",
  blur: "opacity:0;filter:blur(16px)",
  zoom: "transform:scale(1.18)",
};
const SCROLL_TO: Record<string, string> = {
  fade: "opacity:1",
  rise: "opacity:1;transform:none",
  scale: "opacity:1;transform:none",
  reveal: "clip-path:inset(0 0 0 0);transform:none",
  "slide-left": "opacity:1;transform:none",
  "slide-right": "opacity:1;transform:none",
  blur: "opacity:1;filter:blur(0)",
  zoom: "transform:none",
};

/**
 * Scroll-linked effects. Browsers with scroll timelines (Chrome, Edge,
 * Safari 26+) drive them natively; elsewhere the site script sets --sc-p
 * (0 to 1) and a paused animation is scrubbed with a negative delay.
 */
export const SCROLL_CSS = [
  "@media (prefers-reduced-motion:no-preference){",
  ...Object.keys(SCROLL_FROM).flatMap((k) => [
    `@keyframes sc-s-${k}{from{${SCROLL_FROM[k]}}to{${SCROLL_TO[k]}}}`,
    `@keyframes sc-s-${k}-b{0%{${SCROLL_FROM[k]}}35%,65%{${SCROLL_TO[k]}}100%{${SCROLL_FROM[k]}}}`,
    `.sc-scrub.sc-s-${k}{animation-name:sc-s-${k}}.sc-scrub.sc-s-${k}[data-sc-scrub=both]{animation-name:sc-s-${k}-b}`,
  ]),
  ".sc-scrub{animation-duration:1s;animation-timing-function:linear;animation-fill-mode:both;animation-play-state:paused;animation-delay:calc(var(--sc-p,0) * -1s);will-change:transform,opacity}",
  ".sc-scrub[data-sc-scrub=out]{animation-direction:reverse}",
  "@supports (animation-timeline:view()){",
  ".sc-scrub{animation-timeline:view();animation-duration:auto;animation-delay:0s;animation-play-state:running;animation-range:entry 0% cover 45%}",
  ".sc-scrub[data-sc-scrub=out]{animation-range:cover 55% cover 100%}",
  ".sc-scrub[data-sc-scrub=both]{animation-range:cover 0% cover 100%}",
  "}",
  "}",
  // Reading progress: native scroll timeline where available, else --sc-p from the script.
  "@keyframes sc-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}",
  "@supports (animation-timeline:scroll()){.sc-progress{animation:sc-progress linear both;animation-timeline:scroll(root)}}",
].join("");

/** Layout of scroll stories and the progress bar; used on the canvas too. */
export const STORY_CSS = [
  ".sc-story{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:clamp(32px,6vw,96px)}",
  // Room below the last step keeps its visual pinned while it's read.
  ".sc-story-steps{display:flex;flex-direction:column;padding-bottom:20vh}",
  ".sc-story-steps>*{min-height:85vh;justify-content:center}",
  ".sc-story-stage{position:relative}",
  ".sc-story-sticky{position:sticky;top:0;height:100vh;display:flex;align-items:center}",
  ".sc-story-sticky>*{width:100%}",
  ".sc-story[data-side=left] .sc-story-stage{order:-1}",
  // With the script running, visuals stack in one place and swap as steps change.
  ".sc-live .sc-story-sticky>*{display:grid}",
  ".sc-live .sc-story-sticky>*>*{grid-area:1/1;opacity:0;transform:translateY(24px) scale(.98)}",
  ".sc-live .sc-story-sticky>*>.sc-on{opacity:1;transform:none}",
  ".sc-live .sc-story-steps>*{opacity:.28}",
  ".sc-live .sc-story-steps>.sc-on{opacity:1}",
  "@media (prefers-reduced-motion:no-preference){.sc-live .sc-story-sticky>*>*{transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}.sc-live .sc-story-steps>*{transition:opacity .5s}}",
  `@media (max-width:${767}px){`,
  ".sc-story{grid-template-columns:minmax(0,1fr)}",
  ".sc-story-stage{order:-1;position:sticky;top:0;z-index:1;height:50vh;padding:12px 0;background:var(--color-background)}",
  ".sc-story-sticky{position:static;height:100%}",
  // The visual pins to the top half; each step's words sit in the bottom half.
  ".sc-story-steps>*{min-height:78vh;justify-content:flex-end;padding-bottom:6vh}",
  "}",
  // On the canvas: everything in normal flow, so nothing depends on the viewport height.
  ".sc-story-edit .sc-story-sticky,.sc-story-edit .sc-story-stage{position:static;height:auto}",
  ".sc-story-edit .sc-story-sticky>*{display:flex;flex-direction:column;gap:24px}",
  ".sc-story-edit .sc-story-steps{padding-bottom:0}.sc-story-edit .sc-story-steps>*{min-height:0;padding:64px 0}",
  ".sc-progress{position:fixed;top:0;left:0;right:0;height:3px;background:var(--color-primary);transform-origin:0 50%;transform:scaleX(var(--sc-p,0));z-index:100;pointer-events:none}",
  ".sc-progress-edit{position:static;transform:scaleX(.35)}",
].join("");

/** Ready-made hover effects. Movement only for people who haven't asked for less motion. */
export const HOVER_CSS = [
  ".sc-h{transition:transform .28s cubic-bezier(.2,.7,.2,1),box-shadow .28s,opacity .2s,filter .28s}",
  "@media (hover:hover){",
  ".sc-h-glow:hover{box-shadow:0 0 0 1px var(--color-primary),0 10px 36px -6px var(--color-primary)}",
  ".sc-h-dim:hover{opacity:.72}",
  "}",
  "@media (hover:hover) and (prefers-reduced-motion:no-preference){",
  ".sc-h-lift:hover{transform:translateY(-6px);box-shadow:0 18px 40px -12px rgba(0,0,0,.28)}",
  ".sc-h-grow:hover{transform:scale(1.04)}",
  ".sc-h-tilt{transform:perspective(900px) rotateX(var(--sc-rx,0deg)) rotateY(var(--sc-ry,0deg));transition:transform .18s ease-out,box-shadow .28s;will-change:transform}",
  ".sc-h-tilt:hover{box-shadow:0 24px 48px -16px rgba(0,0,0,.32)}",
  "}",
].join("");

export interface MotionAttrs {
  classes: string[];
  style: string;
  attrs: string;
}

/** Classes, CSS variables and runtime hooks for an element's motion. */
export function motionAttrs(n: { animation?: Animation; hover?: HoverEffect; parallax?: number; scroll?: ScrollEffect }, withEntrance: boolean): MotionAttrs {
  const classes: string[] = [];
  const vars: string[] = [];
  let attrs = "";
  const a = n.animation;
  if (withEntrance && a && a.preset !== "none") {
    classes.push(a.staggerMs ? "sc-stagger" : "sc-anim", `sc-${a.preset}`);
    if ((a.durationMs ?? 600) !== 600) vars.push(`--sc-dur:${a.durationMs}ms`);
    if (a.delayMs) vars.push(`--sc-delay:${a.delayMs}ms`);
    if (a.staggerMs) vars.push(`--sc-step:${a.staggerMs}ms`);
    if (a.easing && a.easing !== "smooth") vars.push(`--sc-ease:${EASING_CSS[a.easing]}`);
    attrs += ` data-sc-trigger="${a.trigger === "load" ? "load" : "scroll"}"`;
  }
  if (withEntrance && n.scroll) {
    classes.push("sc-scrub", `sc-s-${n.scroll.effect}`);
    attrs += ` data-sc-scrub="${n.scroll.range === "out" ? "out" : n.scroll.range === "both" ? "both" : "in"}"`;
  }
  const h = n.hover?.preset;
  if (h) {
    classes.push("sc-h", `sc-h-${h}`);
    if (h === "tilt" && withEntrance) attrs += " data-sc-tilt";
  }
  if (withEntrance && n.parallax) attrs += ` data-sc-parallax="${n.parallax}"`;
  return { classes, style: vars.join(";"), attrs };
}

/** @deprecated use motionAttrs */
export function animationAttrs(a: Animation | undefined): MotionAttrs {
  return motionAttrs({ animation: a }, true);
}

export function assembleCss(doc: SiteDocument, c: CssCollector, withAnimations: boolean): string {
  const parts = [themeCss(doc), RESET_CSS];
  if (withAnimations) parts.push(ANIMATION_CSS, SCROLL_CSS);
  parts.push(STORY_CSS);
  parts.push(HOVER_CSS);
  parts.push(c.base.join(""));
  if (c.hover.length) parts.push(`@media (hover:hover){${c.hover.join("")}}`);
  if (c.tablet.length) parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH.tablet}px){${c.tablet.join("")}}`);
  if (c.mobile.length) parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH.mobile}px){${c.mobile.join("")}}`);
  return parts.join("\n");
}
