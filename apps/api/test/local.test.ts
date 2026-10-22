import type { FastifyInstance } from "fastify";
import { request, type Server } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttp } from "../../mcp/src/main.js";
import { startTestServer } from "./helpers.js";

/** The local app: embedded database, no sign-in for the owner, Claude still on branches. */
const AGENT = "test-local-agent";
let app: FastifyInstance;
let mcp: Server;
const API_PORT = 4921;
const MCP_PORT = 4922;

beforeAll(async () => {
  ({ app } = await startTestServer({
    SITECRAFT_LOCAL: "1",
    DATABASE_URL: "pglite:memory",
    PUBLIC_URL: `http://localhost:${API_PORT}`,
    AGENT_TOKEN: AGENT,
    EDITOR_TOKEN: "",
    ADMIN_TOKEN: "",
  }));
  await app.listen({ port: API_PORT, host: "127.0.0.1" });
  mcp = await startHttp(MCP_PORT, `http://127.0.0.1:${API_PORT}`, { localAgentToken: AGENT }, "127.0.0.1");
});
afterAll(async () => {
  mcp?.close();
  await app?.close();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { host: `localhost:${API_PORT}`, ...headers } });
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as never, headers: { host: `localhost:${API_PORT}`, ...headers } });

describe("local app sign-in", () => {
  it("treats requests from this computer as the owner", async () => {
    const r = await get("/api/me");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: "You", role: "admin", local: true });
    expect((await get("/api/me", { origin: `http://localhost:${API_PORT}` })).statusCode).toBe(200);
  });

  it("refuses other hostnames (DNS rebinding) and other websites", async () => {
    expect((await get("/api/me", { host: "evil.example" })).statusCode).toBe(403);
    expect((await get("/api/me", { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await get("/api/me", { origin: "null" })).statusCode).toBe(403);
  });

  it("still applies agent limits to Claude's token", async () => {
    const me = await get("/api/me", { authorization: `Bearer ${AGENT}` });
    expect(me.json()).toMatchObject({ name: "Claude Code", role: "agent", local: false });
    const site = (await post("/api/sites", { name: "Local Co", template: "landing" })).json();
    expect((await post(`/api/sites/${site.id}/publish`, {}, { authorization: `Bearer ${AGENT}` })).statusCode).toBe(403);
    expect((await post(`/api/sites/${site.id}/publish`, {})).statusCode).toBe(200);
    expect((await get("/api/me", { authorization: "Bearer wrong" })).statusCode).toBe(401);
  });
});

describe("export", () => {
  it("zips pages, images and a sitemap when the address is known", async () => {
    const site = (await post("/api/sites", { name: "Export Co", template: "landing" })).json();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const up = await app.inject({
      method: "POST",
      url: `/api/sites/${site.id}/assets?filename=hero.png`,
      headers: { host: `localhost:${API_PORT}`, "content-type": "image/png" },
      payload: png,
    });
    const imageUrl = up.json().url as string;
    expect(imageUrl).toContain(`http://localhost:${API_PORT}/media/`);
    const doc = (await get(`/api/sites/${site.id}/branches/main`)).json().document;
    await post(`/api/sites/${site.id}/branches/main/ops`, {
      ops: [
        { op: "add_block", parentId: doc.pages[0].root.id, block: "image-section", content: { src: imageUrl, alt: "Hero" } },
        { op: "add_page", path: "/about", title: "About", blocks: ["text-section"] },
      ],
    });

    const plain = await get(`/api/sites/${site.id}/export`);
    expect(plain.statusCode).toBe(200);
    expect(plain.headers["content-type"]).toBe("application/zip");
    expect(plain.headers["content-disposition"]).toContain("export-co.zip");
    const files = unzipSync(new Uint8Array(plain.rawPayload));
    const names = Object.keys(files).sort();
    expect(names).toEqual(expect.arrayContaining(["index.html", "about/index.html", "404.html", "robots.txt", "README.txt"]));
    expect(names).not.toContain("sitemap.xml");
    const media = names.filter((n) => n.startsWith("media/"));
    expect(media).toHaveLength(1);
    const index = strFromU8(files["index.html"]!);
    expect(index).toContain(`src="/${media[0]}"`);
    expect(index).not.toContain(`localhost:${API_PORT}/media`);
    expect(index).not.toContain('rel="canonical"');

    const withUrl = unzipSync(new Uint8Array((await get(`/api/sites/${site.id}/export?url=${encodeURIComponent("https://export.example")}`)).rawPayload));
    expect(strFromU8(withUrl["sitemap.xml"]!)).toContain("<loc>https://export.example/about</loc>");
    expect(strFromU8(withUrl["index.html"]!)).toContain('href="https://export.example/"');
    expect((await get(`/api/sites/${site.id}/export?url=not-a-url`)).statusCode).toBe(400);
  });
});

describe("local MCP server", () => {
  // node:http rather than fetch, because fetch won't let a test set Host.
  const call = (headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string }>((ok, bad) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sites", arguments: {} } });
      const req = request(
        { host: "127.0.0.1", port: MCP_PORT, path: "/mcp", method: "POST", headers: { host: `localhost:${MCP_PORT}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => ok({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on("error", bad);
      req.end(body);
    });

  it("lets Claude Code on this computer connect without a token, as the agent", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toContain("Local Co");
  });

  it("refuses web pages and other hostnames", async () => {
    expect((await call({ origin: "https://evil.example" })).status).toBe(403);
    expect((await call({ host: "evil.example" })).status).toBe(403);
    expect((await call({ origin: `http://localhost:${API_PORT}` })).status).toBe(200);
  });
});
