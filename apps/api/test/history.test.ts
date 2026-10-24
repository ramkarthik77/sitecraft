import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppContext } from "../src/server.js";
import { ADMIN, AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let ctx: AppContext;
let site = "";

const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const head = async () => (await call("GET", `/api/sites/${site}/branches/main`, EDITOR)).body;
const ops = (operations: unknown[], message?: string) => call("POST", `/api/sites/${site}/branches/main/ops`, EDITOR, { ops: operations, message });

beforeAll(async () => {
  ({ app, ctx } = await startTestServer({ DATABASE_URL: "pglite:memory" }));
  site = (await call("POST", "/api/sites", EDITOR, { name: "Timeline Co", template: "landing" })).body.id;
});
afterAll(async () => app?.close());

describe("history", () => {
  it("records what each save changed, by page, and names versions", async () => {
    const root = (await head()).document.pages[0].root.id;
    await ops([{ op: "add_page", path: "/about", title: "About", blocks: ["text-section"] }], "Add about");
    await ops([{ op: "add_block", parentId: root, block: "cta" }], "Add a call to action");
    const list = (await call("GET", `/api/sites/${site}/branches/main/versions`, EDITOR)).body;
    expect(list[0]).toMatchObject({ message: "Add a call to action", kind: "edit", published: false });
    expect(list[0].changes.pages).toEqual([expect.objectContaining({ path: "/", added: expect.any(Number) })]);
    expect(list[1].changes.pages[0]).toMatchObject({ path: "/about", status: "added" });
    expect(list.at(-1).kind).toBe("create");

    // Only the saves that touched one page.
    const home = (await call("GET", `/api/sites/${site}/branches/main/versions?page=${encodeURIComponent((await head()).document.pages[0].id)}`, EDITOR)).body;
    expect(home.map((v: { message: string }) => v.message)).toEqual(["Add a call to action"]);

    expect((await call("PATCH", `/api/sites/${site}/versions/${list[1].id}`, AGENT, { label: "x" })).status).toBe(403);
    expect((await call("PATCH", `/api/sites/${site}/versions/${list[1].id}`, EDITOR, { label: "Before the CTA" })).status).toBe(200);
    const named = (await call("GET", `/api/sites/${site}/branches/main/versions?only=named`, EDITOR)).body;
    expect(named).toEqual([expect.objectContaining({ id: list[1].id, label: "Before the CTA" })]);
  });

  it("shows any version, compares it with now, and marks what went live", async () => {
    const list = (await call("GET", `/api/sites/${site}/branches/main/versions`, EDITOR)).body;
    const older = list[1];
    const v = (await call("GET", `/api/sites/${site}/versions/${older.id}`, EDITOR)).body;
    expect(v.document.pages.map((p: { path: string }) => p.path)).toEqual(["/", "/about"]);
    const d = (await call("GET", `/api/sites/${site}/versions/${older.id}/compare`, EDITOR)).body;
    expect(d.added.length).toBeGreaterThan(0); // the CTA added since
    expect(d.removed).toEqual([]);

    await call("POST", `/api/sites/${site}/publish`, EDITOR, {});
    const after = (await call("GET", `/api/sites/${site}/branches/main/versions`, EDITOR)).body;
    expect(after[0]).toMatchObject({ published: true, live: true });
    const live = (await call("GET", `/api/sites/${site}/live-at?at=${encodeURIComponent(new Date().toISOString())}`, EDITOR)).body.live;
    expect(live).toMatchObject({ versionId: after[0].id, reason: "publish" });
    expect((await call("GET", `/api/sites/${site}/live-at?at=2001-01-01T00:00:00Z`, EDITOR)).body.live).toBeNull();
    const cal = (await call("GET", "/api/calendar", EDITOR)).body;
    expect(cal).toContainEqual(expect.objectContaining({ kind: "published", siteName: "Timeline Co", versionId: after[0].id }));
  });

  it("restores one page, or one element, without touching the rest", async () => {
    const before = (await call("GET", `/api/sites/${site}/branches/main/versions`, EDITOR)).body;
    const doc = (await head()).document;
    const about = doc.pages.find((p: { path: string }) => p.path === "/about");
    const heading = about.root.children[0].children[0].children[0];
    // Change both pages, then put back only About.
    await ops([
      { op: "update_node", nodeId: heading.id, props: { text: "Changed about" } },
      { op: "update_page", pageId: doc.pages[0].id, title: "Changed home" },
    ]);
    const r = await call("POST", `/api/sites/${site}/branches/main/restore`, EDITOR, { versionId: before[0].id, pageId: about.id });
    expect(r.status).toBe(200);
    let now = (await head()).document;
    expect(JSON.stringify(now.pages.find((p: { id: string }) => p.id === about.id))).not.toContain("Changed about");
    expect(now.pages[0].title).toBe("Changed home");
    const restored = (await call("GET", `/api/sites/${site}/branches/main/versions`, EDITOR)).body[0];
    expect(restored).toMatchObject({ kind: "restore" });
    expect(restored.message).toMatch(/^Restore page \/about from version/);

    // Delete the heading, then bring just it back where it was.
    await ops([{ op: "remove_node", nodeId: heading.id }]);
    expect(JSON.stringify((await head()).document)).not.toContain(heading.id);
    expect((await call("POST", `/api/sites/${site}/branches/main/restore`, EDITOR, { versionId: before[0].id, nodeId: heading.id })).status).toBe(200);
    now = (await head()).document;
    expect(now.pages.find((p: { id: string }) => p.id === about.id).root.children[0].children[0].children[0].id).toBe(heading.id);

    // Agents restore on branches only, like any other edit.
    expect((await call("POST", `/api/sites/${site}/branches/main/restore`, AGENT, { versionId: before[0].id })).status).toBe(403);
  });

  it("moves a page with its children and redirects the old addresses", async () => {
    const doc = (await head()).document;
    await ops([{ op: "add_page", path: "/about/team", title: "Team", blocks: ["text-section"] }]);
    const about = doc.pages.find((p: { path: string }) => p.path === "/about");
    expect((await ops([{ op: "move_page", pageId: about.id, path: "/company" }])).status).toBe(200);
    const now = (await head()).document;
    expect(now.pages.map((p: { path: string }) => p.path).sort()).toEqual(["/", "/company", "/company/team"]);
    expect(now.settings.redirects).toEqual([
      { from: "/about", to: "/company" },
      { from: "/about/team", to: "/company/team" },
    ]);
    // Moving again doesn't chain redirects.
    await ops([{ op: "move_page", pageId: about.id, path: "/us" }]);
    expect((await head()).document.settings.redirects).toContainEqual({ from: "/about", to: "/us" });

    // Previews and published sites send old addresses on.
    const { url } = (await call("GET", `/api/sites/${site}/branches/main/preview-url`, EDITOR)).body;
    const res = await app.inject({ method: "GET", url: new URL(url).pathname + "about/team" });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toMatch(/\/us\/team$/);
    await call("POST", `/api/sites/${site}/publish`, EDITOR, {});
    const old = await app.inject({ method: "GET", url: "/s/timeline-co/company/team/" });
    expect(old.body).toContain('http-equiv="refresh"');
    expect(old.body).toContain("/s/timeline-co/us/team");
  });

  it("shows who did what on the site, and who can open it", async () => {
    const act = (await call("GET", `/api/sites/${site}/activity`, EDITOR)).body;
    const actions = act.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["version.edit", "version.restore", "site.create", "site.publish", "version.name"]));
    expect(actions).not.toContain("version.create");
    const edit = act.items.find((i: { action: string; detail: { message: string } }) => i.action === "version.edit" && i.detail.message === "Add about");
    expect(edit).toMatchObject({ actor: "editor (seed)", role: "editor" });
    expect(edit.detail.pages[0]).toMatchObject({ path: "/about" });
    expect(act.people).toContainEqual(expect.objectContaining({ name: "editor (seed)" }));
    // Filters.
    const pub = (await call("GET", `/api/sites/${site}/activity?kind=publishing`, EDITOR)).body.items;
    expect(pub.every((i: { action: string }) => ["site.publish", "site.rollback", "branch.merge", "schedule.create", "schedule.cancel", "schedule.failed"].includes(i.action))).toBe(true);
    expect(pub.length).toBeGreaterThan(0);
    expect((await call("GET", `/api/sites/${site}/activity`, AGENT)).status).toBe(403);
    const csv = await app.inject({ method: "GET", url: `/api/sites/${site}/activity.csv`, headers: auth(EDITOR) });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("when,who,role,action,details");

    // Access: everyone with a sign-in for all sites, plus one limited to this site; not one limited elsewhere.
    const other = (await call("POST", "/api/sites", EDITOR, { name: "Other Co", template: "blank" })).body.id;
    await call("POST", "/api/tokens", ADMIN, { name: "Priya (this site)", role: "editor", sites: [site] });
    await call("POST", "/api/tokens", ADMIN, { name: "Sam (other site)", role: "editor", sites: [other] });
    const access = (await call("GET", `/api/sites/${site}/access`, ADMIN)).body;
    const names = access.map((a: { name: string }) => a.name);
    expect(names).toContain("Priya (this site)");
    expect(names).not.toContain("Sam (other site)");
    expect(access.find((a: { name: string }) => a.name === "Priya (this site)")).toMatchObject({ role: "editor", scope: "this site", id: expect.any(String) });
    expect(access[0].role).toBe("admin");
    // Editors see who, not the ids needed to revoke.
    expect((await call("GET", `/api/sites/${site}/access`, EDITOR)).body.every((a: { id?: string }) => a.id === undefined)).toBe(true);
  });
  it("condenses old edits but keeps named, published and branch versions", async () => {
    const list = (await call("GET", `/api/sites/${site}/branches/main/versions?limit=200`, EDITOR)).body;
    const named = list.find((v: { label: string | null }) => v.label);
    // Pretend everything happened 200 days ago, on the same day.
    await ctx.db.query("UPDATE versions SET created_at = now() - interval '200 days' WHERE site_id = $1", [site]);
    const removed = await ctx.repo.pruneHistory(site, 90);
    expect(removed).toBeGreaterThan(0);
    const left = (await call("GET", `/api/sites/${site}/branches/main/versions?limit=200`, EDITOR)).body;
    expect(left.length).toBeLessThan(list.length);
    expect(left).toContainEqual(expect.objectContaining({ id: named.id, label: "Before the CTA" }));
    expect(left.filter((v: { published: boolean }) => v.published).length).toBe(list.filter((v: { published: boolean }) => v.published).length);
    expect(left[0].id).toBe(list[0].id);
    // Summaries are worked out again against the version now before each one.
    expect(left.every((v: { kind: string; changes: unknown }) => v.kind === "create" || v.changes)).toBe(true);
    expect((await head()).versionId).toBe(list[0].id);
    // The audit trail still has every save, and can't be changed.
    const edits = (await call("GET", `/api/sites/${site}/activity?kind=edits&limit=500`, EDITOR)).body.items;
    expect(edits.length).toBeGreaterThanOrEqual(list.length - 1);
    expect(edits.some((i: { detail: { message: string } }) => i.detail.message === "Add about")).toBe(true);
    await expect(ctx.db.query("DELETE FROM audit_log WHERE site_id = $1", [site])).rejects.toThrow(/append-only/);
    await expect(ctx.db.query("UPDATE audit_log SET actor = 'someone else' WHERE site_id = $1", [site])).rejects.toThrow(/append-only/);
  });

});
