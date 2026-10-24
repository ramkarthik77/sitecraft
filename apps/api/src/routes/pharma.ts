import type { FastifyInstance, FastifyRequest } from "fastify";
import { diffDocuments, JOB_CODE, summarizeChanges, type SiteDocument } from "@sitecraft/schema";
import { canAccessSite, parseTextArray, requireRole, type Actor } from "../auth.js";
import { HttpError } from "../errors.js";
import { EventBus } from "../events.js";
import type { SiteRow } from "../repo.js";
import { approvalStatus, listText } from "../reviews.js";
import type { AppContext } from "../server.js";

/**
 * Running regulated sites: where each site sits in the portfolio, MLR review
 * requests, what blocks publishing, each person's work queue and
 * notifications, and the organisation's audit trail with its integrity check.
 */

export const DISCIPLINES = ["medical", "legal", "regulatory"] as const;
export const AUDIENCES = ["hcp", "patient", "caregiver", "consumer", "corporate"] as const;
export const AUDIENCE_LABEL: Record<string, string> = { hcp: "HCP", patient: "Patient", caregiver: "Caregiver", consumer: "Consumer", corporate: "Corporate" };
const MARKET = /^([A-Z]{2}|GLOBAL)$/;
const UUID = /^[0-9a-f-]{36}$/i;

const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

/** Where a site sits and the rules it follows, for API output. */
export function siteProfile(s: SiteRow) {
  return {
    therapyArea: s.therapy_area ?? null,
    market: s.market ?? null,
    audience: s.audience ?? null,
    jobCode: s.job_code ?? null,
    reviewDisciplines: parseTextArray(s.review_disciplines),
    requireJobCodes: !!s.require_job_codes,
  };
}

export interface Blocker {
  kind: "job-code" | "asset-expired" | "asset-unapproved" | "asset-market";
  message: string;
  pageId?: string;
  assetId?: string;
}

/** What stops a site's main version from being published: missing job codes, and library assets it may not use. */
export async function publishBlockers(ctx: AppContext, site: SiteRow, doc: SiteDocument): Promise<Blocker[]> {
  const out: Blocker[] = [];
  if (site.require_job_codes) {
    for (const p of doc.pages) {
      if (p.unpublished || p.jobCode) continue;
      out.push({ kind: "job-code", pageId: p.id, message: `${p.path === "/" ? "Home" : p.path} has no job code.` });
    }
  }
  const ids = [...new Set((JSON.stringify(doc).match(/\/media\/library\/[0-9a-f-]{36}\./gi) ?? []).map((m) => m.slice(15, 51).toLowerCase()))];
  if (ids.length) {
    const { rows } = await ctx.db.query<{ id: string; title: string; file_name: string; status: string; expires_at: string | null; markets: unknown }>(
      "SELECT id, title, file_name, status, expires_at, markets FROM library_assets WHERE id = ANY($1::uuid[])",
      [ids],
    );
    for (const a of rows) {
      const name = `“${a.title || a.file_name}”`;
      if (a.expires_at && new Date(a.expires_at).getTime() < Date.now()) out.push({ kind: "asset-expired", assetId: a.id, message: `${name}'s usage rights expired on ${new Date(a.expires_at).toISOString().slice(0, 10)}. Replace it or renew the rights.` });
      else if (a.status !== "approved") out.push({ kind: "asset-unapproved", assetId: a.id, message: `${name} isn't approved for use (${a.status.replace("_", " ")}).` });
      const markets = parseTextArray(a.markets);
      if (markets.length && !markets.includes("GLOBAL") && (!site.market || !markets.includes(site.market))) {
        out.push({ kind: "asset-market", assetId: a.id, message: `${name} is cleared only for ${listText(markets)}${site.market ? `, not ${site.market}` : "; set this site's market"}.` });
      }
    }
  }
  return out;
}

