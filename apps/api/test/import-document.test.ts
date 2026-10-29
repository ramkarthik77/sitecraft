import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { extractDocx, extractPdf, compileExtractedDocument } from "../src/import-document.js";
import { auth, EDITOR, startTestServer } from "./helpers.js";

/** Real OpenXML packaging with 2 headings, paragraph, list and a table. */
function wordFile() {
  const document = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Services overview</w:t></w:r></w:p>
      <w:p><w:r><w:t>Build experiences responsibly.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Frequently asked questions</w:t></w:r></w:p>
      <w:p><w:r><w:t>Can I edit this?</w:t></w:r></w:p>
      <w:p><w:r><w:t>Yes, all content remains editable.</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Review this document</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
  return Buffer.from(zipSync({
    "word/document.xml": strToU8(document),
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  }));
}

/** Generate a small, well-formed PDF with a selectable text stream. */
function pdfFile(text = "Hello Sitecraft PDF import") {
  const escaped = text.replace(/[()\\]/g, "\\$&");
  const instructions = `BT /F1 22 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(instructions)} >>\\nstream\\n${instructions}\\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\\n${obj}\\nendobj\\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\\n0 ${objects.length + 1}\\n0000000000 65535 f \\n`;
  for (const off of offsets.slice(1)) pdf += `${String(off).padStart(10, "0")} 00000 n \\n`;
  pdf += `trailer\\n<< /Size ${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n${xref}\\n%%EOF`;
  return Buffer.from(pdf);
}

let app: FastifyInstance;
beforeAll(async () => { ({ app } = await startTestServer({ DATABASE_URL: "pglite:memory" })); });
afterAll(async () => { await app?.close(); });

describe("multi-source document importer", () => {
  it("extracts headings, paragraphs, lists and Word tables", () => {
    const d = extractDocx(wordFile(), "services.docx");
    expect(d.source).toBe("docx");
    expect(d.extractedItems).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(d.pages)).toContain("Services overview");
    expect(JSON.stringify(d.pages)).toContain("Review this document");
    expect(JSON.stringify(d.pages)).toContain("Plan | Price");
    expect(d.warnings.join(" ")).toMatch(/table/i);
    const converted = compileExtractedDocument(d, new Map());
    expect(converted.pages[0]?.sections.length).toBeGreaterThan(1);
  });

  it("uploads a DOCX into a review branch and never changes main", async () => {
    const before = await app.inject({ method: "GET", url: "/api/sites", headers: auth(EDITOR) });
    const count = JSON.parse(before.body).length;
    const res = await app.inject({
      method: "POST", url: "/api/imports/file?filename=services.docx&ai=0",
      headers: { ...auth(EDITOR), "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      payload: wordFile(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.source).toBe("docx");
    expect(body.branch).toMatch(/^import\//);
    expect(body.pages.length).toBe(1);
    const draft = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${body.site.id}/branches/${body.branch}`, headers: auth(EDITOR) })).body);
    expect(JSON.stringify(draft.document)).toContain("Services overview");
    const main = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${body.site.id}/branches/main`, headers: auth(EDITOR) })).body);
    expect(JSON.stringify(main.document)).not.toContain("Services overview");
    const after = JSON.parse((await app.inject({ method: "GET", url: "/api/sites", headers: auth(EDITOR) })).body);
    expect(after.length).toBe(count + 1);
  });

  it("extracts text-based PDF and creates a reviewable page", async () => {
    const pdf = pdfFile();
    const extracted = await extractPdf(pdf, "product-guide.pdf");
    expect(JSON.stringify(extracted.pages)).toContain("Hello Sitecraft PDF import");
    const res = await app.inject({
      method: "POST", url: "/api/imports/file?filename=product-guide.pdf&mode=single",
      headers: { ...auth(EDITOR), "content-type": "application/pdf" }, payload: pdf,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body);
    const draft = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${body.site.id}/branches/${body.branch}`, headers: auth(EDITOR) })).body);
    expect(JSON.stringify(draft.document)).toContain("Hello Sitecraft PDF import");
    expect(body.warnings.join(" ")).toMatch(/columns|tables/);
  });

  it("can import pages into an existing site without replacing main", async () => {
    const first = await app.inject({
      method: "POST", url: "/api/imports/file?filename=first.docx",
      headers: { ...auth(EDITOR), "content-type": "application/octet-stream" }, payload: wordFile(),
    });
    expect(first.statusCode).toBe(201);
    const siteId = JSON.parse(first.body).site.id;
    const followup = await app.inject({
      method: "POST", url: `/api/imports/file?filename=other.docx&siteId=${siteId}`,
      headers: { ...auth(EDITOR), "content-type": "application/octet-stream" }, payload: wordFile(),
    });
    expect(followup.statusCode, followup.body).toBe(201);
    const res = JSON.parse(followup.body);
    expect(res.site.id).toBe(siteId);
    expect(res.pages[0].path).toMatch(/^\/import-other$/);
    const main = JSON.parse((await app.inject({ method: "GET", url: `/api/sites/${siteId}/branches/main`, headers: auth(EDITOR) })).body);
    expect(main.document.pages.some((p: { path: string }) => p.path === "/import-other")).toBe(false);
  });

  it("rejects mislabelled files and unsupported Word formats", async () => {
    const pdf = pdfFile();
    const wrong = await app.inject({ method: "POST", url: "/api/imports/file?filename=wrong.docx", headers: { ...auth(EDITOR), "content-type": "application/octet-stream" }, payload: pdf });
    expect(wrong.statusCode).toBe(415);
    const doc = await app.inject({ method: "POST", url: "/api/imports/file?filename=old.doc", headers: { ...auth(EDITOR), "content-type": "application/octet-stream" }, payload: wordFile() });
    expect(doc.statusCode).toBe(400);
  });
});
