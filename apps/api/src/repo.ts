import type pg from "pg";
import { applyOperations, OperationError, validateDocument, type Operation, type SiteDocument } from "@sitecraft/schema";
import type { Actor } from "./auth.js";
import { tx, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import { EventBus } from "./events.js";

export interface SiteRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  created_by: string;
  created_at: string;
  current_deployment_id: string | null;
}

export interface BranchRow {
  site_id: string;
  name: string;
  head_version_id: number;
  base_version_id: number | null;
  created_by: string;
  created_at: string;
  merged_at: string | null;
}

export interface VersionMeta {
  id: number;
  branch: string;
  parent_id: number | null;
  message: string;
  actor: string;
  actor_role: string;
  created_at: string;
}

const BRANCH_RE = /^[a-z0-9][a-z0-9._/-]{0,62}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function slugify(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "site";
}

async function audit(q: pg.PoolClient | Db, siteId: string | null, actor: Actor, action: string, detail: Record<string, unknown> = {}) {
  await q.query("INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, $4, $5)", [siteId, actor.name, actor.role, action, detail]);
}

export class Repo {
  constructor(private db: Db) {}

  async listSites(): Promise<(SiteRow & { updated_at: string })[]> {
    const { rows } = await this.db.query(
      `SELECT s.*, COALESCE((SELECT max(created_at) FROM versions v WHERE v.site_id = s.id), s.created_at) AS updated_at
       FROM sites s ORDER BY updated_at DESC`,
    );
    return rows;
  }

