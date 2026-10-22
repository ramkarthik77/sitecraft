import { describe, expect, it } from "vitest";
import { forwardHeaders, instanceName, isCacheableRequest, isCacheableResponse, targetFor } from "../src/routing";

const env = { APP_HOST: "sitecraft.example.com", MCP_HOST: "sitecraft-mcp.example.com", SITES_DOMAIN: "sites.example.com" };
const req = (url: string, init?: RequestInit) => new Request(url, init);

describe("Cloudflare Worker routing", () => {
  it("sends the MCP host to the MCP container and everything else to the app", () => {
    expect(targetFor(new URL("https://sitecraft-mcp.example.com/mcp"), env)).toBe("mcp");
    expect(targetFor(new URL("https://sitecraft.example.com/api/sites"), env)).toBe("app");
    expect(targetFor(new URL("https://acme.sites.example.com/"), env)).toBe("app");
    expect(targetFor(new URL("https://www.customer.com/pricing"), env)).toBe("app");
  });

  it("caches only anonymous GETs of published pages and media", () => {
    expect(isCacheableRequest(req("https://acme.sites.example.com/pricing"), env)).toBe(true);
    expect(isCacheableRequest(req("https://www.customer.com/"), env)).toBe(true);
    expect(isCacheableRequest(req("https://sitecraft.example.com/s/acme/"), env)).toBe(true);
    expect(isCacheableRequest(req("https://sitecraft.example.com/media/x/y.png"), env)).toBe(true);
    expect(isCacheableRequest(req("https://sitecraft.example.com/api/sites"), env)).toBe(false);
    expect(isCacheableRequest(req("https://sitecraft.example.com/"), env)).toBe(false);
    expect(isCacheableRequest(req("https://sitecraft.example.com/preview/k/s/main/"), env)).toBe(false);
    expect(isCacheableRequest(req("https://sitecraft-mcp.example.com/mcp"), env)).toBe(false);
    expect(isCacheableRequest(req("https://acme.sites.example.com/", { headers: { authorization: "Bearer x" } }), env)).toBe(false);
    expect(isCacheableRequest(req("https://acme.sites.example.com/forms/x/contact", { method: "POST" }), env)).toBe(false);
  });

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
    const h = forwardHeaders(req("https://acme.sites.example.com/", { headers: { "cf-connecting-ip": "203.0.113.7" } }));
    expect(h.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("x-forwarded-host")).toBe("acme.sites.example.com");
  });
});
