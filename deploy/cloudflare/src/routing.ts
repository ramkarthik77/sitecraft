/**
 * Pure routing decisions for the Cloudflare Worker, kept separate so they can
 * be unit tested without the Workers runtime.
 *
 * Everything is served from one hostname (the workers.dev URL by default):
 *   /mcp        → MCP container (Claude Code)
 *   everything  → app container (editor, API, previews, /s/<slug> sites)
 * Optional extras: a separate MCP_HOST, and SITES_DOMAIN / custom domains for
 * published sites once a domain is on Cloudflare.
 */

export interface RoutingEnv {
  /** Editor, API and previews, e.g. sitecraft.<account>.workers.dev */
  APP_HOST: string;
  /** Optional dedicated MCP hostname. Without it, MCP lives at APP_HOST/mcp. */
  MCP_HOST?: string;
  /** Optional wildcard parent for published sites, e.g. sites.example.com. */
  SITES_DOMAIN?: string;
}

export type Target = "app" | "mcp";

const isMcpPath = (path: string) => path === "/mcp" || path.startsWith("/mcp/");

export function targetFor(url: URL, env: RoutingEnv): Target {
  if (env.MCP_HOST && url.hostname.toLowerCase() === env.MCP_HOST.toLowerCase()) return "mcp";
  return isMcpPath(url.pathname) ? "mcp" : "app";
}

/**
 * Only anonymous GETs for published pages and uploaded media may be served from
 * the edge cache, and only when the app marked the response public.
 */
export function isCacheableRequest(req: Request, env: RoutingEnv): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.has("authorization") || req.headers.has("cookie")) return false;
  const url = new URL(req.url);
  if (targetFor(url, env) === "mcp") return false;
  if (url.hostname.toLowerCase() === env.APP_HOST.toLowerCase()) {
    return url.pathname.startsWith("/s/") || url.pathname.startsWith("/media/");
  }
  // Any other host is a published site (subdomain or custom domain).
  return !url.pathname.startsWith("/forms/");
}

export function isCacheableResponse(res: Response): boolean {
  if (res.status !== 200) return false;
  const cc = res.headers.get("cache-control") ?? "";
  return /\bpublic\b/.test(cc) && !/no-store|private/.test(cc);
}

/** Pick one of N app instances; requests spread evenly. */
export function instanceName(n: number, rand = Math.random()): string {
  const count = Math.max(1, Math.floor(n));
  return `app-${Math.min(count - 1, Math.floor(rand * count))}`;
}

/**
 * Every app instance, starting from a random one. A request goes to the first;
 * if that instance is still starting (or restarting), safe requests try the next.
 */
export function instanceOrder(n: number, rand = Math.random()): string[] {
  const count = Math.max(1, Math.floor(n));
  const first = Math.min(count - 1, Math.floor(rand * count));
  return Array.from({ length: count }, (_, i) => `app-${(first + i) % count}`);
}

/** Only these can be sent again to another instance without side effects. */
export const isRetryable = (req: Request) => req.method === "GET" || req.method === "HEAD";

/** Shown while no instance can answer yet, for example in the first minute after a deploy. */
export function startingResponse(req: Request): Response {
  const headers = { "retry-after": "5", "cache-control": "no-store" };
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starting Sitecraft</title></head>' +
        '<body style="font:15px/1.5 system-ui,sans-serif;background:#111317;color:#e6e8eb;display:grid;place-items:center;min-height:100vh;margin:0"><p>Sitecraft is starting. This page reloads in a few seconds.</p></body></html>',
      { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } },
    );
  }
  return Response.json({ error: "Sitecraft is starting. Try again in a few seconds." }, { status: 503, headers });
}

/** Headers the app relies on behind Cloudflare: real client IP and scheme. */
export function forwardHeaders(req: Request): Headers {
  const h = new Headers(req.headers);
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) h.set("x-forwarded-for", ip);
  h.set("x-forwarded-proto", new URL(req.url).protocol.replace(":", ""));
  h.set("x-forwarded-host", new URL(req.url).host);
  return h;
}

/** Public URL Claude Code should use for MCP. */
export function mcpUrl(env: RoutingEnv): string {
  return env.MCP_HOST ? `https://${env.MCP_HOST}/mcp` : `https://${env.APP_HOST}/mcp`;
}