  async getSite(idOrSlug: string): Promise<SiteRow> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const { rows } = await this.db.query<SiteRow>(`SELECT * FROM sites WHERE ${isUuid ? "id = $1" : "slug = $1"}`, [idOrSlug]);
    if (!rows[0]) throw new HttpError(404, `Site "${idOrSlug}" not found.`);
    return rows[0];
  }

  async findSiteByHost(host: string, sitesDomain?: string): Promise<SiteRow | null> {
    const h = host.toLowerCase().split(":")[0]!;
    const { rows } = await this.db.query<SiteRow>("SELECT * FROM sites WHERE domain = $1", [h]);
    if (rows[0]) return rows[0];
    if (sitesDomain && h.endsWith("." + sitesDomain)) {
      const slug = h.slice(0, -(sitesDomain.length + 1));
      const r = await this.db.query<SiteRow>("SELECT * FROM sites WHERE slug = $1", [slug]);
      return r.rows[0] ?? null;
    }
    return null;
  }

  async createSite(actor: Actor, input: { name: string; slug?: string; document: SiteDocument }): Promise<SiteRow> {
    const v = validateDocument(input.document);
    if (!v.ok) throw new HttpError(400, "Invalid site document", { errors: v.errors });
    let slug = input.slug ? input.slug.toLowerCase() : slugify(input.name);
    if (!SLUG_RE.test(slug)) throw new HttpError(400, "Slug may use lowercase letters, numbers and dashes.");
    return tx(this.db, async (c) => {
      if (!input.slug) {
        // Auto-suffix generated slugs until one is free.
        const base = slug;
        for (let i = 2; (await c.query("SELECT 1 FROM sites WHERE slug = $1", [slug])).rowCount; i++) slug = `${base}-${i}`;
      }
      const ins = await c.query<SiteRow>("INSERT INTO sites (name, slug, created_by) VALUES ($1, $2, $3) RETURNING *", [input.name, slug, actor.name]).catch((e) => {
        if (e.code === "23505") throw new HttpError(409, `The slug "${slug}" is taken.`);
        throw e;
      });
      const site = ins.rows[0]!;
      const ver = await c.query<{ id: number }>(
        "INSERT INTO versions (site_id, branch, document, message, actor, actor_role) VALUES ($1, 'main', $2, 'Create site', $3, $4) RETURNING id",
        [site.id, v.document, actor.name, actor.role],
      );
      await c.query("INSERT INTO branches (site_id, name, head_version_id, created_by) VALUES ($1, 'main', $2, $3)", [site.id, ver.rows[0]!.id, actor.name]);
      await audit(c, site.id, actor, "site.create", { slug });
      return site;
    });
  }

  async updateSite(actor: Actor, siteId: string, patch: { name?: string; domain?: string | null }): Promise<SiteRow> {
    if (patch.domain !== undefined && patch.domain !== null && !/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(patch.domain)) {
      throw new HttpError(400, "Domain should look like www.example.com");
    }
    const { rows } = await this.db
      .query<SiteRow>(
        "UPDATE sites SET name = COALESCE($2, name), domain = CASE WHEN $3::boolean THEN $4 ELSE domain END WHERE id = $1 RETURNING *",
        [siteId, patch.name ?? null, patch.domain !== undefined, patch.domain?.toLowerCase() ?? null],
      )
      .catch((e) => {
        if (e.code === "23505") throw new HttpError(409, "That domain is already used by another site.");
        throw e;
      });
    if (!rows[0]) throw new HttpError(404, "Site not found.");
    await audit(this.db, siteId, actor, "site.update", patch);
    return rows[0];
  }

  async deleteSite(actor: Actor, siteId: string) {
    await this.db.query("DELETE FROM sites WHERE id = $1", [siteId]);
    await audit(this.db, null, actor, "site.delete", { siteId });
  }

  async listBranches(siteId: string): Promise<(BranchRow & { head_actor: string; head_message: string; head_at: string })[]> {
    const { rows } = await this.db.query(
      `SELECT b.*, v.actor AS head_actor, v.message AS head_message, v.created_at AS head_at
       FROM branches b JOIN versions v ON v.id = b.head_version_id
       WHERE b.site_id = $1 ORDER BY (b.name = 'main') DESC, v.created_at DESC`,
      [siteId],
    );
    return rows;
  }

  async getBranch(siteId: string, name: string, c: pg.PoolClient | Db = this.db, lock = false): Promise<BranchRow> {
    const { rows } = await c.query<BranchRow>(`SELECT * FROM branches WHERE site_id = $1 AND name = $2${lock ? " FOR UPDATE" : ""}`, [siteId, name]);
    if (!rows[0]) throw new HttpError(404, `Branch "${name}" not found.`);
    return rows[0];
  }

  async createBranch(actor: Actor, siteId: string, name: string, from = "main"): Promise<BranchRow> {
    if (!BRANCH_RE.test(name) || name === "main") throw new HttpError(400, "Branch names use lowercase letters, numbers, dots, dashes and slashes (and can't be main).");
    return tx(this.db, async (c) => {
      const src = await this.getBranch(siteId, from, c);
      const { rows } = await c
        .query<BranchRow>(
          "INSERT INTO branches (site_id, name, head_version_id, base_version_id, created_by) VALUES ($1, $2, $3, $3, $4) RETURNING *",
          [siteId, name, src.head_version_id, actor.name],
        )
        .catch((e) => {
          if (e.code === "23505") throw new HttpError(409, `Branch "${name}" already exists.`);
          throw e;
        });
      await audit(c, siteId, actor, "branch.create", { name, from });
      await EventBus.publish(c, { type: "branch", siteId, branch: name, actor: actor.name, actorRole: actor.role, message: `Created branch ${name}` });
      return rows[0]!;
    });
  }

  async deleteBranch(actor: Actor, siteId: string, name: string) {
    if (name === "main") throw new HttpError(400, "The main branch can't be deleted.");
    const r = await this.db.query("DELETE FROM branches WHERE site_id = $1 AND name = $2", [siteId, name]);
    if (!r.rowCount) throw new HttpError(404, `Branch "${name}" not found.`);
    await audit(this.db, siteId, actor, "branch.delete", { name });
  }

  async getVersion(siteId: string, versionId: number): Promise<VersionMeta & { document: SiteDocument }> {
    const { rows } = await this.db.query("SELECT * FROM versions WHERE site_id = $1 AND id = $2", [siteId, versionId]);
    if (!rows[0]) throw new HttpError(404, `Version ${versionId} not found.`);
    return rows[0];
  }

  async getHead(siteId: string, branch: string): Promise<{ versionId: number; document: SiteDocument; branch: BranchRow }> {
    const b = await this.getBranch(siteId, branch);
    const v = await this.getVersion(siteId, b.head_version_id);
    return { versionId: v.id, document: v.document, branch: b };
  }

  async listVersions(siteId: string, branch: string, limit = 50): Promise<VersionMeta[]> {
    const { rows } = await this.db.query<VersionMeta>(
      "SELECT id, branch, parent_id, message, actor, actor_role, created_at FROM versions WHERE site_id = $1 AND branch = $2 ORDER BY id DESC LIMIT $3",
      [siteId, branch, Math.min(limit, 200)],
    );
    return rows;
  }

  /**
   * Commit a new head for a branch. With baseVersion set, fails with 409 if
   * someone else committed first, so editors never silently overwrite agents.
   */
  async commit(
    actor: Actor,
    siteId: string,
    branchName: string,
    next: (current: SiteDocument, headId: number) => { document: SiteDocument; message: string },
    baseVersion?: number,
  ): Promise<{ versionId: number; document: SiteDocument }> {
    return tx(this.db, async (c) => {
      const b = await this.getBranch(siteId, branchName, c, true);
      if (baseVersion !== undefined && baseVersion !== b.head_version_id) {
        throw new HttpError(409, "This branch changed since you loaded it. Reload to get the latest version.", { headVersionId: b.head_version_id });
      }
      const cur = await c.query<{ document: SiteDocument }>("SELECT document FROM versions WHERE id = $1", [b.head_version_id]);
      const { document, message } = next(cur.rows[0]!.document, b.head_version_id);
      const v = validateDocument(document);
      if (!v.ok) throw new HttpError(400, "Invalid site document", { errors: v.errors });
      const ins = await c.query<{ id: number }>(
        "INSERT INTO versions (site_id, branch, parent_id, document, message, actor, actor_role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [siteId, branchName, b.head_version_id, v.document, message.slice(0, 500), actor.name, actor.role],
      );
      const id = ins.rows[0]!.id;
      await c.query("UPDATE branches SET head_version_id = $3 WHERE site_id = $1 AND name = $2", [siteId, branchName, id]);
      await EventBus.publish(c, { type: "version", siteId, branch: branchName, versionId: id, actor: actor.name, actorRole: actor.role, message });
      return { versionId: id, document: v.document };
    });
  }

  async applyOps(actor: Actor, siteId: string, branch: string, ops: Operation[], message: string | undefined, baseVersion?: number) {
    let created: (string | null)[] = [];
    const r = await this.commit(
      actor,
      siteId,
      branch,
      (cur) => {
        try {
          const res = applyOperations(cur, ops);
          created = res.created;
          return { document: res.document, message: message || summarizeOps(ops) };
        } catch (e) {
          if (e instanceof OperationError) throw new HttpError(400, e.message);
          throw e;
        }
      },
      baseVersion,
    );
    return { ...r, created };
  }

  /** Merge a branch into main. Fast-forwards when main hasn't moved; otherwise needs force. */
  async merge(actor: Actor, siteId: string, branchName: string, force = false) {
    if (branchName === "main") throw new HttpError(400, "Pick a branch other than main to merge.");
    return tx(this.db, async (c) => {
      const main = await this.getBranch(siteId, "main", c, true);
      const b = await this.getBranch(siteId, branchName, c, true);
      if (b.head_version_id === b.base_version_id) throw new HttpError(400, "This branch has no changes to merge.");
      if (main.head_version_id !== b.base_version_id && !force) {
        throw new HttpError(409, "Main has changed since this branch was created. Review the diff and merge with force to take the branch version.", {
          mainHead: main.head_version_id,
          branchBase: b.base_version_id,
        });
      }
      const doc = await c.query<{ document: SiteDocument }>("SELECT document FROM versions WHERE id = $1", [b.head_version_id]);
      const ins = await c.query<{ id: number }>(
        "INSERT INTO versions (site_id, branch, parent_id, document, message, actor, actor_role) VALUES ($1, 'main', $2, $3, $4, $5, $6) RETURNING id",
        [siteId, main.head_version_id, doc.rows[0]!.document, `Merge branch ${branchName}`, actor.name, actor.role],
      );
      const id = ins.rows[0]!.id;
      await c.query("UPDATE branches SET head_version_id = $2 WHERE site_id = $1 AND name = 'main'", [siteId, id]);
      // Rebase the branch on the merge so it can keep being used.
      await c.query("UPDATE branches SET base_version_id = $3, head_version_id = $3, merged_at = now() WHERE site_id = $1 AND name = $2", [siteId, branchName, id]);
      await audit(c, siteId, actor, "branch.merge", { branch: branchName, versionId: id, force });
      await EventBus.publish(c, { type: "version", siteId, branch: "main", versionId: id, actor: actor.name, actorRole: actor.role, message: `Merged ${branchName}` });
      return { versionId: id };
    });
  }

  async recordDeployment(actor: Actor, siteId: string, versionId: number, url: string, files: string[], deploymentId: string) {
    return tx(this.db, async (c) => {
      await c.query("INSERT INTO deployments (id, site_id, version_id, url, files, actor) VALUES ($1, $2, $3, $4, $5, $6)", [
        deploymentId,
        siteId,
        versionId,
        url,
        JSON.stringify(files),
        actor.name,
      ]);
      await c.query("UPDATE sites SET current_deployment_id = $2 WHERE id = $1", [siteId, deploymentId]);
      await audit(c, siteId, actor, "site.publish", { versionId, deploymentId });
      await EventBus.publish(c, { type: "deploy", siteId, versionId, actor: actor.name, actorRole: actor.role, message: `Published to ${url}` });
    });
  }

  async listDeployments(siteId: string) {
    const { rows } = await this.db.query("SELECT id, version_id, url, actor, created_at FROM deployments WHERE site_id = $1 ORDER BY created_at DESC LIMIT 50", [siteId]);
    return rows;
  }

  async rollback(actor: Actor, siteId: string, deploymentId: string) {
    const r = await this.db.query("UPDATE sites SET current_deployment_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM deployments WHERE id = $2 AND site_id = $1)", [siteId, deploymentId]);
    if (!r.rowCount) throw new HttpError(404, "Deployment not found.");
    await audit(this.db, siteId, actor, "site.rollback", { deploymentId });
  }

  async addSubmission(siteId: string, form: string, data: Record<string, string>) {
    await this.db.query("INSERT INTO form_submissions (site_id, form, data) VALUES ($1, $2, $3)", [siteId, form, data]);
  }

  async listSubmissions(siteId: string) {
    const { rows } = await this.db.query("SELECT id, form, data, created_at FROM form_submissions WHERE site_id = $1 ORDER BY id DESC LIMIT 500", [siteId]);
    return rows;
  }

  async addAsset(actor: Actor, siteId: string, fileName: string, contentType: string, size: number): Promise<{ id: string }> {
    const { rows } = await this.db.query<{ id: string }>(
      "INSERT INTO assets (site_id, file_name, content_type, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [siteId, fileName, contentType, size, actor.name],
    );
    return rows[0]!;
  }

  async listAssets(siteId: string) {
    const { rows } = await this.db.query("SELECT id, file_name, content_type, size_bytes, created_at FROM assets WHERE site_id = $1 ORDER BY created_at DESC", [siteId]);
    return rows;
  }

  async getAsset(siteId: string, id: string) {
    const { rows } = await this.db.query("SELECT * FROM assets WHERE site_id = $1 AND id = $2", [siteId, id]);
    return rows[0] ?? null;
  }

  async listAudit(siteId: string) {
    const { rows } = await this.db.query("SELECT actor, actor_role, action, detail, created_at FROM audit_log WHERE site_id = $1 ORDER BY id DESC LIMIT 200", [siteId]);
    return rows;
  }
}

export function summarizeOps(ops: Operation[]): string {
  const parts = ops.slice(0, 4).map((o) => {
    switch (o.op) {
      case "add_block":
        return `add ${o.block}`;
      case "add_node":
        return `add ${o.node.type}`;
      case "update_node":
        return o.props?.text !== undefined ? "edit text" : o.style ? "restyle" : "edit element";
      case "add_page":
        return `add page ${o.path}`;
      default:
        return o.op.replace(/_/g, " ");
    }
  });
  return parts.join(", ") + (ops.length > 4 ? ` (+${ops.length - 4} more)` : "");
}
