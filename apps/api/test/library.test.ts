import type { FastifyInstance } from "fastify";
import type { SiteDocument } from "@sitecraft/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;

const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const doc = async (site: string, branch = "main"): Promise<SiteDocument> => (await call("GET", `/api/sites/${site}/branches/${encodeURIComponent(branch)}`, EDITOR)).body.document;
const ops = (site: string, branch: string, list: unknown[], token = EDITOR) => call("POST", `/api/sites/${site}/branches/${encodeURIComponent(branch)}/ops`, token, { ops: list });

beforeAll(async () => {
  ({ app } = await startTestServer({ DATABASE_URL: process.env.LIBRARY_TEST_DB ?? "pglite:memory" }));
});
afterAll(async () => app?.close());

describe("site templates", () => {
  it("saves a site as a template and starts new sites from it, renamed", async () => {
    const src = (await call("POST", "/api/sites", EDITOR, { name: "Northwind", template: "blog" })).body;
    const saved = await call("POST", "/api/site-templates", EDITOR, { siteId: src.id, name: "Launch kit", description: "Blog with a hero" });
    expect(saved.status).toBe(201);
    expect((await call("POST", "/api/site-templates", EDITOR, { siteId: src.id, name: "launch KIT" })).status).toBe(409);

    const list = (await call("GET", "/api/site-templates", AGENT)).body;
    expect(list).toEqual([expect.objectContaining({ name: "Launch kit", description: "Blog with a hero", pages: 3 })]);

    // By name (Claude) or id (editor).
    const site = (await call("POST", "/api/sites", AGENT, { name: "Contoso", template: "Launch kit" })).body;
    const d = await doc(site.id);
    expect(d.pages.map((p) => p.path)).toEqual(["/", "/blog", "/blog/:slug"]);
    expect(JSON.stringify(d)).toContain("Notes from Contoso");
    expect(JSON.stringify(d)).not.toContain("Northwind");
    expect(d.collections![0]!.items).toEqual([]); // items only when asked
    expect((await call("POST", "/api/sites", EDITOR, { name: "X", templateId: saved.body.id })).status).toBe(201);
    expect((await call("POST", "/api/sites", EDITOR, { name: "Y", template: "nope" })).body.error).toContain("no template called");

    expect((await call("DELETE", `/api/site-templates/${saved.body.id}`, AGENT)).status).toBe(403);
    expect((await call("DELETE", `/api/site-templates/${saved.body.id}`, EDITOR)).status).toBe(204);
  });
});

