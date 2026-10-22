import { walk } from "./tree.js";
import type { SiteDocument, SiteNode } from "./types.js";

/**
 * Languages. One site, one design; only the words change per language.
 * Translations live next to what they translate:
 *   node.props.i18n[locale]   = { text: "Bonjour", "~text": "Hello" }
 *   page.i18n[locale]         = { title, description, "~title", ... }
 *   item.i18n[locale]         = { title: "…", "~title": "…" }   (fields marked localized)
 * The "~" copy is the main-language text the translation was made from, so
 * a translation shows as out of date when the original changes.
 */

export const LOCALE = /^[a-z]{2,3}(-[A-Z]{2}|-[A-Za-z]{4})?$/;

/** Props each element type translates. */
export const TRANSLATABLE: Record<string, string[]> = {
  heading: ["text"],
  text: ["text"],
  button: ["label"],
  image: ["alt"],
  richtext: ["markdown"],
  input: ["label", "placeholder"],
  form: ["successMessage"],
};

export const PAGE_TRANSLATABLE = ["title", "description"] as const;

export type Translations = Record<string, Record<string, string>>;

/** Common languages for pickers; any valid code works. */
export const LANGUAGES: Record<string, string> = {
  en: "English",
  "en-GB": "English (UK)",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  "pt-BR": "Portuguese (Brazil)",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  nb: "Norwegian",
  fi: "Finnish",
  pl: "Polish",
  cs: "Czech",
  tr: "Turkish",
  el: "Greek",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  "zh-TW": "Chinese (Traditional)",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
};

/** Right-to-left languages get dir="rtl". */
export const RTL = new Set(["ar", "he", "fa", "ur"]);
export const isRtl = (locale: string) => RTL.has(locale.split("-")[0]!);

export const languageName = (code: string) => LANGUAGES[code] ?? code;

export function localesOf(doc: SiteDocument): string[] {
  return doc.settings.locales ?? [];
}

/** All languages, main one first. */
export function allLocales(doc: SiteDocument): string[] {
  return [doc.settings.lang, ...localesOf(doc)];
}

/** "/about" in French is "/fr/about"; the main language has no prefix. */
export function localePath(path: string, locale: string | undefined, doc: SiteDocument): string {
  if (!locale || locale === doc.settings.lang) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Split "/fr/about" into the locale and "/about". */
export function splitLocale(doc: SiteDocument, path: string): { locale: string; path: string } {
  const m = /^\/([a-z]{2,3}(?:-[A-Za-z]{2,4})?)(\/.*)?$/.exec(path);
  if (m && localesOf(doc).includes(m[1]!)) return { locale: m[1]!, path: m[2] && m[2] !== "/" ? m[2].replace(/\/+$/, "") : "/" };
  return { locale: doc.settings.lang, path };
}

/** The value of a translated prop for a locale, falling back to the original. */
export function translated(source: Record<string, unknown>, i18n: unknown, locale: string | undefined, prop: string): unknown {
  if (!locale || !i18n || typeof i18n !== "object") return source[prop];
  const t = (i18n as Translations)[locale]?.[prop];
  return typeof t === "string" && t !== "" ? t : source[prop];
}

export interface TranslationEntry {
  kind: "node" | "page" | "item";
  /** Node id, page id, or "collectionId/itemId". */
  id: string;
  prop: string;
  /** Where it is, for people: "Home › Hero › heading", "Blog › Welcome". */
  where: string;
  source: string;
  translation?: string;
  state: "missing" | "stale" | "done";
}

function bound(n: SiteNode, prop: string): boolean {
  const b = n.props.bind as Record<string, string> | undefined;
  return !!b && prop in b;
}

/** Everything that can be translated into a locale, and how far along it is. */
export function translationStatus(doc: SiteDocument, locale: string): TranslationEntry[] {
  const out: TranslationEntry[] = [];
  const state = (source: string, t: Record<string, string> | undefined, prop: string): TranslationEntry["state"] => {
    const v = t?.[prop];
    if (!v) return "missing";
    return t?.[`~${prop}`] !== undefined && t[`~${prop}`] !== source ? "stale" : "done";
  };
  const visitTree = (root: SiteNode, area: string) =>
    walk(root, (n) => {
      for (const prop of TRANSLATABLE[n.type] ?? []) {
        const source = n.props[prop];
        if (typeof source !== "string" || !source.trim() || bound(n, prop)) continue;
        const t = (n.props.i18n as Translations | undefined)?.[locale];
        out.push({ kind: "node", id: n.id, prop, where: `${area} › ${n.name ?? n.type}`, source, translation: t?.[prop], state: state(source, t, prop) });
      }
    });
  for (const p of doc.pages) {
    const area = p.path === "/" ? "Home" : p.path;
    for (const prop of PAGE_TRANSLATABLE) {
      const source = p[prop];
      if (typeof source !== "string" || !source.trim() || p.collectionId) continue;
      const t = p.i18n?.[locale];
      out.push({ kind: "page", id: p.id, prop, where: `${area} › page ${prop}`, source, translation: t?.[prop], state: state(source, t, prop) });
    }
    visitTree(p.root, area);
  }
  for (const c of doc.components) visitTree(c.root, `Component ${c.name}`);
  for (const c of doc.collections ?? []) {
    const fields = c.fields.filter((f) => f.localized && (f.type === "text" || f.type === "richtext"));
    for (const item of c.items) {
      for (const f of fields) {
        const source = item.values[f.id];
        if (typeof source !== "string" || !source.trim()) continue;
        const t = item.i18n?.[locale];
        out.push({ kind: "item", id: `${c.id}/${item.id}`, prop: f.id, where: `${c.name} › ${item.slug} › ${f.name}`, source, translation: t?.[f.id], state: state(source, t, f.id) });
      }
    }
  }
  return out;
}

/** Remove every translation for a locale (when the language is removed). */
export function stripLocale(doc: SiteDocument, locale: string) {
  const strip = (o: { i18n?: Translations } | Record<string, unknown>) => {
    const i = (o as { i18n?: Translations }).i18n;
    if (i && locale in i) {
      delete i[locale];
      if (!Object.keys(i).length) delete (o as { i18n?: Translations }).i18n;
    }
  };
  for (const p of doc.pages) {
    strip(p);
    walk(p.root, (n) => strip(n.props));
  }
  for (const c of doc.components) walk(c.root, (n) => strip(n.props));
  for (const c of doc.collections ?? []) for (const item of c.items) strip(item);
}
