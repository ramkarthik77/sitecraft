import { isSafeHref, isSafeSrc } from "@sitecraft/schema";

/**
 * A small, safe Markdown subset for rich text fields: headings, paragraphs,
 * bold, italic, inline code, links, images, lists, quotes, code blocks and
 * rules. Everything is escaped; raw HTML is shown as text, never rendered.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const INLINE = /(`[^`\n]+`)|!\[([^\]\n]*)\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function emphasis(escaped: string): string {
  return escaped.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
}

function inline(raw: string, href: (h: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(INLINE)) {
    out += emphasis(esc(raw.slice(last, m.index)));
    last = m.index! + m[0].length;
    if (m[1]) out += `<code>${esc(m[1].slice(1, -1))}</code>`;
    else if (m[3] !== undefined) {
      out += isSafeSrc(m[3]) ? `<img src="${esc(m[3])}" alt="${esc(m[2] ?? "")}" loading="lazy" decoding="async">` : esc(m[0]);
    } else if (m[5] !== undefined) {
      const external = /^https?:\/\//i.test(m[5]);
      out += isSafeHref(m[5])
        ? `<a href="${esc(href(m[5]))}"${external ? ' rel="noopener noreferrer"' : ""}>${emphasis(esc(m[4]!))}</a>`
        : emphasis(esc(m[4]!));
    }
  }
  return out + emphasis(esc(raw.slice(last)));
}

export function renderMarkdown(src: string, href: (h: string) => string = (h) => h): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), href)}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (t.startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      // One h1 per page belongs to the page title, so "#" starts at h2.
      const level = Math.min(6, Math.max(2, h[1]!.length));
      out.push(`<h${level}>${inline(h[2]!, href)}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith(">"); i++) quote.push(lines[i]!.trim().replace(/^>\s?/, ""));
      i--;
      out.push(`<blockquote><p>${inline(quote.join(" "), href)}</p></blockquote>`);
      continue;
    }
    const ul = /^[-*+]\s+/;
    const ol = /^\d+[.)]\s+/;
    if (ul.test(t) || ol.test(t)) {
      flush();
      const ordered = ol.test(t);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      for (; i < lines.length && re.test(lines[i]!.trim()); i++) items.push(`<li>${inline(lines[i]!.trim().replace(re, ""), href)}</li>`);
      i--;
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    para.push(t);
  }
  flush();
  return out.join("");
}
