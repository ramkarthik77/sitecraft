import { randomUUID } from "node:crypto";
import { renderSite } from "@sitecraft/renderer";
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

/** Render a version to static files, upload them, then point the site at the new deployment. */
export async function publishVersion(cfg: Config, repo: Repo, storage: Storage, actor: Actor, site: SiteRow, branch: string) {
  const head = await repo.getHead(site.id, branch);
  const loc = siteLocation(cfg, site);
  const files = renderSite(head.document, { siteUrl: loc.url, basePath: loc.basePath, formAction: formActionFor(cfg, site.id) });
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
