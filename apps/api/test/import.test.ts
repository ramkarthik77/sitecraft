import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, isPrivateAddress } from "../src/safefetch.js";
import { convertPage, toPath } from "../src/importer.js";
import { AGENT, auth, EDITOR, startTestServer } from "./helpers.js";

let app: FastifyInstance;
let strict: FastifyInstance;
let site: Server;
let origin = "";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html><head><title>Lumen Health | Care that fits</title><meta name="description" content="Clinics near you">
    <meta name="theme-color" content="#0f766e"><style>body{font-family:"Source Sans 3",sans-serif;color:#1f2937} h1,h2{font-family:'Merriweather',serif} .btn{background:#0f766e}</style>
    <link rel="stylesheet" href="/site.css"><script>alert(1)</script></head><body>
    <header><nav><a href="/">Lumen</a><a href="/about">About us</a><a href="/services/">Services</a><a href="https://elsewhere.example/x">Partner</a></nav></header>
    <main>
      <section><h1>Care that fits your life</h1><p>Same-day appointments at <strong>40 clinics</strong>.</p><p><a class="btn btn-primary" href="/book">Book a visit</a></p></section>
      <section><h2>Why Lumen</h2><img src="/img/clinic.jpg" alt="A bright clinic" width="800"><img src="/pixel.gif" width="1"><ul><li>Open late</li><li>Every insurer</li></ul></section>
      <div><div><h2>Our doctors</h2><p>Board-certified, and on your side.</p><a href="javascript:alert(1)">Bad link</a></div></div>
      <form><input name="q"></form>
    </main>
    <footer><p>© 2026 Lumen Health</p><a href="/privacy">Privacy</a></footer></body></html>`,
  "/about": `<html><head><title>About us | Lumen Health</title></head><body><main><h1>About Lumen</h1><p>Founded in 2010 by two nurses.</p></main></body></html>`,
  "/services/": `<html><head><title>Services - Lumen</title></head><body><main><h2>Primary care</h2><p>Check-ups and more.</p></main></body></html>`,
  "/site.css": `a{color:#0f766e}.card{border:1px solid #e5e7eb}`,
};

beforeAll(async () => {
  site = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const body = PAGES[path];
    if (!body) return res.writeHead(404).end("no");
    res.writeHead(200, { "content-type": path.endsWith(".css") ? "text/css" : "text/html; charset=utf-8" }).end(body);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  ({ app } = await startTestServer({ DATABASE_URL: "pglite:memory", IMPORT_ALLOW_PRIVATE: "true" }));
  ({ app: strict } = await startTestServer({ DATABASE_URL: "pglite:memory" }));
});
afterAll(async () => {
  site?.close();
  await app?.close();
  await strict?.close();
});

const post = (a: FastifyInstance, payload: unknown, token = EDITOR) => a.inject({ method: "POST", url: "/api/imports", headers: auth(token), payload: payload as never });

describe("importing a website", () => {
  it("checks every redirect like the first address", async () => {
    const { safeFetch } = await import("../src/safefetch.js");
    const hop = createServer((_q, r) => r.writeHead(302, { location: "http://10.1.2.3/secret" }).end());
    await new Promise<void>((r) => hop.listen(0, "127.0.0.1", r));
    const port = String((hop.address() as AddressInfo).port);
    // Only the first, local address is let through; the redirect to a private address is refused.
    await expect(safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: (u) => u.port === port })).rejects.toThrow(/private network/);
    hop.close();
  });

  it("rebuilds pages as editable sections with the site's colour and fonts", async () => {
    const res = await post(app, { url: origin + "/", maxPages: 3 });
    expect(res.statusCode).toBe(201);
    const r = JSON.parse(res.body);
    expect(r.site.name).toBe("Lumen Health");
    expect(r.pages.map((p: { path: string }) => p.path)).toEqual(["/", "/about", "/services"]);
    expect(r.theme.colors.primary).toBe("#0f766e");
    expect(r.theme.fonts.heading).toContain("Merriweather");
    expect(r.theme.fonts.body).toContain("Source Sans 3");
    expect(r.warnings.join(" ")).toMatch(/Images still load from the original site/);

    const doc = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${r.site.id}/branches/main`, headers: auth(EDITOR) })).body).document;
    const home = doc.pages.find((p: { path: string }) => p.path === "/");
    const json = JSON.stringify(home);
    expect(home.title).toBe("Lumen Health | Care that fits");
    expect(json).toContain("Care that fits your life");
    expect(json).toContain('"label":"Book a visit"');
    expect(json).toContain(`"href":"${origin}/book"`);
    expect(json).toContain('"href":"/about"'); // nav links to imported pages stay inside the site
    expect(json).toContain("A bright clinic");
    expect(json).toContain("• Open late");
    expect(json).toContain("Our doctors");
    expect(json).not.toContain("pixel.gif");
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("alert(1)");
    expect(json).toContain("© 2026 Lumen Health");
    expect(doc.pages.find((p: { path: string }) => p.path === "/about").title).toBe("About us");
    // Every save went through operations and the audit trail.
    const act = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${r.site.id}/activity`, headers: auth(EDITOR) })).body).items;
    expect(act.map((i: { action: string }) => i.action)).toContain("site.import");
  });

  it("won't reach private addresses", async () => {
    const res = await post(strict, { url: origin + "/" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/private network/);
    expect((await post(strict, { url: "http://192.168.1.10/" })).statusCode).toBe(400);
    await expect(checkUrl("http://169.254.169.254/latest")).rejects.toThrow(/private network/);
    await expect(checkUrl("http://localhost:8080/")).rejects.toThrow(/private network|standard web ports/);
    await expect(checkUrl("file:///etc/passwd")).rejects.toThrow(/Only http and https/);
    await expect(checkUrl("https://user:pw@example.com/")).rejects.toThrow(/user name and password/);
    for (const ip of ["10.0.0.1", "172.20.1.1", "192.168.1.1", "127.0.0.1", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "fe80::1", "0.0.0.0"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
    expect((await post(app, { url: origin + "/" }, AGENT)).statusCode).toBe(201);
  });

  it("maps addresses to page paths and reads plain HTML", () => {
    expect(toPath(new URL("https://x.com/About_Us/Team.html"))).toBe("/about-us/team");
    expect(toPath(new URL("https://x.com/index.php"))).toBe("/");
    const c = convertPage("<body><div><div><div><div><div>Some long text that sits right inside a div with no paragraph tags around it.</div></div></div></div></div></body>", { base: new URL("https://x.com"), pagePaths: new Map() }, "X", true);
    expect(JSON.stringify(c.sections)).toContain("Some long text");
  });
});
