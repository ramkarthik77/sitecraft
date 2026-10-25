import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000030000000208060000000000000000", "hex");
const call = async (method: string, url: string, payload?: unknown, token = EDITOR) => {
  const res = await app.inject({ method: method as never, url: `/api${url}`, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const upload = async (folderId?: string) =>
  JSON.parse((await app.inject({ method: "POST", url: `/api/assets?filename=a.png${folderId ? `&folderId=${folderId}` : ""}`, headers: { ...auth(EDITOR), "content-type": "image/png" }, payload: png })).body);

beforeAll(async () => void ({ app } = await startTestServer({ DATABASE_URL: "pglite:memory" })));
afterAll(async () => app?.close());

describe("asset folders", () => {
  it("nests folders, uploads into one, moves assets and filters by folder", async () => {
    expect((await call("POST", "/folders", { kind: "asset", name: "  " })).status).toBe(400);
    expect((await call("POST", "/folders", { kind: "asset", name: "X" }, AGENT)).status).toBe(403);
    const brand = (await call("POST", "/folders", { kind: "asset", name: "Calvexa" })).body;
    const camp = (await call("POST", "/folders", { kind: "asset", name: "Autumn campaign", parentId: brand.id })).body;
    expect(camp.parentId).toBe(brand.id);
    expect((await call("POST", "/folders", { kind: "asset", name: "autumn CAMPAIGN", parentId: brand.id })).status).toBe(409);
    // Same name is fine somewhere else.
    expect((await call("POST", "/folders", { kind: "asset", name: "Autumn campaign" })).status).toBe(201);

    const a = await upload(camp.id);
    expect(a.folderId).toBe(camp.id);
    const b = await upload();
    expect(b.folderId).toBeNull();
    expect((await call("GET", `/assets?folder=${camp.id}`)).body.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await call("GET", "/assets?folder=none")).body.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect((await call("PATCH", `/assets/${b.id}`, { folderId: brand.id })).body.folderId).toBe(brand.id);
    const list = (await call("GET", "/folders?kind=asset")).body;
    expect(list.find((f: { id: string }) => f.id === camp.id).count).toBe(1);

    // No loops, and renaming works.
    expect((await call("PATCH", `/folders/${brand.id}`, { parentId: camp.id })).status).toBe(400);
    expect((await call("PATCH", `/folders/${camp.id}`, { name: "Autumn 2026" })).body.name).toBe("Autumn 2026");

    // Deleting a folder keeps its assets and subfolders, one level up.
    expect((await call("DELETE", `/folders/${brand.id}`)).status).toBe(204);
    expect((await call("GET", `/assets?folder=none`)).body.map((x: { id: string }) => x.id)).toContain(b.id);
    const after = (await call("GET", "/folders?kind=asset")).body;
    expect(after.find((f: { id: string }) => f.id === camp.id).parentId).toBeNull();
  });

  it("files sites in folders, like a content tree", async () => {
    const ta = (await call("POST", "/folders", { kind: "site", name: "Immunology" })).body;
    const br = (await call("POST", "/folders", { kind: "site", name: "Calvexa", parentId: ta.id })).body;
    // Site and asset folders are separate trees.
    expect((await call("POST", "/folders", { kind: "asset", name: "x", parentId: br.id })).status).toBe(404);
    const s1 = (await call("POST", "/sites", { name: "Calvexa US", template: "blank", folderId: br.id })).body;
    expect(s1.folderId).toBe(br.id);
    const s2 = (await call("POST", "/sites", { name: "Loose site", template: "blank" })).body;
    expect((await call("PUT", `/sites/${s2.id}/folder`, { folderId: ta.id })).body.folderId).toBe(ta.id);
    expect((await call("PUT", `/sites/${s2.id}/folder`, { folderId: ta.id }, AGENT)).status).toBe(403);
    const tree = (await call("GET", "/folders?kind=site")).body;
    expect(tree.map((f: { name: string; count: number }) => [f.name, f.count])).toEqual([
      ["Calvexa", 1],
      ["Immunology", 1],
    ]);
    expect((await call("GET", "/folders?kind=page")).status).toBe(400);
    await call("DELETE", `/folders/${br.id}`);
    expect((await call("GET", `/sites/${s1.id}`)).body.folderId).toBe(ta.id);
  });
});
