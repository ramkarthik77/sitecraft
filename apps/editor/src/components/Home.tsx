import { useEffect, useMemo, useState } from "react";
import { createStarterDocument, type SiteDocument } from "@sitecraft/schema";
import { AUDIENCES, Sites, Templates, type SavedTemplate } from "../api";
import { navigate } from "../router";
import { refreshShared, useShared } from "../store";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";
import { DocThumb } from "../App";

/** Creating a site: a name, a starting point, and where it sits in the portfolio. */

const editorUrl = (siteId: string) => `/sites/${siteId}`;

// ── New site ────────────────────────────────────────────────────────────

const STARTERS: { id: "landing" | "saas" | "blog" | "blank"; name: string; about: string }[] = [
  { id: "landing", name: "Landing page", about: "One page: hero, features, call to action" },
  { id: "saas", name: "Product site", about: "Features, pricing, FAQ and testimonials" },
  { id: "blog", name: "Blog", about: "Posts from the CMS, with a post page" },
  { id: "blank", name: "Blank", about: "An empty page to build from scratch" },
];

export function NewSiteDialog({ onClose, folderId }: { onClose: () => void; folderId?: string | null }) {
  const [name, setName] = useState("");
  const [choice, setChoice] = useState("landing");
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [savedDocs, setSavedDocs] = useState<Record<string, SiteDocument>>({});
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState({ therapyArea: "", market: "", audience: "" });
  const { sites } = useShared();
  const areas = [...new Set((sites ?? []).map((s) => s.therapyArea).filter(Boolean))] as string[];
  const toast = useToast();
  const starters = useMemo(() => Object.fromEntries(STARTERS.map((s) => [s.id, createStarterDocument({ name: "Your site", template: s.id })])), []);

  useEffect(() => {
    Templates.list()
      .then((list) => {
        setSaved(list);
        // Thumbnails for the first few saved templates.
        for (const t of list.slice(0, 6))
          Templates.get(t.id)
            .then((full) => setSavedDocs((d) => ({ ...d, [t.id]: full.document })))
            .catch(() => {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = choice.startsWith("t:") ? await Sites.create(name.trim(), "", choice.slice(2), folderId) : await Sites.create(name.trim(), choice, undefined, folderId);
      if (where.therapyArea || where.market || where.audience) await Sites.profile(s.id, where).catch((err) => toast({ text: (err as Error).message, tone: "error" }));
      void refreshShared();
      navigate(editorUrl(s.id));
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };

  const option = (id: string, title: string, about: string, doc: SiteDocument | null, extra?: string) => (
    <label key={id} className={`tpl ${choice === id ? "on" : ""}`}>
      <input type="radio" name="template" value={id} checked={choice === id} onChange={() => setChoice(id)} />
      <DocThumb doc={doc} />
      <strong>{title}</strong>
      <span className="muted small">{about}</span>
      {extra && <span className="type-chip">{extra}</span>}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal new-site" role="dialog" aria-modal="true" aria-labelledby="new-site-title" onSubmit={create}>
        <header>
          <h2 id="new-site-title">New site</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <label className="field-stack">
          <span className="small muted">Name</span>
          <input className="input" aria-label="Site name" autoFocus placeholder="e.g. Calvexa US HCP" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="where-row" aria-label="Where it sits">
          <label className="field-stack">
            <span className="small muted">Therapy area</span>
            <input className="input" list="ns-areas" placeholder="e.g. Immunology" value={where.therapyArea} onChange={(e) => setWhere({ ...where, therapyArea: e.target.value })} />
            <datalist id="ns-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label className="field-stack">
            <span className="small muted">Market</span>
            <input className="input mono" placeholder="US" maxLength={6} value={where.market} onChange={(e) => setWhere({ ...where, market: e.target.value.toUpperCase() })} />
          </label>
          <label className="field-stack">
            <span className="small muted">Audience</span>
            <select className="select" value={where.audience} onChange={(e) => setWhere({ ...where, audience: e.target.value })}>
              <option value="">Not set</option>
              {AUDIENCES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset className="tpl-group" aria-label="Template">
          <legend className="small muted">Start from</legend>
          <div className="tpl-grid">{STARTERS.map((s) => option(s.id, s.name, s.about, starters[s.id]!))}</div>
          {saved.length > 0 && (
            <>
              <legend className="small muted" style={{ marginTop: 14 }}>
                Your templates
              </legend>
              <div className="tpl-grid">
                {saved.map((t) => option(`t:${t.id}`, t.name, t.description || `${t.pages ?? ""} pages`.trim(), savedDocs[t.id] ?? null, t.brandName ?? undefined))}
              </div>
            </>
          )}
        </fieldset>
        <footer>
          <span className="muted small">You can change all of this later in the site's Settings.</span>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create site"}
          </button>
        </footer>
      </form>
    </div>
  );
}

