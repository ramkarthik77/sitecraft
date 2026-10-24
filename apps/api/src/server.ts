import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { createToken } from "./auth.js";
import type { Config } from "./config.js";
import { createDb, migrate, type Db } from "./db.js";
import { HttpError } from "./errors.js";
import { EventBus } from "./events.js";
import { Repo } from "./repo.js";
import { apiRoutes } from "./routes/api.js";
import { publicRoutes, serveHostedSite } from "./routes/public.js";
import { runDueSchedules } from "./schedules.js";
import { apiHeaders, editorHeaders, RateLimiter } from "./security.js";
import { createStorage, type Storage } from "./storage.js";

export interface AppContext {
  cfg: Config;
  db: Db;
  repo: Repo;
  storage: Storage;
  events: EventBus;
}

export async function buildServer(cfg: Config, opts: { logger?: boolean } = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const db = await createDb(cfg.databaseUrl);
  await migrate(db);
  for (const t of cfg.seedTokens) await createToken(db, t.name, t.role, t.token);
  const storage = createStorage(cfg.storage);
  await storage.init();
  const events = new EventBus(cfg.databaseUrl, db);
  await events.start();
  const ctx: AppContext = { cfg, db, repo: new Repo(db), storage, events };

  const app = Fastify({
    logger: opts.logger ? { level: process.env.LOG_LEVEL ?? "info" } : false,
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: true,
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 64 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });
  app.addContentTypeParser(/^image\/(png|jpeg|gif|webp)$/, { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || cfg.corsOrigins.includes("*") || cfg.corsOrigins.includes(origin)),
    credentials: false,
  });

  // Per-server limits; Cloudflare rate limiting rules add a shared one in front.
  const apiLimit = new RateLimiter(cfg.rateLimitPerMinute, 60_000);
  const authFailures = new RateLimiter(30, 10 * 60_000);
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (authFailures.over(req.ip)) return reply.status(429).header("Retry-After", "600").send({ error: "Too many failed sign-ins from this address. Try again in 10 minutes." });
    if (apiLimit.hit(req.ip)) return reply.status(429).header("Retry-After", "60").send({ error: "Too many requests. Slow down and try again in a minute." });
  });

  const API_HEADERS = apiHeaders(cfg);
  const EDITOR_HEADERS = editorHeaders(cfg);
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/api/")) {
      if (reply.statusCode === 401) authFailures.hit(req.ip);
      reply.headers(API_HEADERS);
    } else if (!reply.getHeader("content-security-policy")) {
      // Everything else this server answers itself is the editor app.
      reply.headers(EDITOR_HEADERS);
    }
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, ...err.details });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "Internal server error" });
  });

  // Published sites on custom domains and <slug>.<SITES_DOMAIN> hosts.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD") return;
    const host = req.headers.host ?? "";
    if (!host || isPlatformHost(cfg, host)) return;
    const served = await serveHostedSite(ctx, host, req.url, reply);
    if (served) return reply;
  });

  app.get("/healthz", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  await app.register(async (r) => apiRoutes(r, ctx), { prefix: "/api" });
  await app.register(async (r) => publicRoutes(r, ctx));

  // Serve the built editor from the same origin when EDITOR_DIST is set.
  if (cfg.editorDist && existsSync(cfg.editorDist)) {
    const root = resolve(cfg.editorDist);
    await app.register(fastifyStatic, { root, wildcard: false, index: ["index.html"] });
    const indexHtml = await readFile(join(root, "index.html"), "utf8");
    app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && (req.headers.accept ?? "").includes("text/html")) {
        return reply.type("text/html").send(indexHtml);
      }
      return reply.status(404).send({ error: "Not found" });
    });
  }

  // Delete form submissions past the retention period, hourly.
  const purge = async () => {
    if (cfg.formRetentionDays > 0) {
      await db.query("DELETE FROM form_submissions WHERE created_at < now() - make_interval(days => $1)", [cfg.formRetentionDays]).catch((e) => app.log.error(e));
    }
    // Condense edit history older than the retention window, one site at a time.
    if (cfg.historyDays > 0) {
      for (const s of await ctx.repo.listSites().catch(() => [])) {
        const n = await ctx.repo.pruneHistory(s.id, cfg.historyDays).catch((e) => (app.log.error(e), 0));
        if (n) app.log.info(`Condensed ${n} old versions of ${s.slug}`);
      }
    }
  };
  void purge();
  const purgeTimer = setInterval(() => void purge(), 3_600_000);
  purgeTimer.unref();

  // Scheduled publishing and releases, checked every 20 seconds.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueSchedules(ctx);
    } catch (e) {
      app.log.error(e);
    } finally {
      running = false;
    }
  };
  const scheduleTimer = setInterval(() => void tick(), 20_000);
  scheduleTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(purgeTimer);
    clearInterval(scheduleTimer);
    await events.stop();
    await db.end();
  });

  return { app, ctx };
}

function isPlatformHost(cfg: Config, host: string): boolean {
  const h = host.toLowerCase().split(":")[0]!;
  const platform = new URL(cfg.publicUrl).hostname.toLowerCase();
  const editor = new URL(cfg.editorUrl).hostname.toLowerCase();
  return h === platform || h === editor || h === "localhost" || h === "127.0.0.1" || h === "api" || h === "app" || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}
