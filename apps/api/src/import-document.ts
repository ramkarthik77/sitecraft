import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ImportedPage, ImportResult } from "./importer.js";

/** Source-agnostic, data-only intermediate representation.
 * Claude may classify/reorder references; it never creates executable nodes.
 */
export type SourceKind = "pdf" | "docx";
export type IRBlock =
  | { id: string; kind: "heading"; text: string; level: number }
  | { id: string; kind: "paragraph" | "list" | "table"; text: string }
  | { id: string; kind: "image"; key: string; alt: string };
export interface IRSection { title: string; blocks: IRBlock[]; confidence: number }
export interface IRPage { title: string; sections: IRSection[]; sourcePage?: number }
export interface EmbeddedImage { key: string; data: Buffer; alt: string }
export interface ExtractedDocument {
  source: SourceKind;
  title: string;
  pages: IRPage[];
  images: EmbeddedImage[];
  warnings: string[];
  extractedItems: number;
}

const MAX_PAGES = 25;
const MAX_BLOCKS = 450;
const xmlDecode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (token) => {
  const dict: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  if (dict[token]) return dict[token]!;
  const hex = /^&#x([\da-f]+);$/i.exec(token);
  const decimal = /^&#(\d+);$/.exec(token);
  const n = hex ? parseInt(hex[1]!, 16) : decimal ? Number(decimal[1]) : -1;
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : token;
});
const textNodes = (s: string) => Array.from(s.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g), (m) => xmlDecode(m[1]!)).join("");
const titleFrom = (filename: string) => filename.replace(/\.(?:pdf|docx)$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 160) || "Imported document";
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55) || "page";
const blockId = (n: number) => `block-${n}`;

export function extractDocx(bytes: Buffer, filename: string): ExtractedDocument {
  if (bytes.length > 12_000_000) throw Error("DOCX is larger than the 12 MB import limit.");
  let total = 0;
  const zipped = unzipSync(new Uint8Array(bytes), {
    filter: (f) => {
      if (f.originalSize > 5_000_000) return false;
      if (total + f.originalSize > 24_000_000) return false;
      total += f.originalSize;
      return /^word\/(document\.xml|_rels\/document\.xml\.rels|media\/[^/]+)$/.test(f.name);
    },
  });
  const xml = zipped["word/document.xml"];
  if (!xml) throw Error("This ZIP is not a valid DOCX with word/document.xml.");
  const source = new TextDecoder().decode(xml);
  const rels = new TextDecoder().decode(zipped["word/_rels/document.xml.rels"] ?? new Uint8Array());
  const relation = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1];
    if (id && target && /^media\/[\w.-]+$/i.test(target)) relation.set(id, `word/${target}`);
  }
  const images: EmbeddedImage[] = [];
  const imageKeys = new Set<string>();
  const warnings: string[] = [];
  const pages: IRPage[] = [{ title: titleFrom(filename), sections: [] }];
  let current: IRSection = { title: "Introduction", blocks: [], confidence: 0.85 };
  pages[0]!.sections.push(current);
  let n = 0;
  let sections = 0;
  const emit = (b: IRBlock) => { if (n < MAX_BLOCKS) { current.blocks.push(b); n++; } };
  const newSection = (name: string) => {
    if (sections >= 80) return;
    if (!current.blocks.length) current.title = name;
    else {
      current = { title: name.slice(0, 140), blocks: [], confidence: 0.85 };
      pages[pages.length - 1]!.sections.push(current);
    }
    sections++;
  };
  // Handle Word body top-level paragraphs and tables in source order.
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(source)?.[1] ?? source;
  for (const match of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const part = match[0];
    if (n >= MAX_BLOCKS || pages.length > MAX_PAGES) break;
    if (part.startsWith("<w:tbl")) {
      const rows = [...part.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].slice(0, 30).map((row) =>
        [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].slice(0, 10).map((cell) => textNodes(cell[0]).trim()).join(" | "));
      if (rows.length) emit({ id: blockId(n), kind: "table", text: rows.join("\n") });
      warnings.push("A Word table was converted to editable rows of text; check its columns before approval.");
      continue;
    }
    const t = textNodes(part).replace(/\s+/g, " ").trim().slice(0, 3000);
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(part)?.[1] ?? "";
    const heading = /^(?:heading|title)([1-6])$/i.exec(style)?.[1];
    const lvl = heading ? Number(heading) : /<w:outlineLvl\b[^>]*w:val="(\d)"/.exec(part)?.[1];
    const level = lvl === undefined ? 0 : Math.max(1, Math.min(4, Number(lvl) || 1));
    if (t) {
      if (level) {
        newSection(t);
        emit({ id: blockId(n), kind: "heading", level, text: t });
      } else if (/<w:numPr\b/.test(part)) emit({ id: blockId(n), kind: "list", text: `• ${t}` });
      else emit({ id: blockId(n), kind: "paragraph", text: t });
    }
    for (const drawing of part.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"[^>]*\/?\s*>/g)) {
      const path = relation.get(drawing[1]!);
      const img = path ? zipped[path] : undefined;
      if (!img) { warnings.push("A Word image or linked drawing could not be extracted."); continue; }
      if (!imageKeys.has(path!)) {
        images.push({ key: path!, data: Buffer.from(img), alt: `Image from ${titleFrom(filename)}` });
        imageKeys.add(path!);
      }
      emit({ id: blockId(n), kind: "image", key: path!, alt: `Image from ${titleFrom(filename)}` });
    }
  }
  if (!n) throw Error("The Word document contained no readable paragraphs.");
  if (n >= MAX_BLOCKS) warnings.push("Document exceeds 450 editable content blocks. Remaining content was not imported.");
  if (images.length) warnings.push("Word images are imported as draft assets and require rights and alt-text review.");
  return { source: "docx", title: titleFrom(filename), pages, images, warnings, extractedItems: n };
}

