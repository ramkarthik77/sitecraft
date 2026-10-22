import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  BLOCK_DESCRIPTIONS,
  BLOCK_NAMES,
  createStarterDocument,
  diffDocuments,
  outlineDocument,
  parseOperations,
  TEMPLATES,
  type SiteDocument,
  type TemplateName,
} from "@sitecraft/schema";
import { authenticate, createToken, requireRole, signPreview, type Actor, type Role } from "../auth.js";
import { HttpError } from "../errors.js";
import { exportSite, publishVersion, siteLocation } from "../publish.js";
import type { AppContext } from "../server.js";

type Params = { siteId: string; branch: string; id: string };

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}

function body<T = Record<string, unknown>>(req: FastifyRequest): T {
  const b = req.body;
  if (!b || typeof b !== "object" || Buffer.isBuffer(b)) return {} as T;
  return b as T;
}

export async function apiRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo, cfg } = ctx;

  app.decorateRequest("actor", null as unknown as Actor);
  app.addHook("preHandler", async (req) => {
    req.actor = await authenticate(ctx.db, req, { local: cfg.local });
  });

  const reviewUrl = (siteId: string, branch: string) => `${cfg.editorUrl}/sites/${siteId}?branch=${encodeURIComponent(branch)}&review=1`;

  /** Agents work on branches; people decide what reaches main and the live site. */
  function assertCanWrite(actor: Actor, branch: string) {
    if (actor.role === "agent" && branch === "main" && !cfg.agentCanEditMain) {
      throw new HttpError(403, "Agents edit on a branch, not main. Create one first (for example agent/<task>) and a person will review and merge it.");
    }
  }
  function assertCanShip(actor: Actor, siteId: string, branch: string, what: string) {
    if (actor.role === "agent" && !cfg.agentCanPublish) {
      throw new HttpError(403, `Agents can't ${what}. Ask a person to review it here: ${reviewUrl(siteId, branch)}`, { reviewUrl: reviewUrl(siteId, branch) });
    }
  }

  const siteOut = async (s: Awaited<ReturnType<typeof repo.getSite>>) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    domain: s.domain,
    createdBy: s.created_by,
    createdAt: s.created_at,
    liveUrl: s.current_deployment_id ? siteLocation(cfg, s).url : null,
    publishUrl: siteLocation(cfg, s).url,
  });

  app.get("/me", async (req) => ({ name: req.actor.name, role: req.actor.role, agentCanPublish: cfg.agentCanPublish, local: !!req.actor.local }));

  app.get("/blocks", async () => BLOCK_NAMES.map((name) => ({ name, description: BLOCK_DESCRIPTIONS[name] ?? "" })));
  app.get("/templates", async () => TEMPLATES);

  app.post("/tokens", async (req) => {
    requireRole(req.actor, "admin");
    const { name, role } = body<{ name?: string; role?: Role }>(req);
    if (!name || !role || !["admin", "editor", "agent"].includes(role)) throw new HttpError(400, "Provide name and role (admin, editor or agent).");
    return { name, role, token: await createToken(ctx.db, name, role) };
  });

  // Sites
  app.get("/sites", async () => Promise.all((await repo.listSites()).map(async (s) => ({ ...(await siteOut(s)), updatedAt: s.updated_at }))));

  app.post("/sites", async (req, reply) => {
    const b = body<{ name?: string; slug?: string; template?: TemplateName; document?: SiteDocument }>(req);
    if (!b.name || typeof b.name !== "string") throw new HttpError(400, "Give the site a name.");
    if (b.template && !TEMPLATES.includes(b.template)) throw new HttpError(400, `Template must be one of ${TEMPLATES.join(", ")}.`);
    const document = b.document ?? createStarterDocument({ name: b.name, template: b.template ?? "landing" });
    const site = await repo.createSite(req.actor, { name: b.name, slug: b.slug, document });
    reply.status(201);
    return siteOut(site);
  });

  app.get<{ Params: Params }>("/sites/:siteId", async (req) => siteOut(await repo.getSite(req.params.siteId)));

  app.patch<{ Params: Params }>("/sites/:siteId", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ name?: string; domain?: string | null }>(req);
    return siteOut(await repo.updateSite(req.actor, site.id, { name: b.name, domain: b.domain === "" ? null : b.domain }));
  });

  app.delete<{ Params: Params }>("/sites/:siteId", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    await repo.deleteSite(req.actor, site.id);
    return reply.status(204).send();
  });

  // Branches and documents
  app.get<{ Params: Params }>("/sites/:siteId/branches", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    return (await repo.listBranches(site.id)).map((b) => ({
      name: b.name,
      headVersionId: Number(b.head_version_id),
      baseVersionId: b.base_version_id === null ? null : Number(b.base_version_id),
      hasChanges: b.name !== "main" && b.head_version_id !== b.base_version_id,
      createdBy: b.created_by,
      lastChangeBy: b.head_actor,
      lastMessage: b.head_message,
      updatedAt: b.head_at,
    }));
  });

  app.post<{ Params: Params }>("/sites/:siteId/branches", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ name?: string; from?: string }>(req);
    if (!b.name) throw new HttpError(400, "Give the branch a name, for example agent/new-hero.");
    const br = await repo.createBranch(req.actor, site.id, b.name, b.from ?? "main");
    reply.status(201);
    return { name: br.name, headVersionId: Number(br.head_version_id) };
  });

  app.delete<{ Params: Params }>("/sites/:siteId/branches/:branch", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    await repo.deleteBranch(req.actor, site.id, req.params.branch);
    return reply.status(204).send();
  });

  app.get<{ Params: Params; Querystring: { format?: string; page?: string } }>("/sites/:siteId/branches/:branch", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const head = await repo.getHead(site.id, req.params.branch);
    if (req.query.format === "outline") {
      return { versionId: Number(head.versionId), outline: outlineDocument(head.document, { pageId: req.query.page }) };
    }
    return { versionId: Number(head.versionId), document: head.document };
  });

  app.put<{ Params: Params }>("/sites/:siteId/branches/:branch/document", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    assertCanWrite(req.actor, req.params.branch);
    const b = body<{ document?: SiteDocument; baseVersion?: number; message?: string }>(req);
    if (!b.document) throw new HttpError(400, "Send the full document.");
    const r = await repo.commit(req.actor, site.id, req.params.branch, () => ({ document: b.document!, message: b.message ?? "Edit in editor" }), b.baseVersion);
    return { versionId: Number(r.versionId) };
  });

  app.post<{ Params: Params }>("/sites/:siteId/branches/:branch/ops", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    assertCanWrite(req.actor, req.params.branch);
    const b = body<{ ops?: unknown; baseVersion?: number; message?: string }>(req);
    const parsed = parseOperations(b.ops);
    if (!parsed.ok) throw new HttpError(400, `Invalid operations: ${parsed.error}`);
    const r = await repo.applyOps(req.actor, site.id, req.params.branch, parsed.ops, b.message, b.baseVersion);
    return { versionId: Number(r.versionId), created: r.created };
  });

  app.get<{ Params: Params; Querystring: { limit?: string } }>("/sites/:siteId/branches/:branch/versions", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    return (await repo.listVersions(site.id, req.params.branch, Number(req.query.limit ?? 50))).map((v) => ({
      id: Number(v.id),
      parentId: v.parent_id === null ? null : Number(v.parent_id),
      message: v.message,
      actor: v.actor,
      actorRole: v.actor_role,
      createdAt: v.created_at,
    }));
  });

  app.post<{ Params: Params }>("/sites/:siteId/branches/:branch/restore", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    assertCanWrite(req.actor, req.params.branch);
    const { versionId } = body<{ versionId?: number }>(req);
    if (!versionId) throw new HttpError(400, "Pass the versionId to restore.");
    const v = await repo.getVersion(site.id, versionId);
    const r = await repo.commit(req.actor, site.id, req.params.branch, () => ({ document: v.document, message: `Restore version ${versionId}` }));
    return { versionId: Number(r.versionId) };
  });

  app.get<{ Params: Params; Querystring: { against?: string } }>("/sites/:siteId/branches/:branch/diff", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const target = await repo.getHead(site.id, req.params.branch);
    const against = req.query.against ?? "main";
    const base = against === "base" && target.branch.base_version_id ? await repo.getVersion(site.id, Number(target.branch.base_version_id)) : await repo.getHead(site.id, against);
    return diffDocuments(base.document, target.document);
  });

  app.post<{ Params: Params }>("/sites/:siteId/branches/:branch/merge", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    assertCanShip(req.actor, site.id, req.params.branch, "merge into main");
    const { force } = body<{ force?: boolean }>(req);
    const r = await repo.merge(req.actor, site.id, req.params.branch, !!force);
    return { versionId: Number(r.versionId) };
  });

  app.get<{ Params: Params }>("/sites/:siteId/branches/:branch/preview-url", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    await repo.getBranch(site.id, req.params.branch);
    const key = signPreview(cfg.secret, site.id, req.params.branch);
    return {
      url: `${cfg.publicUrl}/preview/${key}/${site.id}/${encodeURIComponent(req.params.branch)}/`,
      editorUrl: `${cfg.editorUrl}/sites/${site.id}?branch=${encodeURIComponent(req.params.branch)}`,
    };
  });

  // Live change stream for open editors.
  app.get<{ Params: Params }>("/sites/:siteId/events", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    reply.hijack();
    const res = reply.raw;
    const origin = req.headers.origin;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(origin && (cfg.corsOrigins.includes(origin) || cfg.corsOrigins.includes("*")) ? { "Access-Control-Allow-Origin": origin } : {}),
    });
    res.write(`event: ready\ndata: {}\n\n`);
    const unsub = ctx.events.subscribe(site.id, (e) => res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });

  // Publishing
  app.post<{ Params: Params }>("/sites/:siteId/publish", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const { branch = "main" } = body<{ branch?: string }>(req);
    if (branch !== "main") throw new HttpError(400, "Only main is published. Merge the branch first.");
    assertCanShip(req.actor, site.id, branch, "publish the live site");
    return publishVersion(cfg, repo, ctx.storage, req.actor, site, branch);
  });

  // Download a site as a zip of static files, to host anywhere.
  app.get<{ Params: Params; Querystring: { branch?: string; url?: string } }>("/sites/:siteId/export", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const url = (req.query.url ?? "").trim();
    if (url && !/^https?:\/\/[^\s/]+(\/.*)?$/i.test(url)) throw new HttpError(400, "The site address should look like https://www.example.com");
    const zip = await exportSite(cfg, repo, ctx.storage, site, req.query.branch ?? "main", url || undefined);
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${site.slug}.zip"`)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(zip));
  });

  app.get<{ Params: Params }>("/sites/:siteId/deployments", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const rows = await repo.listDeployments(site.id);
    return rows.map((d: Record<string, unknown>) => ({ id: d.id, versionId: Number(d.version_id), url: d.url, actor: d.actor, createdAt: d.created_at, current: d.id === site.current_deployment_id }));
  });

  app.post<{ Params: Params }>("/sites/:siteId/deployments/:id/rollback", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    await repo.rollback(req.actor, site.id, req.params.id);
    return { ok: true };
  });

  app.get<{ Params: Params }>("/sites/:siteId/forms", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    return repo.listSubmissions(site.id);
  });

  app.get<{ Params: Params }>("/sites/:siteId/audit", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    return repo.listAudit(site.id);
  });

  // Image uploads
  app.post<{ Params: Params; Querystring: { filename?: string } }>("/sites/:siteId/assets", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(415, "Upload a PNG, JPEG, GIF or WebP image as the request body.");
    const type = String(req.headers["content-type"]).split(";")[0]!;
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[type];
    if (!ext) throw new HttpError(415, "Unsupported image type.");
    const name = (req.query.filename ?? `upload.${ext}`).replace(/[^\w.-]/g, "_").slice(0, 100);
    const asset = await repo.addAsset(req.actor, site.id, name, type, buf.length);
    await ctx.storage.put(`assets/${site.id}/${asset.id}.${ext}`, buf, type);
    reply.status(201);
    return { id: asset.id, url: `${cfg.publicUrl}/media/${site.id}/${asset.id}.${ext}`, fileName: name };
  });

  app.get<{ Params: Params }>("/sites/:siteId/assets", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const rows = await repo.listAssets(site.id);
    const ext: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    return rows.map((a: Record<string, string>) => ({ id: a.id, fileName: a.file_name, url: `${cfg.publicUrl}/media/${site.id}/${a.id}.${ext[a.content_type]}`, createdAt: a.created_at }));
  });
}
