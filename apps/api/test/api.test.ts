import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, AGENT, auth, EDITOR, resetDb, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let siteId = "";
let rootId = "";

beforeAll(async () => {
  await resetDb();
  ({ app } = await startTestServer());
});
afterAll(async () => app?.close());

const call = async (method: string, url: string, token: string | null, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: token ? auth(token) : {}, payload: payload as never });
  return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res };
};
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

describe("auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await call("GET", "/api/sites", null)).status).toBe(401);
    expect((await call("GET", "/api/sites", "nope")).status).toBe(401);
    expect((await call("GET", "/api/me", AGENT)).body).toMatchObject({ role: "agent" });
  });

  it("only admins mint tokens", async () => {
    expect((await call("POST", "/api/tokens", EDITOR, { name: "x", role: "agent" })).status).toBe(403);
    const r = await call("POST", "/api/tokens", ADMIN, { name: "ci-bot", role: "agent" });
    expect(r.status).toBe(200);
    expect((await call("GET", "/api/me", r.body.token)).body).toMatchObject({ name: "ci-bot", role: "agent" });
  });
});

describe("sites and documents", () => {
  it("creates a site from a template", async () => {
    const r = await call("POST", "/api/sites", EDITOR, { name: "Acme Rockets", template: "saas" });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("acme-rockets");
    siteId = r.body.id;
    const again = await call("POST", "/api/sites", EDITOR, { name: "Acme Rockets" });
    expect(again.body.slug).toBe("acme-rockets-2");
  });

  it("reads the document and an outline", async () => {
    const r = await call("GET", `/api/sites/${siteId}/branches/main`, EDITOR);
    expect(r.body.document.pages[0].path).toBe("/");
    rootId = r.body.document.pages[0].root.id;
    const o = await call("GET", `/api/sites/${siteId}/branches/main?format=outline`, AGENT);
    expect(o.body.outline).toContain('section "Hero"');
  });

  it("applies operations and versions every change", async () => {
    const r = await call("POST", `/api/sites/${siteId}/branches/main/ops`, EDITOR, {
      ops: [{ op: "add_block", parentId: rootId, block: "contact-form", content: { headline: "Talk to sales" } }],
    });
    expect(r.status).toBe(200);
    expect(r.body.created[0]).toMatch(/^n_/);
    const versions = await call("GET", `/api/sites/${siteId}/branches/main/versions`, EDITOR);
    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].message).toBe("add contact-form");
  });

  it("rejects invalid operations and unsafe documents", async () => {
    expect((await call("POST", `/api/sites/${siteId}/branches/main/ops`, EDITOR, { ops: [{ op: "remove_node", nodeId: "missing" }] })).status).toBe(400);
    const head = await call("GET", `/api/sites/${siteId}/branches/main`, EDITOR);
    const doc = head.body.document;
    doc.pages[0].root.children[0].props.href = "javascript:alert(1)";
    const put = await call("PUT", `/api/sites/${siteId}/branches/main/document`, EDITOR, { document: doc, baseVersion: head.body.versionId });
    expect(put.status).toBe(400);
  });

  it("detects conflicting saves", async () => {
    const head = await call("GET", `/api/sites/${siteId}/branches/main`, EDITOR);
    const doc = head.body.document;
    const ok = await call("PUT", `/api/sites/${siteId}/branches/main/document`, EDITOR, { document: doc, baseVersion: head.body.versionId });
    expect(ok.status).toBe(200);
    const stale = await call("PUT", `/api/sites/${siteId}/branches/main/document`, EDITOR, { document: doc, baseVersion: head.body.versionId });
    expect(stale.status).toBe(409);
  });

  it("restores an earlier version", async () => {
    const versions = (await call("GET", `/api/sites/${siteId}/branches/main/versions`, EDITOR)).body;
    const first = versions[versions.length - 1].id;
    const r = await call("POST", `/api/sites/${siteId}/branches/main/restore`, EDITOR, { versionId: first });
    expect(r.status).toBe(200);
    const head = await call("GET", `/api/sites/${siteId}/branches/main`, EDITOR);
    expect(JSON.stringify(head.body.document)).not.toContain("Talk to sales");
  });
});

