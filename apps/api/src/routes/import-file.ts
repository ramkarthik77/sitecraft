import type { FastifyInstance } from "fastify";
import { createStarterDocument, type Operation } from "@sitecraft/schema";
import { canAccessSite, requireRole } from "../auth.js";
import { HttpError } from "../errors.js";
import type { AppContext } from "../server.js";
import { compileExtractedDocument, extractDocx, extractPdf } from "../import-document.js";
import { claudeSectionHints, semanticOps } from "../semantic-import.js";
import { ingestEmbeddedImages } from "../import-assets.js";

/**
 * Accept file bytes directly. JSON POST /imports (website URL) remains
 * backward compatible. Both sources enter the same ImportedPage → semanticOps
 * → repo.applyOps pipeline. Nothing publishes or bypasses an MLR review.
 *
 * POST /imports/file?filename=...&siteId=...&mode=single|pages&ai=1
 * Content-Type: application/pdf or DOCX OpenXML mime
 * Body: raw file bytes; 12MB maximum.
 */
export function importFileRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo } = ctx;
  app.post<{ Querystring: { filename?: string; siteId?: string; mode?: string; ai?: string; name?: string } }>("/imports/file", async (req, reply) => {
    requireRole(req.actor, "admin", "editor");
    const b = req.query ?? {};
    const filename = String(b.filename ?? "").replace(/[^\w. -]/g, "_").slice(0, 140);
    if (!filename || !/\.(pdf|docx)$/i.test(filename)) {
      throw new HttpError(400, "Choose a .pdf or .docx file. Older .doc files are not supported.");
    }
    if (!Buffer.isBuffer(req.body) || !req.body.byteLength || req.body.byteLength > 12_000_000) {
      throw new HttpError(400, "Upload a PDF or DOCX as raw file bytes, up to 12 MB.");
    }
    const isPdf = /\.pdf$/i.test(filename);
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0]!;
    const permitted = isPdf ? ["application/pdf", "application/octet-stream"] :
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"];
    if (!permitted.includes(contentType)) throw new HttpError(415, "File type does not match PDF or DOCX. Check its extension and Content-Type.");
    if (isPdf ? req.body.subarray(0, 5).toString() !== "%PDF-" : req.body.subarray(0, 2).toString() !== "PK") {
      throw new HttpError(415, "The file bytes do not match the selected PDF or DOCX format.");
    }
    const mode = b.mode === "single" ? "single" : "pages";
    let extracted;
    try {
      extracted = isPdf
        ? await extractPdf(req.body, filename)
        : extractDocx(req.body, filename);
    } catch (e) {
      throw new HttpError(422, `Could not read ${filename}: ${(e as Error).message.slice(0, 240)}`);
    }
    const name = (b.name?.trim() || extracted.title).slice(0, 80);
    const existingId = b.siteId?.trim();
    if (existingId && !/^[a-f0-9-]{36}$/i.test(existingId)) throw new HttpError(400, "Invalid destination site ID.");
    if (!existingId && req.actor.siteIds) throw new HttpError(403, "This token can only access existing sites.");
    let site;
    if (existingId) {
      site = await repo.getSite(existingId);
      if (!canAccessSite(req.actor, site.id)) throw new HttpError(403, "This token cannot edit the destination site.");
    }
    const assets = await ingestEmbeddedImages(extracted.images, ctx, req.actor);
    const result = compileExtractedDocument(extracted, assets.urls, mode);
    result.warnings.push(...assets.warnings);
    const hints = await claudeSectionHints(result.pages, new Map(), b.ai === "1" || b.ai === "true");
    if (hints.warning) result.warnings.push(hints.warning);
    if (!site) site = await repo.createSite(req.actor, { name, document: createStarterDocument({ name, template: "blank" }) });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "document";
    const branch = `import/${slug}-${Date.now().toString(36)}`;
    await repo.createBranch(req.actor, site.id, branch);
    const head = (await repo.getHead(site.id, branch)).document;
    let pages = result.pages;
    if (existingId) {
      // Never overwrite live/main pages when bringing a file into an existing
      // site. A separate import branch creates namespaced pages for review.
      const basePath = `/import-${slug}`;
      pages = result.pages.map((p, i) => ({
        ...p,
        path: `${basePath}${i ? `/page-${i + 1}` : ""}`,
      }));
    }
    const pre: Operation[] = [];
    if (existingId) {
      for (const p of pages) {
        if (head.pages.some((x) => x.path === p.path)) {
          throw new HttpError(409, `Page ${p.path} already exists; rename the import before retrying.`);
        }
        pre.push({ op: "add_page", title: p.title, path: p.path, description: p.description });
      }
    } else {
      const home = pages[0];
      if (home) pre.push({ op: "update_page", pageId: head.pages[0]!.id, title: home.title, description: home.description ?? "" });
      for (const p of pages.slice(1)) pre.push({ op: "add_page", path: p.path, title: p.title, description: p.description });
    }
    if (pre.length) await repo.applyOps(req.actor, site.id, branch, pre, "Create imported document pages");
    const snapshot = (await repo.getHead(site.id, branch)).document;
    const ops: Operation[] = [];
    const decisions: { path: string; label: string; index: number; mapped: boolean; reason: string }[] = [];
    for (const p of pages) {
      const target = snapshot.pages.find((x) => x.path === p.path);
      if (!target) throw new HttpError(500, "Imported page could not be created.");
      const semantic = semanticOps(p.sections, target.root.id, hints.hints.get(result.pages.find((x) => x.source === p.source)?.path ?? p.path));
      ops.push(...semantic.ops);
      decisions.push(...semantic.decisions.map((x) => ({ path: p.path, ...x })));
    }
    if (ops.length) await repo.applyOps(req.actor, site.id, branch, ops, `Extract and structure ${filename}`);
    await ctx.db.query(
      "INSERT INTO audit_log (site_id, actor, actor_role, action, detail) VALUES ($1, $2, $3, 'document.import', $4)",
      [site.id, req.actor.name, req.actor.role, { filename, format: extracted.source, branch, items: extracted.extractedItems, pages: pages.length, assets: assets.urls.size }],
    );
    reply.status(201);
    return {
      site: { id: site.id, name: site.name, slug: site.slug },
      branch,
      source: extracted.source,
      pages: pages.map((p) => ({ path: p.path, source: p.source, title: p.title, sections: p.sections.length })),
      warnings: result.warnings,
      theme: result.theme,
      report: {
        importedAssets: assets.urls.size,
        renderedPages: 0,
        sharedComponents: 0,
        retainedRemoteAssets: 0,
        mappedBlocks: decisions.filter((d) => d.mapped).length,
        preservedSections: decisions.filter((d) => !d.mapped).length,
        lowConfidenceSections: extracted.pages.flatMap((p) => p.sections).filter((x) => x.confidence < 0.75).length,
        decisions,
        screenshots: [],
      },
    };
  });
}
