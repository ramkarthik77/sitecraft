import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessSite, requireRole } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { AppContext } from "../server.js";

/**
 * Folders for sites and for library assets, nested like AEM's content tree
 * (Immunology › Calvexa › US). Deleting a folder moves what's in it up a
 * level, so nothing is ever deleted with it.
 */

export type FolderKind = "site" | "asset";
const KINDS: FolderKind[] = ["site", "asset"];
const UUID = /^[0-9a-f-]{36}$/i;

interface FolderRow {
  id: string;
  kind: FolderKind;
  name: string;
  parent_id: string | null;
  created_by: string;
  created_at: string;
}

/** A folder of the given kind, or a 404. */
export async function folderFor(db: Db, id: string, kind: FolderKind): Promise<FolderRow> {
  if (!UUID.test(id)) throw new HttpError(404, "Folder not found.");
  const { rows } = await db.query<FolderRow>("SELECT * FROM folders WHERE id = $1 AND kind = $2", [id, kind]);
  if (!rows[0]) throw new HttpError(404, "Folder not found.");
  return rows[0];
}

export async function folderRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));
  const kindOf = (v: unknown): FolderKind => {
    if (!KINDS.includes(v as FolderKind)) throw new HttpError(400, "kind is site or asset.");
    return v as FolderKind;
  };
  const table = (k: FolderKind) => (k === "site" ? "sites" : "library_assets");
  const out = (f: FolderRow & { n?: number }) => ({ id: f.id, kind: f.kind, name: f.name, parentId: f.parent_id, count: Number(f.n ?? 0), createdBy: f.created_by });
  const name = (v: unknown) => {
    const n = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!n) throw new HttpError(400, "Give the folder a name.");
    if (/[/\\]/.test(n)) throw new HttpError(400, "Folder names can't contain slashes.");
    return n;
  };
  const taken = (e: unknown, n: string): never => {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, `There's already a folder called "${n}" here.`);
    throw e;
  };
  const canWrite = (req: FastifyRequest) => {
    requireRole(req.actor, "admin", "editor");
    if (req.actor.siteIds) throw new HttpError(403, "This token is limited to some sites, so it can't change folders.");
  };
  const audit = (req: FastifyRequest, action: string, detail: Record<string, unknown>) =>
    db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, $3, $4)", [req.actor.name, req.actor.role, action, detail]);

  app.get<{ Querystring: { kind?: string } }>("/folders", async (req) => {
    const kind = kindOf(req.query.kind);
    const { rows } = await db.query<FolderRow & { n: number }>(
      `SELECT f.*, (SELECT count(*)::int FROM ${table(kind)} x WHERE x.folder_id = f.id) AS n FROM folders f WHERE f.kind = $1 ORDER BY lower(f.name)`,
      [kind],
    );
    // Site counts only include sites this token can open.
    if (kind === "site" && req.actor.siteIds) {
      const { rows: s } = await db.query<{ id: string; folder_id: string | null }>("SELECT id, folder_id FROM sites WHERE folder_id IS NOT NULL");
      const n = new Map<string, number>();
      for (const x of s) if (canAccessSite(req.actor, x.id)) n.set(x.folder_id!, (n.get(x.folder_id!) ?? 0) + 1);
      return rows.map((f) => out({ ...f, n: n.get(f.id) ?? 0 }));
    }
    return rows.map(out);
  });

  app.post("/folders", async (req, reply) => {
    canWrite(req);
    const b = body<{ kind?: string; name?: string; parentId?: string | null }>(req);
    const kind = kindOf(b.kind);
    const n = name(b.name);
    const parent = b.parentId ? await folderFor(db, b.parentId, kind) : null;
    const { rows } = await db
      .query<FolderRow>("INSERT INTO folders (kind, name, parent_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [kind, n, parent?.id ?? null, req.actor.name])
      .catch((e) => taken(e, n));
    await audit(req, "folder.create", { kind, id: rows[0]!.id, name: n, parent: parent?.name });
    reply.status(201);
    return out(rows[0]!);
  });

  app.patch<{ Params: { id: string } }>("/folders/:id", async (req) => {
    canWrite(req);
    if (!UUID.test(req.params.id)) throw new HttpError(404, "Folder not found.");
    const { rows: cur } = await db.query<FolderRow>("SELECT * FROM folders WHERE id = $1", [req.params.id]);
    const f = cur[0];
    if (!f) throw new HttpError(404, "Folder not found.");
    const b = body<{ name?: string; parentId?: string | null }>(req);
    const n = b.name !== undefined ? name(b.name) : f.name;
    let parentId = f.parent_id;
    if (b.parentId !== undefined) {
      parentId = b.parentId || null;
      // A folder can't go inside itself or one of its own folders.
      for (let at = parentId; at; ) {
        if (at === f.id) throw new HttpError(400, "A folder can't go inside itself.");
        at = (await folderFor(db, at, f.kind)).parent_id;
      }
    }
    const { rows } = await db.query<FolderRow>("UPDATE folders SET name = $2, parent_id = $3 WHERE id = $1 RETURNING *", [f.id, n, parentId]).catch((e) => taken(e, n));
    await audit(req, "folder.update", { kind: f.kind, id: f.id, name: n, was: f.name !== n ? f.name : undefined, moved: b.parentId !== undefined || undefined });
    return out(rows[0]!);
  });

  app.delete<{ Params: { id: string } }>("/folders/:id", async (req, reply) => {
    canWrite(req);
    if (!UUID.test(req.params.id)) throw new HttpError(404, "Folder not found.");
    const { rows: cur } = await db.query<FolderRow>("SELECT * FROM folders WHERE id = $1", [req.params.id]);
    const f = cur[0];
    if (!f) throw new HttpError(404, "Folder not found.");
    const moved = await db.query(`UPDATE ${table(f.kind)} SET folder_id = $2 WHERE folder_id = $1 RETURNING id`, [f.id, f.parent_id]);
    await db.query("UPDATE folders SET parent_id = $2 WHERE parent_id = $1", [f.id, f.parent_id]).catch((e) => taken(e, "that name"));
    await db.query("DELETE FROM folders WHERE id = $1", [f.id]);
    await audit(req, "folder.delete", { kind: f.kind, id: f.id, name: f.name, movedUp: moved.rows.length });
    reply.status(204);
  });

  // File a site in a folder (or take it out with null).
  app.put<{ Params: { siteId: string } }>("/sites/:siteId/folder", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await ctx.repo.getSite(req.params.siteId);
    const { folderId } = body<{ folderId?: string | null }>(req);
    const f = folderId ? await folderFor(db, folderId, "site") : null;
    await db.query("UPDATE sites SET folder_id = $2 WHERE id = $1", [site.id, f?.id ?? null]);
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'site.folder', $4)", [site.id, req.actor.name, req.actor.role, { folder: f?.name ?? null }]);
    return { folderId: f?.id ?? null };
  });
}
