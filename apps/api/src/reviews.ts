import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { actorForToken, parseTextArray, requireRole, type Actor } from "./auth.js";
import { HttpError } from "./errors.js";
import { EventBus } from "./events.js";
import type { AppContext } from "./server.js";

/**
 * Comments and approvals, so reviews happen in Sitecraft: comment on the site,
 * an element or a CMS item on a branch, and require people to approve a
 * branch's latest version before it's merged.
 */

interface CommentRow {
  id: string;
  site_id: string;
  branch: string;
  target_kind: "site" | "node" | "item";
  target_id: string | null;
  target_label: string;
  parent_id: string | null;
  body: string;
  author: string;
  author_role: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const commentOut = (r: CommentRow) => ({
  id: r.id,
  branch: r.branch,
  targetKind: r.target_kind,
  targetId: r.target_id,
  targetLabel: r.target_label,
  parentId: r.parent_id,
  body: r.body,
  author: r.author,
  authorRole: r.author_role,
  mentions: [...new Set((r.body.match(/@([\p{L}\p{N}_.-]+)/gu) ?? []).map((m) => m.slice(1)))],
  resolvedAt: iso(r.resolved_at),
  resolvedBy: r.resolved_by,
  createdAt: iso(r.created_at)!,
});

export interface ApprovalStatus {
  required: number;
  versionId: number;
  approvals: { approver: string; role: string; note: string; at: string; discipline: string; signed: boolean; meaning: string | null }[];
  /** People who changed this branch, and the people Claude worked for on it; they can't approve it. */
  authors: string[];
  /** True when Claude made any of the branch's changes. */
  byClaude: boolean;
  /** Disciplines that must each approve (MLR), and those still missing. */
  disciplines: string[];
  missing: string[];
  /** A reviewer sent the branch back and it hasn't been sent for review again. */
  changesRequested: boolean;
  met: boolean;
}

export async function approvalStatus(ctx: AppContext, siteId: string, branch: string): Promise<ApprovalStatus> {
  const site = await ctx.repo.getSite(siteId);
  const disciplines = parseTextArray(site.review_disciplines);
  const required = Math.max(Number(site.required_approvals ?? 0), disciplines.length);
  const b = await ctx.repo.getBranch(site.id, branch);
  const versionId = Number(b.head_version_id);
  const { rows } = await ctx.db.query<{ approver: string; approver_role: string; note: string; created_at: string; discipline: string; signature: { meaning?: string } | null }>(
    "SELECT approver, approver_role, note, created_at, discipline, signature FROM approvals WHERE site_id = $1 AND branch = $2 AND version_id = $3 ORDER BY created_at",
    [site.id, branch, versionId],
  );
  const { rows: auth } = await ctx.db.query<{ actor: string; actor_role: string; on_behalf_of: string | null }>(
    "SELECT DISTINCT actor, actor_role, on_behalf_of FROM versions WHERE site_id = $1 AND branch = $2 AND ($3::bigint IS NULL OR id > $3::bigint)",
    [site.id, branch, b.base_version_id],
  );
  const authors = [...new Set(auth.flatMap((a) => [a.actor, ...(a.on_behalf_of ? [a.on_behalf_of] : [])]))];
  const approvals = rows
    .filter((r) => !authors.includes(r.approver))
    .map((r) => ({ approver: r.approver, role: r.approver_role, note: r.note, at: new Date(r.created_at).toISOString(), discipline: r.discipline ?? "", signed: !!r.signature, meaning: r.signature?.meaning ?? null }));
  const covered = new Set(approvals.map((a) => a.discipline));
  const missing = disciplines.filter((d) => !covered.has(d));
  const { rows: sent } = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM review_requests WHERE site_id = $1 AND branch = $2 AND status = 'changes_requested'", [site.id, branch]);
  const changesRequested = Number(sent[0]?.n ?? 0) > 0;
  return {
    required,
    versionId,
    approvals,
    authors,
    byClaude: auth.some((a) => a.actor_role === "agent"),
    disciplines,
    missing,
    changesRequested,
    met: approvals.length >= required && missing.length === 0 && !changesRequested,
  };
}

/** Stop a merge (or a scheduled release) that doesn't have its approvals. Admins may override. */
export async function assertApproved(ctx: AppContext, actor: Actor, siteId: string, branch: string, override = false) {
  const st = await approvalStatus(ctx, siteId, branch);
  if (st.met) return;
  if (override && actor.role === "admin") {
    await ctx.db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'approval.override', $4)", [
      siteId,
      actor.name,
      actor.role,
      { branch, have: st.approvals.length, need: st.required, missing: st.missing, changesRequested: st.changesRequested },
    ]);
    return;
  }
  if (st.changesRequested) throw new HttpError(403, "A reviewer asked for changes to this branch. Make them and send it for review again.", { changesRequested: true });
  if (st.missing.length) {
    throw new HttpError(403, `This branch still needs sign-off from ${listText(st.missing)} review before it's merged.`, { missing: st.missing, approvals: st.approvals.length, required: st.required });
  }
  throw new HttpError(403, `This branch needs ${st.required} ${st.required === 1 ? "approval" : "approvals"} of its latest version before it's merged; it has ${st.approvals.length}.`, {
    approvals: st.approvals.length,
    required: st.required,
  });
}

