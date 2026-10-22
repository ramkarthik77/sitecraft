/**
 * The site document model. Everything (editor, API, renderer, MCP server)
 * reads and writes this one structure, so people and agents edit the same thing.
 */

export const NODE_TYPES = [
  "section",
  "stack",
  "grid",
  "heading",
  "text",
  "image",
  "button",
  "link",
  "divider",
  "spacer",
  "form",
  "input",
  "embed",
  "instance",
  "richtext",
  "collection-list",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Node types that may contain children. */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "section",
  "stack",
  "grid",
  "form",
  "link",
  "collection-list",
]);

export const BREAKPOINTS = ["base", "tablet", "mobile"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Max widths (px) at which each non-base breakpoint applies. */
export const BREAKPOINT_MAX_WIDTH: Record<Exclude<Breakpoint, "base">, number> = {
  tablet: 1023,
  mobile: 767,
};

/** Canvas widths the editor previews each breakpoint at. */
export const BREAKPOINT_CANVAS_WIDTH: Record<Breakpoint, number> = {
  base: 1200,
  tablet: 810,
  mobile: 390,
};

/** CSS properties a node may set (camelCase). Anything else is rejected. */
export const STYLE_PROPERTIES = [
  "display",
  "flexDirection",
  "flexWrap",
  "alignItems",
  "justifyContent",
  "gap",
  "gridTemplateColumns",
  "gridColumn",
  "width",
  "maxWidth",
  "minWidth",
  "height",
  "minHeight",
  "maxHeight",
  "margin",
  "marginTop",
  "marginBottom",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "zIndex",
  "overflow",
  "background",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecoration",
  "border",
  "borderTop",
  "borderBottom",
  "borderRadius",
  "boxShadow",
  "opacity",
  "objectFit",
  "aspectRatio",
  "cursor",
  "transition",
  "transform",
] as const;

export type StyleProperty = (typeof STYLE_PROPERTIES)[number];
export type Style = Partial<Record<StyleProperty, string | number>>;
export type StyleSet = Partial<Record<Breakpoint, Style>>;

export const ANIMATION_PRESETS = ["none", "fade-in", "slide-up", "slide-left", "scale-in"] as const;
export type AnimationPreset = (typeof ANIMATION_PRESETS)[number];

export interface Animation {
  preset: AnimationPreset;
  /** "load" plays on page load, "scroll" when the node scrolls into view. */
  trigger: "load" | "scroll";
  durationMs?: number;
  delayMs?: number;
}

export interface HoverEffect {
  /** Style applied while hovering (desktop pointer devices). */
  style: Style;
}

export interface SiteNode {
  id: string;
  type: NodeType;
  /** Optional layer name shown in the editor. */
  name?: string;
  /** Type-specific content: text, src, href, label, etc. */
  props: Record<string, unknown>;
  style: StyleSet;
  animation?: Animation;
  hover?: HoverEffect;
  /** Hide this node at specific breakpoints. */
  hidden?: Partial<Record<Breakpoint, boolean>>;
  children?: SiteNode[];
}

export interface Page {
  id: string;
  /**
   * URL path, e.g. "/" or "/pricing". A collection's template page ends in
   * "/:slug" (e.g. "/blog/:slug") and publishes once per item.
   */
  path: string;
  /** Set on a template page: the collection whose items it renders. */
  collectionId?: string;
  title: string;
  /** SEO meta description. */
  description?: string;
  /** Social share image URL. */
  ogImage?: string;
  root: SiteNode;
}

export interface Theme {
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
  radius: string;
}

export interface ComponentDef {
  id: string;
  name: string;
  root: SiteNode;
}

/** Kinds of content a collection field holds. */
export const FIELD_TYPES = ["text", "richtext", "image", "date", "link", "number", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface CollectionField {
  /** Key used in item values and bindings, e.g. "cover_image". */
  id: string;
  /** Label shown in the editor, e.g. "Cover image". */
  name: string;
  type: FieldType;
}

export type FieldValue = string | number | boolean;

export interface CollectionItem {
  id: string;
  /** URL segment for the item's page, unique within the collection. */
  slug: string;
  /** Drafts show in the editor and previews but are left out when publishing. */
  draft?: boolean;
  values: Record<string, FieldValue>;
}

/**
 * Structured content (blog posts, products, team members). Items render
 * through a template page ("/blog/:slug") and collection-list nodes, whose
 * elements bind props to fields with props.bind, e.g. { text: "title" }.
 */
export interface Collection {
  id: string;
  name: string;
  /** Used in default page paths, e.g. "blog". */
  slug: string;
  /** The first field is the title and must be text. */
  fields: CollectionField[];
  items: CollectionItem[];
}

/** Binding sources every item has besides its fields. */
export const ITEM_BUILTINS = ["slug", "url"] as const;

export interface SiteDocument {
  schemaVersion: 1;
  theme: Theme;
  /** Reusable components; place them with "instance" nodes. */
  components: ComponentDef[];
  /** CMS collections. Missing in sites made before collections existed. */
  collections?: Collection[];
  pages: Page[];
  settings: {
    /** Language code for <html lang>. */
    lang: string;
    favicon?: string;
  };
}
