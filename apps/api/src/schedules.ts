import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Role } from "./auth.js";
import { HttpError } from "./errors.js";
import { publishVersion } from "./publish.js";
import { assertApproved } from "./reviews.js";
import { assertReadyToPublish } from "./routes/pharma.js";
import { libraryHelpers } from "./routes/library.js";
import type { AppContext } from "./server.js";

/**
 * Scheduled publishing. A schedule on main publishes main at a time; one on a
 * branch is a release: at that time the branch is merged into main and main
 * is published, so a launch (new pages, posts, a price change, taking a
 * promotion down) goes live together.
 */

interface ScheduleRow {
  id: string;
  site_id: string;
  branch: string;
  run_at: string;
  note: string;
  status: string;
  result: string | null;
  created_by: string;
  created_role: Role;
  created_at: string;
  finished_at: string | null;
}

const out = (r: ScheduleRow) => ({
  id: r.id,
  siteId: r.site_id,
  branch: r.branch,
  runAt: new Date(r.run_at).toISOString(),
  note: r.note,
  status: r.status,
  result: r.result,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

export async function scheduleRoutes(app: FastifyInstance, ctx: AppContext, assertCanShip: (actor: Actor, siteId: string, branch: string, what: string) => void) {
  const { db, repo } = ctx;
  const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));

  app.get<{ Params: { siteId: string } }>("/sites/:siteId/schedules", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const { rows } = await db.query<ScheduleRow>(
      "SELECT * FROM schedules WHERE site_id = $1 AND (status IN ('pending', 'running') OR finished_at > now() - interval '30 days') ORDER BY run_at DESC LIMIT 50",
      [site.id],
    );
    return rows.map(out);
  });

  app.post<{ Params: { siteId: string } }>("/sites/:siteId/schedules", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ branch?: string; runAt?: string; note?: string }>(req);
    const branch = b.branch || "main";
    assertCanShip(req.actor, site.id, branch, "schedule publishing");
    if (req.actor.role === "agent") throw new HttpError(403, "Only people can schedule publishing.");
    const at = Date.parse(b.runAt ?? "");
    if (Number.isNaN(at)) throw new HttpError(400, "runAt must be a date and time, like 2026-11-01T09:00:00Z.");
    if (at < Date.now() - 60_000) throw new HttpError(400, "That time has already passed.");
    if (at > Date.now() + 366 * 86_400_000) throw new HttpError(400, "Schedule within the next year.");
    await repo.getBranch(site.id, branch);
    const { rows: dup } = await db.query<{ id: string }>("SELECT id FROM schedules WHERE site_id = $1 AND branch = $2 AND status = 'pending'", [site.id, branch]);
    if (dup.length) throw new HttpError(409, `${branch} is already scheduled. Cancel that one first, or change its time.`);
    const { rows } = await db.query<ScheduleRow>(
      "INSERT INTO schedules (site_id, branch, run_at, note, created_by, created_role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [site.id, branch, new Date(at).toISOString(), (b.note ?? "").slice(0, 300), req.actor.name, req.actor.role],
    );
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'schedule.create', $4)", [site.id, req.actor.name, req.actor.role, { branch, runAt: new Date(at).toISOString() }]);
    reply.status(201);
    return out(rows[0]!);
  });

  app.delete<{ Params: { siteId: string; id: string } }>("/sites/:siteId/schedules/:id", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    if (req.actor.role === "agent") throw new HttpError(403, "Only people can change scheduled publishing.");
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, "No such schedule.");
    const { rows } = await db.query<ScheduleRow>("UPDATE schedules SET status = 'cancelled', finished_at = now() WHERE id = $1 AND site_id = $2 AND status = 'pending' RETURNING *", [req.params.id, site.id]);
    if (!rows[0]) throw new HttpError(404, "No pending schedule with that id.");
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'schedule.cancel', $4)", [site.id, req.actor.name, req.actor.role, { branch: rows[0].branch, runAt: rows[0].run_at }]);
    reply.status(204);
  });
}

/** Run every schedule that's due. Safe with several servers: each claims one row at a time. */
export async function runDueSchedules(ctx: AppContext): Promise<number> {
  const { db, repo } = ctx;
  const { syncBrand } = libraryHelpers(ctx);
  let ran = 0;
  for (;;) {
    const { rows } = await db.query<ScheduleRow>(
      `UPDATE schedules SET status = 'running' WHERE id = (
         SELECT id FROM schedules WHERE status = 'pending' AND run_at <= now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
    );
    const s = rows[0];
    if (!s) return ran;
    ran++;
    const actor: Actor = { name: `${s.created_by} (scheduled)`, role: s.created_role };
    try {
      const site = await repo.getSite(s.site_id);
      // Check what will go live before changing anything.
      await assertReadyToPublish(ctx, site, (await repo.getHead(site.id, s.branch)).document);
      if (s.branch !== "main") {
        // A release: it needs its approvals, and won't overwrite main if main changed since the branch started.
        await assertApproved(ctx, actor, site.id, s.branch);
        await repo.merge(actor, site.id, s.branch, false);
        await syncBrand(actor, site.id, "Keep the current brand after the release").catch(() => false);
      }
      const r = await publishVersion(ctx.cfg, repo, ctx.storage, actor, await repo.getSite(site.id), "main");
      await db.query("UPDATE schedules SET status = 'done', result = $2, finished_at = now() WHERE id = $1", [s.id, `Published version ${r.versionId} to ${r.url}`]);
    } catch (e) {
      const msg = e instanceof HttpError && e.status === 409 && !e.message.startsWith("This site can't be published") ? "Main changed after this branch was made, so it wasn't merged. Review the branch and schedule it again." : (e as Error).message;
      await db.query("UPDATE schedules SET status = 'failed', result = $2, finished_at = now() WHERE id = $1", [s.id, msg.slice(0, 500)]);
      await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'schedule.failed', $4)", [s.site_id, actor.name, actor.role, { branch: s.branch, error: msg.slice(0, 300) }]);
    }
  }
}