export const listText = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export async function reviewRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, repo } = ctx;
  const body = <T>(req: FastifyRequest): T => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as T) : ({} as T));
  const notify = (siteId: string, branch: string, type: "comment" | "approval", actor: Actor, message: string) =>
    EventBus.publish(db, { type, siteId, branch, actor: actor.name, actorRole: actor.role, message });

  // ---- Comments -----------------------------------------------------------

  app.get<{ Params: { siteId: string }; Querystring: { branch?: string; all?: string } }>("/sites/:siteId/comments", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const args: unknown[] = [site.id];
    const where = ["site_id = $1"];
    if (req.query.branch) where.push(`branch = $${args.push(req.query.branch)}`);
    if (req.query.all !== "1") where.push("(resolved_at IS NULL OR resolved_at > now() - interval '14 days')");
    const { rows } = await db.query<CommentRow>(`SELECT * FROM comments WHERE ${where.join(" AND ")} ORDER BY created_at LIMIT 1000`, args);
    return rows.map(commentOut);
  });

  app.post<{ Params: { siteId: string } }>("/sites/:siteId/comments", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const b = body<{ branch?: string; targetKind?: string; targetId?: string; targetLabel?: string; body?: string; parentId?: string }>(req);
    const text = (b.body ?? "").trim();
    if (!text) throw new HttpError(400, "Write something first.");
    if (text.length > 5000) throw new HttpError(400, "Keep comments under 5,000 characters.");
    const branch = b.branch || "main";
    await repo.getBranch(site.id, branch);
    let kind = (["site", "node", "item"].includes(b.targetKind ?? "") ? b.targetKind : "site") as CommentRow["target_kind"];
    let targetId = b.targetId?.slice(0, 200) ?? null;
    let label = (b.targetLabel ?? "").slice(0, 120);
    if (b.parentId) {
      // Replies belong to their thread's target.
      const { rows } = await db.query<CommentRow>("SELECT * FROM comments WHERE id = $1 AND site_id = $2", [b.parentId, site.id]);
      const parent = rows[0];
      if (!parent) throw new HttpError(404, "The comment you're replying to is gone.");
      if (parent.parent_id) throw new HttpError(400, "Reply to the first comment in the thread.");
      kind = parent.target_kind;
      targetId = parent.target_id;
      label = parent.target_label;
    }
    if (kind === "site") targetId = null;
    const { rows } = await db.query<CommentRow>(
      "INSERT INTO comments (site_id, branch, target_kind, target_id, target_label, parent_id, body, author, author_role) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
      [site.id, branch, kind, targetId, label, b.parentId ?? null, text, req.actor.name, req.actor.role],
    );
    await notify(site.id, branch, "comment", req.actor, text.slice(0, 80));
    reply.status(201);
    return commentOut(rows[0]!);
  });

  const getComment = async (siteId: string, id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "No such comment.");
    const { rows } = await db.query<CommentRow>("SELECT * FROM comments WHERE id = $1 AND site_id = $2", [id, siteId]);
    if (!rows[0]) throw new HttpError(404, "No such comment.");
    return rows[0];
  };

  app.patch<{ Params: { siteId: string; id: string } }>("/sites/:siteId/comments/:id", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const c = await getComment(site.id, req.params.id);
    const b = body<{ resolved?: boolean; body?: string }>(req);
    if (b.body !== undefined) {
      if (c.author !== req.actor.name) throw new HttpError(403, "Only the person who wrote a comment can edit it.");
      if (!b.body.trim()) throw new HttpError(400, "Write something first.");
      await db.query("UPDATE comments SET body = $2 WHERE id = $1", [c.id, b.body.trim().slice(0, 5000)]);
    }
    if (b.resolved !== undefined) {
      if (c.parent_id) throw new HttpError(400, "Resolve the thread from its first comment.");
      await db.query(b.resolved ? "UPDATE comments SET resolved_at = now(), resolved_by = $2 WHERE id = $1" : "UPDATE comments SET resolved_at = NULL, resolved_by = NULL WHERE id = $1", b.resolved ? [c.id, req.actor.name] : [c.id]);
    }
    await notify(site.id, c.branch, "comment", req.actor, b.resolved ? "resolved a comment" : "updated a comment");
    return commentOut((await getComment(site.id, c.id)) as CommentRow);
  });

  app.delete<{ Params: { siteId: string; id: string } }>("/sites/:siteId/comments/:id", async (req, reply) => {
    const site = await repo.getSite(req.params.siteId);
    const c = await getComment(site.id, req.params.id);
    if (c.author !== req.actor.name && req.actor.role !== "admin") throw new HttpError(403, "Only the person who wrote a comment, or an admin, can delete it.");
    await db.query("DELETE FROM comments WHERE id = $1", [c.id]);
    await notify(site.id, c.branch, "comment", req.actor, "deleted a comment");
    reply.status(204);
  });

  // ---- Approvals ----------------------------------------------------------

  app.get<{ Params: { siteId: string; branch: string } }>("/sites/:siteId/branches/:branch/approvals", async (req) => {
    const st = await approvalStatus(ctx, req.params.siteId, req.params.branch);
    const mine = st.approvals.some((a) => a.approver === req.actor.name);
    let canApprove = !mine;
    let reason = "";
    if (req.actor.role === "agent") (canApprove = false), (reason = "Claude can't approve; a person reviews its work.");
    else if (st.authors.includes(req.actor.name)) (canApprove = false), (reason = "You changed this branch, or Claude did while working for you, so someone else approves it.");
    else if (req.params.branch === "main") (canApprove = false), (reason = "Approvals are for branches.");
    // With MLR on, you sign off for a discipline you review for.
    const mayFor = st.disciplines.filter((d) => req.actor.local || (req.actor.disciplines ?? []).includes(d));
    if (canApprove && st.disciplines.length && !mayFor.length) (canApprove = false), (reason = `This site needs ${listText(st.disciplines)} review. Ask an admin to make you a reviewer for one of them.`);
    return { ...st, approvedByMe: mine, canApprove, reason, myDisciplines: mayFor, needsSignature: st.disciplines.length > 0, signInWithToken: !req.actor.local };
  });

  app.post<{ Params: { siteId: string; branch: string } }>("/sites/:siteId/branches/:branch/approvals", async (req) => {
    requireRole(req.actor, "admin", "editor");
    const site = await repo.getSite(req.params.siteId);
    if (req.params.branch === "main") throw new HttpError(400, "Approvals are for branches.");
    const st = await approvalStatus(ctx, site.id, req.params.branch);
    if (st.authors.includes(req.actor.name)) throw new HttpError(403, "You changed this branch, or Claude did while working for you, so someone else needs to approve it.");
    const b = body<{ note?: string; discipline?: string; signature?: { name?: string; token?: string }; reviewId?: string }>(req);
    const discipline = (b.discipline ?? "").trim().toLowerCase();
    if (st.disciplines.length) {
      if (!discipline) throw new HttpError(400, `Say which review you're signing off: ${listText(st.disciplines)}.`);
      if (!st.disciplines.includes(discipline)) throw new HttpError(400, `This site's reviews are ${listText(st.disciplines)}.`);
    }
    if (discipline && !req.actor.local && !(req.actor.disciplines ?? []).includes(discipline)) throw new HttpError(403, `You aren't a ${discipline} reviewer. Ask an admin to add you.`);
    // MLR sign-off is an electronic signature: your name, and your sign-in again, bound to exactly what you saw.
    let signature: Record<string, unknown> | null = null;
    if (st.disciplines.length || b.signature) {
      const typed = (b.signature?.name ?? "").trim();
      if (!typed || typed.toLowerCase() !== req.actor.name.toLowerCase()) throw new HttpError(400, `Type your name exactly as it appears in Sitecraft (${req.actor.name}) to sign.`);
      if (!req.actor.local) {
        const again = b.signature?.token ? await actorForToken(db, b.signature.token).catch(() => null) : null;
        if (!again || again.tokenId !== req.actor.tokenId) throw new HttpError(401, "Enter your Sitecraft sign-in token again to sign. It must be the one you're signed in with.");
      }
      const v = await repo.getVersion(site.id, st.versionId);
      signature = {
        name: typed,
        meaning: discipline ? `Approved in ${discipline} review` : "Approved",
        method: req.actor.local ? "local" : "token",
        versionId: st.versionId,
        documentSha256: createHash("sha256").update(JSON.stringify(v.document)).digest("hex"),
        at: new Date().toISOString(),
      };
    }
    const note = (b.note ?? "").slice(0, 500);
    await db.query(
      `INSERT INTO approvals (site_id, branch, version_id, approver, approver_role, note, discipline, signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (site_id, branch, version_id, approver) DO NOTHING`,
      [site.id, req.params.branch, st.versionId, req.actor.name, req.actor.role, note, discipline, signature],
    );
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'branch.approve', $4)", [
      site.id,
      req.actor.name,
      req.actor.role,
      { branch: req.params.branch, versionId: st.versionId, discipline: discipline || undefined, note: note || undefined, signature: signature ? { meaning: signature.meaning, method: signature.method, documentSha256: signature.documentSha256 } : undefined },
    ]);
    // Log it on any open review of this branch.
    await db.query(
      "INSERT INTO review_events (review_id, actor, actor_role, action, discipline, reason, version_id) SELECT id, $3, $4, 'approve', $5, $6, $7 FROM review_requests WHERE site_id = $1 AND branch = $2 AND status = 'open'",
      [site.id, req.params.branch, req.actor.name, req.actor.role, discipline, note, st.versionId],
    );
    await notify(site.id, req.params.branch, "approval", req.actor, discipline ? `approved for ${discipline}` : "approved this branch");
    return approvalStatus(ctx, site.id, req.params.branch);
  });

  app.delete<{ Params: { siteId: string; branch: string } }>("/sites/:siteId/branches/:branch/approvals", async (req) => {
    const site = await repo.getSite(req.params.siteId);
    const r = await db.query("DELETE FROM approvals WHERE site_id = $1 AND branch = $2 AND approver = $3 RETURNING version_id", [site.id, req.params.branch, req.actor.name]);
    if (r.rows.length) {
      await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'branch.unapprove', $4)", [site.id, req.actor.name, req.actor.role, { branch: req.params.branch }]);
      await notify(site.id, req.params.branch, "approval", req.actor, "withdrew their approval");
    }
    return approvalStatus(ctx, site.id, req.params.branch);
  });

  app.put<{ Params: { siteId: string } }>("/sites/:siteId/approvals-required", async (req) => {
    requireRole(req.actor, "admin");
    const site = await repo.getSite(req.params.siteId);
    const { required } = body<{ required?: number }>(req);
    if (!Number.isInteger(required) || required! < 0 || required! > 5) throw new HttpError(400, "required must be 0 to 5.");
    await db.query("UPDATE sites SET required_approvals = $2 WHERE id = $1", [site.id, required]);
    await db.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'site.approvals', $4)", [site.id, req.actor.name, req.actor.role, { required }]);
    return { required };
  });
}
