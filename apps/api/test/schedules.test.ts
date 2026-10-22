import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDueSchedules } from "../src/schedules.js";
import type { AppContext } from "../src/server.js";
import { AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let ctx: AppContext;
let site = "";

const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const soon = () => new Date(Date.now() + 60_000).toISOString();
const makeDue = () => ctx.db.query("UPDATE schedules SET run_at = now() - interval '1 second' WHERE status = 'pending'");

beforeAll(async () => {
  ({ app, ctx } = await startTestServer({ DATABASE_URL: "pglite:memory" }));
  site = (await call("POST", "/api/sites", EDITOR, { name: "Launch Co", template: "landing" })).body.id;
});
afterAll(async () => app?.close());

describe("scheduled publishing", () => {
  it("publishes main at the set time", async () => {
    expect((await call("POST", `/api/sites/${site}/schedules`, AGENT, { runAt: soon() })).status).toBe(403);
    expect((await call("POST", `/api/sites/${site}/schedules`, EDITOR, { runAt: "2001-01-01T00:00:00Z" })).body.error).toContain("already passed");
    const s = await call("POST", `/api/sites/${site}/schedules`, EDITOR, { runAt: soon(), note: "Morning launch" });
    expect(s.status).toBe(201);
    expect((await call("POST", `/api/sites/${site}/schedules`, EDITOR, { runAt: soon() })).status).toBe(409);
    expect(await runDueSchedules(ctx)).toBe(0); // not yet
    await makeDue();
    expect(await runDueSchedules(ctx)).toBe(1);
    const list = (await call("GET", `/api/sites/${site}/schedules`, EDITOR)).body;
    expect(list[0]).toMatchObject({ status: "done", branch: "main", note: "Morning launch", createdBy: "editor (seed)" });
    expect(list[0].result).toContain("Published version");
    expect((await app.inject({ method: "GET", url: "/s/launch-co/" })).statusCode).toBe(200);
  });

  it("releases a branch: merges it and publishes, together", async () => {
    await call("POST", `/api/sites/${site}/branches`, EDITOR, { name: "black-friday" });
    await call("POST", `/api/sites/${site}/branches/black-friday/ops`, EDITOR, { ops: [{ op: "add_page", path: "/deals", title: "Deals", blocks: ["hero"] }] });
    await call("POST", `/api/sites/${site}/schedules`, EDITOR, { branch: "black-friday", runAt: soon() });
    expect((await app.inject({ method: "GET", url: "/s/launch-co/deals" })).statusCode).toBe(404);
    await makeDue();
    await runDueSchedules(ctx);
    expect((await app.inject({ method: "GET", url: "/s/launch-co/deals" })).statusCode).toBe(200);
  });

  it("won't overwrite main that changed since the branch started, and can be cancelled", async () => {
    await call("POST", `/api/sites/${site}/branches`, EDITOR, { name: "late" });
    await call("POST", `/api/sites/${site}/branches/late/ops`, EDITOR, { ops: [{ op: "add_page", path: "/late", title: "Late" }] });
    const head = (await call("GET", `/api/sites/${site}/branches/main`, EDITOR)).body;
    await call("POST", `/api/sites/${site}/branches/main/ops`, EDITOR, { ops: [{ op: "update_page", pageId: head.document.pages[0].id, title: "Changed on main" }] });
    await call("POST", `/api/sites/${site}/schedules`, EDITOR, { branch: "late", runAt: soon() });
    await makeDue();
    await runDueSchedules(ctx);
    const failed = (await call("GET", `/api/sites/${site}/schedules`, EDITOR)).body.find((x: { branch: string }) => x.branch === "late");
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.result).toContain("Main changed");

    const c = (await call("POST", `/api/sites/${site}/schedules`, EDITOR, { runAt: soon() })).body;
    expect((await app.inject({ method: "DELETE", url: `/api/sites/${site}/schedules/${c.id}`, headers: auth(EDITOR) })).statusCode).toBe(204);
    await makeDue();
    expect(await runDueSchedules(ctx)).toBe(0);
  });
});
