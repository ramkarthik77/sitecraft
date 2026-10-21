import { buildBlock } from "./blocks.js";
import { newId } from "./ids.js";
import type { SiteDocument, Theme } from "./types.js";

export const DEFAULT_THEME: Theme = {
  colors: {
    primary: "#4f46e5",
    "on-primary": "#ffffff",
    background: "#ffffff",
    surface: "#f7f7fb",
    text: "#0f172a",
    muted: "#475569",
    border: "#e2e8f0",
  },
  fonts: {
    heading: "'Inter', system-ui, sans-serif",
    body: "'Inter', system-ui, sans-serif",
  },
  radius: "12px",
};

export const TEMPLATES = ["blank", "landing", "saas"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

const TEMPLATE_BLOCKS: Record<TemplateName, string[]> = {
  blank: [],
  landing: ["navbar", "hero", "features", "cta", "footer"],
  saas: ["navbar", "hero", "logos", "features", "testimonial", "pricing", "faq", "cta", "footer"],
};

/** A new site document from a template. */
export function createStarterDocument(opts: { name?: string; template?: TemplateName } = {}): SiteDocument {
  const template = opts.template ?? "landing";
  const brand = opts.name ?? "Acme";
  const content = { brand, note: `© ${new Date().getFullYear()} ${brand}. All rights reserved.` };
  return {
    schemaVersion: 1,
    theme: structuredClone(DEFAULT_THEME),
    components: [],
    settings: { lang: "en" },
    pages: [
      {
        id: newId("p"),
        path: "/",
        title: brand,
        description: `${brand} — built with Sitecraft.`,
        root: {
          id: newId(),
          type: "stack",
          name: "Page",
          props: {},
          style: { base: { display: "flex", flexDirection: "column", minHeight: "100vh" } },
          children: TEMPLATE_BLOCKS[template].map((b) => buildBlock(b, content)),
        },
      },
    ],
  };
}
