import { describe, expect, it } from "vitest";
import { forwardHeaders, instanceName, isCacheableRequest, isCacheableResponse, mcpUrl, targetFor } from "../src/routing";

const APP = "sitecraft.guduriphaniram1988.workers.dev";
const env = { APP_HOST: APP };
const withDomains = { APP_HOST: "sitecraft.example.com", MCP_HOST: "sitecraft-mcp.example.com", SITES_DOMAIN: "sites.example.com" };
const req = (url: string, init?: RequestInit) => new Request(url, init);

describe("Cloudflare Worker routing on workers.dev", () => {
  it("sends /mcp to the MCP container and everything else to the app", () => {
    expect(targetFor(new URL(`https://${APP}/mcp`), env)).toBe("mcp");
    expect(targetFor(new URL(`https://${APP}/mcp/`), env)).toBe("mcp");
    expect(targetFor(new URL(`https://${APP}/mcpx`), env)).toBe("app");
    expect(targetFor(new URL(`https://${APP}/api/sites`), env)).toBe("app");
    expect(targetFor(new URL(`https://${APP}/s/acme/`), env)).toBe("app");
    expect(mcpUrl(env)).toBe(`https://${APP}/mcp`);
  });

  it("caches only anonymous GETs of published pages and media", () => {
    expect(isCacheableRequest(req(`https://${APP}/s/acme/`), env)).toBe(true);
    expect(isCacheableRequest(req(`https://${APP}/media/x/y.png`), env)).toBe(true);
    expect(isCacheableRequest(req(`https://${APP}/api/sites`), env)).toBe(false);
    expect(isCacheableRequest(req(`https://${APP}/`), env)).toBe(false);
    expect(isCacheableRequest(req(`https://${APP}/preview/k/s/main/`), env)).toBe(false);
    expect(isCacheableRequest(req(`https://${APP}/mcp`), env)).toBe(false);
    expect(isCacheableRequest(req(`https://${APP}/s/acme/`, { headers: { authorization: "Bearer x" } }), env)).toBe(false);
    expect(isCacheableRequest(req(`https://${APP}/forms/x/contact`, { method: "POST" }), env)).toBe(false);
  });
});

describe("Cloudflare Worker routing with your own domain", () => {
  it("supports a dedicated MCP host, site subdomains and custom domains", () => {
    expect(targetFor(new URL("https://sitecraft-mcp.example.com/mcp"), withDomains)).toBe("mcp");
    expect(targetFor(new URL("https://acme.sites.example.com/"), withDomains)).toBe("app");
    expect(mcpUrl(withDomains)).toBe("https://sitecraft-mcp.example.com/mcp");
    expect(isCacheableRequest(req("https://acme.sites.example.com/pricing"), withDomains)).toBe(true);
    expect(isCacheableRequest(req("https://www.customer.com/"), withDomains)).toBe(true);
    expect(isCacheableRequest(req("https://sitecraft-mcp.example.com/healthz"), withDomains)).toBe(false);
  });
});

describe("Worker helpers", () => {
  it("stores only public 200 responses", () => {
    expect(isCacheableResponse(new Response("ok", { headers: { "cache-control": "public, max-age=60" } }))).toBe(true);
    expect(isCacheableResponse(new Response("ok", { headers: { "cache-control": "no-store" } }))).toBe(false);
    expect(isCacheableResponse(new Response("nf", { status: 404, headers: { "cache-control": "public" } }))).toBe(false);
    expect(isCacheableResponse(new Response("ok"))).toBe(false);
  });

  it("spreads requests across app instances", () => {
    expect(instanceName(2, 0)).toBe("app-0");
    expect(instanceName(2, 0.99)).toBe("app-1");
    expect(instanceName(0, 0.5)).toBe("app-0");
  });

  it("forwards the client IP and scheme", () => {
    const h = forwardHeaders(req(`https://${APP}/`, { headers: { "cf-connecting-ip": "203.0.113.7" } }));
    expect(h.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("x-forwarded-host")).toBe(APP);
  });
});

describe("instances that are still starting", () => {
  it("tries every instance once, starting at a random one", async () => {
    const { instanceOrder } = await import("../src/routing");
    expect(instanceOrder(2, 0)).toEqual(["app-0", "app-1"]);
    expect(instanceOrder(2, 0.99)).toEqual(["app-1", "app-0"]);
    expect(instanceOrder(3, 0.5)).toEqual(["app-1", "app-2", "app-0"]);
    expect(instanceOrder(0, 0.5)).toEqual(["app-0"]);
  });

  it("only retries requests without side effects", async () => {
    const { isRetryable } = await import("../src/routing");
    expect(isRetryable(new Request("https://x/", { method: "GET" }))).toBe(true);
    expect(isRetryable(new Request("https://x/", { method: "POST", body: "{}" }))).toBe(false);
  });

  it("answers with a short starting page or JSON, never cached", async () => {
    const { startingResponse } = await import("../src/routing");
    const page = startingResponse(new Request("https://x/", { headers: { accept: "text/html" } }));
    expect(page.status).toBe(503);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toContain("Sitecraft is starting");
    const api = startingResponse(new Request("https://x/api/me"));
    expect(api.headers.get("retry-after")).toBe("5");
    expect(((await api.json()) as { error: string }).error).toContain("starting");
  });
});

describe("the containers library's own 'not running' reply", () => {
  it("is recognised, while the app's own errors are passed through", async () => {
    const { isNotRunning } = await import("../src/routing");
    expect(await isNotRunning(new Response("Error proxying request to container: The container is not running, consider calling start()", { status: 500 }))).toBe(true);
    expect(await isNotRunning(Response.json({ error: "Internal server error" }, { status: 500 }))).toBe(false);
    expect(await isNotRunning(new Response("ok"))).toBe(false);
  });
});
