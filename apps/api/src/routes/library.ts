import type { FastifyInstance, FastifyRequest } from "fastify";
import { applyBrand, detachBrand, templateFromDocument, validateDocument, type BrandKit, type ComponentDef, type SiteDocument, type Theme } from "@sitecraft/schema";
import { requireRole, type Actor } from "../auth.js";
import { HttpError } from "../errors.js";
import type { AppContext } from "../server.js";

/**
 * Brand kits and saved site templates: shared across sites, kept in the
 * database, and applied to sites through ordinary versions.
 */

interface BrandRow {
  id: string;
  name: string;
  version: number;
  locked: boolean;
  theme: Theme;
  logo: string | null;
  guidelines: string | null;
  components: ComponentDef[];
  created_by: string;
  updated_at: string;
}

const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));
const UUID = /^[0-9a-f-]{36}$/i;
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export function kitOf(b: BrandRow): BrandKit {
  const kit: BrandKit = { id: b.id, name: b.name, version: b.version, locked: b.locked, theme: b.theme, components: b.components ?? [] };
  if (b.logo) kit.logo = b.logo;
  if (b.guidelines) kit.guidelines = b.guidelines;
  return kit;
}

export function libraryHelpers(ctx: AppContext) {
  const { db, repo } = ctx;
  const getBrand = async (idOrName: string): Promise<BrandRow> => {
    const { rows } = await db.query<BrandRow>(UUID.test(idOrName) ? "SELECT * FROM brands WHERE id = $1" : "SELECT * FROM brands WHERE lower(name) = lower($1)", [idOrName]);
    if (!rows[0]) throw new HttpError(404, `Brand "${idOrName}" not found.`);
    return rows[0];
  };

  /** Bring a site's main up to its brand's latest version (or detach it). Returns true when it changed. */
  const syncBrand = async (actor: Actor, siteId: string, why?: string): Promise<boolean> => {
    const site = await repo.getSite(siteId);
    const brand = site.brand_id ? await getBrand(site.brand_id).catch(() => null) : null;
    const head = await repo.getHead(site.id, "main");
    if (brand) {
      if (head.document.brand?.id === brand.id && head.document.brand.version === brand.version) return false;
      await repo.commit(actor, site.id, "main", (cur) => ({ document: applyBrand(cur, kitOf(brand)), message: why ?? `Apply the ${brand.name} brand (v${brand.version})` }));
      return true;
    }
    if (!head.document.brand) return false;
    const name = head.document.brand.name;
    await repo.commit(actor, site.id, "main", (cur) => ({ document: detachBrand(cur), message: why ?? `Stop following the ${name} brand` }));
    return true;
  };
  return { getBrand, syncBrand };
}

