import type { FastifyInstance, FastifyRequest } from "fastify";
import { walk, type SiteDocument } from "@sitecraft/schema";
import { requireRole, type Actor } from "../auth.js";
import { HttpError } from "../errors.js";
import { IMAGE_TYPES, imageSize, sniffImage } from "../images.js";
import type { AppContext } from "../server.js";

/**
 * The company-wide image library: every site uses the same approved images,
 * with titles, alt text, tags, credits, a focal point and an optional expiry.
 * Files live at /media/library/<id>.<ext>; replacing one keeps its address,
 * so every page using it updates.
 */

export interface LibraryRow {
  id: string;
  file_name: string;
  ext: string;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  title: string;
  alt: string;
  credit: string;
  tags: string[];
  focal_x: number;
  focal_y: number;
  expires_at: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
export const libraryKey = (id: string, ext: string) => `library/${id}.${ext}`;

export function assetOut(cfg: AppContext["cfg"], r: LibraryRow) {
  return {
    id: r.id,
    url: `${cfg.publicUrl}/media/library/${r.id}.${r.ext}`,
    fileName: r.file_name,
    contentType: r.content_type,
    size: r.size_bytes,
    width: r.width,
    height: r.height,
    title: r.title,
    alt: r.alt,
    credit: r.credit,
    tags: Array.isArray(r.tags) ? r.tags : [],
    focalX: Number(r.focal_x),
    focalY: Number(r.focal_y),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    expired: !!r.expires_at && new Date(r.expires_at).getTime() < Date.now(),
    version: r.version,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Check an uploaded body is a supported image of the type it claims. */
export function checkImage(req: FastifyRequest): { buf: Buffer; type: string; ext: string } {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(415, "Upload a PNG, JPEG, GIF or WebP image as the request body.");
  const claimed = String(req.headers["content-type"]).split(";")[0]!;
  const real = sniffImage(buf);
  if (!real || !IMAGE_TYPES[claimed]) throw new HttpError(415, "That file isn't a PNG, JPEG, GIF or WebP image.");
  if (real !== claimed) throw new HttpError(415, `That file is really ${real}, not ${claimed}.`);
  return { buf, type: real, ext: IMAGE_TYPES[real]! };
}

const cleanTags = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean))].slice(0, 30)
    : [];

