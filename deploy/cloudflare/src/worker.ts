import { Container, getContainer } from "@cloudflare/containers";
import type { DurableObject } from "cloudflare:workers";
import { forwardHeaders, instanceName, isCacheableRequest, isCacheableResponse, targetFor } from "./routing";

export interface Env {
  APP: DurableObjectNamespace<SitecraftApp>;
  MCP: DurableObjectNamespace<SitecraftMcp>;

  // Plain vars (wrangler.jsonc "vars")
  APP_HOST: string;
  MCP_HOST?: string;
  SITES_DOMAIN?: string;
  APP_INSTANCES?: string;
  R2_BUCKET: string;
  AGENT_CAN_PUBLISH?: string;
  AGENT_CAN_EDIT_MAIN?: string;

  // Secrets (set by the deploy workflow from GitHub secrets)
  CLOUDFLARE_ACCOUNT_ID: string;
  DATABASE_URL: string;
  SECRET: string;
  ADMIN_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

/** Environment for the app container, built from Worker vars and secrets. */
export function appEnv(env: Env): Record<string, string> {
  const publicUrl = `https://${env.APP_HOST}`;
  const out: Record<string, string> = {
    ROLE: "app",
    PORT: "4000",
    NODE_ENV: "production",
    DATABASE_URL: env.DATABASE_URL,
    SECRET: env.SECRET,
    ADMIN_TOKEN: env.ADMIN_TOKEN,
    PUBLIC_URL: publicUrl,
    EDITOR_URL: publicUrl,
    CORS_ORIGINS: publicUrl,
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    S3_REGION: "auto",
    S3_BUCKET: env.R2_BUCKET,
    S3_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: "true",
    AGENT_CAN_PUBLISH: env.AGENT_CAN_PUBLISH ?? "false",
    AGENT_CAN_EDIT_MAIN: env.AGENT_CAN_EDIT_MAIN ?? "false",
  };
  if (env.SITES_DOMAIN) out.SITES_DOMAIN = env.SITES_DOMAIN;
  return out;
}

export function mcpEnv(env: Env): Record<string, string> {
  return { ROLE: "mcp", PORT: "4100", NODE_ENV: "production", SITECRAFT_API_URL: `https://${env.APP_HOST}` };
}

/** API, editor, previews and published sites. Stateless; state lives in Postgres and R2. */
export class SitecraftApp extends Container<Env> {
  defaultPort = 4000;
  sleepAfter = "30m";
  pingEndpoint = "localhost/healthz";
  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    this.envVars = appEnv(env);
  }
}

/** MCP server Claude Code connects to. Stateless; one request, one server. */
export class SitecraftMcp extends Container<Env> {
  defaultPort = 4100;
  sleepAfter = "30m";
  pingEndpoint = "localhost/healthz";
  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    this.envVars = mcpEnv(env);
  }
}

const appCount = (env: Env) => Number(env.APP_INSTANCES ?? 2) || 2;

async function proxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const forwarded = new Request(request, { headers: forwardHeaders(request) });
  if (targetFor(url, env) === "mcp") return getContainer(env.MCP, "mcp-0").fetch(forwarded);
  return getContainer(env.APP, instanceName(appCount(env))).fetch(forwarded);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!isCacheableRequest(request, env)) return proxy(request, env);
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await proxy(request, env);
    if (isCacheableResponse(res)) ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },

  /** Keep every instance warm so editors and Claude Code never wait on a cold start. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const pings: Promise<unknown>[] = [];
    for (let i = 0; i < appCount(env); i++) {
      pings.push(getContainer(env.APP, `app-${i}`).fetch(new Request(`https://${env.APP_HOST}/healthz`)).catch(() => null));
    }
    pings.push(getContainer(env.MCP, "mcp-0").fetch(new Request(`https://${env.MCP_HOST ?? env.APP_HOST}/healthz`)).catch(() => null));
    ctx.waitUntil(Promise.all(pings));
  },
};
