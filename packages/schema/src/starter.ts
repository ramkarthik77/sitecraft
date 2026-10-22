import { buildBlock } from "./blocks.js";
import { applyOperations } from "./ops.js";
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

export const TEMPLATES = ["blank", "landing", "saas", "blog"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

const TEMPLATE_BLOCKS: Record<TemplateName, string[]> = {
  blank: [],
  landing: ["navbar", "hero", "features", "cta", "footer"],
  saas: ["navbar", "hero", "logos", "features", "testimonial", "pricing", "faq", "cta", "footer"],
  blog: ["navbar", "hero", "footer"],
};

/** A new site document from a template. */
export function createStarterDocument(opts: { name?: string; template?: TemplateName } = {}): SiteDocument {
  const template = opts.template ?? "landing";
  const brand = opts.name ?? "Acme";
  const content: Record<string, unknown> = { brand, note: `© ${new Date().getFullYear()} ${brand}. All rights reserved.` };
  if (template === "blog") {
    Object.assign(content, { eyebrow: "The blog", headline: `Notes from ${brand}`, subheadline: "Stories, guides and updates from the team.", ctaLabel: "Read the latest", ctaHref: "/blog", secondaryLabel: "All posts", secondaryHref: "/blog", links: [{ label: "Blog", href: "/blog" }] });
    const doc = starter(brand, template, content);
    // A blog collection with its list and post pages, and the latest posts on the home page.
    const withBlog = applyOperations(doc, [{ op: "add_collection", name: "Blog", preset: "blog" }]);
    const home = withBlog.document.pages[0]!;
    return applyOperations(withBlog.document, [
      { op: "add_collection_list", parentId: home.root.id, index: 2, collectionId: withBlog.created[0]!, headline: "Latest posts", limit: 3 },
    ]).document;
  }
  return starter(brand, template, content);
}

function starter(brand: string, template: TemplateName, content: Record<string, unknown>): SiteDocument {
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
