import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveRoute } from "@sitecraft/schema";
import { renderNotFound, renderPage } from "@sitecraft/renderer";
import { verifyPreview } from "../auth.js";
import { HttpError } from "../errors.js";
import { fileForPath, formActionFor } from "../publish.js";
import type { SiteRow } from "../repo.js";
import type { AppContext } from "../server.js";
import { contentTypeFor } from "../storage.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

async function sendDeployedFile(ctx: AppContext, site: SiteRow, path: string, reply: FastifyReply) {
  reply.headers(SECURITY_HEADERS);
  if (!site.current_deployment_id) {
    return reply.status(404).type("text/html").send("<!doctype html><title>Not published</title><p>This site hasn't been published yet.</p>");
  }
  const prefix = `sites/${site.id}/deploys/${site.current_deployment_id}`;
  const file = fileForPath(path);
  const body = file ? await ctx.storage.get(`${prefix}/${file}`) : null;
  if (!body) {
    const nf = await ctx.storage.get(`${prefix}/404.html`);
    return reply.status(404).type("text/html; charset=utf-8").send(nf ?? "Not found");
  }
  return reply.header("Cache-Control", "public, max-age=60").type(contentTypeFor(file!)).send(body);
}

const hostCache = new Map<string, { site: SiteRow | null; at: number }>();

/** Serve a published site when the request host is a custom domain or site subdomain. */
export async function serveHostedSite(ctx: AppContext, host: string, url: string, reply: FastifyReply): Promise<boolean> {
  const key = host.toLowerCase();
  let hit = hostCache.get(key);
  if (!hit || Date.now() - hit.at > 10_000) {
    hit = { site: await ctx.repo.findSiteByHost(host, ctx.cfg.sitesDomain), at: Date.now() };
    hostCache.set(key, hit);
  }
  if (!hit.site) return false;
  if (url.startsWith("/forms/") || url.startsWith("/media/")) return false;
  const site = await ctx.repo.getSite(hit.site.id); // fresh deployment pointer
  await sendDeployedFile(ctx, site, url, reply);
  return true;
}

const formHits = new Map<string, number[]>();

function rateLimited(ip: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const list = (formHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  formHits.set(ip, list);
  return list.length > max;
}

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo, cfg } = ctx;

  app.get<{ Params: { slug: string; "*": string } }>("/s/:slug/*", async (req, reply) => {
    const site = await repo.getSite(req.params.slug).catch(() => null);
    if (!site) return reply.status(404).send("Site not found");
    return sendDeployedFile(ctx, site, "/" + (req.params["*"] ?? ""), reply);
  });
  app.get<{ Params: { slug: string } }>("/s/:slug", async (req, reply) => reply.redirect(`/s/${req.params.slug}/`));

  // Live preview of any branch, opened with a signed link.
  app.get<{ Params: { key: string; siteId: string; branch: string; "*": string } }>("/preview/:key/:siteId/:branch/*", async (req, reply) => {
    const { key, siteId, branch } = req.params;
    if (!verifyPreview(cfg.secret, siteId, branch, key)) return reply.status(403).send("This preview link is invalid or has expired.");
    const head = await repo.getHead(siteId, branch);
    const path = "/" + (req.params["*"] ?? "").replace(/\/+$/, "");
    const route = resolveRoute(head.document, path === "" ? "/" : path, { includeDrafts: true });
    reply.headers(SECURITY_HEADERS).header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    if (!route) return reply.status(404).type("text/html").send(renderNotFound(head.document));
    const basePath = `/preview/${key}/${siteId}/${encodeURIComponent(branch)}`;
    return reply
      .type("text/html; charset=utf-8")
      .send(renderPage(head.document, route.page, { mode: "preview", basePath, itemId: route.item?.id, formAction: formActionFor(cfg, siteId) }));
  });

  // Form submissions from published sites.
  app.post<{ Params: { siteId: string; form: string } }>("/forms/:siteId/:form", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    if (rateLimited(req.ip)) return reply.status(429).send({ error: "Too many submissions. Try again in a minute." });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.siteId) || !/^[\w-]{1,64}$/.test(req.params.form)) throw new HttpError(404, "Unknown form.");
    const site = await repo.getSite(req.params.siteId).catch(() => null);
    if (!site) throw new HttpError(404, "Unknown form.");
    const raw = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 30)) {
      if (/^[\w-]{1,64}$/.test(k)) data[k] = String(v ?? "").slice(0, 5000);
    }
    if (Object.keys(data).length === 0) throw new HttpError(400, "The form was empty.");
    await repo.addSubmission(site.id, req.params.form, data);
    if ((req.headers["content-type"] ?? "").includes("application/json")) return { ok: true };
    const back = typeof req.headers.referer === "string" ? req.headers.referer : "/";
    return reply.redirect(back, 303);
  });
  app.options("/forms/:siteId/:form", async (_req, reply) =>
    reply.header("Access-Control-Allow-Origin", "*").header("Access-Control-Allow-Methods", "POST").header("Access-Control-Allow-Headers", "Content-Type").status(204).send(),
  );

  app.get<{ Params: { siteId: string; file: string } }>("/media/:siteId/:file", async (req, reply) => {
    const { siteId, file } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(siteId) || !/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i.test(file)) return reply.status(404).send("Not found");
    const body = await ctx.storage.get(`assets/${siteId}/${file}`);
    if (!body) return reply.status(404).send("Not found");
    return reply.headers(SECURITY_HEADERS).header("Cache-Control", "public, max-age=31536000, immutable").type(contentTypeFor(file)).send(body);
  });
}
