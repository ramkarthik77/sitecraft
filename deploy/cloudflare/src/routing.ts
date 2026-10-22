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
