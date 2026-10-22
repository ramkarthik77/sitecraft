import { randomUUID } from "node:crypto";
import { renderSite } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Actor } from "./auth.js";
import type { Config } from "./config.js";
import type { Repo, SiteRow } from "./repo.js";
import { contentTypeFor, type Storage } from "./storage.js";

/** Where a site lives once published, and the link prefix its pages need. */
export function siteLocation(cfg: Config, site: Pick<SiteRow, "slug" | "domain">): { url: string; basePath: string } {
  if (site.domain) return { url: `https://${site.domain}`, basePath: "" };
  if (cfg.sitesDomain) {
    const proto = cfg.publicUrl.startsWith("https") ? "https" : "http";
    return { url: `${proto}://${site.slug}.${cfg.sitesDomain}`, basePath: "" };
  }
  return { url: `${cfg.publicUrl}/s/${site.slug}`, basePath: `/s/${site.slug}` };
}

export function formActionFor(cfg: Config, siteId: string) {
  return (form: string) => `${cfg.publicUrl}/forms/${siteId}/${form}`;
}

/** Render options that keep pages safe: the form bot check, and embeds of Sitecraft itself kept sandboxed. */
export function renderSecurity(cfg: Config) {
  const origins = [cfg.publicUrl, cfg.editorUrl].map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return "";
    }
  });
  return { turnstileSiteKey: cfg.turnstileSiteKey, selfOrigins: origins.filter(Boolean) };
}

/** Render a version to static files, upload them, then point the site at the new deployment. */
export async function publishVersion(cfg: Config, repo: Repo, storage: Storage, actor: Actor, site: SiteRow, branch: string) {
  const head = await repo.getHead(site.id, branch);
  const loc = siteLocation(cfg, site);
  const files = renderSite(head.document, { siteUrl: loc.url, basePath: loc.basePath, formAction: formActionFor(cfg, site.id), ...renderSecurity(cfg) });
  const deploymentId = randomUUID();
  const prefix = `sites/${site.id}/deploys/${deploymentId}`;
  await Promise.all([...files].map(([name, body]) => storage.put(`${prefix}/${name}`, body, contentTypeFor(name))));
  await repo.recordDeployment(actor, site.id, head.versionId, loc.url, [...files.keys()], deploymentId);
  return { deploymentId, url: loc.url, versionId: head.versionId, files: [...files.keys()] };
}

/** Map a request path inside a published site to its stored file. */
export function fileForPath(path: string): string | null {
  const clean = decodeURIComponent(path.split("?")[0]!).replace(/\/+$/, "");
  if (clean.includes("..") || clean.includes("\\")) return null;
  if (clean === "" || clean === "/") return "index.html";
  const rel = clean.replace(/^\//, "");
  if (/\.(xml|txt|html)$/.test(rel)) return rel;
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(rel)) return null;
  return `${rel}/index.html`;
}

/**
 * Render a branch as a self-contained zip: every page, a 404 page, robots.txt,
 * a sitemap when the final address is known, and the uploaded images it uses
 * (copied in and linked as /media/...).
 */
export async function exportSite(cfg: Config, repo: Repo, storage: Storage, site: SiteRow, branch: string, siteUrl?: string): Promise<Uint8Array> {
  const head = await repo.getHead(site.id, branch);
  const mediaPrefix = `${cfg.publicUrl}/media/${site.id}/`;
  const json = JSON.stringify(head.document).split(mediaPrefix).join("/media/");
  const doc = JSON.parse(json) as SiteDocument;
  const files = renderSite(doc, { siteUrl, basePath: "", formAction: formActionFor(cfg, site.id), ...renderSecurity(cfg) });

  const zip: Zippable = {};
  for (const [name, body] of files) zip[name] = strToU8(body);
  const media = new Set(json.match(/\/media\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp)/gi) ?? []);
  for (const ref of media) {
    const file = ref.slice("/media/".length);
    const body = await storage.get(`assets/${site.id}/${file}`);
    if (body) zip[`media/${file}`] = new Uint8Array(body);
  }
  zip["README.txt"] = strToU8(
    `${site.name}, exported from Sitecraft.\n\n` +
      `Upload everything in this folder to any static host (Cloudflare Pages, Netlify, GitHub Pages, S3).\n` +
      `Pages link to each other with root paths like /pricing, so host it at the root of a domain.\n` +
      `Forms post to ${cfg.publicUrl}/forms/; they work while that address is reachable.\n`,
  );
  return zipSync(zip, { level: 6 });
}
