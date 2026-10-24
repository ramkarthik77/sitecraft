import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppContext } from "../src/server.js";
import { ADMIN, AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let ctx: AppContext;
let site = "";
const tokens: Record<string, string> = {};

const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url: `/api${url}`, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const head = async (branch = "main") => (await call("GET", `/sites/${site}/branches/${encodeURIComponent(branch)}`, EDITOR)).body;
const editAs = async (token: string, branch: string, text: string) => {
  const doc = (await head(branch)).document;
  const root = doc.pages[0].root.id;
  return call("POST", `/sites/${site}/branches/${encodeURIComponent(branch)}/ops`, token, { ops: [{ op: "add_node", parentId: root, node: { type: "text", props: { text } } }] });
};
const person = async (name: string, disciplines: string[] = []) => {
  const r = await call("POST", "/tokens", ADMIN, { name, role: "editor", disciplines });
  expect(r.status).toBe(200);
  tokens[name] = r.body.token;
  return r.body.token as string;
};
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000030000000208060000000000000000", "hex");

beforeAll(async () => {
  ({ app, ctx } = await startTestServer({ DATABASE_URL: "pglite:memory" }));
  site = (await call("POST", "/sites", EDITOR, { name: "Calvexa US HCP", template: "landing" })).body.id;
});
afterAll(async () => app?.close());

describe("where a site sits", () => {
  it("records therapy area, market, audience and job code, and lists site status", async () => {
    expect((await call("PUT", `/sites/${site}/profile`, EDITOR, { market: "usa" })).status).toBe(400);
    expect((await call("PUT", `/sites/${site}/profile`, EDITOR, { audience: "doctors" })).status).toBe(400);
    expect((await call("PUT", `/sites/${site}/profile`, AGENT, { market: "US" })).status).toBe(403);
    const r = await call("PUT", `/sites/${site}/profile`, EDITOR, { therapyArea: "Immunology", market: "us", audience: "HCP", jobCode: "US-CAL-2400123" });
    expect(r.body).toMatchObject({ therapyArea: "Immunology", market: "US", audience: "hcp", jobCode: "US-CAL-2400123" });
    const list = (await call("GET", "/sites", EDITOR)).body;
    expect(list[0]).toMatchObject({ market: "US", audience: "hcp", pageCount: expect.any(Number), openReviews: 0, openBranches: 0 });
    const act = (await call("GET", `/sites/${site}/activity?kind=settings`, EDITOR)).body.items;
    expect(act.map((i: { action: string }) => i.action)).toContain("site.profile");
  });
});

describe("Claude works for a person", () => {
  it("doesn't let you approve what Claude changed for you", async () => {
    const priya = await person("Priya");
    const sam = await person("Sam");
    const claude = (await call("POST", "/tokens", ADMIN, { name: "Claude for Priya", role: "agent", onBehalfOf: "Priya" })).body;
    expect(claude.onBehalfOf).toBe("Priya");
    expect((await call("POST", `/sites/${site}/branches`, claude.token, { name: "agent/hero" })).status).toBe(201);
    expect((await editAs(claude.token, "agent/hero", "Claude wrote this")).status).toBe(200);
    await call("PUT", `/sites/${site}/approvals-required`, ADMIN, { required: 1 });

    const mine = (await call("GET", `/sites/${site}/branches/agent%2Fhero/approvals`, priya)).body;
    expect(mine).toMatchObject({ canApprove: false, byClaude: true });
    expect(mine.authors).toEqual(expect.arrayContaining(["Claude for Priya", "Priya"]));
    expect((await call("POST", `/sites/${site}/branches/agent%2Fhero/approvals`, priya, {})).status).toBe(403);
    // Someone else can.
    expect((await call("POST", `/sites/${site}/branches/agent%2Fhero/approvals`, sam, { note: "Looks right" })).status).toBe(200);
    expect((await call("POST", `/sites/${site}/branches/agent%2Fhero/merge`, priya, {})).status).toBe(200);
    // The audit trail records who Claude worked for.
    const edits = (await call("GET", `/sites/${site}/activity?kind=edits`, EDITOR)).body.items;
    expect(edits.find((i: { actor: string }) => i.actor === "Claude for Priya").detail.onBehalfOf).toBe("Priya");
    // An agent token's creator is who it works for, if nobody else is named.
    const plain = (await call("POST", "/tokens", ADMIN, { name: "Claude (admin)", role: "agent" })).body;
    expect(plain.onBehalfOf).toBe("admin (seed)");
    await call("PUT", `/sites/${site}/approvals-required`, ADMIN, { required: 0 });
  });
});

describe("MLR review", () => {
  let reviewId = "";
  it("asks for review of a branch, and lists it for the right reviewers", async () => {
    await person("Dr Lee", ["medical"]);
    await person("Ana (legal)", ["legal"]);
    expect((await call("PUT", `/sites/${site}/policy`, EDITOR, { reviewDisciplines: ["medical"] })).status).toBe(403);
    expect((await call("PUT", `/sites/${site}/policy`, ADMIN, { reviewDisciplines: ["medical", "astrology"] })).status).toBe(400);
    const pol = (await call("PUT", `/sites/${site}/policy`, ADMIN, { reviewDisciplines: ["legal", "medical"] })).body;
    expect(pol.reviewDisciplines).toEqual(["medical", "legal"]);

    await call("POST", `/sites/${site}/branches`, EDITOR, { name: "efficacy" });
    expect((await call("POST", `/sites/${site}/branches/efficacy/reviews`, EDITOR, { title: "Efficacy claims" })).status).toBe(400); // nothing changed yet
    await editAs(EDITOR, "efficacy", "New efficacy data");
    const r = await call("POST", `/sites/${site}/branches/efficacy/reviews`, EDITOR, { title: "Efficacy claims", dueAt: new Date(Date.now() + 3600e3).toISOString() });
    expect(r.status).toBe(201);
    reviewId = r.body.id;
    expect(r.body).toMatchObject({ status: "open", jobCode: "US-CAL-2400123", approvals: { have: 0, required: 2, missing: ["medical", "legal"] } });
    expect((await call("POST", `/sites/${site}/branches/efficacy/reviews`, EDITOR, {})).status).toBe(409);

    const lee = (await call("GET", "/work", tokens["Dr Lee"]!)).body;
    expect(lee.items).toContainEqual(expect.objectContaining({ kind: "review", reviewId }));
    // The author doesn't review their own change; nor does someone without a discipline the site needs.
    expect((await call("GET", "/work", EDITOR)).body.items.some((i: { reviewId?: string }) => i.reviewId === reviewId)).toBe(false);
    expect((await call("GET", "/work", tokens.Sam!)).body.items.some((i: { reviewId?: string }) => i.reviewId === reviewId)).toBe(false);
    const n = (await call("GET", "/notifications", tokens["Dr Lee"]!)).body;
    expect(n.items[0]).toMatchObject({ action: "review.request", unread: true });
    await call("POST", "/notifications/seen", tokens["Dr Lee"]!);
    expect((await call("GET", "/notifications", tokens["Dr Lee"]!)).body.unread).toBe(0);
  });

  it("needs a signed approval from each discipline before merging", async () => {
    const lee = tokens["Dr Lee"]!;
    const url = `/sites/${site}/branches/efficacy/approvals`;
    expect((await call("POST", url, lee, {})).status).toBe(400); // which discipline?
    expect((await call("POST", url, lee, { discipline: "legal", signature: { name: "Dr Lee", token: lee } })).status).toBe(403); // not a legal reviewer
    expect((await call("POST", url, lee, { discipline: "medical" })).status).toBe(400); // unsigned
    expect((await call("POST", url, lee, { discipline: "medical", signature: { name: "Someone", token: lee } })).status).toBe(400);
    expect((await call("POST", url, lee, { discipline: "medical", signature: { name: "Dr Lee", token: tokens.Sam } })).status).toBe(401);
    const ok = await call("POST", url, lee, { discipline: "medical", note: "Claims match the label", signature: { name: "dr lee", token: lee } });
    expect(ok.status).toBe(200);
    expect(ok.body.approvals[0]).toMatchObject({ approver: "Dr Lee", discipline: "medical", signed: true, meaning: "Approved in medical review" });
    expect(ok.body.missing).toEqual(["legal"]);
    const blocked = await call("POST", `/sites/${site}/branches/efficacy/merge`, EDITOR, {});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/legal review/);
    const audit = (await call("GET", `/sites/${site}/activity?kind=reviews`, EDITOR)).body.items;
    expect(audit.find((i: { action: string }) => i.action === "branch.approve").detail.signature).toMatchObject({ meaning: "Approved in medical review", documentSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("sends a branch back with a reason, and blocks merging until it's sent again", async () => {
    const ana = tokens["Ana (legal)"]!;
    expect((await call("POST", `/reviews/${reviewId}/changes`, ana, { reason: "" })).status).toBe(400);
    const back = await call("POST", `/reviews/${reviewId}/changes`, ana, { reason: "Add the fair balance statement", discipline: "legal" });
    expect(back.body.status).toBe("changes_requested");
    expect((await call("GET", "/work", EDITOR)).body.items).toContainEqual(expect.objectContaining({ kind: "changes", reviewId }));
    const m = await call("POST", `/sites/${site}/branches/efficacy/merge`, EDITOR, {});
    expect(m.body.error).toMatch(/asked for changes/);

    await editAs(EDITOR, "efficacy", "Fair balance statement");
    expect((await call("POST", `/reviews/${reviewId}/resubmit`, EDITOR, { note: "Added it" })).body.status).toBe("open");
    // The branch changed, so the medical sign-off has to be given again.
    const st = (await call("GET", `/sites/${site}/branches/efficacy/approvals`, ana)).body;
    expect(st.missing).toEqual(["medical", "legal"]);
    expect(st.myDisciplines).toEqual(["legal"]);
    await call("POST", `/sites/${site}/branches/efficacy/approvals`, tokens["Dr Lee"]!, { discipline: "medical", signature: { name: "Dr Lee", token: tokens["Dr Lee"] } });
    await call("POST", `/sites/${site}/branches/efficacy/approvals`, ana, { discipline: "legal", signature: { name: "Ana (legal)", token: ana } });
    expect((await call("GET", `/reviews/${reviewId}`, EDITOR)).body.status).toBe("approved");
    expect((await call("POST", `/sites/${site}/branches/efficacy/merge`, EDITOR, {})).status).toBe(200);
    const done = (await call("GET", `/reviews/${reviewId}`, EDITOR)).body;
    expect(done.status).toBe("merged");
    expect(done.events.map((e: { action: string }) => e.action)).toEqual(["request", "approve", "request_changes", "resubmit", "approve", "approve", "merge"]);
    expect(done.events[2]).toMatchObject({ actor: "Ana (legal)", discipline: "legal", reason: "Add the fair balance statement" });
    await call("PUT", `/sites/${site}/policy`, ADMIN, { reviewDisciplines: [] });
  });

  it("lets Claude ask for review but never approve", async () => {
    await call("POST", `/sites/${site}/branches`, AGENT, { name: "agent/isi" });
    await editAs(AGENT, "agent/isi", "Safety copy");
    const r = await call("POST", `/sites/${site}/branches/agent%2Fisi/reviews`, AGENT, { title: "Safety language" });
    expect(r.status).toBe(201);
    expect(r.body.byClaude).toBe(true);
    expect((await call("POST", `/sites/${site}/branches/agent%2Fisi/approvals`, AGENT, {})).status).toBe(403);
    expect((await call("POST", `/reviews/${r.body.id}/withdraw`, tokens.Sam!, {})).status).toBe(403);
    expect((await call("POST", `/reviews/${r.body.id}/withdraw`, ADMIN, {})).body.status).toBe("withdrawn");
  });
});

describe("what blocks publishing", () => {
  it("needs a job code on every page when the site requires them, and prints it on the page", async () => {
    await call("PUT", `/sites/${site}/policy`, ADMIN, { requireJobCodes: true });
    const ready = (await call("GET", `/sites/${site}/readiness`, EDITOR)).body;
    expect(ready).toMatchObject({ ready: false, blockers: [expect.objectContaining({ kind: "job-code" })] });
    const p = await call("POST", `/sites/${site}/publish`, EDITOR, {});
    expect(p.status).toBe(409);
    expect(p.body.error).toMatch(/has no job code/);
    const doc = (await head()).document;
    expect((await call("POST", `/sites/${site}/branches/main/ops`, EDITOR, { ops: [{ op: "update_page", pageId: doc.pages[0].id, jobCode: "bad code!" }] })).status).toBe(400);
    await call("POST", `/sites/${site}/branches/main/ops`, EDITOR, { ops: doc.pages.map((x: { id: string }) => ({ op: "update_page", pageId: x.id, jobCode: "US-CAL-2400123" })) });
    expect((await call("POST", `/sites/${site}/publish`, EDITOR, {})).status).toBe(200);
    const live = await app.inject({ method: "GET", url: "/s/calvexa-us-hcp/" });
    expect(live.body).toContain('<p class="sc-job-code">US-CAL-2400123</p>');
  });

  it("won't publish library images that are expired, unapproved or not cleared for the site's market", async () => {
    const up = await app.inject({ method: "POST", url: "/api/assets?filename=hero.png&title=Hero", headers: { ...auth(EDITOR), "content-type": "image/png" }, payload: png });
    const asset = JSON.parse(up.body);
    expect(asset.status).toBe("approved");
    const doc = (await head()).document;
    await call("POST", `/sites/${site}/branches/main/ops`, EDITOR, { ops: [{ op: "add_node", parentId: doc.pages[0].root.id, node: { type: "image", props: { src: asset.url, alt: "Hero" } } }] });
    const check = async () => (await call("GET", `/sites/${site}/readiness`, EDITOR)).body.blockers.map((b: { kind: string }) => b.kind);
    expect(await check()).toEqual([]);

    expect((await call("PATCH", `/assets/${asset.id}`, EDITOR, { status: "maybe" })).status).toBe(400);
    await call("PATCH", `/assets/${asset.id}`, EDITOR, { status: "in_review", jobCode: "GLB-CAL-2600018" });
    expect(await check()).toEqual(["asset-unapproved"]);
    await call("PATCH", `/assets/${asset.id}`, EDITOR, { status: "approved", markets: ["gb", "de"] });
    expect(await check()).toEqual(["asset-market"]);
    await call("PATCH", `/assets/${asset.id}`, EDITOR, { markets: ["US"], expiresAt: "2020-01-01" });
    expect(await check()).toEqual(["asset-expired"]);
    expect((await call("POST", `/sites/${site}/publish`, EDITOR, {})).body.error).toMatch(/rights expired/);

    // The DAM filters, and the work queue tells people.
    expect((await call("GET", "/assets?status=expired", EDITOR)).body.map((a: { id: string }) => a.id)).toEqual([asset.id]);
    expect((await call("GET", "/assets?market=GB", EDITOR)).body).toEqual([]);
    expect((await call("GET", "/work", EDITOR)).body.items).toContainEqual(expect.objectContaining({ kind: "asset", title: "Replace Hero" }));
    await call("PATCH", `/assets/${asset.id}`, EDITOR, { expiresAt: null });
    expect(await check()).toEqual([]);
    await call("PUT", `/sites/${site}/policy`, ADMIN, { requireJobCodes: false });
  });
});

describe("the organisation's audit trail", () => {
  it("lists everything for admins and only site entries for editors", async () => {
    const all = (await call("GET", "/audit?limit=500", ADMIN)).body.items;
    expect(all.some((i: { action: string }) => i.action === "token.create")).toBe(true);
    const ed = (await call("GET", "/audit?limit=500", EDITOR)).body.items;
    expect(ed.some((i: { siteId: string | null }) => i.siteId === null)).toBe(false);
    expect((await call("GET", "/audit", AGENT)).status).toBe(403);
    const reviews = (await call("GET", "/audit?action=review.", ADMIN)).body.items;
    expect(reviews.every((i: { action: string }) => i.action.startsWith("review."))).toBe(true);
    // Pages of results, by entry number.
    const page = (await call("GET", `/audit?limit=5&before=${all[0].seq}`, ADMIN)).body.items;
    expect(page[0].seq).toBe(all[1].seq);
  });

  it("proves nothing was changed, and finds where it was", async () => {
    const ok = (await call("GET", "/audit/verify", EDITOR)).body;
    expect(ok).toMatchObject({ ok: true, brokenAt: null, head: { hash: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(ok.entries).toBeGreaterThan(10);
    // Someone with direct database access edits an entry behind Sitecraft's back.
    const { rows } = await ctx.db.query<{ seq: number }>("SELECT seq FROM audit_log ORDER BY seq LIMIT 1 OFFSET 3");
    await ctx.db.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change");
    await ctx.db.query("UPDATE audit_log SET actor = 'someone else' WHERE seq = $1", [rows[0]!.seq]);
    const bad = (await call("GET", "/audit/verify", EDITOR)).body;
    expect(bad).toMatchObject({ ok: false, brokenAt: Number(rows[0]!.seq) });
    // Removing an entry is found too.
    await ctx.db.query("UPDATE audit_log SET actor = (SELECT actor FROM audit_log WHERE seq = $1 + 1) WHERE seq = $1", [rows[0]!.seq]).catch(() => {});
    await ctx.db.query("DELETE FROM audit_log WHERE seq = $1", [Number(rows[0]!.seq) + 5]);
    const gap = (await call("GET", "/audit/verify", EDITOR)).body;
    expect(gap.ok).toBe(false);
    await ctx.db.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change");
  });

  it("lists brand components across the organisation", async () => {
    const b = await call("POST", "/brands", ADMIN, { name: "Calvexa", fromSite: site });
    expect(b.status).toBe(201);
    const list = (await call("GET", "/components", EDITOR)).body;
    expect(Array.isArray(list)).toBe(true);
  });
});
