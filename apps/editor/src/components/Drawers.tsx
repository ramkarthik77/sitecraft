import { useEffect, useState, type ReactNode } from "react";
import { ApiError, Brands, Sites, Templates, type Brand, type Deployment, type Diff, type SiteSummary, type Version } from "../api";
import { Icon } from "./Icon";

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="body">{children}</div>
      </aside>
    </div>
  );
}

export function Who({ name, role }: { name: string; role?: string }) {
  return (
    <span className={`who ${role === "agent" ? "agent" : ""}`}>
      <span className="dot" aria-hidden="true" />
      {name}
    </span>
  );
}

const when = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ReviewDrawer(props: { siteId: string; branch: string; onClose: () => void; onMerged: () => void; toast: (m: string, tone?: "error") => void }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    Sites.diff(props.siteId, props.branch).then(setDiff).catch((e) => props.toast(e.message, "error"));
    Sites.versions(props.siteId, props.branch).then(setVersions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.siteId, props.branch]);

  const merge = async (force: boolean) => {
    setBusy(true);
    try {
      await Sites.merge(props.siteId, props.branch, force);
      props.toast(`Merged ${props.branch} into main`);
      props.onMerged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else props.toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const agentWork = versions.filter((v) => v.actorRole === "agent");
  return (
    <Drawer title={`Review ${props.branch}`} onClose={props.onClose}>
      {agentWork.length > 0 && (
        <div className="callout">
          {agentWork[0]!.actor} made {agentWork.length} change{agentWork.length === 1 ? "" : "s"} on this branch. Check them on the canvas, then merge to put them on main.
        </div>
      )}
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Changes compared to main</h3>
        {!diff && <div className="muted">Loading changes…</div>}
        {diff && diff.summary.length === 0 && <div className="muted">This branch matches main.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {diff?.summary.map((line, i) => (
            <div key={i} className={`diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "chg"}`}>
              {line}
            </div>
          ))}
        </div>
      </section>
      {!!diff?.brandIssues?.length && (
        <section className="brand-check" aria-label="Brand check">
          <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>
            Off-brand <span className="badge">{diff.brandIssues.length}</span>
          </h3>
          <ul>
            {diff.brandIssues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <span className="muted small">Use the theme colors and fonts instead, or merge anyway if this is intentional.</span>
        </section>
      )}
      {conflict ? (
        <div className="callout human">
          Main changed after this branch was created. Merging anyway replaces main with this branch's version; earlier main versions stay in history.
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => merge(true)}>
              Merge anyway
            </button>
            <button className="btn" onClick={() => setConflict(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={busy || !diff || diff.summary.length === 0} onClick={() => merge(false)}>
            Merge into main
          </button>
        </div>
      )}
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Branch history</h3>
        <table className="table">
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{v.message}</td>
                <td>
                  <Who name={v.actor} role={v.actorRole} />
                </td>
                <td className="muted">{when(v.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Drawer>
  );
}

export function HistoryDrawer(props: { siteId: string; branch: string; onClose: () => void; onRestored: () => void; toast: (m: string, tone?: "error") => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const load = () => {
    Sites.versions(props.siteId, props.branch).then(setVersions).catch(() => {});
    Sites.deployments(props.siteId).then(setDeps).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [props.siteId, props.branch]);
  return (
    <Drawer title="History" onClose={props.onClose}>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Versions on {props.branch}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Change</th>
              <th>By</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={v.id}>
                <td>{v.message}</td>
                <td>
                  <Who name={v.actor} role={v.actorRole} />
                </td>
                <td className="muted">{when(v.createdAt)}</td>
                <td>
                  {i > 0 && (
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await Sites.restore(props.siteId, props.branch, v.id);
                        props.toast(`Restored version ${v.id}`);
                        props.onRestored();
                        load();
                      }}
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Published versions</h3>
        {deps.length === 0 && <div className="muted">Nothing published yet.</div>}
        <table className="table">
          <tbody>
            {deps.map((d) => (
              <tr key={d.id}>
                <td>Version {d.versionId}</td>
                <td>{d.actor}</td>
                <td className="muted">{when(d.createdAt)}</td>
                <td>
                  {d.current ? (
                    <span className="small" style={{ color: "var(--ok)" }}>
                      Live
                    </span>
                  ) : (
                    <button
                      className="btn sm"
                      onClick={async () => {
                        await Sites.rollback(props.siteId, d.id);
                        props.toast(`Version ${d.versionId} is live again`);
                        load();
                      }}
                    >
                      Make live
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Drawer>
  );
}

export function SettingsDrawer(props: {
  site: SiteSummary;
  onClose: () => void;
  onSaved: (s: SiteSummary) => void;
  toast: (m: string, tone?: "error") => void;
  isAdmin?: boolean;
  canEdit?: boolean;
  /** Called after the site's brand changed, so the editor reloads main. */
  onBrandChanged?: () => void;
}) {
  const [name, setName] = useState(props.site.name);
  const [domain, setDomain] = useState(props.site.domain ?? "");
  const [exportUrl, setExportUrl] = useState(props.site.domain ? `https://${props.site.domain}` : "");
  const [exporting, setExporting] = useState(false);
  const [subs, setSubs] = useState<{ id: number; form: string; data: Record<string, string>; created_at: string }[] | null>(null);
  useEffect(() => {
    Sites.forms(props.site.id).then(setSubs).catch(() => setSubs([]));
  }, [props.site.id]);
  const save = async () => {
    try {
      const s = await Sites.update(props.site.id, { name, domain: domain.trim() || null });
      props.onSaved(s);
      props.toast("Settings saved");
    } catch (e) {
      props.toast((e as Error).message, "error");
    }
  };
  const keys = [...new Set((subs ?? []).flatMap((s) => Object.keys(s.data)))].slice(0, 5);
  return (
    <Drawer title="Site settings" onClose={props.onClose}>
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="row">
          <label htmlFor="s-name">Name</label>
          <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row">
          <label htmlFor="s-domain">Domain</label>
          <input id="s-domain" className="input" value={domain} placeholder="www.example.com" onChange={(e) => setDomain(e.target.value)} />
        </div>
        <span className="muted small">
          Point a CNAME for your domain at your Sitecraft host, save, then publish again. Until then the site is at {props.site.publishUrl.replace(/^https?:\/\//, "")}.
        </span>
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={save}>
          Save settings
        </button>
      </section>
      <BrandSection site={props.site} isAdmin={!!props.isAdmin} toast={props.toast} onChanged={(brandId) => (props.onSaved({ ...props.site, brandId }), props.onBrandChanged?.())} />
      {props.canEdit && <SaveAsTemplate site={props.site} toast={props.toast} />}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>Export</h3>
        <span className="muted small">Download the site as plain HTML to host anywhere, such as Cloudflare Pages or Netlify. Exports the main version.</span>
        <div className="row">
          <label htmlFor="s-export-url">Will live at</label>
          <input id="s-export-url" className="input" value={exportUrl} placeholder="https://www.example.com (optional)" onChange={(e) => setExportUrl(e.target.value)} />
        </div>
        <span className="muted small">Add the address to include a sitemap and search-engine links.</span>
        <button
          className="btn"
          style={{ alignSelf: "flex-start" }}
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await Sites.exportZip(props.site.id, props.site.slug, exportUrl.trim() || undefined);
              props.toast("Downloaded the site");
            } catch (e) {
              props.toast((e as Error).message, "error");
            } finally {
              setExporting(false);
            }
          }}
        >
          <Icon name="download" size={14} />
          {exporting ? "Preparing…" : "Download .zip"}
        </button>
      </section>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Form submissions</h3>
        {subs && subs.length === 0 && <div className="muted">No submissions yet. Add a form section and publish to start collecting them.</div>}
        {subs && subs.length > 0 && <FormDataTools siteId={props.site.id} slug={props.site.slug} toast={props.toast} onChanged={() => void Sites.forms(props.site.id).then(setSubs)} />}
        {subs && subs.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Form</th>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>{s.form}</td>
                  {keys.map((k) => (
                    <td key={k}>{s.data[k]}</td>
                  ))}
                  <td className="muted">{when(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Drawer>
  );
}

/** Export and delete form data: for data requests ("delete everything from jane@…") and clean-ups. */
function FormDataTools(props: { siteId: string; slug: string; toast: (m: string, tone?: "error") => void; onChanged: () => void }) {
  const [containing, setContaining] = useState("");
  const [confirming, setConfirming] = useState<null | "all" | "match">(null);
  const del = async (q: { containing?: string }) => {
    try {
      const r = await Sites.deleteForms(props.siteId, q);
      props.toast(`Deleted ${r.deleted} ${r.deleted === 1 ? "submission" : "submissions"}.`);
      setConfirming(null);
      setContaining("");
      props.onChanged();
    } catch (e) {
      props.toast((e as Error).message, "error");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => void Sites.formsCsv(props.siteId, props.slug).catch((e) => props.toast((e as Error).message, "error"))}>
          <Icon name="download" size={13} /> Download CSV
        </button>
        {confirming === "all" ? (
          <>
            <button className="btn sm danger" onClick={() => void del({})}>
              Delete all submissions
            </button>
            <button className="btn sm ghost" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn sm ghost" onClick={() => setConfirming("all")}>
            Delete all…
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" aria-label="Delete submissions containing" placeholder="Delete submissions containing, e.g. an email" value={containing} onChange={(e) => (setContaining(e.target.value), setConfirming(null))} />
        {confirming === "match" ? (
          <button className="btn sm danger" onClick={() => void del({ containing: containing.trim() })}>
            Confirm
          </button>
        ) : (
          <button className="btn sm" disabled={containing.trim().length < 3} onClick={() => setConfirming("match")}>
            Delete
          </button>
        )}
      </div>
      <span className="muted small">Submissions are deleted automatically after the server's retention period (one year by default).</span>
    </div>
  );
}

function BrandSection(props: { site: SiteSummary; isAdmin: boolean; toast: (m: string, tone?: "error") => void; onChanged: (brandId: string | null) => void }) {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Brands.list().then(setBrands).catch(() => setBrands([]));
  }, []);
  const current = brands?.find((b) => b.id === props.site.brandId);
  if (!brands) return null;
  if (!props.isAdmin && !current) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Brand</h3>
      {props.isAdmin ? (
        <div className="row">
          <label htmlFor="s-brand">Follows</label>
          <select
            id="s-brand"
            className="select"
            disabled={busy}
            value={props.site.brandId ?? ""}
            onChange={async (e) => {
              setBusy(true);
              try {
                const r = await Sites.setBrand(props.site.id, e.target.value || null);
                const b = brands.find((x) => x.id === r.brandId);
                props.toast(b ? `This site now follows the ${b.name} brand` : "This site no longer follows a brand");
                props.onChanged(r.brandId);
              } catch (err) {
                props.toast((err as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.locked ? " (locked)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <span className="small">
          Follows the {current!.name} brand{current!.locked ? ", which is locked" : ""}. Admins change this.
        </span>
      )}
      <span className="muted small">The brand's colors, fonts and shared components are copied into main as a new version, and updates arrive the same way.</span>
    </section>
  );
}

function SaveAsTemplate(props: { site: SiteSummary; toast: (m: string, tone?: "error") => void }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState(false);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Save as template</h3>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" aria-label="Template name" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await Templates.create({ siteId: props.site.id, name: name.trim(), includeItems: items });
              props.toast(`Saved "${name.trim()}". Find it in Templates.`);
              setName("");
            } catch (e) {
              props.toast((e as Error).message, "error");
            }
          }}
        >
          Save
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={items} onChange={(e) => setItems(e.target.checked)} /> Include CMS items
      </label>
    </section>
  );
}
