import { z } from "zod";
import {
  ANIMATION_PRESETS,
  CONTAINER_TYPES,
  FIELD_TYPES,
  ITEM_BUILTINS,
  NODE_TYPES,
  STYLE_PROPERTIES,
  type CollectionField,
  type FieldValue,
  type SiteDocument,
  type SiteNode,
} from "./types.js";

const FORBIDDEN_CSS = /[;{}<>\\]|\/\*|expression\s*\(|@import|javascript:/i;

/** True when a CSS value is safe to emit into a stylesheet. */
export function isSafeCssValue(value: string | number): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value.length > 500) return false;
  if (FORBIDDEN_CSS.test(value)) return false;
  // url(...) only for http(s), root-relative paths or inline images.
  const urls = value.match(/url\(([^)]*)\)/gi) ?? [];
  for (const u of urls) {
    const inner = u.slice(4, -1).trim().replace(/^["']|["']$/g, "");
    if (!/^(https?:\/\/|\/|data:image\/)/i.test(inner)) return false;
  }
  return true;
}

/** True when a link target is safe to put in href. */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href.trim());
}

/** True when an image source is safe to put in src. */
export function isSafeSrc(src: string): boolean {
  return /^(https?:\/\/|\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i.test(src.trim());
}

const cssValue = z
  .union([z.string(), z.number()])
  .refine(isSafeCssValue, { message: "Unsafe or invalid CSS value" });

export const styleSchema = z
  .record(z.string(), cssValue)
  .superRefine((style, ctx) => {
    for (const key of Object.keys(style)) {
      if (!(STYLE_PROPERTIES as readonly string[]).includes(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown style property "${key}"` });
      }
    }
  });

export const styleSetSchema = z
  .object({
    base: styleSchema.optional(),
    tablet: styleSchema.optional(),
    mobile: styleSchema.optional(),
  })
  .strict();

const animationSchema = z
  .object({
    preset: z.enum(ANIMATION_PRESETS),
    trigger: z.enum(["load", "scroll"]),
    durationMs: z.number().int().min(0).max(10000).optional(),
    delayMs: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Invalid id");

export const nodeSchema: z.ZodType<SiteNode> = z.lazy(() =>
  z
    .object({
      id: idSchema,
      type: z.enum(NODE_TYPES),
      name: z.string().max(120).optional(),
      props: z.record(z.string(), z.unknown()),
      style: styleSetSchema,
      animation: animationSchema.optional(),
      hover: z.object({ style: styleSchema }).strict().optional(),
      hidden: z.object({ base: z.boolean().optional(), tablet: z.boolean().optional(), mobile: z.boolean().optional() }).strict().optional(),
      children: z.array(nodeSchema).optional(),
    })
    .strict()
    .superRefine((node, ctx) => {
      if (node.children && node.children.length > 0 && !CONTAINER_TYPES.has(node.type)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${node.type} node cannot have children` });
      }
      const p = node.props;
      const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
      if (str("href") !== undefined && !isSafeHref(str("href")!)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unsafe href on node ${node.id}` });
      }
      if (str("src") !== undefined && !isSafeSrc(str("src")!)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unsafe image src on node ${node.id}` });
      }
      if (node.type === "embed" && str("url") !== undefined && !/^https:\/\//i.test(str("url")!)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Embed url must use https on node ${node.id}` });
      }
      if (node.type === "instance" && typeof p.componentId !== "string") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Instance node ${node.id} needs props.componentId` });
      }
      if (p.bind !== undefined) {
        const ok =
          p.bind !== null &&
          typeof p.bind === "object" &&
          !Array.isArray(p.bind) &&
          Object.entries(p.bind as Record<string, unknown>).every(([k, v]) => BINDABLE_PROPS.includes(k) && typeof v === "string" && FIELD_KEY.test(v));
        if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid field binding on node ${node.id}` });
      }
      if (node.type === "richtext" && p.markdown !== undefined && (typeof p.markdown !== "string" || p.markdown.length > 200_000)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Rich text on node ${node.id} must be text` });
      }
      if (node.type === "collection-list") {
        if (typeof p.collectionId !== "string") ctx.addIssue({ code: z.ZodIssueCode.custom, message: `List node ${node.id} needs props.collectionId` });
        if (p.limit !== undefined && !(Number.isInteger(p.limit) && (p.limit as number) >= 1 && (p.limit as number) <= 500)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `List node ${node.id} limit must be 1 to 500` });
        }
      }
    }),
);

/** Props an element can take from a collection field. */
export const BINDABLE_PROPS = ["text", "src", "alt", "href", "label", "markdown"];
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const PAGE_PATH = /^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/;
const TEMPLATE_PATH = /^(\/[a-z0-9-]+)+\/:slug$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const pageSchema = z
  .object({
    id: idSchema,
    path: z.string(),
    collectionId: idSchema.optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    ogImage: z.string().refine(isSafeSrc, "Unsafe og image").optional(),
    root: nodeSchema,
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.collectionId) {
      if (!TEMPLATE_PATH.test(page.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A template page path must end in /:slug, like /blog/:slug" });
    } else if (!PAGE_PATH.test(page.path)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Page path must look like / or /about or /blog/post" });
    }
  });

/** Why a value doesn't fit a field, or null when it does. */
export function checkFieldValue(field: CollectionField, value: FieldValue): string | null {
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.length <= 5000 ? null : "must be text up to 5000 characters";
    case "richtext":
      return typeof value === "string" && value.length <= 200_000 ? null : "must be text";
    case "image":
      return typeof value === "string" && (value === "" || isSafeSrc(value)) ? null : "must be an image URL (https:// or /)";
    case "link":
      return typeof value === "string" && (value === "" || isSafeHref(value)) ? null : "must be a link (https://, /, mailto: or tel:)";
    case "date":
      return typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) ? null : "must be a date like 2026-10-22";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
  }
}

const fieldSchema = z
  .object({
    id: z.string().regex(FIELD_KEY, "Field keys are lowercase letters, numbers and underscores").refine((k) => !(ITEM_BUILTINS as readonly string[]).includes(k), "slug and url are reserved"),
    name: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
  })
  .strict();

const itemSchema = z
  .object({
    id: idSchema,
    slug: z.string().max(80).regex(SLUG, "Slugs are lowercase letters, numbers and dashes"),
    draft: z.boolean().optional(),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

export const collectionSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(80),
    slug: z.string().max(60).regex(SLUG, "Slugs are lowercase letters, numbers and dashes"),
    fields: z.array(fieldSchema).min(1).max(40),
    items: z.array(itemSchema).max(5000),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${c.name}: ${message}` });
    if (c.fields[0]?.type !== "text") issue("the first field is the title and must be text");
    const keys = new Set<string>();
    for (const f of c.fields) {
      if (keys.has(f.id)) issue(`two fields use the key ${f.id}`);
      keys.add(f.id);
    }
    const byKey = new Map(c.fields.map((f) => [f.id, f]));
    const slugs = new Set<string>();
    for (const item of c.items) {
      if (slugs.has(item.slug)) issue(`two items use the slug ${item.slug}`);
      slugs.add(item.slug);
      for (const [k, v] of Object.entries(item.values)) {
        const f = byKey.get(k);
        if (!f) issue(`item ${item.slug} has a value for unknown field ${k}`);
        else {
          const why = checkFieldValue(f, v);
          if (why) issue(`${f.name} on ${item.slug} ${why}`);
        }
      }
    }
  });

