import { useEffect, useState } from "react";
import type { SiteDocument } from "@sitecraft/schema";
import { Brands, Folders, Sites, Templates, type Brand, type Me, type SavedTemplate, type SiteSummary } from "../api";
import { refreshShared, useShared } from "../store";
import { PageHead } from "./Shell";
import { DocThumb } from "../App";
import { ago } from "../format";
import { navigate } from "../router";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Templates

function TemplateThumb({ id }: { id: string }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  useEffect(() => {
    Templates.get(id)
      .then((t) => setDoc(t.document))
      .catch(() => {});
  }, [id]);
  return <DocThumb doc={doc} />;
}

/** Save a site's main version as a template (or update a template from it). */
export function SaveTemplateDialog({ siteId, siteName, onClose, onDone }: { siteId?: string; siteName?: string; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const { sites } = useShared();
  const [list, setList] = useState<SavedTemplate[]>([]);
  const [form, setForm] = useState({ siteId: siteId ?? "", name: siteName ? `${siteName} template` : "", description: "", includeItems: false, replace: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => void Templates.list().then(setList, () => {}), []);
  useEffect(() => {
    if (!form.siteId && sites?.[0]) setForm((f) => ({ ...f, siteId: sites[0]!.id }));
  }, [sites, form.siteId]);
  const fromThis = list.filter((t) => t.sourceSiteId === form.siteId);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.replace) {
        await Templates.update(form.replace, { siteId: form.siteId, includeItems: form.includeItems });
        toast({ text: "Template updated from the site" });
      } else {
        await Templates.create({ siteId: form.siteId, name: form.name.trim(), description: form.description.trim() || undefined, includeItems: form.includeItems });
        toast({ text: `Saved "${form.name.trim()}" as a template. It's in Create site → Your templates.` });
      }
      onDone?.();
      onClose();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby="st-title" onSubmit={submit}>
        <header>
          <h2 id="st-title">Save as template</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className="muted small" style={{ margin: 0 }}>
          Saves the site's main version: pages, design, components and CMS fields. New sites made from it take their own name and follow the same brand.
        </p>
        {!siteId && (
          <label className="field-stack">
            <span className="small muted">From site</span>
            <select className="select" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value, replace: "" })}>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fromThis.length > 0 && (
          <div className="seg" role="group" aria-label="New or update">
            <button type="button" aria-pressed={!form.replace} onClick={() => setForm({ ...form, replace: "" })}>
              New template
            </button>
            {fromThis.map((t) => (
              <button type="button" key={t.id} aria-pressed={form.replace === t.id} onClick={() => setForm({ ...form, replace: t.id })}>
                Update “{t.name}”
              </button>
            ))}
          </div>
        )}
        {!form.replace && (
          <>
            <label className="field-stack">
              <span className="small muted">Template name</span>
              <input className="input" autoFocus required placeholder="e.g. HCP product site" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field-stack">
              <span className="small muted">What it's for (optional)</span>
              <input className="input" placeholder="e.g. Every new market's HCP site starts here" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={form.includeItems} onChange={(e) => setForm({ ...form, includeItems: e.target.checked })} />
          <span>Include CMS items (otherwise only the collections and their fields)</span>
        </label>
        <footer>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !form.siteId || (!form.replace && !form.name.trim())}>
            {form.replace ? "Update template" : "Save template"}
          </button>
        </footer>
      </form>
    </div>
  );
}

const STARTERS = [
  ["landing", "Landing page"],
  ["saas", "Product site"],
  ["blog", "Blog"],
  ["blank", "Blank"],
] as const;

/** Start a new template from scratch: a working site to design it in, saved as a template straight away. */
function NewTemplateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [starter, setStarter] = useState("saas");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Template sources live in a Templates folder in the site tree.
      const folders = await Folders.list("site");
      const home = folders.find((f) => !f.parentId && f.name.toLowerCase() === "templates") ?? (await Folders.create("site", "Templates"));
      const s = await Sites.create(`${name.trim()} (template)`, starter, undefined, home.id);
      await Templates.create({ siteId: s.id, name: name.trim() });
      void refreshShared();
      onDone();
      toast({ text: `Created the template. Design it here, then Save as template again to update it.` });
      navigate(`/sites/${s.id}`);
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby="nt-title" onSubmit={submit}>
        <header>
          <h2 id="nt-title">New template</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className="muted small" style={{ margin: 0 }}>
          Sitecraft makes a working copy in the Templates folder for you to design. Whenever it's how every new site should start, use <b>Save as template</b> on it to update the template.
        </p>
        <label className="field-stack">
          <span className="small muted">Template name</span>
          <input className="input" autoFocus required placeholder="e.g. HCP product site" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="seg" role="radiogroup" aria-label="Start from">
          {STARTERS.map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={starter === k} aria-pressed={starter === k} onClick={() => setStarter(k)}>
              {l}
            </button>
          ))}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Create and design it
          </button>
        </footer>
      </form>
    </div>
  );
}

