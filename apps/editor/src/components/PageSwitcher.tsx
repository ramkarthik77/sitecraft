import { useEffect, useMemo, useRef, useState } from "react";
import { findCollection, type Page, type SiteDocument } from "@sitecraft/schema";
import { Icon } from "./Icon";

/** Pages in reading order: Home first, then by address, so /about/team sits under /about. */
export function orderedPages(doc: SiteDocument): { page: Page; depth: number; label: string }[] {
  const pages = doc.pages.filter((p) => !p.collectionId);
  const sorted = [...pages].sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
  const paths = new Set(sorted.map((p) => p.path));
  return sorted.map((page) => {
    const parts = page.path.split("/").filter(Boolean);
    // Indent under the nearest parent page that exists.
    let depth = 0;
    for (let i = parts.length - 1; i > 0; i--) if (paths.has("/" + parts.slice(0, i).join("/"))) depth++;
    return { page, depth, label: page.path === "/" ? "Home" : page.title || page.path };
  });
}

export function templatePages(doc: SiteDocument) {
  return doc.pages
    .filter((p) => p.collectionId)
    .map((page) => {
      const col = findCollection(doc, page.collectionId!);
      return { page, label: col ? `${col.name}: each item` : page.title, items: col?.items.length ?? 0 };
    });
}

/** The page picker in the editor's top bar: search, nesting and status at a glance. */
export function PageSwitcher(props: { doc: SiteDocument; page: Page; onOpen: (id: string) => void; onNewPage: () => void; onAllPages: () => void }) {
  const { doc, page } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => orderedPages(doc), [doc]);
  const templates = useMemo(() => templatePages(doc), [doc]);
  const match = (label: string, path: string) => !q || `${label} ${path}`.toLowerCase().includes(q.toLowerCase());
  const current = page.collectionId ? templates.find((t) => t.page.id === page.id)?.label : page.path === "/" ? "Home" : page.title;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(box.current?.querySelectorAll<HTMLButtonElement>(".ps-item") ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]!.focus();
      }
    };
    addEventListener("mousedown", away);
    addEventListener("keydown", key);
    return () => (removeEventListener("mousedown", away), removeEventListener("keydown", key));
  }, [open]);

  const pick = (id: string) => {
    props.onOpen(id);
    setOpen(false);
    setQ("");
  };
  const item = (p: Page, label: string, opts: { depth?: number; chip?: React.ReactNode; cms?: boolean }) => (
    <button key={p.id} role="option" aria-selected={p.id === page.id} className={`ps-item ${p.id === page.id ? "on" : ""}`} style={{ paddingLeft: 10 + (opts.depth ?? 0) * 16 }} onClick={() => pick(p.id)}>
      <Icon name={opts.cms ? "database" : p.path === "/" ? "home" : "pages"} size={13} style={opts.cms ? { color: "var(--cms)" } : undefined} />
      <span className="grow">{label}</span>
      {opts.chip}
      <span className="mono muted">{p.path}</span>
    </button>
  );
  const shownPages = pages.filter((x) => match(x.label, x.page.path));
  const shownTemplates = templates.filter((x) => match(x.label, x.page.path));

  return (
    <div className="page-switcher hide-narrow" ref={box}>
      <button className="ps-button" aria-label="Page" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={page.path}>
        <Icon name={page.collectionId ? "database" : page.path === "/" ? "home" : "pages"} size={13} />
        <span className="ps-title">{current}</span>
        <span className="mono ps-path">{page.path}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="ps-pop" role="dialog" aria-label="Pages">
          <label className="search ps-search">
            <Icon name="search" size={13} />
            <input autoFocus placeholder={`Find a page (${doc.pages.length})`} aria-label="Find a page" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (shownPages[0] ?? shownTemplates[0]) && pick((shownPages[0] ?? shownTemplates[0])!.page.id)} />
          </label>
          <div className="ps-list" role="listbox" aria-label="Pages">
            {shownPages.map((x) => item(x.page, x.label, { depth: q ? 0 : x.depth, chip: x.page.unpublished ? <span className="type-chip hidden-chip">Hidden</span> : null }))}
            {shownTemplates.length > 0 && <div className="ps-group">CMS item pages</div>}
            {shownTemplates.map((x) => item(x.page, x.label, { cms: true, chip: <span className="muted small">{x.items} items</span> }))}
            {shownPages.length + shownTemplates.length === 0 && <div className="ps-empty muted">No page matches “{q}”.</div>}
          </div>
          <div className="ps-foot">
            <button className="btn sm" onClick={() => (setOpen(false), props.onNewPage())}>
              <Icon name="plus" size={12} /> New page
            </button>
            <button className="btn ghost sm" onClick={() => (setOpen(false), props.onAllPages())}>
              All pages and status
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
