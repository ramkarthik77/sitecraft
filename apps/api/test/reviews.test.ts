import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let site = "";
let reviewer = "";

const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

beforeAll(async () => {
  ({ app } = await startTestServer({ DATABASE_URL: "pglite:memory" }));
  site = (await call("POST", "/api/sites", EDITOR, { name: "Review Co", template: "landing" })).body.id;
  reviewer = (await call("POST", "/api/tokens", ADMIN, { name: "Riya (reviewer)", role: "editor" })).body.token;
});
afterAll(async () => app?.close());

describe("comments", () => {
  it("threads on elements and the site, with replies, mentions and resolving", async () => {
    await call("POST", `/api/sites/${site}/branches`, AGENT, { name: "agent/copy" });
    const doc = (await call("GET", `/api/sites/${site}/branches/agent%2Fcopy`, AGENT)).body.document;
    const hero = doc.pages[0].root.children[1].id;
    const c = await call("POST", `/api/sites/${site}/comments`, reviewer, { branch: "agent/copy", targetKind: "node", targetId: hero, targetLabel: "Hero", body: "@Claude make this shorter, please." });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ targetKind: "node", targetId: hero, mentions: ["Claude"], authorRole: "editor" });
    const reply = await call("POST", `/api/sites/${site}/comments`, AGENT, { branch: "agent/copy", parentId: c.body.id, body: "Done: cut it to one line." });
    expect(reply.body).toMatchObject({ parentId: c.body.id, targetId: hero }); // replies keep the thread's target
    expect((await call("POST", `/api/sites/${site}/comments`, EDITOR, { branch: "agent/copy", body: "  " })).status).toBe(400);
    expect((await call("PATCH", `/api/sites/${site}/comments/${c.body.id}`, AGENT, { body: "rewrite history" })).status).toBe(403);
    expect((await call("PATCH", `/api/sites/${site}/comments/${c.body.id}`, reviewer, { resolved: true })).body).toMatchObject({ resolvedBy: "Riya (reviewer)" });
    const list = (await call("GET", `/api/sites/${site}/comments?branch=agent/copy`, EDITOR)).body;
    expect(list).toHaveLength(2);
    expect((await call("DELETE", `/api/sites/${site}/comments/${reply.body.id}`, EDITOR)).status).toBe(403);
    expect((await call("DELETE", `/api/sites/${site}/comments/${reply.body.id}`, ADMIN)).status).toBe(204);
  });
});

describe("approvals", () => {
  it("merges need approvals of the latest version, from someone who didn't make the changes", async () => {
    expect((await call("PUT", `/api/sites/${site}/approvals-required`, EDITOR, { required: 1 })).status).toBe(403);
    expect((await call("PUT", `/api/sites/${site}/approvals-required`, ADMIN, { required: 1 })).body).toEqual({ required: 1 });

    await call("POST", `/api/sites/${site}/branches`, EDITOR, { name: "pricing" });
    const doc = (await call("GET", `/api/sites/${site}/branches/pricing`, EDITOR)).body.document;
    await call("POST", `/api/sites/${site}/branches/pricing/ops`, EDITOR, { ops: [{ op: "update_page", pageId: doc.pages[0].id, title: "New title" }] });

    const blocked = await call("POST", `/api/sites/${site}/branches/pricing/merge`, EDITOR, {});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toContain("needs 1 approval");

    const own = await call("GET", `/api/sites/${site}/branches/pricing/approvals`, EDITOR);
    expect(own.body).toMatchObject({ required: 1, canApprove: false, reason: expect.stringContaining("someone else") });
    expect((await call("POST", `/api/sites/${site}/branches/pricing/approvals`, EDITOR, {})).status).toBe(403);
    expect((await call("POST", `/api/sites/${site}/branches/pricing/approvals`, AGENT, {})).status).toBe(403);
    expect((await call("POST", `/api/sites/${site}/branches/pricing/approvals`, reviewer, { note: "Looks good" })).body).toMatchObject({ met: true });

    // A new change needs a new approval.
    await call("POST", `/api/sites/${site}/branches/pricing/ops`, EDITOR, { ops: [{ op: "update_page", pageId: doc.pages[0].id, title: "Newer title" }] });
    expect((await call("GET", `/api/sites/${site}/branches/pricing/approvals`, reviewer)).body).toMatchObject({ met: false, approvals: [] });
    expect((await call("POST", `/api/sites/${site}/branches/pricing/merge`, EDITOR, {})).status).toBe(403);
    // Admins can override, and it's recorded.
    expect((await call("POST", `/api/sites/${site}/branches/pricing/merge`, ADMIN, { override: true })).status).toBe(200);
    const audit = (await call("GET", `/api/sites/${site}/audit`, ADMIN)).body.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["approval.override", "branch.approve"]));
  });
});