describe("agent guardrails, branches and merge", () => {
  it("blocks agents from editing main", async () => {
    const r = await call("POST", `/api/sites/${siteId}/branches/main/ops`, AGENT, { ops: [{ op: "set_theme", colors: { primary: "#000000" } }] });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/branch/);
  });

  it("lets agents work on a branch, then a person reviews and merges", async () => {
    expect((await call("POST", `/api/sites/${siteId}/branches`, AGENT, { name: "agent/rebrand" })).status).toBe(201);
    const ops = await call("POST", `/api/sites/${siteId}/branches/agent%2Frebrand/ops`, AGENT, {
      ops: [{ op: "set_theme", colors: { primary: "#e11d48" } }, { op: "add_page", path: "/pricing", title: "Pricing", blocks: ["navbar", "pricing", "footer"] }],
      message: "Rebrand to rose and add pricing page",
    });
    expect(ops.status).toBe(200);

    const diff = await call("GET", `/api/sites/${siteId}/branches/agent%2Frebrand/diff`, EDITOR);
    expect(diff.body.themeChanged).toBe(true);
    expect(diff.body.pagesAdded).toEqual(["/pricing"]);

    const agentMerge = await call("POST", `/api/sites/${siteId}/branches/agent%2Frebrand/merge`, AGENT, {});
    expect(agentMerge.status).toBe(403);
    expect(agentMerge.body.reviewUrl).toContain("review=1");

    const branches = (await call("GET", `/api/sites/${siteId}/branches`, EDITOR)).body;
    expect(branches.find((b: { name: string }) => b.name === "agent/rebrand").hasChanges).toBe(true);

    // Main moved since the branch was made (the restore above happened before; now edit again).
    const merge = await call("POST", `/api/sites/${siteId}/branches/agent%2Frebrand/merge`, EDITOR, {});
    expect(merge.status).toBe(200);
    const main = await call("GET", `/api/sites/${siteId}/branches/main`, EDITOR);
    expect(main.body.document.theme.colors.primary).toBe("#e11d48");
    expect(main.body.document.pages).toHaveLength(2);
  });

  it("refuses a plain merge when main moved, unless forced", async () => {
    await call("POST", `/api/sites/${siteId}/branches`, AGENT, { name: "agent/faq" });
    await call("POST", `/api/sites/${siteId}/branches/agent%2Ffaq/ops`, AGENT, { ops: [{ op: "add_block", parentId: rootId, block: "faq" }] });
    await call("POST", `/api/sites/${siteId}/branches/main/ops`, EDITOR, { ops: [{ op: "set_theme", radius: "4px" }] });
    expect((await call("POST", `/api/sites/${siteId}/branches/agent%2Ffaq/merge`, EDITOR, {})).status).toBe(409);
    expect((await call("POST", `/api/sites/${siteId}/branches/agent%2Ffaq/merge`, EDITOR, { force: true })).status).toBe(200);
  });

  it("serves signed branch previews", async () => {
    const p = await call("GET", `/api/sites/${siteId}/branches/main/preview-url`, AGENT);
    const path = new URL(p.body.url).pathname;
    const res = await app.inject({ method: "GET", url: path });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("noindex");
    const pricing = await app.inject({ method: "GET", url: path + "pricing" });
    expect(pricing.statusCode).toBe(200);
    expect(pricing.body).toContain("<title>Pricing</title>");
    const tampered = path.replace(/\/preview\/[^/]+/, "/preview/123.abc");
    expect((await app.inject({ method: "GET", url: tampered })).statusCode).toBe(403);
  });
});

describe("publishing, hosting and forms", () => {
  it("blocks agents from publishing and lets editors publish", async () => {
    expect((await call("POST", `/api/sites/${siteId}/publish`, AGENT, {})).status).toBe(403);
    const r = await call("POST", `/api/sites/${siteId}/publish`, EDITOR, {});
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("http://localhost:4000/s/acme-rockets");
    expect(r.body.files).toContain("pricing/index.html");
  });

  it("serves the published site, sitemap and 404", async () => {
    const home = await app.inject({ method: "GET", url: "/s/acme-rockets/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.body).toContain('<link rel="canonical" href="http://localhost:4000/s/acme-rockets/">');
    expect((await app.inject({ method: "GET", url: "/s/acme-rockets/pricing" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/s/acme-rockets/sitemap.xml" })).body).toContain("/pricing</loc>");
    expect((await app.inject({ method: "GET", url: "/s/acme-rockets/nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/s/acme-rockets/..%2F..%2Fetc" })).statusCode).toBe(404);
  });

  it("serves custom domains by Host header", async () => {
    await call("PATCH", `/api/sites/${siteId}`, EDITOR, { domain: "www.acme-rockets.test" });
    await call("POST", `/api/sites/${siteId}/publish`, EDITOR, {});
    const res = await app.inject({ method: "GET", url: "/", headers: { host: "www.acme-rockets.test" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="https://www.acme-rockets.test/"');
  });

  it("rolls back to an earlier deployment", async () => {
    const deps = (await call("GET", `/api/sites/${siteId}/deployments`, EDITOR)).body;
    expect(deps).toHaveLength(2);
    expect((await call("POST", `/api/sites/${siteId}/deployments/${deps[1].id}/rollback`, EDITOR, {})).status).toBe(200);
    const res = await app.inject({ method: "GET", url: "/s/acme-rockets/" });
    expect(res.body).toContain("http://localhost:4000/s/acme-rockets/");
  });

  it("accepts form submissions and lists them", async () => {
    const r = await app.inject({ method: "POST", url: `/forms/${siteId}/contact`, payload: { name: "Ada", email: "ada@example.com", message: "Hi" } });
    expect(r.statusCode).toBe(200);
    const form = await app.inject({ method: "POST", url: `/forms/${siteId}/contact`, headers: { "content-type": "application/x-www-form-urlencoded", referer: "http://x/s/acme-rockets/" }, payload: "name=Bob&email=b%40x.com" });
    expect(form.statusCode).toBe(303);
    const list = await call("GET", `/api/sites/${siteId}/forms`, EDITOR);
    expect(list.body).toHaveLength(2);
    expect(list.body[1].data).toMatchObject({ name: "Ada" });
    expect((await call("GET", `/api/sites/${siteId}/forms`, AGENT)).status).toBe(403);
  });

  it("uploads and serves images", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const up = await app.inject({ method: "POST", url: `/api/sites/${siteId}/assets?filename=logo.png`, headers: { ...auth(EDITOR), "content-type": "image/png" }, payload: png });
    expect(up.statusCode).toBe(201);
    const url = new URL(JSON.parse(up.body).url).pathname;
    const got = await app.inject({ method: "GET", url });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
  });

  it("keeps an audit log", async () => {
    const log = (await call("GET", `/api/sites/${siteId}/audit`, ADMIN)).body as { action: string }[];
    const actions = log.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["site.create", "branch.create", "branch.merge", "site.publish", "site.rollback"]));
  });
});