describe("brands", () => {
  let brandId = "";
  let siteA = "";
  let siteB = "";

  it("creates a brand from a site and applies it to other sites", async () => {
    siteA = (await call("POST", "/api/sites", EDITOR, { name: "Brand source", template: "landing" })).body.id;
    const src = await doc(siteA);
    // Make the navbar a reusable component and set brand colors on the source.
    const nav = src.pages[0]!.root.children![0]!;
    await ops(siteA, "main", [
      { op: "create_component", nodeId: nav.id, name: "Header" },
      { op: "set_theme", colors: { primary: "#0f766e" }, fonts: { heading: "'Fraunces', serif" } },
    ]);
    expect((await call("POST", "/api/brands", EDITOR, { name: "Teal", fromSite: siteA })).status).toBe(403);
    const made = await call("POST", "/api/brands", ADMIN, { name: "Teal", fromSite: siteA, guidelines: "Plain words. Never say 'synergy'.", locked: true });
    expect(made.status).toBe(201);
    brandId = made.body.id;
    expect(made.body).toMatchObject({ version: 1, locked: true, components: [{ name: "Header" }] });

    siteB = (await call("POST", "/api/sites", EDITOR, { name: "Follower", template: "saas" })).body.id;
    expect((await call("PUT", `/api/sites/${siteB}/brand`, ADMIN, { brandId: "Teal" })).body).toEqual({ brandId, changed: true });
    const d = await doc(siteB);
    expect(d.theme.colors.primary).toBe("#0f766e");
    expect(d.brand).toMatchObject({ name: "Teal", version: 1, locked: true, guidelines: "Plain words. Never say 'synergy'." });
    expect(d.components.find((c) => c.name === "Header")?.brandId).toBe(brandId);
    const outline = (await call("GET", `/api/sites/${siteB}/branches/main?format=outline`, AGENT)).body.outline;
    expect(outline).toContain("Brand: Teal (locked");
    expect(outline).toContain("Never say 'synergy'");
  });

  it("a locked brand blocks theme changes and off-brand colors, by operation or whole-document save", async () => {
    const d = await doc(siteB);
    const heading = d.pages[0]!.root.children![1]!.children![0]!.children![1]!;
    const theme = await ops(siteB, "main", [{ op: "set_theme", colors: { primary: "#ff0000" } }]);
    expect(theme.status).toBe(400);
    expect(theme.body.error).toContain("come from the Teal brand");
    const color = await ops(siteB, "main", [{ op: "update_node", nodeId: heading.id, style: { color: "#ff0000" } }]);
    expect(color.status).toBe(400);
    expect(color.body.error).toContain("#ff0000");
    // Brand colors and theme tokens are fine.
    const ok1 = await ops(siteB, "main", [{ op: "update_node", nodeId: heading.id, style: { color: "var(--color-primary)" } }]);
    expect(ok1.body.error ?? "").toBe("");
    expect((await ops(siteB, "main", [{ op: "update_node", nodeId: heading.id, style: { color: "#0f766e" } }])).status).toBe(200);
    // The brand's components can't be edited in the site.
    const header = d.components.find((c) => c.name === "Header")!;
    const edit = await ops(siteB, "main", [{ op: "update_node", nodeId: header.root.id, style: { padding: "4px" } }]);
    expect(edit.body.error).toContain("Edit it in Brands");
    // Whole-document saves (the editor) get the same rules.
    const head = await call("GET", `/api/sites/${siteB}/branches/main`, EDITOR);
    const bad = structuredClone(head.body.document) as SiteDocument;
    bad.theme.colors.primary = "#123456";
    const put = await call("PUT", `/api/sites/${siteB}/branches/main/document`, EDITOR, { document: bad, baseVersion: head.body.versionId });
    expect(put.status).toBe(400);
    const sneaky = structuredClone(head.body.document) as SiteDocument;
    delete sneaky.brand;
    expect((await call("PUT", `/api/sites/${siteB}/branches/main/document`, EDITOR, { document: sneaky, baseVersion: head.body.versionId })).status).toBe(400);
  });

  it("updating the brand rolls out to every site, and merges keep the current brand", async () => {
    // Unlock (v2), then start a branch, then change the brand color (v3).
    expect((await call("PATCH", `/api/brands/${brandId}`, ADMIN, { locked: false })).body).toMatchObject({ version: 2, updatedSites: 1, locked: false });
    await call("POST", `/api/sites/${siteB}/branches`, AGENT, { name: "agent/copy" });
    const theme = (await doc(siteB)).theme;
    const upd = await call("PATCH", `/api/brands/${brandId}`, ADMIN, { theme: { ...theme, colors: { ...theme.colors, primary: "#115e59" } } });
    expect(upd.body).toMatchObject({ version: 3, updatedSites: 1 });
    expect((await doc(siteB)).theme.colors.primary).toBe("#115e59");
    expect((await doc(siteB, "agent/copy")).theme.colors.primary).toBe("#0f766e"); // the branch is from before

    // Unlocked: off-brand colors are allowed but flagged in review.
    const bd = await doc(siteB, "agent/copy");
    const heading = bd.pages[0]!.root.children![1]!.children![0]!.children![1]!;
    expect((await ops(siteB, "agent/copy", [{ op: "update_node", nodeId: heading.id, style: { color: "#ff00ff" } }], AGENT)).status).toBe(200);
    const diff = (await call("GET", `/api/sites/${siteB}/branches/agent%2Fcopy/diff`, EDITOR)).body;
    expect(diff.brandIssues).toEqual([expect.stringContaining("#ff00ff, which isn't a Teal brand color")]);

    expect((await call("POST", `/api/sites/${siteB}/branches/agent%2Fcopy/merge`, EDITOR, { force: true })).status).toBe(200);
    const merged = await doc(siteB);
    expect(merged.theme.colors.primary).toBe("#115e59");
    expect(merged.brand?.version).toBe(3);
  });

  it("deleting a brand leaves sites with their current look", async () => {
    expect((await call("DELETE", `/api/brands/${brandId}`, ADMIN)).status).toBe(204);
    const d = await doc(siteB);
    expect(d.brand).toBeUndefined();
    expect(d.theme.colors.primary).toBe("#115e59");
    expect(d.components.every((c) => !c.brandId)).toBe(true);
  });
});
