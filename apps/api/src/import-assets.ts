import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppContext } from "./server.js";
import type { Actor } from "./auth.js";
import type { ImportedPage } from "./importer.js";
import { IMAGE_TYPES, imageSize, sniffImage } from "./images.js";
import { libraryKey } from "./routes/assets.js";
import { safeFetchBytes, type SafeFetchOptions } from "./safefetch.js";

type Node = ImportedPage["sections"][number];
function imageNodes(pages: ImportedPage[]): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    if (n.type === "image" && typeof n.props.src === "string") out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  for (const p of pages) for (const s of p.sections) visit(s);
  return out;
}

/**
 * Ingest remote images into Sitecraft DAM, never silently mark them approved.
 *
 * A bounded best-effort pass: failed URLs remain remote AND are reported.
 * Source image URLs are never used as filesystem names; content is sniffed.
 * This function is called only after the user has confirmed reuse rights.
 */
export async function ingestImportedImages(
  pages: ImportedPage[],
  ctx: Pick<AppContext, "db" | "storage" | "cfg">,
  actor: Actor,
  opts: { fetch?: SafeFetchOptions; maxImages?: number } = {},
): Promise<{ imported: number; retainedRemote: number; warnings: string[] }> {
  const nodes = imageNodes(pages);
  const URLs = [...new Set(nodes.map((n) => String(n.props.src)).filter((s) => /^https?:\/\//i.test(s)))];
  const limit = Math.min(40, Math.max(0, opts.maxImages ?? 24));
  const mapped = new Map<string, string>();
  const warnings: string[] = [];
  for (const source of URLs.slice(0, limit)) {
    try {
      const r = await safeFetchBytes(source, { ...opts.fetch, maxBytes: 4_000_000, timeoutMs: 6_000, accept: /^image\/(png|jpeg|gif|webp)/i });
      const type = sniffImage(r.body);
      if (!type || !IMAGE_TYPES[type]) throw Error("Unsupported or mismatched image format (PNG/JPEG/GIF/WebP only).");
      if (r.contentType !== type) throw Error("Image Content-Type does not match its actual bytes.");
      const size = imageSize(r.body);
      if (!size || size.width < 10 || size.height < 10 || size.width > 12000 || size.height > 12000) throw Error("Invalid or oversized image dimensions.");
      const ext = IMAGE_TYPES[type]!;
      const id = randomUUID();
      const fileName = basename(new URL(source).pathname).replace(/[^\w.-]/g, "_").slice(0, 75) || `imported-${id}.${ext}`;
      const first = nodes.find((n) => n.props.src === source);
      const alt = String(first?.props.alt ?? "").slice(0, 500);
      // Draft by default: a reviewer must verify copyright, consent,
      // licensed use, expiry, market and job code before approval.
      await ctx.storage.put(libraryKey(id, ext), r.body, type);
      try {
        await ctx.db.query(
          `INSERT INTO library_assets (id, file_name, ext, content_type, size_bytes, width, height, title, alt, credit, tags, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::jsonb, 'draft', $12)`,
          [id, fileName, ext, type, r.body.length, size.width, size.height, alt || fileName, alt, `Source: ${new URL(source).origin}`, JSON.stringify(["imported", "rights-review-required"]), actor.name],
        );
      } catch (e) {
        await ctx.storage.delete(libraryKey(id, ext)).catch(() => undefined);
        throw e;
      }
      mapped.set(source, `${ctx.cfg.publicUrl}/media/library/${id}.${ext}`);
      await ctx.db.query(
        "INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'asset.import', $3)",
        [actor.name, actor.role, { id, origin: new URL(source).origin, status: "draft" }],
      );
    } catch (err) {
      warnings.push(`Could not copy image from ${new URL(source).origin}: ${(err as Error).message.slice(0, 90)}`);
    }
  }
  for (const node of nodes) {
    const replacement = mapped.get(String(node.props.src));
    if (replacement) node.props.src = replacement;
  }
  const retainedRemote = nodes.filter((n) => /^https?:\/\//i.test(String(n.props.src)) && !String(n.props.src).startsWith(`${ctx.cfg.publicUrl}/media/library/`)).length;
  if (URLs.length > limit) warnings.push(`The first ${limit} unique images were considered; ${URLs.length - limit} additional images need manual review.`);
  if (retainedRemote) warnings.push(`${retainedRemote} image references still point to their source websites; replace them before production publishing.`);
  if (mapped.size) warnings.push(`${mapped.size} copied images are in the shared asset library as DRAFT. Approve usage rights and market coverage before publishing.`);
  return { imported: mapped.size, retainedRemote, warnings };
}


/** Ingest DOCX-embedded raster images with the same draft-only DAM policy.
 * SVG, EMF, WMF and unknown types are not interpreted as active content.
 */
export async function ingestEmbeddedImages(
  embedded: { key: string; data: Buffer; alt: string }[],
  ctx: Pick<AppContext, "db" | "storage" | "cfg">,
  actor: Actor,
): Promise<{ urls: Map<string, string>; warnings: string[] }> {
  const urls = new Map<string, string>();
  const warnings: string[] = [];
  let budget = 0;
  for (const image of embedded.slice(0, 40)) {
    const type = sniffImage(image.data);
    if (!type || !IMAGE_TYPES[type]) {
      warnings.push("An embedded image uses an unsupported type (only PNG, JPEG, GIF and WebP are copied).");
      continue;
    }
    const size = imageSize(image.data);
    budget += image.data.byteLength;
    if (!size || !size.width || !size.height || size.width > 12000 || size.height > 12000 || image.data.byteLength > 4_000_000 || budget > 16_000_000) {
      warnings.push("An embedded image exceeded size or resolution limits and was skipped.");
      continue;
    }
    const id = randomUUID();
    const ext = IMAGE_TYPES[type]!;
    const key = libraryKey(id, ext);
    await ctx.storage.put(key, image.data, type);
    try {
      await ctx.db.query(
        \`INSERT INTO library_assets (id, file_name, ext, content_type, size_bytes, width, height, title, alt, credit, tags, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::jsonb, 'draft', $12)\`,
        [id, \`document-\${id}.\${ext}\`, ext, type, image.data.length, size.width, size.height,
         image.alt.slice(0, 200), image.alt.slice(0, 500), "Imported from user-provided document",
         JSON.stringify(["imported", "rights-review-required"]), actor.name],
      );
    } catch (e) {
      await ctx.storage.delete(key).catch(() => undefined);
      throw e;
    }
    await ctx.db.query(
      "INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'asset.import', $3)",
      [actor.name, actor.role, { id, status: "draft", document: true }],
    );
    urls.set(image.key, \`\${ctx.cfg.publicUrl}/media/library/\${id}.\${ext}\`);
  }
  if (embedded.length > 40) warnings.push("Only the first 40 embedded images were considered.");
  if (urls.size) warnings.push(\`\${urls.size} embedded images were copied as draft assets. Review alt text and usage rights before approval.\`);
  return { urls, warnings };
}
