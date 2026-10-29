import { useEffect, useState } from "react";
import { Imports, Templates, type ImportResult } from "../api";
import { navigate } from "../router";
import { refreshShared } from "../store";
import { useToast } from "../Toasts";
import { FolderSelect, useFolders } from "./Folders";
import { Icon } from "./Icon";

/**
 * Bring an existing website in: its pages are rebuilt as editable sections,
 * as a new site and, if asked, a template.
 */
export function ImportDialog({ onClose, asTemplate = false, folderId = null }: { onClose: () => void; asTemplate?: boolean; folderId?: string | null }) {
  const toast = useToast();
  const { folders } = useFolders("site");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [pages, setPages] = useState(5);
  const [folder, setFolder] = useState<string | null>(folderId);
  const [template, setTemplate] = useState(asTemplate);
  const [rights, setRights] = useState(false);
  const [render, setRender] = useState(true);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, busy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await Imports.run({ url: url.trim(), name: name.trim() || undefined, maxPages: pages, folderId: folder, render, ai, rightsConfirmed: rights });
      if (template) await Templates.create({ siteId: r.site.id, name: name.trim() || r.site.name }).catch((err) => toast({ text: `Imported, but the template wasn't saved: ${(err as Error).message}`, tone: "error" }));
      void refreshShared();
      setDone(r);
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      {!done ? (
        <form className="modal form-modal import" role="dialog" aria-modal="true" aria-labelledby="im-title" onSubmit={submit}>
          <header>
            <h2 id="im-title">Import from a website</h2>
            <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose} disabled={busy}>
              <Icon name="close" size={14} />
            </button>
          </header>
          <p className="muted small" style={{ margin: 0 }}>
            Sitecraft renders the website, inspects its layout and maps recognized content to editable Sections. It saves screenshots for comparison and copies supported images to the asset library as drafts. Complex widgets and interactions still require review.
          </p>
          <label className="field-stack">
            <span className="small muted">Website address</span>
            <input className="input" autoFocus required type="text" inputMode="url" placeholder="https://www.example.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Website address" />
          </label>
          <div className="row2">
            <label className="field-stack">
              <span className="small muted">Name (optional)</span>
              <input className="input" placeholder="Taken from the site" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field-stack">
              <span className="small muted">Pages to bring</span>
              <select className="select" value={pages} onChange={(e) => setPages(Number(e.target.value))} aria-label="Pages to bring">
                {[1, 3, 5, 10, 25].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Just this page" : `Up to ${n} pages`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field-stack">
            <span className="small muted">Folder</span>
            <FolderSelect folders={folders ?? []} value={folder} onChange={setFolder} label="Folder" />
          </label>
          <label className="check">
            <input type="checkbox" checked={render} onChange={(e) => setRender(e.target.checked)} />
            <span>Render JavaScript and capture source layout with Playwright (recommended)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
            <span>Use Claude for optional semantic section suggestions (sends page structure to configured provider)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
            <span>Also save it as a template</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>We own this site or have permission to copy its content, images and design. Imported images require separate asset approval before publishing.</span>
          </label>
          <footer>
            <span className="muted small grow">{busy ? "Rendering and converting the site…" : "Supported images become draft assets. Review screenshots, content fidelity and rights before publishing."}</span>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !url.trim() || !rights}>
              {busy ? "Importing…" : "Import"}
            </button>
          </footer>
        </form>
      ) : (
        <div className="modal form-modal import" role="dialog" aria-modal="true" aria-labelledby="im-done">
          <header>
            <h2 id="im-done">Imported {done.site.name}</h2>
            <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={14} />
            </button>
          </header>
          <ul className="im-pages">
            {done.pages.map((p) => (
              <li key={p.path}>
                <Icon name="pages" size={13} />
                <span className="grow">
                  <strong>{p.path === "/" ? "Home" : p.title}</strong>
                  <span className="muted small mono">{p.path}</span>
                </span>
                <span className="muted small">
                  {p.sections} {p.sections === 1 ? "section" : "sections"}
                </span>
              </li>
            ))}
          </ul>
          {done.report && (
            <div className="card" style={{ padding: "14px 16px", display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center" }} aria-label="Import quality report">
              <strong>Import report</strong>
              <span className="small">{done.report.renderedPages} rendered pages</span>
              <span className="small">{done.report.mappedBlocks} Section blocks</span>
              <span className="small">{done.report.preservedSections} faithful editable sections</span>
              <span className="small">{done.report.sharedComponents} shared components</span>
              <span className="small">{done.report.importedAssets} draft images copied</span>
              {done.report.retainedRemoteAssets > 0 && <span className="small">{done.report.retainedRemoteAssets} source images need replacement</span>}
              <p className="muted small" style={{ width: "100%", margin: 0 }}>Use source screenshots for a visual comparison before approving or publishing. Screenshots require sign-in and are available through the import report API.</p>
            </div>
          )}
          {(done.theme.colors.primary || done.theme.fonts.heading) && (
            <p className="small im-theme">
              {done.theme.colors.primary && (
                <>
                  <span className="im-swatch" style={{ background: done.theme.colors.primary }} aria-hidden="true" /> Main colour {done.theme.colors.primary}
                </>
              )}
              {done.theme.fonts.heading && <> · Headings in {done.theme.fonts.heading.split(",")[0]!.replace(/'/g, "")}</>}
            </p>
          )}
          {done.warnings.length > 0 && (
            <ul className="im-warn">
              {done.warnings.map((w, i) => (
                <li key={i}>
                  <Icon name="alert" size={12} /> {w}
                </li>
              ))}
            </ul>
          )}
          <footer>
            <span className="grow" />
            <button className="btn" onClick={() => (onClose(), navigate(`/sites/${done.site.id}/overview`))}>
              Open overview
            </button>
            <button className="btn primary" onClick={() => (onClose(), navigate(`/sites/${done.site.id}`))}>
              Open in editor
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