export const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    theme: z
      .object({
        colors: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), cssValue),
        fonts: z.object({ heading: cssValue, body: cssValue }).strict(),
        radius: cssValue,
      })
      .strict(),
    components: z.array(z.object({ id: idSchema, name: z.string().min(1).max(120), root: nodeSchema, brandId: idSchema.optional() }).strict()),
    brand: z
      .object({
        id: idSchema,
        name: z.string().min(1).max(80),
        version: z.number().int().min(1),
        locked: z.boolean(),
        logo: z.string().refine(isSafeSrc, "Unsafe logo").optional(),
        guidelines: z.string().max(20_000).optional(),
      })
      .strict()
      .optional(),
    collections: z.array(collectionSchema).max(50).optional(),
    pages: z.array(pageSchema).min(1),
    settings: z
      .object({
        lang: z.string().regex(/^[a-zA-Z-]{2,10}$/),
        favicon: z.string().refine(isSafeSrc, "Unsafe favicon").optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const paths = new Set<string>();
    const ids = new Set<string>();
    for (const page of doc.pages) {
      if (paths.has(page.path)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate page path ${page.path}` });
      paths.add(page.path);
    }
    const componentIds = new Set(doc.components.map((c) => c.id));
    const collections = new Map((doc.collections ?? []).map((c) => [c.id, c]));
    const collectionSlugs = new Set<string>();
    for (const c of doc.collections ?? []) {
      if (collectionSlugs.has(c.slug)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Two collections use the slug ${c.slug}` });
      collectionSlugs.add(c.slug);
    }
    if (collections.size !== (doc.collections ?? []).length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate collection id" });
    const templated = new Set<string>();
    for (const page of doc.pages) {
      if (!page.collectionId) continue;
      const c = collections.get(page.collectionId);
      if (!c) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Page ${page.path} uses a missing collection` });
        continue;
      }
      if (templated.has(c.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${c.name} has more than one template page` });
      templated.add(c.id);
      for (const item of c.items) {
        const p = page.path.replace(":slug", item.slug);
        if (paths.has(p)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${c.name} item ${item.slug} would use ${p}, which another page already uses` });
        paths.add(p);
      }
    }
    const visit = (n: SiteNode) => {
      if (ids.has(n.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate node id ${n.id}` });
      ids.add(n.id);
      if (n.type === "instance" && !componentIds.has(String(n.props.componentId))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Instance ${n.id} references missing component` });
      }
      if (n.type === "collection-list" && !collections.has(String(n.props.collectionId))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `List ${n.id} references a missing collection` });
      }
      n.children?.forEach(visit);
    };
    doc.pages.forEach((p) => visit(p.root));
    doc.components.forEach((c) => visit(c.root));
  });

export type ValidationResult = { ok: true; document: SiteDocument } | { ok: false; errors: string[] };

/** Validate an unknown value as a site document. */
export function validateDocument(value: unknown): ValidationResult {
  const result = documentSchema.safeParse(value);
  if (result.success) return { ok: true, document: result.data as SiteDocument };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "document"}: ${i.message}`),
  };
}
