import { z } from "zod";
import {
  ANIMATION_PRESETS,
  CONTAINER_TYPES,
  NODE_TYPES,
  STYLE_PROPERTIES,
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
    }),
);

const pathSchema = z
  .string()
  .regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, "Page path must look like / or /about or /blog/post");

export const pageSchema = z
  .object({
    id: idSchema,
    path: pathSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    ogImage: z.string().refine(isSafeSrc, "Unsafe og image").optional(),
    root: nodeSchema,
  })
  .strict();

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
    components: z.array(z.object({ id: idSchema, name: z.string().min(1).max(120), root: nodeSchema }).strict()),
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
    const visit = (n: SiteNode) => {
      if (ids.has(n.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate node id ${n.id}` });
      ids.add(n.id);
      if (n.type === "instance" && !componentIds.has(String(n.props.componentId))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Instance ${n.id} references missing component` });
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
