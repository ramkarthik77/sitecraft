import { walk } from "./tree.js";
import type { BrandRef, ComponentDef, SiteDocument, SiteNode, Style, Theme } from "./types.js";

/**
 * Brand kits: a theme, shared components (header, footer), a logo and
 * written guidelines, kept once and applied to many sites. Applying a brand
 * copies it into the site document, so rendering, history and branches work
 * as for any other change. Locked brands also stop sites drifting off-brand.
 */

export interface BrandKit {
  id: string;
  name: string;
  version: number;
  locked: boolean;
  theme: Theme;
  logo?: string;
  guidelines?: string;
  components: ComponentDef[];
}

/** Copy a brand into a site: theme, brand info and brand-managed components. */
export function applyBrand(doc: SiteDocument, kit: BrandKit): SiteDocument {
  const next: SiteDocument = structuredClone(doc);
  next.theme = structuredClone(kit.theme);
  const ref: BrandRef = { id: kit.id, name: kit.name, version: kit.version, locked: kit.locked };
  if (kit.logo) ref.logo = kit.logo;
  if (kit.guidelines) ref.guidelines = kit.guidelines;
  next.brand = ref;
  const kitIds = new Set(kit.components.map((c) => c.id));
  // Components from another (or an older) brand that this one doesn't have become the site's own.
  next.components = next.components.map((c) => (c.brandId && !kitIds.has(c.id) ? withoutBrand(c) : c));
  for (const kc of kit.components) {
    const copy: ComponentDef = { ...structuredClone(kc), brandId: kit.id };
    const at = next.components.findIndex((c) => c.id === kc.id);
    if (at >= 0) next.components[at] = copy;
    else next.components.push(copy);
  }
  return next;
}

/** Stop following a brand: the site keeps its current look as its own. */
export function detachBrand(doc: SiteDocument): SiteDocument {
  const next: SiteDocument = structuredClone(doc);
  delete next.brand;
  next.components = next.components.map(withoutBrand);
  return next;
}

function withoutBrand(c: ComponentDef): ComponentDef {
  const { brandId, ...rest } = c;
  void brandId;
  return rest;
}

const COLOR_KEYS = new Set(["color", "background", "backgroundColor", "backgroundImage", "border", "borderTop", "borderBottom", "boxShadow"]);
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const FONT_OK = /^(var\(--font-(heading|body)\)|inherit|initial|unset)$/i;

function norm(c: string) {
  return c.toLowerCase().replace(/\s+/g, "");
}

function palette(theme: Theme): Set<string> {
  return new Set(Object.values(theme.colors).map((v) => norm(String(v))));
}

function stylesOf(n: SiteNode): Style[] {
  return [n.style.base, n.style.tablet, n.style.mobile, n.hover?.style].filter(Boolean) as Style[];
}

/** Colors and fonts in one element that aren't the brand's. */
function offBrand(n: SiteNode, theme: Theme): string[] {
  const allowed = palette(theme);
  const fonts = new Set([theme.fonts.heading, theme.fonts.body].map(norm));
  const out: string[] = [];
  for (const st of stylesOf(n)) {
    for (const [k, raw] of Object.entries(st)) {
      const v = String(raw);
      if (COLOR_KEYS.has(k)) {
        for (const lit of v.match(COLOR_LITERAL) ?? []) if (!allowed.has(norm(lit))) out.push(`uses the color ${lit}`);
      }
      if (k === "fontFamily" && !FONT_OK.test(v.trim()) && !fonts.has(norm(v))) out.push(`uses the font ${v}`);
    }
  }
  return [...new Set(out)];
}

function label(n: SiteNode): string {
  const text = typeof n.props.text === "string" ? n.props.text : typeof n.props.label === "string" ? n.props.label : "";
  return n.name ? `"${n.name}"` : text ? `${n.type} "${text.slice(0, 40)}"` : `a ${n.type}`;
}

function indexNodes(doc: SiteDocument): Map<string, SiteNode> {
  const m = new Map<string, SiteNode>();
  for (const p of doc.pages) walk(p.root, (n) => m.set(n.id, n));
  for (const c of doc.components) walk(c.root, (n) => m.set(n.id, n));
  return m;
}

/** JSON with sorted keys: stored documents and edited ones may list keys in different orders. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const styleSig = (n: SiteNode) => stable([n.style, n.hover ?? null]);

/**
 * Off-brand colors and fonts, as review warnings. With `onlyIds`, just those
 * elements (what a branch added or changed).
 */
export function brandIssues(doc: SiteDocument, onlyIds?: Iterable<string>): string[] {
  if (!doc.brand) return [];
  const nodes = indexNodes(doc);
  const ids = onlyIds ? [...onlyIds] : [...nodes.keys()];
  const out: string[] = [];
  for (const id of ids) {
    const n = nodes.get(id);
    if (!n) continue;
    for (const why of offBrand(n, doc.theme)) out.push(`${label(n)} ${why}, which isn't a ${doc.brand.name} brand ${why.includes("font") ? "font" : "color"}`);
  }
  return out;
}

/**
 * Why an edit breaks a locked brand, or an empty list. Edits from people and
 * Claude go through this; applying or detaching a brand is done by the API
 * itself (applyBrand, detachBrand) and never passes through here.
 */
export function brandViolations(prev: SiteDocument, next: SiteDocument): string[] {
  const b = prev.brand;
  if (!b?.locked) return [];
  const out: string[] = [];
  if (stable(prev.theme) !== stable(next.theme)) out.push(`Colors, fonts and corner radius come from the ${b.name} brand, which is locked.`);
  if (stable(prev.brand) !== stable(next.brand)) out.push(`The ${b.name} brand settings can only be changed in Brands.`);
  const before = new Map(prev.components.filter((c) => c.brandId).map((c) => [c.id, stable(c)]));
  for (const c of next.components) {
    const was = before.get(c.id);
    if (was !== undefined && was !== stable(c)) out.push(`${c.name} comes from the ${b.name} brand. Edit it in Brands to change it everywhere.`);
    before.delete(c.id);
  }
  for (const id of before.keys()) out.push(`A ${b.name} brand component can't be removed from the site.`);
  // New or restyled elements must stay on brand.
  const old = indexNodes(prev);
  for (const [id, n] of indexNodes(next)) {
    const o = old.get(id);
    if (o && styleSig(o) === styleSig(n)) continue;
    for (const why of offBrand(n, next.theme)) out.push(`${label(n)} ${why}. The ${b.name} brand is locked to its own colors and fonts.`);
  }
  return [...new Set(out)];
}