type PdfText = { str?: string; hasEOL?: boolean; transform?: number[]; height?: number };
export async function extractPdf(bytes: Buffer, filename: string): Promise<ExtractedDocument> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw Error("This file is not a PDF.");
  if (bytes.length > 12_000_000) throw Error("PDF is larger than the 12 MB import limit.");
  const warnings: string[] = [];
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, stopAtErrors: false });
  const pages: IRPage[] = [];
  let count = 0;
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} PDF pages were extracted; ${pdf.numPages - MAX_PAGES} were skipped.`);
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & PdfText => "str" in i && typeof i.str === "string") as PdfText[];
      const lines: { text: string; size: number }[] = [];
      let buffer = "";
      let maxSize = 0;
      const flush = () => {
        const text = buffer.replace(/\s+/g, " ").trim();
        if (text) lines.push({ text: text.slice(0, 3000), size: maxSize });
        buffer = "";
        maxSize = 0;
      };
      for (const item of items) {
        if (!item.str) continue;
        const size = item.height || Math.hypot(item.transform?.[0] ?? 0, item.transform?.[1] ?? 0);
        maxSize = Math.max(maxSize, size);
        buffer += item.str + (item.hasEOL ? "" : " ");
        if (item.hasEOL) flush();
      }
      flush();
      const typical = [...lines.map((l) => l.size).filter((x) => x > 0)].sort((a, b) => a - b);
      const median = typical[Math.floor(typical.length / 2)] ?? 12;
      let section: IRSection = { title: `Page ${p}`, confidence: 0.7, blocks: [] };
      const entry: IRPage = { title: `${titleFrom(filename)} — Page ${p}`, sections: [section], sourcePage: p };
      for (const line of lines) {
        if (count >= MAX_BLOCKS) break;
        const heading = line.size >= median * 1.42 && line.text.length < 150;
        if (heading && section.blocks.length && entry.sections.length < 18) {
          section = { title: line.text, confidence: 0.72, blocks: [] };
          entry.sections.push(section);
        }
        section.blocks.push(heading
          ? { id: blockId(count), kind: "heading", level: 2, text: line.text }
          : { id: blockId(count), kind: "paragraph", text: line.text });
        count++;
      }
      if (!lines.length) warnings.push(`PDF page ${p} has no extractable text. It may be scanned; OCR is not enabled.`);
      else if (lines.length > 140) warnings.push(`PDF page ${p} is dense. Review reading order and complex columns/tables.`);
      pages.push(entry);
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  if (!count) throw Error("No selectable PDF text was found. This file may require OCR; scanned PDFs are not supported yet.");
  warnings.push("PDF columns, tables, diagrams and embedded images may require manual reconstruction; check page reading order.");
  if (count >= MAX_BLOCKS) warnings.push("PDF content exceeds 450 blocks; remaining text was skipped.");
  return { source: "pdf", title: titleFrom(filename), pages, images: [], warnings, extractedItems: count };
}

/** Compile only safe, editable built-in nodes. Every returned operation is
 * subsequently validated by repo.applyOps; no raw source XML/JS is published.
 */
export function compileExtractedDocument(
  extracted: ExtractedDocument,
  imageUrls: Map<string, string>,
  mode: "pages" | "single" = "pages",
): ImportResult {
  type N = ImportedPage["sections"][number];
  const pages: ImportedPage[] = [];
  const sectionNode = (section: IRSection): N => {
    const children: N[] = [];
    for (const b of section.blocks) {
      if (b.kind === "image") {
        const src = imageUrls.get(b.key);
        if (src) children.push({ type: "image", props: { src, alt: b.alt }, style: { base: { width: "100%", maxWidth: "900px", objectFit: "contain" } } });
      } else if (b.kind === "heading") {
        children.push({ type: "heading", props: { text: b.text, level: b.level }, style: { base: { color: "var(--color-text)", fontSize: b.level === 1 ? "42px" : "30px", margin: "0" }, mobile: { fontSize: "26px" } } });
      } else {
        children.push({ type: "text", props: { text: b.text }, style: { base: { lineHeight: "1.6", fontSize: "17px", color: "var(--color-text)", margin: "0", maxWidth: "860px" } } });
      }
    }
    return { type: "section", name: section.title, props: {}, style: { base: { padding: "48px 24px", display: "flex", flexDirection: "column" }, mobile: { padding: "32px 16px" } }, children: [
      { type: "stack", name: "Container", props: {}, style: { base: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1000px", width: "100%", margin: "0 auto" } }, children },
    ] };
  };
  for (let i = 0; i < extracted.pages.length; i++) {
    const page = extracted.pages[i]!;
    if (mode === "single" && pages.length) {
      pages[0]!.sections.push(...page.sections.map(sectionNode));
      continue;
    }
    pages.push({
      source: `${extracted.source}:${extracted.title}#page=${i + 1}`,
      path: i === 0 ? "/" : `/page-${i + 1}`,
      title: page.title,
      sections: page.sections.filter((s) => s.blocks.length).map(sectionNode),
    });
  }
  return {
    origin: `${extracted.source}:${extracted.title}`,
    name: extracted.title,
    pages,
    warnings: [...extracted.warnings],
    theme: { colors: {}, fonts: {} },
  };
}
