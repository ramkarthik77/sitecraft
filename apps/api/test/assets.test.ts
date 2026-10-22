import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageSize, sniffImage } from "../src/images.js";
import { ADMIN, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
// A real 3×2 PNG header (IHDR) is enough for type and size checks.
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const upload = (buf: Buffer, type = "image/png", q = "filename=team-photo.png", token = EDITOR) =>
  app.inject({ method: "POST", url: `/api/assets?${q}`, headers: { ...auth(token), "content-type": type }, payload: buf });
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const res = await app.inject({ method: method as never, url, headers: auth(token), payload: payload as never });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

beforeAll(async () => {
  ({ app } = await startTestServer({ DATABASE_URL: process.env.LIBRARY_TEST_DB ?? "pglite:memory" }));
});
afterAll(async () => app?.close());

describe("image checks", () => {
  it("reads sizes and real types", () => {
    expect(sniffImage(png(3, 2))).toBe("image/png");
    expect(imageSize(png(3, 2))).toEqual({ width: 3, height: 2 });
    expect(sniffImage(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });
});

describe("asset library", () => {
  let asset: { id: string; url: string };

  it("uploads with metadata, and refuses files that aren't the image they claim", async () => {
    const r = await upload(png(1200, 800), "image/png", "filename=team-photo.png&tags=Team,People");
    expect(r.statusCode).toBe(201);
    asset = r.json();
    expect(r.json()).toMatchObject({ title: "team photo", width: 1200, height: 800, tags: ["team", "people"], focalX: 0.5 });
    expect((await upload(Buffer.from("<svg onload=alert(1)>"), "image/png")).statusCode).toBe(415);
    expect((await upload(png(1, 1), "image/jpeg")).json().error).toContain("really image/png");
    // Site uploads get the same check now.
    const site = (await call("POST", "/api/sites", EDITOR, { name: "Pics", template: "blank" })).body;
    expect((await app.inject({ method: "POST", url: `/api/sites/${site.id}/assets`, headers: { ...auth(EDITOR), "content-type": "image/gif" }, payload: Buffer.from("GIF89a<script>") })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/sites/${site.id}/assets`, headers: { ...auth(EDITOR), "content-type": "image/gif" }, payload: Buffer.from("<script>") })).statusCode).toBe(415);
  });

  it("edits metadata and finds images by text and tag", async () => {
    const r = await call("PATCH", `/api/assets/${asset.id}`, EDITOR, { alt: "Our team at the spring offsite", credit: "Photo: Sam Lee", tags: ["team", "offsite"], focalX: 0.3, focalY: 1.4 });
    expect(r.body).toMatchObject({ alt: "Our team at the spring offsite", focalX: expect.closeTo(0.3, 5), focalY: 1, tags: ["team", "offsite"] });
    await upload(png(10, 10), "image/png", "filename=logo.png&tags=brand");
    expect((await call("GET", "/api/assets?q=offsite", EDITOR)).body.map((a: { id: string }) => a.id)).toEqual([asset.id]);
    expect((await call("GET", "/api/assets?tag=brand", EDITOR)).body).toHaveLength(1);
    expect((await call("GET", "/api/assets/tags", EDITOR)).body).toEqual(expect.arrayContaining([{ tag: "team", count: 1 }, { tag: "brand", count: 1 }]));
  });

  it("shows where an image is used and guards deletes", async () => {
    const site = (await call("POST", "/api/sites", EDITOR, { name: "Team page", template: "blog" })).body;
    await call("POST", `/api/sites/${site.id}/branches/main/ops`, EDITOR, { ops: [{ op: "update_item", collectionId: "blog", itemId: "how-we-work", values: { cover_image: asset.url } }] });
    const usage = (await call("GET", `/api/assets/${asset.id}/usage`, EDITOR)).body;
    expect(usage).toEqual([expect.objectContaining({ siteName: "Team page", where: ["Blog: 1 item"] })]);
    const blocked = await call("DELETE", `/api/assets/${asset.id}`, EDITOR);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("Team page");
  });

  it("replacing keeps the address; expired images stop being served", async () => {
    const path = new URL(asset.url).pathname;
    expect((await app.inject({ method: "GET", url: path })).headers["content-type"]).toBe("image/png");
    const rep = await app.inject({ method: "PUT", url: `/api/assets/${asset.id}/file`, headers: { ...auth(EDITOR), "content-type": "image/png" }, payload: png(1600, 900) });
    expect(rep.json()).toMatchObject({ url: asset.url, width: 1600, version: 2 });
    await call("PATCH", `/api/assets/${asset.id}`, EDITOR, { expiresAt: "2001-01-01" });
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(410);
    expect((await call("DELETE", `/api/assets/${asset.id}?force=1`, ADMIN)).status).toBe(204);
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(404);
  });

  it("site-limited tokens can use the library but not change it", async () => {
    const site = (await call("POST", "/api/sites", EDITOR, { name: "Scoped", template: "blank" })).body;
    const t = (await call("POST", "/api/tokens", ADMIN, { name: "Scoped Claude", role: "agent", sites: [site.id] })).body.token;
    expect((await call("GET", "/api/assets", t)).status).toBe(200);
    expect((await upload(png(2, 2), "image/png", "filename=x.png", t)).statusCode).toBe(403);
  });
});