export async function assertReadyToPublish(ctx: AppContext, site: SiteRow, doc: SiteDocument) {
  const blockers = await publishBlockers(ctx, site, doc);
  if (blockers.length) throw new HttpError(409, `This site can't be published yet: ${blockers[0]!.message}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ""}`, { blockers });
}

interface ReviewRow {
  id: string;
  site_id: string;
  branch: string;
  title: string;
  note: string;
  job_code: string;
  due_at: string | null;
  status: string;
  version_id: number;
  requested_by: string;
  requested_by_role: string;
  created_at: string;
  updated_at: string;
  site_name?: string;
  therapy_area?: string | null;
  market?: string | null;
  audience?: string | null;
  brand_name?: string | null;
}

export async function pharmaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, repo } = ctx;
  const audit = (siteId: string | null, actor: Actor, action: string, detail: Record<string, unknown>) =>
    db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, $4, $5)", [siteId, actor.name, actor.role, action, detail]);
  const notify = (siteId: string, branch: string, actor: Actor, message: string) =>
    EventBus.publish(db, { type: "approval", siteId, branch, actor: actor.name, actorRole: actor.role, message });
  const sitesFor = async (actor: Actor) => (await repo.listSites()).filter((s) => canAccessSite(actor, s.id));

  // ---- Where a site sits, and its rules ----------------------------------

  app.put<{ Params: { siteId: string } }>("/sites/:siteId/profile", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ therapyArea?: string | null; market?: string | null; audience?: string | null; jobCode?: string | null }>(req);
    const text = (v: string | null | undefined, max: number) => (v === undefined ? undefined : v === null || !String(v).trim() ? null : String(v).trim().slice(0, max));
    const market = text(b.market, 6)?.toUpperCase();
    if (market && !MARKET.test(market)) throw new HttpError(400, "Market is a two-letter country code like US, GB or DE, or GLOBAL.");
    const audience = text(b.audience, 20)?.toLowerCase();
    if (audience && !(AUDIENCES as readonly string[]).includes(audience)) throw new HttpError(400, `Audience is one of ${AUDIENCES.join(", ")}.`);
    const jobCode = text(b.jobCode, 40);
    if (jobCode && !JOB_CODE.test(jobCode)) throw new HttpError(400, "A job code uses letters, numbers, dots, dashes and slashes, like US-CAL-2400123.");
    const patch = { therapy_area: text(b.therapyArea, 80), market, audience, job_code: jobCode };
    const sets = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (sets.length) {
      await db.query(`UPDATE sites SET ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [site.id, ...sets.map(([, v]) => v)]);
      await audit(site.id, req.actor, "site.profile", Object.fromEntries(sets));
    }
    return siteProfile(await repo.getSite(site.id));
  });

  app.put<{ Params: { siteId: string } }>("/sites/:siteId/policy", async (req) => {
    requireRole(req.actor, "admin");
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ reviewDisciplines?: string[]; requireJobCodes?: boolean; requiredApprovals?: number }>(req);
    const sets: string[] = [];
    const args: unknown[] = [site.id];
    const detail: Record<string, unknown> = {};
    if (b.reviewDisciplines !== undefined) {
      if (!Array.isArray(b.reviewDisciplines)) throw new HttpError(400, "reviewDisciplines is a list.");
      const d = [...new Set(b.reviewDisciplines.map((x) => String(x).toLowerCase()))];
      const bad = d.filter((x) => !(DISCIPLINES as readonly string[]).includes(x));
      if (bad.length) throw new HttpError(400, `Review disciplines are ${DISCIPLINES.join(", ")}.`);
      sets.push(`review_disciplines = $${args.push(DISCIPLINES.filter((x) => d.includes(x)))}`);
      detail.reviewDisciplines = d;
    }
    if (b.requireJobCodes !== undefined) {
      sets.push(`require_job_codes = $${args.push(!!b.requireJobCodes)}`);
      detail.requireJobCodes = !!b.requireJobCodes;
    }
    if (b.requiredApprovals !== undefined) {
      if (!Number.isInteger(b.requiredApprovals) || b.requiredApprovals < 0 || b.requiredApprovals > 5) throw new HttpError(400, "requiredApprovals must be 0 to 5.");
      sets.push(`required_approvals = $${args.push(b.requiredApprovals)}`);
      detail.required = b.requiredApprovals;
    }
    if (sets.length) {
      await db.query(`UPDATE sites SET ${sets.join(", ")} WHERE id = $1`, args);
      await audit(site.id, req.actor, "site.policy", detail);
    }
    const s = await repo.getSite(site.id);
    return { ...siteProfile(s), requiredApprovals: Number(s.required_approvals ?? 0) };
  });

  app.get<{ Params: { siteId: string } }>("/sites/:siteId/readiness", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const head = await repo.getHead(site.id, "main");
    const blockers = await publishBlockers(ctx, site, head.document);
    return { ready: blockers.length === 0, blockers };
  });

  // ---- MLR review requests ----------------------------------------------

  const reviewSelect = `SELECT r.*, s.name AS site_name, s.therapy_area, s.market, s.audience, b.name AS brand_name
    FROM review_requests r JOIN sites s ON s.id = r.site_id LEFT JOIN brands b ON b.id = s.brand_id`;

  const reviewOut = async (r: ReviewRow, actor: Actor) => {
    const st = await approvalStatus(ctx, r.site_id, r.branch).catch(() => null);
    const open = r.status === "open";
    const status = open && st?.met ? "approved" : r.status;
    const mayFor = st ? st.disciplines.filter((d) => actor.local || (actor.disciplines ?? []).includes(d)) : [];
    const approvedByMe = !!st?.approvals.some((a) => a.approver === actor.name);
    const canReview =
      !!st && open && actor.role !== "agent" && !st.authors.includes(actor.name) && !approvedByMe && (st.disciplines.length === 0 || mayFor.some((d) => st.missing.includes(d)));
    return {
      id: r.id,
      siteId: r.site_id,
      siteName: r.site_name ?? "",
      brand: r.brand_name ?? null,
      therapyArea: r.therapy_area ?? null,
      market: r.market ?? null,
      audience: r.audience ?? null,
      branch: r.branch,
      title: r.title,
      note: r.note,
      jobCode: r.job_code || null,
      dueAt: iso(r.due_at),
      status,
      requestedBy: r.requested_by,
      requestedByRole: r.requested_by_role,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      byClaude: r.requested_by_role === "agent" || !!st?.byClaude,
      approvals: st ? { have: st.approvals.length, required: st.required, disciplines: st.disciplines, missing: st.missing, list: st.approvals } : null,
      authors: st?.authors ?? [],
      canReview,
      approvedByMe,
    };
  };

  const getReview = async (id: string, actor: Actor) => {
    if (!UUID.test(id)) throw new HttpError(404, "No such review.");
    const { rows } = await db.query<ReviewRow>(`${reviewSelect} WHERE r.id = $1`, [id]);
    const r = rows[0];
    if (!r || !canAccessSite(actor, r.site_id)) throw new HttpError(404, "No such review.");
    return r;
  };

  app.post<{ Params: { siteId: string; branch: string } }>("/sites/:siteId/branches/:branch/reviews", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const branch = req.params.branch;
    if (branch === "main") throw new HttpError(400, "Reviews are for branches. Make the change on a branch, then ask for review.");
    const br = await repo.getBranch(site.id, branch);
    if (br.head_version_id === br.base_version_id) throw new HttpError(400, "This branch has no changes to review yet.");
    const b = body<{ title?: string; note?: string; jobCode?: string; dueAt?: string }>(req);
    const title = (b.title ?? "").trim().slice(0, 160) || `Review ${branch}`;
    const jobCode = (b.jobCode ?? "").trim();
    if (jobCode && !JOB_CODE.test(jobCode)) throw new HttpError(400, "A job code uses letters, numbers, dots, dashes and slashes, like US-CAL-2400123.");
    if (b.dueAt && Number.isNaN(Date.parse(b.dueAt))) throw new HttpError(400, "dueAt must be a date like 2026-11-02T17:00:00Z.");
    const { rows: existing } = await db.query<{ id: string }>("SELECT id FROM review_requests WHERE site_id = $1 AND branch = $2 AND status IN ('open', 'changes_requested')", [site.id, branch]);
    if (existing[0]) throw new HttpError(409, "This branch already has a review in progress.", { reviewId: existing[0].id });
    const { rows } = await db.query<ReviewRow>(
      `INSERT INTO review_requests (site_id, branch, title, note, job_code, due_at, version_id, requested_by, requested_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [site.id, branch, title, (b.note ?? "").slice(0, 2000), jobCode || site.job_code || "", b.dueAt ? new Date(b.dueAt).toISOString() : null, br.head_version_id, req.actor.name, req.actor.role],
    );
    const r = rows[0]!;
    await db.query("INSERT INTO review_events (review_id, actor, actor_role, action, reason, version_id) VALUES ($1, $2, $3, 'request', $4, $5)", [r.id, req.actor.name, req.actor.role, r.note, br.head_version_id]);
    await audit(site.id, req.actor, "review.request", { reviewId: r.id, branch, title, jobCode: r.job_code || undefined, dueAt: r.due_at ? iso(r.due_at) : undefined });
    await notify(site.id, branch, req.actor, `asked for review: ${title}`);
    reply.status(201);
    return reviewOut((await getReview(r.id, req.actor)) as ReviewRow, req.actor);
  });

  const listReviews = async (actor: Actor, q: { status?: string; siteId?: string; mine?: string }) => {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.siteId) where.push(`r.site_id = $${args.push((await repo.getSite(q.siteId)).id)}`);
    if (q.status === "closed") where.push("r.status IN ('merged', 'withdrawn')");
    else if (q.status === "all") void 0;
    else where.push("r.status IN ('open', 'changes_requested')");
    if (q.mine === "1") where.push(`r.requested_by = $${args.push(actor.name)}`);
    const { rows } = await db.query<ReviewRow>(`${reviewSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.due_at NULLS LAST, r.created_at DESC LIMIT 300`, args);
    return Promise.all(rows.filter((r) => canAccessSite(actor, r.site_id)).map((r) => reviewOut(r, actor)));
  };

  app.get<{ Querystring: { status?: string; siteId?: string; mine?: string } }>("/reviews", async (req) => listReviews(req.actor, req.query));
  app.get<{ Params: { siteId: string }; Querystring: { status?: string } }>("/sites/:siteId/reviews", async (req) => listReviews(req.actor, { ...req.query, siteId: req.params.siteId }));

  app.get<{ Params: { id: string } }>("/reviews/:id", async (req) => {
    const r = await getReview(req.params.id, req.actor);
    const { rows: events } = await db.query<{ id: string; actor: string; actor_role: string; action: string; discipline: string; reason: string; version_id: number | null; created_at: string }>(
      "SELECT * FROM review_events WHERE review_id = $1 ORDER BY id",
      [r.id],
    );
    let changes: { added: number; removed: number; changed: number; pages: { path: string; title: string }[]; summary: string[] } | null = null;
    const head = await repo.getHead(r.site_id, r.branch).catch(() => null);
    if (head?.branch.base_version_id) {
      const base = await repo.getVersion(r.site_id, Number(head.branch.base_version_id)).catch(() => null);
      if (base) {
        const c = summarizeChanges(base.document, head.document);
        changes = { added: c.added, removed: c.removed, changed: c.changed, pages: c.pages.map((p) => ({ path: p.path, title: p.title })), summary: diffDocuments(base.document, head.document).summary.slice(0, 30) };
      }
    }
    return {
      ...(await reviewOut(r, req.actor)),
      changes,
      events: events.map((e) => ({ id: Number(e.id), actor: e.actor, role: e.actor_role, action: e.action, discipline: e.discipline || null, reason: e.reason, versionId: e.version_id === null ? null : Number(e.version_id), at: iso(e.created_at)! })),
    };
  });

  const event = (r: ReviewRow, actor: Actor, action: string, extra: { discipline?: string; reason?: string; versionId?: number } = {}) =>
    db.query("INSERT INTO review_events (review_id, actor, actor_role, action, discipline, reason, version_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      r.id,
      actor.name,
      actor.role,
      action,
      extra.discipline ?? "",
      extra.reason ?? "",
      extra.versionId ?? null,
    ]);

  // A reviewer sends the branch back with a reason.
  app.post<{ Params: { id: string } }>("/reviews/:id/changes", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const r = await getReview(req.params.id, req.actor);
    if (r.status !== "open") throw new HttpError(400, "Only a review that's waiting can be sent back.");
    const st = await approvalStatus(ctx, r.site_id, r.branch);
    if (st.authors.includes(req.actor.name)) throw new HttpError(403, "You changed this branch, so someone else reviews it.");
    const b = body<{ reason?: string; discipline?: string }>(req);
    const reason = (b.reason ?? "").trim().slice(0, 2000);
    if (!reason) throw new HttpError(400, "Say what needs to change.");
    const discipline = (b.discipline ?? "").toLowerCase();
    if (discipline && !(DISCIPLINES as readonly string[]).includes(discipline)) throw new HttpError(400, `Disciplines are ${DISCIPLINES.join(", ")}.`);
    await db.query("UPDATE review_requests SET status = 'changes_requested', updated_at = now() WHERE id = $1", [r.id]);
    await event(r, req.actor, "request_changes", { discipline, reason, versionId: st.versionId });
    await audit(r.site_id, req.actor, "review.changes", { reviewId: r.id, branch: r.branch, title: r.title, discipline: discipline || undefined, reason });
    await notify(r.site_id, r.branch, req.actor, `asked for changes: ${reason.slice(0, 60)}`);
    return reviewOut(await getReview(r.id, req.actor), req.actor);
  });

  // The author sends it back for review after making the changes.
  app.post<{ Params: { id: string } }>("/reviews/:id/resubmit", async (req) => {
    const r = await getReview(req.params.id, req.actor);
    if (r.status !== "changes_requested") throw new HttpError(400, "This review isn't waiting for changes.");
    const note = (body<{ note?: string }>(req).note ?? "").trim().slice(0, 2000);
    const head = await repo.getBranch(r.site_id, r.branch);
    await db.query("UPDATE review_requests SET status = 'open', version_id = $2, updated_at = now() WHERE id = $1", [r.id, head.head_version_id]);
    await event(r, req.actor, "resubmit", { reason: note, versionId: Number(head.head_version_id) });
    await audit(r.site_id, req.actor, "review.resubmit", { reviewId: r.id, branch: r.branch, title: r.title, note: note || undefined });
    await notify(r.site_id, r.branch, req.actor, "sent the branch for review again");
    return reviewOut(await getReview(r.id, req.actor), req.actor);
  });

  app.post<{ Params: { id: string } }>("/reviews/:id/withdraw", async (req) => {
    const r = await getReview(req.params.id, req.actor);
    if (r.requested_by !== req.actor.name && req.actor.role !== "admin") throw new HttpError(403, "Only the person who asked for the review, or an admin, can withdraw it.");
    if (!["open", "changes_requested"].includes(r.status)) throw new HttpError(400, "This review is already closed.");
    await db.query("UPDATE review_requests SET status = 'withdrawn', updated_at = now() WHERE id = $1", [r.id]);
    await event(r, req.actor, "withdraw");
    await audit(r.site_id, req.actor, "review.withdraw", { reviewId: r.id, branch: r.branch, title: r.title });
    return reviewOut(await getReview(r.id, req.actor), req.actor);
  });

  // ---- My work ------------------------------------------------------------

  app.get("/work", async (req) => {
    const actor = req.actor;
    const sites = await sitesFor(actor);
    const ids = new Set(sites.map((s) => s.id));
    const name = new Map(sites.map((s) => [s.id, s.name]));
    const items: { id: string; kind: "review" | "changes" | "claude" | "release" | "asset"; title: string; siteId?: string; siteName?: string; detail: string; due: string | null; link: string; reviewId?: string; branch?: string }[] = [];

    const reviews = await listReviews(actor, {});
    for (const r of reviews) {
      if (r.canReview) items.push({ id: `review:${r.id}`, kind: "review", title: r.title, siteId: r.siteId, siteName: r.siteName, detail: `${r.byClaude ? "Drafted by Claude · " : ""}${r.approvals ? `${r.approvals.have} of ${r.approvals.required} approvals` : ""}${r.jobCode ? ` · ${r.jobCode}` : ""}`, due: r.dueAt, link: `/reviews/${r.id}`, reviewId: r.id, branch: r.branch });
      else if (r.status === "changes_requested" && (r.requestedBy === actor.name || r.authors.includes(actor.name))) {
        items.push({ id: `changes:${r.id}`, kind: "changes", title: r.title, siteId: r.siteId, siteName: r.siteName, detail: "A reviewer asked for changes", due: r.dueAt, link: `/reviews/${r.id}`, reviewId: r.id, branch: r.branch });
      }
    }
    const inReview = new Set(reviews.map((r) => `${r.siteId}:${r.branch}`));

    // Claude's branches with changes nobody has picked up yet.
    if (actor.role !== "agent") {
      const { rows } = await db.query<{ site_id: string; name: string; actor: string; message: string; created_at: string }>(
        `SELECT b.site_id, b.name, v.actor, v.message, v.created_at FROM branches b JOIN versions v ON v.id = b.head_version_id
         WHERE b.name <> 'main' AND b.head_version_id <> COALESCE(b.base_version_id, -1) AND v.actor_role = 'agent' ORDER BY v.created_at DESC LIMIT 100`,
      );
      for (const b of rows) {
        if (!ids.has(b.site_id) || inReview.has(`${b.site_id}:${b.name}`)) continue;
        items.push({ id: `claude:${b.site_id}:${b.name}`, kind: "claude", title: b.message || `Changes on ${b.name}`, siteId: b.site_id, siteName: name.get(b.site_id), detail: `On ${b.name}`, due: null, link: `/sites/${b.site_id}?branch=${encodeURIComponent(b.name)}&review=1`, branch: b.name });
      }
    }

    const { rows: rel } = await db.query<{ id: string; site_id: string; branch: string; run_at: string; note: string }>(
      "SELECT id, site_id, branch, run_at, note FROM schedules WHERE status = 'pending' AND run_at < now() + interval '7 days' ORDER BY run_at",
    );
    for (const s of rel) {
      if (!ids.has(s.site_id)) continue;
      items.push({ id: `release:${s.id}`, kind: "release", title: s.note || (s.branch === "main" ? "Publish main" : `Release ${s.branch}`), siteId: s.site_id, siteName: name.get(s.site_id), detail: s.branch === "main" ? "Publishes main" : `Merges ${s.branch}, then publishes`, due: iso(s.run_at), link: `/releases`, branch: s.branch });
    }

    if (actor.role !== "agent" && !actor.siteIds) {
      const { rows: exp } = await db.query<{ id: string; title: string; file_name: string; expires_at: string; job_code: string }>(
        "SELECT id, title, file_name, expires_at, job_code FROM library_assets WHERE expires_at IS NOT NULL AND expires_at < now() + interval '30 days' ORDER BY expires_at LIMIT 50",
      );
      for (const a of exp) {
        const gone = new Date(a.expires_at).getTime() < Date.now();
        items.push({ id: `asset:${a.id}`, kind: "asset", title: `${gone ? "Replace" : "Renew or replace"} ${a.title || a.file_name}`, detail: `${gone ? "Rights expired" : "Rights expire"}${a.job_code ? ` · ${a.job_code}` : ""}`, due: iso(a.expires_at), link: `/assets?asset=${a.id}` });
      }
    }

    const order = { review: 0, changes: 1, claude: 2, release: 3, asset: 4 };
    items.sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : order[a.kind] - order[b.kind]));
    const count = (k: string) => items.filter((i) => i.kind === k).length;
    const soon = (k: string, days: number) => items.filter((i) => i.kind === k && i.due && new Date(i.due).getTime() < Date.now() + days * 864e5).length;
    return {
      items,
      counts: { review: count("review"), changes: count("changes"), claude: count("claude"), release: count("release"), asset: count("asset"), reviewDueToday: soon("review", 1), assetWithin7: soon("asset", 7) },
    };
  });

  // ---- Notifications ------------------------------------------------------

  const NOTIFY = ["review.request", "review.changes", "review.resubmit", "branch.approve", "branch.merge", "site.publish", "site.rollback", "schedule.failed", "approval.override", "branch.create"];

  app.get("/notifications", async (req) => {
    const actor = req.actor;
    const seen = await db.query<{ seen_at: string }>("SELECT seen_at FROM notification_reads WHERE actor = $1", [actor.name]);
    const seenAt = seen.rows[0]?.seen_at ? new Date(seen.rows[0].seen_at) : new Date(0);
    const { rows } = await db.query<{ id: string; site_id: string | null; actor: string; actor_role: string; action: string; detail: Record<string, unknown>; created_at: string; site_name: string | null }>(
      `SELECT a.id, a.site_id, a.actor, a.actor_role, a.action, a.detail, a.created_at, s.name AS site_name FROM audit_log a LEFT JOIN sites s ON s.id = a.site_id
       WHERE a.created_at > now() - interval '30 days' AND a.actor <> $1 AND a.action = ANY($2::text[]) ORDER BY a.seq DESC LIMIT 60`,
      [actor.name, NOTIFY],
    );
    const items = rows
      .filter((r) => (r.site_id ? canAccessSite(actor, r.site_id) : actor.role === "admin"))
      .filter((r) => r.action !== "branch.create" || r.actor_role === "agent")
      .map((r) => ({ id: String(r.id), siteId: r.site_id, siteName: r.site_name, actor: r.actor, role: r.actor_role, action: r.action, detail: r.detail, at: iso(r.created_at)!, unread: new Date(r.created_at) > seenAt }));
    return { items, unread: items.filter((i) => i.unread).length };
  });

  app.post("/notifications/seen", async (req) => {
    await db.query("INSERT INTO notification_reads (actor, seen_at) VALUES ($1, now()) ON CONFLICT (actor) DO UPDATE SET seen_at = now()", [req.actor.name]);
    return { ok: true };
  });

  // ---- The organisation's audit trail ------------------------------------

  app.get<{ Querystring: { before?: string; actor?: string; action?: string; siteId?: string; q?: string; limit?: string } }>("/audit", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const q = req.query;
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.before) {
      const n = Number(q.before);
      if (!Number.isInteger(n)) throw new HttpError(400, "before is an entry number.");
      where.push(`a.seq < $${args.push(n)}`);
    }
    if (q.actor) where.push(`a.actor = $${args.push(q.actor)}`);
    if (q.action) where.push(`a.action LIKE $${args.push(q.action.replace(/[%_\\]/g, (c) => "\\" + c) + "%")}`);
    if (q.siteId) where.push(`a.site_id = $${args.push((await repo.getSite(q.siteId)).id)}`);
    if (q.q?.trim()) where.push(`(a.detail::text ILIKE $${args.push(`%${q.q.trim().replace(/[%_\\]/g, (c) => "\\" + c)}%`)} OR a.actor ILIKE $${args.length})`);
    // Editors see what happened on their sites; organisation-wide entries are for admins.
    if (req.actor.role !== "admin") where.push("a.site_id IS NOT NULL");
    if (req.actor.siteIds) where.push(`a.site_id = ANY($${args.push(req.actor.siteIds)}::uuid[])`);
    const limit = Math.min(500, Number(q.limit) || 100);
    const { rows } = await db.query<{ seq: number; id: string; site_id: string | null; site_name: string | null; actor: string; actor_role: string; action: string; detail: Record<string, unknown>; created_at: string; hash: string }>(
      `SELECT a.seq, a.id, a.site_id, s.name AS site_name, a.actor, a.actor_role, a.action, a.detail, a.created_at, a.hash
       FROM audit_log a LEFT JOIN sites s ON s.id = a.site_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.seq DESC LIMIT ${limit}`,
      args,
    );
    const people = await db.query<{ actor: string; n: number }>("SELECT actor, count(*)::int AS n FROM audit_log GROUP BY actor ORDER BY n DESC LIMIT 50");
    return {
      items: rows.map((r) => ({ seq: Number(r.seq), id: `audit:${r.id}`, siteId: r.site_id, siteName: r.site_name, actor: r.actor, role: r.actor_role, action: r.action, detail: r.detail, at: iso(r.created_at)!, hash: r.hash })),
      people: people.rows.map((p) => ({ name: p.actor, count: Number(p.n) })),
    };
  });

  /**
   * Walk the whole chain: each entry's hash must match its contents and the
   * entry before it, with no gaps in the sequence. Returns the head to record
   * elsewhere, so removing the newest entries can be spotted too.
   */
  app.get("/audit/verify", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const { rows } = await db.query<{ seq: number; ok: boolean }>(
      `SELECT seq, (hash = audit_entry_hash(prev_hash, seq, id, site_id, actor, actor_role, action, detail, created_at)
          AND COALESCE(prev_hash, '') = COALESCE(lag(hash) OVER (ORDER BY seq), '')
          AND seq = COALESCE(lag(seq) OVER (ORDER BY seq), 0) + 1) AS ok
       FROM audit_log ORDER BY seq`,
    );
    const broken = rows.find((r) => !r.ok);
    const head = await db.query<{ seq: number; hash: string; created_at: string }>("SELECT seq, hash, created_at FROM audit_log ORDER BY seq DESC LIMIT 1");
    const h = head.rows[0];
    return {
      ok: !broken,
      entries: rows.length,
      brokenAt: broken ? Number(broken.seq) : null,
      head: h ? { seq: Number(h.seq), hash: h.hash, at: iso(h.created_at) } : null,
      checkedAt: new Date().toISOString(),
    };
  });

  // ---- Shared components, across brands ----------------------------------

  app.get("/components", async () => {
    const { rows } = await db.query<{ id: string; name: string; version: number; locked: boolean; components: { id: string; name: string; root?: { type?: string } }[]; sites: number; updated_at: string }>(
      "SELECT b.id, b.name, b.version, b.locked, b.components, b.updated_at, (SELECT count(*)::int FROM sites s WHERE s.brand_id = b.id) AS sites FROM brands b ORDER BY lower(b.name)",
    );
    return rows.flatMap((b) =>
      (b.components ?? []).map((c) => ({ id: c.id, name: c.name, type: c.root?.type ?? "stack", brandId: b.id, brandName: b.name, brandVersion: b.version, locked: b.locked, sites: Number(b.sites), updatedAt: iso(b.updated_at) })),
    );
  });
}