export function TemplatesPage({ me }: { me: Me }) {
  const toast = useToast();
  const [list, setList] = useState<SavedTemplate[] | null>(null);
  const [dialog, setDialog] = useState<"save" | "new" | null>(null);
  const [using, setUsing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const canEdit = me.role !== "agent";

  const load = () =>
    Templates.list()
      .then(setList)
      .catch((e) => toast({ text: e.message, tone: "error" }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), []);

  const use = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!using) return;
    try {
      const s = await Sites.create(using.name.trim(), "", using.id);
      void refreshShared();
      navigate(`/sites/${s.id}`);
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    }
  };

  return (
    <main className="page">
      <PageHead
        eyebrow="Shared libraries"
        title="Templates"
        sub="Approved starting points for new sites, such as an HCP product site or a patient support site. New sites copy the template's pages, design and brand. Claude can start from them too."
        actions={
          canEdit && (
            <>
              <button className="btn" onClick={() => setDialog("save")}>
                <Icon name="copy" size={14} /> Save a site as a template
              </button>
              <button className="btn primary" onClick={() => setDialog("new")}>
                <Icon name="plus" size={14} /> New template
              </button>
            </>
          )
        }
      />

      <ol className="how-steps" aria-label="How templates work">
        <li>
          <strong>Design it</strong>
          <span className="muted small">Build a site the way every new one should start, or choose New template.</span>
        </li>
        <li>
          <strong>Save as template</strong>
          <span className="muted small">From the site's overview, or here. Save again later to update it.</span>
        </li>
        <li>
          <strong>Start sites from it</strong>
          <span className="muted small">Create site → Your templates, or Use template below.</span>
        </li>
      </ol>

      {using && (
        <form className="card inline-form tpl-use" onSubmit={use}>
          <input className="input" aria-label="New site name" placeholder="Name the new site" value={using.name} onChange={(e) => setUsing({ ...using, name: e.target.value })} autoFocus />
          <button className="btn primary" disabled={!using.name.trim()}>
            Create site
          </button>
          <button type="button" className="btn ghost" onClick={() => setUsing(null)}>
            Cancel
          </button>
        </form>
      )}

      {list && list.length === 0 && (
        <div className="empty-state">
          <strong>No templates yet</strong>
          <span>Make one from scratch with New template, or save a site you've already built.</span>
        </div>
      )}
      <div className="tiles">
        {(list ?? []).map((t) => (
          <article key={t.id} className="tile tpl-tile">
            <TemplateThumb id={t.id} />
            <span className="tile-meta">
              <span className="tile-name">
                <strong>{t.name}</strong>
                {t.brandName && <span className="pill p-cms">{t.brandName}</span>}
              </span>
              <span className="muted small">{t.description || `${t.pages ?? 0} pages`}</span>
              <span className="muted small">
                by {t.createdBy} · updated {ago(t.updatedAt)}
              </span>
              {canEdit && (
                <span className="card-actions">
                  <button className="btn sm primary" onClick={() => setUsing({ id: t.id, name: "" })}>
                    Use template
                  </button>
                  {t.sourceSiteId && (
                    <a className="btn sm" href={`/sites/${t.sourceSiteId}`} onClick={(e) => (e.preventDefault(), navigate(`/sites/${t.sourceSiteId}`))}>
                      Edit its site
                    </a>
                  )}
                  {confirm === t.id ? (
                    <>
                      <button
                        className="btn sm danger"
                        onClick={async () => {
                          await Templates.remove(t.id).catch((e) => toast({ text: e.message, tone: "error" }));
                          setConfirm(null);
                          void load();
                        }}
                      >
                        Delete template
                      </button>
                      <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button className="btn sm ghost" onClick={() => setConfirm(t.id)}>
                      Delete…
                    </button>
                  )}
                </span>
              )}
            </span>
          </article>
        ))}
      </div>
      {dialog === "save" && <SaveTemplateDialog onClose={() => setDialog(null)} onDone={() => void load()} />}
      {dialog === "new" && <NewTemplateDialog onClose={() => setDialog(null)} onDone={() => void load()} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Brands

function Swatches({ theme }: { theme: Brand["theme"] }) {
  return (
    <span className="swatches">
      {Object.entries(theme.colors)
        .slice(0, 7)
        .map(([n, v]) => (
          <span key={n} className="swatch" style={{ background: String(v) }} title={`${n} ${v}`} />
        ))}
    </span>
  );
}

const fontName = (stack: string) => (/'([^']+)'|"([^"]+)"/.exec(stack)?.slice(1).find(Boolean) ?? stack.split(",")[0] ?? "").trim();

export function BrandsPage({ me }: { me: Me }) {
  const toast = useToast();
  const [list, setList] = useState<Brand[] | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [creating, setCreating] = useState<{ name: string; fromSite: string; guidelines: string; locked: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const admin = me.role === "admin";

  const load = () =>
    Brands.list()
      .then(setList)
      .catch((e) => toast({ text: e.message, tone: "error" }));
  useEffect(() => {
    void load();
    Sites.list().then(setSites).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creating) return;
    try {
      const b = await Brands.create(creating);
      toast({ text: `Created the ${b.name} brand` });
      setCreating(null);
      setOpen(b.id);
      void load();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    }
  };

  return (
    <main className="dash-main">
      <div className="dash-head">
        <h1>Brands</h1>
        <span className="muted">Colors, fonts, shared header and footer, and written guidelines, kept once and used by many sites.</span>
        <div className="spacer" />
        {admin && (
          <button className="btn primary" style={{ height: 36 }} onClick={() => setCreating(creating ? null : { name: "", fromSite: sites[0]?.id ?? "", guidelines: "", locked: true })} aria-expanded={!!creating}>
            <Icon name="plus" size={14} /> New brand
          </button>
        )}
      </div>

      {creating && (
        <form className="create-panel wrap" onSubmit={create}>
          <input className="input" aria-label="Brand name" placeholder="Brand name, e.g. Northwind" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus />
          <select className="select" aria-label="Take the look from" value={creating.fromSite} onChange={(e) => setCreating({ ...creating, fromSite: e.target.value })}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                Look from {s.name}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={creating.locked} onChange={(e) => setCreating({ ...creating, locked: e.target.checked })} /> Lock it
          </label>
          <button className="btn light" disabled={!creating.name.trim() || !creating.fromSite}>
            Create brand
          </button>
          <textarea
            className="textarea"
            aria-label="Guidelines"
            placeholder="Guidelines for people and Claude: voice and tone, words to use and avoid, how to use the logo, image style…"
            value={creating.guidelines}
            onChange={(e) => setCreating({ ...creating, guidelines: e.target.value })}
          />
          <span className="muted small hint">
            Takes the site's theme and its reusable components (make the header and footer reusable first). Locked brands keep sites to brand colors and fonts, and their components can only be changed here.
          </span>
        </form>
      )}

      {list && list.length === 0 && <div className="empty">No brands yet. Style one site the way the brand should look, then create a brand from it.</div>}
      <div className="brand-list">
        {(list ?? []).map((b) =>
          open === b.id ? (
            <BrandEditor key={b.id} id={b.id} sites={sites} admin={admin} onClose={() => (setOpen(null), void load())} />
          ) : (
            <button key={b.id} className="brand-row" onClick={() => setOpen(b.id)}>
              <span className="brand-mark" style={{ background: String(b.theme.colors.primary ?? "#888"), color: String(b.theme.colors["on-primary"] ?? "#fff") }}>
                {b.logo ? <img src={b.logo} alt="" /> : b.name[0]}
              </span>
              <span className="grow">
                <strong>{b.name}</strong>
                <span className="muted small">
                  {fontName(b.theme.fonts.heading)} · {b.components.length} shared {b.components.length === 1 ? "component" : "components"} · v{b.version} · {b.sites ?? 0} {b.sites === 1 ? "site" : "sites"}
                </span>
              </span>
              <Swatches theme={b.theme} />
              {b.locked && (
                <span className="status brand">
                  <Icon name="lock" size={11} /> Locked
                </span>
              )}
              <Icon name="chevron" size={14} />
            </button>
          ),
        )}
      </div>
    </main>
  );
}

function BrandEditor({ id, sites, admin, onClose }: { id: string; sites: SiteSummary[]; admin: boolean; onClose: () => void }) {
  const toast = useToast();
  const [b, setB] = useState<(Brand & { siteList: { id: string; name: string; slug: string }[] }) | null>(null);
  const [draft, setDraft] = useState<{ name: string; guidelines: string; logo: string; locked: boolean; colors: Record<string, string> } | null>(null);
  const [fromSite, setFromSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () =>
    Brands.get(id)
      .then((x) => {
        setB(x);
        setDraft({ name: x.name, guidelines: x.guidelines, logo: x.logo ?? "", locked: x.locked, colors: Object.fromEntries(Object.entries(x.theme.colors).map(([k, v]) => [k, String(v)])) });
      })
      .catch((e) => toast({ text: e.message, tone: "error" }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!b || !draft) return <div className="brand-editor empty">Loading…</div>;

  const save = async (extra: { fromSite?: string } = {}) => {
    setBusy(true);
    try {
      const r = await Brands.update(b.id, {
        name: draft.name,
        guidelines: draft.guidelines,
        logo: draft.logo.trim() || null,
        locked: draft.locked,
        ...(extra.fromSite ? { fromSite: extra.fromSite } : { theme: { ...b.theme, colors: draft.colors } }),
      });
      toast({ text: `Saved ${r.name} v${r.version}${r.updatedSites ? `, updated ${r.updatedSites} ${r.updatedSites === 1 ? "site" : "sites"}` : ""}` });
      void load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="brand-editor" aria-label={`${b.name} brand`}>
      <div className="brand-editor-head">
        <h2>{b.name}</h2>
        <span className="muted small">
          v{b.version} · updated {ago(b.updatedAt)}
        </span>
        <div className="spacer" />
        <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="brand-editor-body">
        <div className="col">
          <div className="row">
            <label htmlFor="b-name">Name</label>
            <input id="b-name" className="input" disabled={!admin} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="row">
            <label htmlFor="b-logo">Logo</label>
            <input id="b-logo" className="input" disabled={!admin} placeholder="https://… image address" value={draft.logo} onChange={(e) => setDraft({ ...draft, logo: e.target.value })} />
          </div>
          <label className="check">
            <input type="checkbox" disabled={!admin} checked={draft.locked} onChange={(e) => setDraft({ ...draft, locked: e.target.checked })} />
            Locked: sites keep to brand colors and fonts, and shared components change only here
          </label>
          <label className="small muted" htmlFor="b-guidelines">
            Guidelines (people and Claude read these before editing)
          </label>
          <textarea id="b-guidelines" className="textarea tall" disabled={!admin} value={draft.guidelines} onChange={(e) => setDraft({ ...draft, guidelines: e.target.value })} placeholder="Voice and tone, words to use and avoid, logo rules, image style…" />
        </div>
        <div className="col">
          <h3>Colors</h3>
          <div className="brand-colors">
            {Object.entries(draft.colors).map(([name, v]) => (
              <label key={name} className="brand-color">
                <input type="color" disabled={!admin} value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"} onChange={(e) => setDraft({ ...draft, colors: { ...draft.colors, [name]: e.target.value } })} aria-label={`${name} color`} />
                <span>{name.replace(/-/g, " ")}</span>
                <span className="mono muted">{v}</span>
              </label>
            ))}
          </div>
          <h3>Type and shape</h3>
          <span className="small">
            Headings {fontName(b.theme.fonts.heading)} · Body {fontName(b.theme.fonts.body)} · Radius {b.theme.radius}
          </span>
          <h3>Shared components</h3>
          <span className="small">{b.components.length ? b.components.map((c) => c.name).join(", ") : "None yet"}</span>
          {admin && (
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <select className="select" aria-label="Update from site" value={fromSite} onChange={(e) => setFromSite(e.target.value)}>
                <option value="">Update theme and components from a site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn sm" disabled={!fromSite || busy} onClick={() => void save({ fromSite })}>
                Update
              </button>
            </div>
          )}
          <h3>Sites using it</h3>
          <span className="small">{b.siteList.length ? b.siteList.map((s) => s.name).join(", ") : "None. Pick this brand in a site's settings."}</span>
        </div>
      </div>
      {admin && (
        <div className="brand-editor-foot">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : b.siteList.length ? `Save and update ${b.siteList.length} ${b.siteList.length === 1 ? "site" : "sites"}` : "Save brand"}
          </button>
          <span className="muted small">Each site gets a new version on main, so you can see it in History and undo it there.</span>
          <div className="spacer" />
          {confirmDelete ? (
            <>
              <button
                className="btn sm danger"
                onClick={async () => {
                  await Brands.remove(b.id).catch((e) => toast({ text: e.message, tone: "error" }));
                  onClose();
                }}
              >
                Delete brand
              </button>
              <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn sm ghost" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
