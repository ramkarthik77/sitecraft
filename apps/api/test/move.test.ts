import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, AGENT, startTestServer } from "./helpers.js";

/** pnpm move-to-cloud: the local app on one port, a "cloud" Sitecraft on another. */
const LOCAL = 4931;
const CLOUD = 4932;
const script = fileURLToPath(new URL("../../../scripts/move-to-cloud.mjs", import.meta.url));
let local: FastifyInstance;
let cloud: FastifyInstance;

const run = (args: string[], token?: string) =>
  new Promise<{ code: number; out: string }>((ok) => {
    execFile(process.execPath, [script, "--from", `http://localhost:${LOCAL}`, "--to", `http://localhost:${CLOUD}`, ...args], { env: { ...process.env, SITECRAFT_TOKEN: token ?? "" } }, (err, stdout, stderr) =>
      ok({ code: err ? Number(err.code ?? 1) : 0, out: stdout + stderr }),
    );
  });

const at = (app: FastifyInstance, port: number) => (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: method as never, url, payload: payload as never, headers: { host: `localhost:${port}`, ...headers } });

beforeAll(async () => {
  ({ app: local } = await startTestServer({ SITECRAFT_LOCAL: "1", DATABASE_URL: "pglite:memory", PUBLIC_URL: `http://localhost:${LOCAL}`, ADMIN_TOKEN: "", EDITOR_TOKEN: "" }));
  ({ app: cloud } = await startTestServer({ DATABASE_URL: "pglite:memory", PUBLIC_URL: `http://localhost:${CLOUD}` }));
  await local.listen({ port: LOCAL, host: "127.0.0.1" });
  await cloud.listen({ port: CLOUD, host: "127.0.0.1" });

  // A local blog with an uploaded image used by a post.
  const L = at(local, LOCAL);
  const site = (await L("POST", "/api/sites", { name: "Moving Day", template: "blog" })).json();
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const up = (await local.inject({ method: "POST", url: `/api/sites/${site.id}/assets?filename=cover.png`, headers: { host: `localhost:${LOCAL}`, "content-type": "image/png" }, payload: png })).json();
  await L("POST", `/api/sites/${site.id}/branches/main/ops`, { ops: [{ op: "update_item", collectionId: "blog", itemId: "how-we-work", values: { cover_image: up.url } }] });
  await L("POST", `/api/sites/${site.id}/publish`, {});
});

afterAll(async () => {
  await local?.close();
  await cloud?.close();
});

describe("move to cloud", () => {
  it("needs a person's token", async () => {
    expect((await run([])).out).toContain("Set SITECRAFT_TOKEN");
    const agent = await run([], AGENT);
    expect(agent.code).toBe(1);
    expect(agent.out).toContain("agent token");
  });

  it("dry run changes nothing", async () => {
    const r = await run(["--dry-run"]);
    expect(r.out).toContain("would copy Moving Day (moving-day): 3 pages, 1 collections, 2 items, 1 images");
    expect((await at(cloud, CLOUD)("GET", "/api/sites", undefined, { authorization: `Bearer ${ADMIN}` })).json()).toEqual([]);
  });

  it("copies pages, CMS items and images, re-links them, and publishes", async () => {
    const r = await run(["--publish"], ADMIN);
    expect(r.code).toBe(0);
    expect(r.out).toContain("copied Moving Day (moving-day)");
    const C = at(cloud, CLOUD);
    const head = (await C("GET", "/api/sites/moving-day/branches/main", undefined, { authorization: `Bearer ${ADMIN}` })).json();
    const json = JSON.stringify(head.document);
    expect(json).not.toContain(`localhost:${LOCAL}/media`);
    const img = /http:\/\/localhost:4932(\/media\/[^"]+\.png)/.exec(json)![1]!;
    expect((await C("GET", img)).statusCode).toBe(200);
    const post = await C("GET", "/s/moving-day/blog/how-we-work");
    expect(post.statusCode).toBe(200);
    expect(post.body).toContain(img);
  });

  it("skips a taken address unless asked to rename", async () => {
    const again = await run([], ADMIN);
    expect(again.out).toContain("skipped Moving Day");
    const renamed = await run(["--rename", "--site", "moving-day"], ADMIN);
    expect(renamed.out).toContain("as moving-day-2");
    expect((await run(["--site", "nope"], ADMIN)).out).toContain("Not found locally: nope");
  });
});
