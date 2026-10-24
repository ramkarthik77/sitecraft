import type { FastifyInstance, FastifyRequest } from "fastify";
import { diffDocuments, findInTree, walk, type ComponentDef, type Operation, type SiteDocument } from "@sitecraft/schema";
import { canAccessSite, requireRole, type Actor } from "../auth.js";
import { toCsv } from "../security.js";
import { HttpError } from "../errors.js";
import type { AppContext } from "../server.js";

/**
 * History you can work with: a readable timeline, any version to look at,
 * compare and partly restore, names for the versions that matter, the live
 * site as of a date, and a calendar of what goes live when.
 */

type Params = { siteId: string; branch: string };
type VParams = { siteId: string; versionId: string };

export async function historyRoutes(app: FastifyInstance, ctx: AppContext, assertCanWrite: (actor: Actor, branch: string) => void) {
  const { repo } = ctx;
  const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" ? (req.body as T) : ({} as T));
  const versionId = (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "That isn't a version number.");
    return n;
  };
  const out = (v: Awaited<ReturnType<typeof repo.listVersions>>[number]) => ({
    id: Number(v.id),
    parentId: v.parent_id === null ? null : Number(v.parent_id),
    message: v.message,
    actor: v.actor,
    actorRole: v.actor_role,
    createdAt: v.created_at,
    label: v.label ?? null,
    kind: v.kind ?? "edit",
    changes: v.changes ?? null,
    published: !!v.published,
    live: !!v.live,
  });

  // The timeline: newest first, in pages, optionally for one page of the site.
  app.get<{ Params: Params; Querystring: { limit?: string; before?: string; page?: string; only?: string } }>("/sites/:siteId/branches/:branch/versions", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    await repo.getBranch(site.id, req.params.branch);
    const only = req.query.only === "named" || req.query.only === "published" ? req.query.only : undefined;
    const rows = await repo.listVersions(site.id, req.params.branch, Number(req.query.limit ?? 50) || 50, {
      before: req.query.before ? versionId(req.query.before) : undefined,
      pageId: req.query.page || undefined,
      only,
    });
    return rows.map(out);
  });

  // One version in full, to look at on the canvas.
  app.get<{ Params: VParams }>("/sites/:siteId/versions/:versionId", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const v = await repo.getVersion(site.id, versionId(req.params.versionId));
    return { id: Number(v.id), branch: v.branch, message: v.message, actor: v.actor, createdAt: v.created_at, label: v.label ?? null, kind: v.kind ?? "edit", document: v.document };
  });

  // What differs between a version and another one (default: the branch's current version).
  app.get<{ Params: VParams; Querystring: { with?: string } }>("/sites/:siteId/versions/:versionId/compare", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const v = await repo.getVersion(site.id, versionId(req.params.versionId));
    const other = req.query.with && req.query.with !== "current" ? await repo.getVersion(site.id, versionId(req.query.with)) : await repo.getHead(site.id, v.branch);
    // Read as "from this version to that one": added = only in the other, removed = only in this.
    return diffDocuments(v.document, other.document);
  });

  // Name a version so it's easy to find and never condensed away.
  app.patch<{ Params: VParams }>("/sites/:siteId/versions/:versionId", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const { label } = body<{ label?: string | null }>(req);
    if (label !== null && label !== undefined && typeof label !== "string") throw new HttpError(400, "label must be text or null.");
    await repo.labelVersion(req.actor, site.id, versionId(req.params.versionId), label ?? null);
    return { ok: true };
  });

  /**
   * Restore all of a version, one page of it, or one element. Partial restores
   * are ops on today's version, so brand rules and validation still apply.
   */
  app.post<{ Params: Params }>("/sites/:siteId/branches/:branch/restore", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    assertCanWrite(req.actor, req.params.branch);
    const b = body<{ versionId?: number; pageId?: string; nodeId?: string }>(req);
    if (!b.versionId) throw new HttpError(400, "Pass the versionId to restore.");
    const v = await repo.getVersion(site.id, versionId(String(b.versionId)));
    const when = new Date(v.created_at).toISOString().slice(0, 16).replace("T", " ");
    if (!b.pageId && !b.nodeId) {
      const r = await repo.commit(req.actor, site.id, req.params.branch, () => ({ document: v.document, message: `Restore version ${v.id} (${when})`, kind: "restore" }));
      return { versionId: Number(r.versionId) };
    }
    const old: SiteDocument = v.document;
    const head = await repo.getHead(site.id, req.params.branch);
    let ops: Operation[];
    let message: string;
    if (b.pageId) {
      const page = old.pages.find((p) => p.id === b.pageId);
      if (!page) throw new HttpError(404, "That page isn't in this version.");
      // Components the page uses, in case they've been deleted since.
      const used = new Set<string>();
      walk(page.root, (n) => void (n.type === "instance" && typeof n.props.componentId === "string" && used.add(n.props.componentId)));
      const components = old.components.filter((c: ComponentDef) => used.has(c.id));
      ops = [{ op: "put_page", page: page as never, components: components as never }];
      message = `Restore page ${page.path === "/" ? "Home" : page.path} from version ${v.id} (${when})`;
    } else {
      let hit: { node: SiteDocument["pages"][number]["root"]; parentId: string | null; index: number; pageId: string } | null = null;
      for (const p of old.pages) {
        const f = findInTree(p.root, b.nodeId!);
        if (f) {
          hit = { node: f.node, parentId: f.parent?.id ?? null, index: f.index, pageId: p.id };
          break;
        }
      }
      if (!hit) throw new HttpError(404, "That element isn't in this version.");
      if (!hit.parentId) throw new HttpError(400, "To bring back a whole page, restore the page.");
      // If its old parent is gone, put it at the end of the same page (or the first page).
      const nowPage = head.document.pages.find((p) => p.id === hit!.pageId) ?? head.document.pages[0]!;
      const parentExists = head.document.pages.some((p) => !!findInTree(p.root, hit!.parentId!));
      ops = [{ op: "restore_node", node: hit.node as never, parentId: parentExists ? hit.parentId : nowPage.root.id, index: parentExists ? hit.index : undefined }];
      message = `Restore ${hit.node.name ?? hit.node.type} from version ${v.id} (${when})`;
    }
    const r = await repo.applyOps(req.actor, site.id, req.params.branch, ops, message, undefined, "restore");
    return { versionId: Number(r.versionId), created: r.created };
  });

  // The live site as it was at a moment: which publish was live then.
  app.get<{ Params: { siteId: string }; Querystring: { at?: string } }>("/sites/:siteId/live-at", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const at = req.query.at ? new Date(req.query.at) : new Date();
    if (Number.isNaN(at.getTime())) throw new HttpError(400, "at must be a date and time, like 2026-10-03T14:00:00Z.");
    const hit = await repo.liveAt(site.id, at);
    if (!hit) return { live: null };
    return { live: { deploymentId: hit.deployment_id, versionId: Number(hit.version_id), since: hit.at, by: hit.actor, reason: hit.reason } };
  });

  /**
   * Who did what on a site: every save (with the pages it touched) and every
   * publish, rollback, merge, approval, schedule, setting and form action, newest first.
   */
  const activity = async (siteId: string, q: { before?: string; actor?: string; kind?: string; limit?: string }) => {
    const args: unknown[] = [siteId];
    const filters: string[] = [];
    if (q.before) filters.push(`at < $${args.push(new Date(q.before).toISOString())}`);
    if (q.actor) filters.push(`actor = $${args.push(q.actor)}`);
    if (q.kind === "edits") filters.push("action LIKE 'version.%' AND action NOT IN ('version.name', 'version.unname')");
    else if (q.kind === "publishing") filters.push("action IN ('site.publish', 'site.rollback', 'branch.merge', 'schedule.create', 'schedule.cancel', 'schedule.failed')");
    else if (q.kind === "reviews") filters.push("action IN ('branch.approve', 'approval.override', 'site.approvals')");
    else if (q.kind === "settings") filters.push("action NOT LIKE 'version.%' AND action NOT IN ('site.publish', 'site.rollback', 'branch.merge', 'branch.approve', 'approval.override', 'schedule.create', 'schedule.cancel', 'schedule.failed')");
    const limit = Math.min(500, Number(q.limit) || 100);
    const { rows } = await ctx.db.query<{ source: string; id: string; at: string; actor: string; actor_role: string; action: string; detail: Record<string, unknown> }>(
      `SELECT * FROM (
         SELECT 'version' AS source, v.id::text AS id, v.created_at AS at, v.actor, v.actor_role,
           'version.' || v.kind AS action,
           jsonb_build_object('branch', v.branch, 'message', v.message, 'versionId', v.id, 'label', v.label, 'pages', COALESCE(v.changes->'pages', '[]'::jsonb), 'theme', COALESCE(v.changes->'theme', 'false'::jsonb)) AS detail
         FROM versions v WHERE v.site_id = $1 AND v.kind NOT IN ('merge', 'create')
           -- Saves made before they were written to the audit trail.
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.site_id = v.site_id AND a.action LIKE 'version.%' AND a.action NOT IN ('version.name', 'version.unname') AND a.detail->>'versionId' = v.id::text)
         UNION ALL
         SELECT 'audit', a.id::text, a.created_at, a.actor, a.actor_role, a.action, a.detail FROM audit_log a WHERE a.site_id = $1
       ) x ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY at DESC LIMIT ${limit}`,
      args,
    );
    return rows.map((r) => ({ id: `${r.source}:${r.id}`, at: new Date(r.at).toISOString(), actor: r.actor, role: r.actor_role, action: r.action, detail: r.detail }));
  };

  app.get<{ Params: { siteId: string }; Querystring: { before?: string; actor?: string; kind?: string; limit?: string } }>("/sites/:siteId/activity", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const items = await activity(site.id, req.query);
    // Who appears in the site's history, for the person filter.
    const people = await ctx.db.query<{ actor: string; n: number }>(
      "SELECT actor, count(*)::int AS n FROM (SELECT actor FROM versions WHERE site_id = $1 UNION ALL SELECT actor FROM audit_log WHERE site_id = $1) x GROUP BY actor ORDER BY n DESC LIMIT 50",
      [site.id],
    );
    return { items, people: people.rows.map((p) => ({ name: p.actor, count: Number(p.n) })) };
  });

  app.get<{ Params: { siteId: string } }>("/sites/:siteId/activity.csv", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const items = await activity(site.id, { limit: "500" });
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${site.slug}-activity.csv"`);
    return toCsv(
      ["when", "who", "role", "action", "details"],
      items.map((i) => [i.at, i.actor, i.role, i.action, JSON.stringify(i.detail)]),
    );
  });

  /** Everyone whose sign-in can open this site, and how. Admins also get ids, to revoke. */
  app.get<{ Params: { siteId: string } }>("/sites/:siteId/access", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const { rows } = await ctx.db.query<{ id: string; name: string; role: string; created_at: string; created_by: string | null; last_used_at: string | null; expires_at: string | null; site_ids: string[] | null }>(
      `SELECT id, name, role, created_at, created_by, last_used_at, expires_at, site_ids FROM api_tokens
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (site_ids IS NULL OR $1 = ANY(site_ids))
       ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name`,
      [site.id],
    );
    const admin = req.actor.role === "admin";
    const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
    return rows.map((r) => ({
      id: admin ? r.id : undefined,
      name: r.name,
      role: r.role,
      scope: r.site_ids ? (r.site_ids.length === 1 ? "this site" : `${r.site_ids.length} sites`) : "all sites",
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      lastUsedAt: iso(r.last_used_at),
      expiresAt: iso(r.expires_at),
    }));
  });

  // Everything going live, and what went live, across the sites you can see.
  app.get<{ Querystring: { from?: string; to?: string } }>("/calendar", async (req) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 31 * 864e5);
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 62 * 864e5);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, "from and to must be dates.");
    if (to.getTime() - from.getTime() > 400 * 864e5) throw new HttpError(400, "Ask for at most about a year at a time.");
    const sched = await ctx.db.query<{ id: string; site_id: string; site_name: string; branch: string; run_at: string; note: string; status: string; created_by: string; result: string | null }>(
      `SELECT s.id, s.site_id, x.name AS site_name, s.branch, s.run_at, s.note, s.status, s.created_by, s.result
       FROM schedules s JOIN sites x ON x.id = s.site_id WHERE s.run_at BETWEEN $1 AND $2 AND s.status <> 'cancelled' ORDER BY s.run_at`,
      [from.toISOString(), to.toISOString()],
    );
    const live = await ctx.db.query<{ id: string; site_id: string; site_name: string; at: string; actor: string; reason: string; version_id: number }>(
      `SELECT h.id::text AS id, h.site_id, x.name AS site_name, h.at, h.actor, h.reason, d.version_id
       FROM live_history h JOIN sites x ON x.id = h.site_id JOIN deployments d ON d.id = h.deployment_id
       WHERE h.at BETWEEN $1 AND $2 ORDER BY h.at`,
      [from.toISOString(), to.toISOString()],
    );
    const ok = (siteId: string) => canAccessSite(req.actor, siteId);
    return [
      ...sched.rows.filter((r) => ok(r.site_id)).map((r) => ({
        id: `s:${r.id}`,
        kind: "release" as const,
        siteId: r.site_id,
        siteName: r.site_name,
        at: new Date(r.run_at).toISOString(),
        branch: r.branch,
        note: r.note,
        status: r.status,
        by: r.created_by,
        result: r.result,
      })),
      ...live.rows.filter((r) => ok(r.site_id)).map((r) => ({
        id: `l:${r.id}`,
        kind: r.reason === "rollback" ? ("rollback" as const) : ("published" as const),
        siteId: r.site_id,
        siteName: r.site_name,
        at: new Date(r.at).toISOString(),
        branch: "main",
        note: "",
        status: "done",
        by: r.actor,
        versionId: Number(r.version_id),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  });
}