export async function libraryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, repo } = ctx;
  const { getBrand, syncBrand } = libraryHelpers(ctx);
  const noScoped = (actor: Actor) => {
    if (actor.siteIds) throw new HttpError(403, "This token is limited to some sites, so it can't manage templates or brands.");
  };

  // ---- Templates ----------------------------------------------------------

  const templateOut = (r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    brandId: r.brand_id ?? null,
    brandName: r.brand_name ?? null,
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    pages: Array.isArray((r.document as SiteDocument | undefined)?.pages) ? (r.document as SiteDocument).pages.length : undefined,
  });

  app.get("/site-templates", async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      "SELECT t.*, b.name AS brand_name FROM site_templates t LEFT JOIN brands b ON b.id = t.brand_id ORDER BY t.updated_at DESC",
    );
    return rows.map(templateOut);
  });

  app.get<{ Params: { id: string } }>("/site-templates/:id", async (req) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, "Template not found.");
    const { rows } = await db.query<Record<string, unknown>>("SELECT t.*, b.name AS brand_name FROM site_templates t LEFT JOIN brands b ON b.id = t.brand_id WHERE t.id = $1", [req.params.id]);
    if (!rows[0]) throw new HttpError(404, "Template not found.");
    return { ...templateOut(rows[0]), document: rows[0].document };
  });

  app.post("/site-templates", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    noScoped(req.actor);
    const b = body<{ siteId?: string; name?: string; description?: string; includeItems?: boolean }>(req);
    if (!b.siteId || !b.name?.trim()) throw new HttpError(400, "Pick a site and give the template a name.");
    const site = await repo.getSite(b.siteId);
    const head = await repo.getHead(site.id, "main");
    const doc = templateFromDocument(head.document, { includeItems: !!b.includeItems });
    const { rows } = await db
      .query<Record<string, unknown>>(
        "INSERT INTO site_templates (name, description, document, source_name, brand_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [b.name.trim().slice(0, 80), (b.description ?? "").slice(0, 300), doc, site.name, site.brand_id ?? null, req.actor.name],
      )
      .catch((e) => {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, `There's already a template called "${b.name}".`);
        throw e;
      });
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'template.create', $4)", [site.id, req.actor.name, req.actor.role, { id: rows[0]!.id, name: b.name }]);
    reply.status(201);
    return templateOut(rows[0]!);
  });

  app.patch<{ Params: { id: string } }>("/site-templates/:id", async (req) => {
    requireRole(req.actor, "admin", "editor");
    noScoped(req.actor);
    if (!UUID.test(req.params.id)) throw new HttpError(404, "Template not found.");
    const b = body<{ name?: string; description?: string; siteId?: string; includeItems?: boolean }>(req);
    const sets: string[] = ["updated_at = now()"];
    const args: unknown[] = [req.params.id];
    if (b.name?.trim()) sets.push(`name = $${args.push(b.name.trim().slice(0, 80))}`);
    if (b.description !== undefined) sets.push(`description = $${args.push(b.description.slice(0, 300))}`);
    if (b.siteId) {
      const site = await repo.getSite(b.siteId);
      const head = await repo.getHead(site.id, "main");
      sets.push(`document = $${args.push(templateFromDocument(head.document, { includeItems: !!b.includeItems }))}`);
      sets.push(`source_name = $${args.push(site.name)}`);
      sets.push(`brand_id = $${args.push(site.brand_id ?? null)}`);
    }
    const { rows } = await db.query<Record<string, unknown>>(`UPDATE site_templates SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, args).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, `There's already a template called "${b.name}".`);
      throw e;
    });
    if (!rows[0]) throw new HttpError(404, "Template not found.");
    return templateOut(rows[0]);
  });

  app.delete<{ Params: { id: string } }>("/site-templates/:id", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    noScoped(req.actor);
    if (!UUID.test(req.params.id)) throw new HttpError(404, "Template not found.");
    const { rows } = await db.query<{ name: string }>("DELETE FROM site_templates WHERE id = $1 RETURNING name", [req.params.id]);
    if (!rows[0]) throw new HttpError(404, "Template not found.");
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'template.delete', $3)", [req.actor.name, req.actor.role, { name: rows[0].name }]);
    reply.status(204);
  });

  // ---- Brands -------------------------------------------------------------

  const brandOut = (b: BrandRow & { sites?: number }) => ({
    id: b.id,
    name: b.name,
    version: b.version,
    locked: b.locked,
    theme: b.theme,
    logo: b.logo,
    guidelines: b.guidelines ?? "",
    components: (b.components ?? []).map((c) => ({ id: c.id, name: c.name })),
    sites: b.sites === undefined ? undefined : Number(b.sites),
    createdBy: b.created_by,
    updatedAt: iso(b.updated_at),
  });

  app.get("/brands", async () => {
    const { rows } = await db.query<BrandRow & { sites: number }>("SELECT b.*, (SELECT count(*) FROM sites s WHERE s.brand_id = b.id) AS sites FROM brands b ORDER BY lower(b.name)");
    return rows.map(brandOut);
  });

  app.get<{ Params: { id: string } }>("/brands/:id", async (req) => {
    const b = await getBrand(req.params.id);
    const { rows } = await db.query<{ id: string; name: string; slug: string }>("SELECT id, name, slug FROM sites WHERE brand_id = $1 ORDER BY name", [b.id]);
    return { ...brandOut(b), componentsFull: b.components, siteList: rows };
  });

  /** Theme and components to take from a site. */
  const fromSite = async (siteId: string, componentIds?: string[]) => {
    const site = await repo.getSite(siteId);
    const head = await repo.getHead(site.id, "main");
    const all = head.document.components;
    const pick = componentIds ? all.filter((c) => componentIds.includes(c.id) || componentIds.includes(c.name)) : all;
    return { theme: head.document.theme, components: pick.map(({ brandId, ...c }) => (void brandId, c)) };
  };

  const checkLogo = (logo: unknown) => {
    if (logo === undefined || logo === null || logo === "") return null;
    const s = String(logo);
    if (!/^(https?:\/\/|\/)/i.test(s) || s.length > 2000) throw new HttpError(400, "The logo must be an image address starting with https:// or /.");
    return s;
  };

  /** Push a brand's new version to every site that follows it. */
  const rollout = async (actor: Actor, brand: BrandRow) => {
    const { rows } = await db.query<{ id: string }>("SELECT id FROM sites WHERE brand_id = $1", [brand.id]);
    let updated = 0;
    for (const r of rows) if (await syncBrand(actor, r.id, `Update to the ${brand.name} brand v${brand.version}`)) updated++;
    return updated;
  };

  app.post("/brands", async (req, reply) => {
    requireRole(req.actor, "admin");
    const b = body<{ name?: string; fromSite?: string; components?: string[]; guidelines?: string; logo?: string; locked?: boolean }>(req);
    if (!b.name?.trim()) throw new HttpError(400, "Give the brand a name.");
    if (!b.fromSite) throw new HttpError(400, "Pick a site to take the brand's colors, fonts and components from.");
    const src = await fromSite(b.fromSite, b.components);
    const { rows } = await db
      .query<BrandRow>(
        "INSERT INTO brands (name, locked, theme, logo, guidelines, components, created_by) VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7) RETURNING *",
        [b.name.trim().slice(0, 80), !!b.locked, src.theme, checkLogo(b.logo), (b.guidelines ?? "").slice(0, 20_000) || null, JSON.stringify(src.components), req.actor.name],
      )
      .catch((e) => {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, `There's already a brand called "${b.name}".`);
        throw e;
      });
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'brand.create', $3)", [req.actor.name, req.actor.role, { id: rows[0]!.id, name: b.name }]);
    reply.status(201);
    return brandOut(rows[0]!);
  });

  app.patch<{ Params: { id: string } }>("/brands/:id", async (req) => {
    requireRole(req.actor, "admin");
    const cur = await getBrand(req.params.id);
    const b = body<{ name?: string; guidelines?: string; logo?: string | null; locked?: boolean; theme?: Theme; fromSite?: string; components?: string[] }>(req);
    let theme = cur.theme;
    let components = cur.components;
    if (b.fromSite) ({ theme, components } = await fromSite(b.fromSite, b.components));
    if (b.theme) {
      // Check a hand-edited theme the same way a site's theme is checked.
      const probe = validateDocument({ schemaVersion: 1, theme: b.theme, components: [], pages: [{ id: "p", path: "/", title: "x", root: { id: "r", type: "stack", props: {}, style: {} } }], settings: { lang: "en" } });
      if (!probe.ok) throw new HttpError(400, `That theme isn't valid: ${probe.errors.join("; ")}`);
      theme = b.theme;
    }
    const { rows } = await db
      .query<BrandRow>(
        `UPDATE brands SET name = $2, guidelines = $3, logo = $4, locked = $5, theme = $6, components = $7::text::jsonb, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
        [
          cur.id,
          b.name?.trim() ? b.name.trim().slice(0, 80) : cur.name,
          b.guidelines !== undefined ? b.guidelines.slice(0, 20_000) || null : cur.guidelines,
          b.logo !== undefined ? checkLogo(b.logo) : cur.logo,
          b.locked ?? cur.locked,
          theme,
          JSON.stringify(components),
        ],
      )
      .catch((e) => {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, `There's already a brand called "${b.name}".`);
        throw e;
      });
    const next = rows[0]!;
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'brand.update', $3)", [req.actor.name, req.actor.role, { id: next.id, name: next.name, version: next.version }]);
    const updatedSites = await rollout(req.actor, next);
    return { ...brandOut(next), updatedSites };
  });

  app.delete<{ Params: { id: string } }>("/brands/:id", async (req, reply) => {
    requireRole(req.actor, "admin");
    const brand = await getBrand(req.params.id);
    const { rows } = await db.query<{ id: string }>("UPDATE sites SET brand_id = NULL WHERE brand_id = $1 RETURNING id", [brand.id]);
    for (const r of rows) await syncBrand(req.actor, r.id, `Stop following the ${brand.name} brand (deleted)`);
    await db.query("DELETE FROM brands WHERE id = $1", [brand.id]);
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES (NULL, $1, $2, 'brand.delete', $3)", [req.actor.name, req.actor.role, { name: brand.name }]);
    reply.status(204);
  });

  // Which brand a site follows. Applying it is a new version on main, like any change.
  app.put<{ Params: { siteId: string } }>("/sites/:siteId/brand", async (req) => {
    requireRole(req.actor, "admin");
    const site = await repo.getSite(req.params.siteId);
    const { brandId } = body<{ brandId?: string | null }>(req);
    const brand = brandId ? await getBrand(brandId) : null;
    await db.query("UPDATE sites SET brand_id = $2 WHERE id = $1", [site.id, brand?.id ?? null]);
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'site.brand', $4)", [site.id, req.actor.name, req.actor.role, { brand: brand?.name ?? null }]);
    const changed = await syncBrand(req.actor, site.id);
    return { brandId: brand?.id ?? null, changed };
  });
}
