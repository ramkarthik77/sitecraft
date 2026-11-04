#!/usr/bin/env node
// Disposable local-Docker smoke test. Creates TWO imported demo sites:
// a selectable-text PDF and a DOCX with a table, bullet and embedded PNG.
// It never publishes. Optional --website URL imports an explicitly permitted site.
// Run inside the app container only; no external Node/pnpm dependencies.
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require("../apps/api/node_modules/fflate");
const base = (process.env.SITECRAFT_URL || "http://localhost:4000").replace(/\/$/, "");
const token = process.env.SITECRAFT_TOKEN || "";
if (process.env.SITECRAFT_DEMO_SMOKE !== "1") {
  console.error("This creates sample import sites. Set SITECRAFT_DEMO_SMOKE=1 to explicitly opt in on an expendable demo workspace.");
  process.exit(2);
}
if (!token) throw Error("SITECRAFT_TOKEN is required. Use your disposable stack's admin token.");
const headers = { authorization: `Bearer ${token}` };
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function call(method, path, body, contentType) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(contentType ? { "content-type": contentType } : body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) throw Error(`${method} ${path}: HTTP ${response.status}: ${String(data?.error || text).slice(0, 400)}`);
  return data;
}
function pdfFixture() {
  const stream = "BT /F1 20 Tf 70 720 Td (Sitecraft PDF smoke test) Tj ET";
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < parts.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${parts[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n`;
  for (const n of offsets.slice(1)) pdf += `${String(n).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(kind, payload) {
  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
  const b = Buffer.concat([Buffer.from(kind), payload]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(b));
  return Buffer.concat([len, b, crc]);
}
function pngFixture() {
  const w = 32, h = 24;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + x * 3 + 1;
      pixels[i] = 28 + x * 3; pixels[i + 1] = 75 + y * 4; pixels[i + 2] = 145;
    }
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function docxFixture() {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Sitecraft DOCX smoke test</w:t></w:r></w:p>
<w:p><w:r><w:t>Editable content from a synthetic Word document.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Review the content before publishing</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>
</w:body></w:document>`;
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(xml),
    "word/_rels/document.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="media/smoke.png"/></Relationships>'),
    "word/media/smoke.png": pngFixture(),
  }));
}
async function checkFile(filename, bytes, mime, phrase, expectedImages) {
  const url = `/api/imports/file?filename=${encodeURIComponent(filename)}&mode=single&rightsConfirmed=1`;
  const result = await call("POST", url, bytes, mime);
  assert(/^import\//.test(result.branch), `${filename} did not create a review branch`);
  assert(result.report?.importedAssets === expectedImages, `${filename}: expected ${expectedImages} draft images, got ${result.report?.importedAssets}`);
  assert(Array.isArray(result.warnings), "Import warnings missing");
  const branch = await call("GET", `/api/sites/${result.site.id}/branches/${encodeURIComponent(result.branch)}`);
  const main = await call("GET", `/api/sites/${result.site.id}/branches/main`);
  assert(JSON.stringify(branch.document).includes(phrase), `${filename}: imported text missing from review branch`);
  assert(!JSON.stringify(main.document).includes(phrase), `${filename}: text leaked into main without review`);
  if (expectedImages) assert(JSON.stringify(branch.document).includes("/media/library/"), "DOCX embedded image was not copied into DAM");
  console.log(`PASS ${filename}: ${result.pages.length} page(s), branch ${result.branch}, ${result.report.importedAssets} draft image(s), ${result.warnings.length} warning(s)`);
  console.log(`  Editor: ${base}/sites/${result.site.id}?branch=${encodeURIComponent(result.branch)}`);
  return result;
}

try {
  const health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(10_000) });
  assert(health.ok, "API healthcheck failed");
  const me = await call("GET", "/api/me");
  assert(me.role === "admin", "Use an admin token for the local demo smoke test");
  const unauth = await fetch(`${base}/api/me`, { signal: AbortSignal.timeout(10_000) });
  assert(unauth.status === 401, "API accepted an unauthenticated request");
  const unauthImport = await fetch(`${base}/api/imports/file?filename=unauthorized.pdf&rightsConfirmed=1`, {
    method: "POST", headers: { "content-type": "application/pdf" }, body: pdfFixture(), signal: AbortSignal.timeout(10_000),
  });
  assert(unauthImport.status === 401, "Import endpoint accepted an unauthenticated file upload");
  const sites = await call("GET", "/api/sites");
  assert(sites.some((s) => s.name === "Calvexa US HCP"), "Demo seed missing. Seed the disposable workspace first.");
  const chromium = execFileSync(process.env.SITECRAFT_IMPORT_CHROMIUM_PATH || "/usr/bin/chromium", ["--version"], { encoding: "utf8" }).trim();
  console.log(`PASS API and auth; ${sites.length} seeded sites; ${chromium}`);
  const pdf = pdfFixture();
  const word = docxFixture();
  // The same fixtures can be copied from the container for a drag/drop UI
  // demonstration, without installing Node or office software on the host.
  const smokeDir = await mkdtemp(join(tmpdir(), "sitecraft-smoke-"));
  const smokePdfPath = join(smokeDir, "sitecraft-smoke.pdf");
  const smokeDocxPath = join(smokeDir, "sitecraft-smoke.docx");
  await writeFile(smokePdfPath, pdf, { flag: "wx" });
  await writeFile(smokeDocxPath, word, { flag: "wx" });
  await checkFile("smoke.pdf", pdf, "application/pdf", "Sitecraft PDF smoke test", 0);
  await checkFile("smoke.docx", word, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Sitecraft DOCX smoke test", 1);
  console.log(`Generated ${smokePdfPath} and ${smokeDocxPath} for optional UI uploads.`);
  // Machine-readable paths: never return to predictable /tmp filenames.
  console.log(`FIXTURE_PDF_PATH=${smokePdfPath}`);
  console.log(`FIXTURE_DOCX_PATH=${smokeDocxPath}`);
  const assetList = await call("GET", "/api/assets");
  assert(Array.isArray(assetList) && assetList.some((a) => a.status === "draft"), "Expected a draft image in the asset library");
  console.log("PASS DOCX imported media remains a DRAFT asset; review rights and alt text before publishing.");
  const ix = process.argv.indexOf("--website");
  if (ix >= 0) {
    const url = process.argv[ix + 1];
    assert(url && /^https:\/\//.test(url), "--website requires an authorized public HTTPS address");
    const result = await call("POST", "/api/imports", { url, maxPages: 1, ai: false, render: true, rightsConfirmed: true });
    assert(result.site?.id && result.pages?.length > 0, "Website import did not return editable pages");
    assert(result.report?.renderedPages >= 1, "Browser render unavailable. Check Chromium logs and safeFetch warnings.");
    console.log(`PASS website: ${url} => ${result.pages.length} editable page(s); ${result.report.renderedPages} rendered page(s)`);
    console.log(`  Site: ${base}/sites/${result.site.id}`);
  } else {
    console.log("Website import: omitted to avoid unapproved/fragile external requests. To test, rerun with --website https://YOUR-AUTHORIZED-SITE.example");
  }
  console.log("PASS docker demo importer smoke test");
} catch (e) {
  console.error("FAIL docker demo importer smoke test:", e.message);
  process.exitCode = 1;
}
