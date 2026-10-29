import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

const ADMIN = process.env.E2E_ADMIN_TOKEN ?? "e2e-admin";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAFAAAAA8CAIAAAB+RarbAAAAY0lEQVR4nO3PAQ3AIADAMEA1ppCAt7v4k71VsM197viT9XXA2wzXGa4zXGe4znDdA9H0AlriIZyIAAAAAElFTkSuQmCC", "base64");
let source: Server;
let origin = "";

const header = `<header><nav><a href="/">DemoWorks</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
const footer = `<footer><p>© 2026 DemoWorks. Fictional example for Sitecraft migration testing.</p></footer>`;
const layoutCss = `<style>
  body{font-family:Arial,sans-serif;margin:0;color:#16384a}
  .hero.split{display:flex;gap:40px;padding:50px 4vw;background:#eaf6f4}
  .hero.split > div{width:50%}
  .hero img{width:100%;height:auto}
  .feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
  .features{padding:50px 4vw} .card{padding:20px;background:#f4f8fc}
</style>`;
const jsPage = `<!doctype html><html><head><title>DemoWorks | Digital services</title><meta name="theme-color" content="#0c756c">${layoutCss}</head><body>${header}<main id="app"></main>${footer}<script>
  document.querySelector("#app").innerHTML =
  '<section class="hero split"><div class="copy"><h1>Build better experiences</h1><p>Sitecraft should import this JavaScript-rendered hero.</p><a href="/contact" class="btn">Talk to us</a></div><div class="media"><img src="/photo.png" width="80" height="60" alt="Example banner"></div></section>'
  + '<section class="features"><h2>Our services</h2><div class="feature-grid"><article class="card"><h3>Design</h3><p>Simple design</p></article><article class="card"><h3>Build</h3><p>Flexible build</p></article><article class="card"><h3>Launch</h3><p>Ready to ship</p></article></div></section>';
</script></body></html>`;
const articlePage = (title: string, copy: string) => `<!doctype html><html><head><title>${title} | DemoWorks</title>${layoutCss}</head><body>${header}<main><section><h1>${title}</h1><p>${copy}</p></section></main>${footer}</body></html>`;
const pricingPage = `<!doctype html><html><head><title>Plans | DemoWorks</title>${layoutCss}</head><body>${header}<main><section><h2>Pricing plans</h2><div class="pricing-grid"><article><h3>Starter</h3><p>$12 monthly</p></article><article><h3>Business</h3><p>$50 monthly</p></article></div></section><section><h2>Frequently asked questions</h2><div><h3>Can I try it?</h3><p>Yes, this is sample content.</p><h3>Can I cancel?</h3><p>Yes, anytime.</p></div></section></main>${footer}</body></html>`;

test.beforeAll(async () => {
  source = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (path === "/photo.png") return res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    const html = path === "/" ? jsPage : path === "/about"
      ? articlePage("About us", "A source page with a shared nav and footer.")
      : path === "/services"
        ? articlePage("Services", "Our catalog of fictional services.")
        : path === "/pricing"
          ? pricingPage
          : path === "/contact"
            ? articlePage("Contact", "Please reach out to the fictional team.")
            : null;
    if (!html) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise<void>((r) => source.close(() => r())); });

async function importIt(page: Page, url: string, maxPages: number) {
  const res = await page.request.post("/api/imports", {
    headers: { authorization: `Bearer ${ADMIN}` },
    data: { url, name: "DemoWorks import testing", maxPages, rightsConfirmed: true, render: true, ai: false },
    timeout: 110_000,
  });
  expect(res.ok(), `Import API: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

test("JavaScript site: rendered DOM, split hero, local draft assets, cards and screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  const imported = await importIt(page, origin + "/", 1);
  expect(imported.report.renderedPages).toBe(1);
  expect(imported.report.screenshots[0].elements).toBeGreaterThan(0);
  expect(imported.report.importedAssets).toBeGreaterThanOrEqual(1);
  const screenshot = await page.request.get(imported.report.screenshots[0].url, { headers: { authorization: `Bearer ${ADMIN}` } });
  expect(screenshot.ok()).toBeTruthy();
  expect(screenshot.headers()["content-type"]).toContain("image/png");
  await mkdir("test-results/import-visual", { recursive: true });
  await writeFile("test-results/import-visual/source-rendered.png", Buffer.from(await screenshot.body()));


  const head = await page.request.get(`/api/sites/${imported.site.id}/branches/main`, { headers: { authorization: `Bearer ${ADMIN}` } });
  const doc = (await head.json()).document;
  const content = JSON.stringify(doc);
  expect(content).toContain("Build better experiences");
  expect(content).toContain("Two-column layout");
  expect(content).toContain("Design");
  expect(content).toContain("Launch");
  expect(content).toContain("/media/library/");
  expect(content).not.toContain(`${origin}/photo.png`);
  // Source code never becomes executable user-authored JS.
  expect(content).not.toContain("document.querySelector");
  const assets = await page.request.get("/api/assets", { headers: { authorization: `Bearer ${ADMIN}` } });
  const list = await assets.json();
  expect(list.some((a: { status: string }) => a.status === "draft")).toBeTruthy();
  // Real browser evidence: the imported Sitecraft site should be editable and
  // recognisable next to the source screenshot, not merely valid JSON.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), ADMIN);
  await page.goto(`/sites/${imported.site.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.frameLocator("iframe[title='Page canvas']").getByRole("heading", { name: "Build better experiences" })).toBeVisible();
  await page.screenshot({ path: "test-results/import-visual/sitecraft-editor.png", fullPage: false });

});

test("multi-page site: crawl and convert shared navigation and footer to components", async ({ page }) => {
  test.setTimeout(180_000);
  const imported = await importIt(page, origin + "/", 3);
  expect(imported.pages.map((p: { path: string }) => p.path)).toEqual(["/", "/about", "/services"]);
  expect(imported.report.sharedComponents).toBeGreaterThanOrEqual(1);
  const head = await page.request.get(`/api/sites/${imported.site.id}/branches/main`, { headers: { authorization: `Bearer ${ADMIN}` } });
  const doc = (await head.json()).document;
  expect(doc.pages.length).toBe(3);
  expect(doc.components.length).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(doc)).toContain('"type":"instance"');
});

test("pricing and FAQ: source content is retained without external code", async ({ page }) => {
  test.setTimeout(180_000);
  const imported = await importIt(page, origin + "/pricing", 1);
  const head = await page.request.get(`/api/sites/${imported.site.id}/branches/main`, { headers: { authorization: `Bearer ${ADMIN}` } });
  const doc = (await head.json()).document;
  expect(JSON.stringify(doc)).toContain("Starter");
  expect(JSON.stringify(doc)).toContain("Business");
  expect(JSON.stringify(doc)).toContain("Can I try it?");
  expect(imported.report.decisions.length).toBeGreaterThan(0);
});