export async function assetRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, storage, cfg } = ctx;
  const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));
  const canWrite = (actor: Actor) => {
    if (actor.siteIds) throw new HttpError(403, "This token is limited to some sites, so it can't change the shared image library.");
  };
  const get = async (id: string): Promise<LibraryRow> => {
    if (!UUID.test(id)) throw new HttpError(404, "Image not found.");
    const { rows } = await db.query<LibraryRow>("SELECT * FROM library_assets WHERE id = $1", [id]);
    if (!rows[0]) throw new HttpError(404, "Image not found.");
    return rows[0];
  };

  app.get<{ Querystring: { q?: string; tag?: string; limit?: string } }>("/assets", async (req) => {
    const where: string[] = [];
    const args: unknown[] = [];
    if (req.query.q?.trim()) {
      const q = `%${req.query.q.trim().replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      const n = args.push(q);
      where.push(`(title ILIKE $${n} OR alt ILIKE $${n} OR file_name ILIKE $${n} OR credit ILIKE $${n} OR tags::text ILIKE $${n})`);
    }
    if (req.query.tag?.trim()) where.push(`tags ? $${args.push(req.query.tag.trim().toLowerCase())}`);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const { rows } = await db.query<LibraryRow>(`SELECT * FROM library_assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ${limit}`, args);
    return rows.map((r) => assetOut(cfg, r));
  });

  app.get("/assets/tags", async () => {
    const { rows } = await db.query<{ tag: string; n: number }>("SELECT t AS tag, count(*)::int AS n FROM library_assets, jsonb_array_elements_text(tags) AS t GROUP BY t ORDER BY n DESC, t LIMIT 200");
    return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
  });

  app.post<{ Querystring: { filename?: string; title?: string; alt?: string; tags?: string } }>("/assets", async (req, reply) => {
    requireRole(req.actor, "admin", "editor", "agent");
    canWrite(req.actor);
    const { buf, type, ext } = checkImage(req);
    const size = imageSize(buf);
    const name = (req.query.filename ?? `image.${ext}`).replace(/[^\w.-]/g, "_").slice(0, 100);
    const title = (req.query.title ?? name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")).slice(0, 200);
    const { rows } = await db.query<LibraryRow>(
      `INSERT INTO library_assets (file_name, ext, content_type, size_bytes, width, height, title, alt, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10) RETURNING *`,
      [name, ext, type, buf.length, size?.width ?? null, size?.height ?? null, title, (req.query.alt ?? "").slice(0, 500), JSON.stringify(cleanTags(req.query.tags?.split(","))), req.actor.name],
    );
    const row = rows[0]!;
    await storage.put(libraryKey(row.id, ext), buf, type);
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'asset.upload', $3)", [req.actor.name, req.actor.role, { id: row.id, name }]);
    reply.status(201);
    return assetOut(cfg, row);
  });

  app.patch<{ Params: { id: string } }>("/assets/:id", async (req) => {
    requireRole(req.actor, "admin", "editor");
    canWrite(req.actor);
    const cur = await get(req.params.id);
    const b = body<{ title?: string; alt?: string; credit?: string; tags?: string[]; focalX?: number; focalY?: number; expiresAt?: string | null }>(req);
    const focal = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
    if (b.expiresAt && Number.isNaN(Date.parse(b.expiresAt))) throw new HttpError(400, "expiresAt must be a date like 2027-01-31.");
    const { rows } = await db.query<LibraryRow>(
      `UPDATE library_assets SET title = $2, alt = $3, credit = $4, tags = $5::text::jsonb, focal_x = $6, focal_y = $7, expires_at = $8, updated_at = now() WHERE id = $1 RETURNING *`,
      [
        cur.id,
        b.title !== undefined ? String(b.title).slice(0, 200) : cur.title,
        b.alt !== undefined ? String(b.alt).slice(0, 500) : cur.alt,
        b.credit !== undefined ? String(b.credit).slice(0, 200) : cur.credit,
        JSON.stringify(b.tags !== undefined ? cleanTags(b.tags) : cur.tags),
        focal(b.focalX, Number(cur.focal_x)),
        focal(b.focalY, Number(cur.focal_y)),
        b.expiresAt === undefined ? cur.expires_at : b.expiresAt ? new Date(b.expiresAt).toISOString() : null,
      ],
    );
    return assetOut(cfg, rows[0]!);
  });

  // Replace the file but keep the address: every page using it shows the new one.
  app.put<{ Params: { id: string } }>("/assets/:id/file", async (req) => {
    requireRole(req.actor, "admin", "editor");
    canWrite(req.actor);
    const cur = await get(req.params.id);
    const { buf, type, ext } = checkImage(req);
    if (ext !== cur.ext) throw new HttpError(415, `Replace a .${cur.ext} with another .${cur.ext} so its address stays the same.`);
    const size = imageSize(buf);
    await storage.put(libraryKey(cur.id, ext), buf, type);
    const { rows } = await db.query<LibraryRow>(
      "UPDATE library_assets SET size_bytes = $2, width = $3, height = $4, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *",
      [cur.id, buf.length, size?.width ?? null, size?.height ?? null],
    );
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'asset.replace', $3)", [req.actor.name, req.actor.role, { id: cur.id, name: cur.file_name }]);
    return assetOut(cfg, rows[0]!);
  });

  /** Where an image is used: each site's main version, the page or collection, and the element. */
  const usage = async (row: LibraryRow) => {
    const needle = `/media/library/${row.id}.${row.ext}`;
    const { rows } = await db.query<{ id: string; name: string; slug: string; document: SiteDocument }>(
      `SELECT s.id, s.name, s.slug, v.document FROM sites s
       JOIN branches b ON b.site_id = s.id AND b.name = 'main'
       JOIN versions v ON v.id = b.head_version_id
       WHERE v.document::text LIKE $1`,
      [`%${needle}%`],
    );
    return rows.map((s) => {
      const where: string[] = [];
      for (const p of s.document.pages) {
        let n = 0;
        walk(p.root, (x) => {
          if (JSON.stringify(x.props).includes(needle) || JSON.stringify(x.style).includes(needle)) n++;
        });
        if (n) where.push(`${p.path === "/" ? "Home" : p.path}${n > 1 ? ` (${n} times)` : ""}`);
      }
      for (const c of s.document.collections ?? []) {
        const items = c.items.filter((i) => JSON.stringify(i.values).includes(needle)).length;
        if (items) where.push(`${c.name}: ${items} ${items === 1 ? "item" : "items"}`);
      }
      if (s.document.brand?.logo?.includes(needle)) where.push("Brand logo");
      return { siteId: s.id, siteName: s.name, slug: s.slug, where };
    });
  };

  app.get<{ Params: { id: string } }>("/assets/:id/usage", async (req) => usage(await get(req.params.id)));

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/assets/:id", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    canWrite(req.actor);
    const row = await get(req.params.id);
    const used = await usage(row);
    if (used.length && req.query.force !== "1") {
      throw new HttpError(409, `This image is used on ${used.map((u) => u.siteName).join(", ")}. Replace it there first, or delete it anyway.`, { usage: used });
    }
    await db.query("DELETE FROM library_assets WHERE id = $1", [row.id]);
    await storage.delete(libraryKey(row.id, row.ext)).catch(() => {});
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'asset.delete', $3)", [req.actor.name, req.actor.role, { id: row.id, name: row.file_name, wasUsed: used.length }]);
    reply.status(204);
  });
}
