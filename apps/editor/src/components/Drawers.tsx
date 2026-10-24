import { useEffect, useState, type ReactNode } from "react";
import { BranchSignOff } from "./Reviews";
import { ApiError, Approvals, Brands, Schedules, Sites, Templates, type ApprovalInfo, type Brand, type Deployment, type Diff, type Me, type Schedule, type SiteSummary, type Version } from "../api";
import { LANGUAGES, languageName, translationStatus, type Operation, type SiteDocument } from "@sitecraft/schema";
import { Icon } from "./Icon";
import { ScheduleForm, ScheduleList } from "./Schedule";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

export function ReviewDrawer(props: { siteId: string; branch: string; me?: Me; onClose: () => void; onMerged: () => void; toast: (m: string, tone?: "error") => void; canShip?: boolean; isAdmin?: boolean; refreshKey?: number }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [appr, setAppr] = useState<ApprovalInfo | null>(null);
  const loadApprovals = () => Approvals.get(props.siteId, props.branch).then(setAppr).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void loadApprovals(), [props.siteId, props.branch, props.refreshKey]);
  const [scheduling, setScheduling] = useState(false);
  const [pending, setPending] = useState<Schedule | null>(null);
  const loadSchedule = () =>
    Schedules.list(props.siteId)
      .then((l) => setPending(l.find((x) => x.branch === props.branch && x.status === "pending") ?? null))
      .catch(() => {});
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    Sites.diff(props.siteId, props.branch).then(setDiff).catch((e) => props.toast(e.message, "error"));
    Sites.versions(props.siteId, props.branch).then(setVersions).catch(() => {});
    void loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.siteId, props.branch]);

  const merge = async (force: boolean, override = false) => {
    setBusy(true);
    try {
      await Sites.merge(props.siteId, props.branch, force, override);
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
      {props.me && props.branch !== "main" && <BranchSignOff siteId={props.siteId} branch={props.branch} me={props.me} refreshKey={props.refreshKey} onChanged={() => void loadApprovals()} />}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={busy || !diff || diff.summary.length === 0 || (!!appr && !appr.met)} onClick={() => merge(false)}>
            Merge into main
          </button>
          {appr && !appr.met && props.isAdmin && (
            <button className="btn ghost" disabled={busy || !diff || diff.summary.length === 0} onClick={() => merge(false, true)} title="Recorded in the audit log">
              Merge without approval
            </button>
          )}
          {props.canShip && !pending && (
            <button className="btn" disabled={!diff || diff.summary.length === 0} onClick={() => setScheduling((x) => !x)} aria-expanded={scheduling}>
              <Icon name="clock" size={14} /> Schedule release…
            </button>
          )}
        </div>
      )}
      {scheduling && (
        <ScheduleForm
          siteId={props.siteId}
          branch={props.branch}
          toast={props.toast}
          onCancel={() => setScheduling(false)}
          onDone={(s) => (setPending(s), setScheduling(false))}
        />
      )}
      {pending && <ScheduleList siteId={props.siteId} items={[pending]} canChange={!!props.canShip} toast={props.toast} onChanged={() => void loadSchedule()} />}
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

export function HistoryDrawer(props: { siteId: string; branch: string; onClose: () => void; onRestored: () => void; toast: (m: string, tone?: "error") => void; canShip?: boolean }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const load = () => {
    Sites.versions(props.siteId, props.branch).then(setVersions).catch(() => {});
    Sites.deployments(props.siteId).then(setDeps).catch(() => {});
    Schedules.list(props.siteId).then(setSchedules).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [props.siteId, props.branch]);
  return (
    <Drawer title="History" onClose={props.onClose}>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Scheduled publishing</h3>
        <ScheduleList siteId={props.siteId} items={schedules} canChange={!!props.canShip} toast={props.toast} onChanged={load} />
      </section>
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
  doc?: SiteDocument;
  apply?: (ops: Operation[]) => unknown;
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
      {props.doc && props.apply && props.canEdit && <LanguagesSetting doc={props.doc} apply={props.apply} />}
      {props.doc && props.apply && props.canEdit && <RedirectsSetting doc={props.doc} apply={props.apply} />}
      {props.isAdmin && <ApprovalsSetting site={props.site} toast={props.toast} onSaved={(n) => props.onSaved({ ...props.site, requiredApprovals: n })} />}
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

function ApprovalsSetting(props: { site: SiteSummary; toast: (m: string, tone?: "error") => void; onSaved: (n: number) => void }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Reviews</h3>
      <div className="row">
        <label htmlFor="s-approvals">Approvals</label>
        <select
          id="s-approvals"
          className="select"
          value={String(props.site.requiredApprovals ?? 0)}
          onChange={async (e) => {
            try {
              const r = await Sites.setRequiredApprovals(props.site.id, Number(e.target.value));
              props.onSaved(r.required);
              props.toast(r.required ? `Branches now need ${r.required} ${r.required === 1 ? "approval" : "approvals"} before merging` : "Branches can be merged without approval");
            } catch (err) {
              props.toast((err as Error).message, "error");
            }
          }}
        >
          <option value="0">Not needed to merge</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "person approves" : "people approve"} before merging
            </option>
          ))}
        </select>
      </div>
      <span className="muted small">People who changed a branch can't approve it, and neither can Claude. Admins can merge without approval; it's recorded in the audit log.</span>
    </section>
  );
}

function LanguagesSetting({ doc, apply }: { doc: SiteDocument; apply: (ops: Operation[]) => unknown }) {
  const locales = doc.settings.locales ?? [];
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const choices = Object.entries(LANGUAGES).filter(([code]) => code !== doc.settings.lang && !locales.includes(code));
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Languages</h3>
      <div className="row">
        <label htmlFor="s-lang">Main</label>
        <select id="s-lang" className="select" value={doc.settings.lang} onChange={(e) => apply([{ op: "set_locales", locales, main: e.target.value }])}>
          {!LANGUAGES[doc.settings.lang] && <option value={doc.settings.lang}>{doc.settings.lang}</option>}
          {Object.entries(LANGUAGES)
            .filter(([code]) => !locales.includes(code))
            .map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
        </select>
      </div>
      {locales.map((l) => {
        const st = translationStatus(doc, l);
        const done = st.filter((x) => x.state === "done").length;
        return (
          <div key={l} className="lang-row">
            <span className="grow">
              {languageName(l)} <span className="mono muted">/{l}/</span>
            </span>
            <span className="muted small">
              {done} of {st.length} translated
            </span>
            {confirm === l ? (
              <>
                <button className="btn sm danger" onClick={() => (apply([{ op: "set_locales", locales: locales.filter((x) => x !== l) }]), setConfirm(null))}>
                  Remove and delete its translations
                </button>
                <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="btn ghost icon sm" aria-label={`Remove ${languageName(l)}`} onClick={() => setConfirm(l)}>
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 6 }}>
        <select className="select" aria-label="Add a language" value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a language…</option>
          {choices.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <button className="btn sm" disabled={!adding} onClick={() => (apply([{ op: "set_locales", locales: [...locales, adding] }]), setAdding(""))}>
          Add
        </button>
      </div>
      <span className="muted small">
        Each language is published at /code/… with links between the versions for search engines. Switch language in the top bar to translate, add a Languages element for a switcher, or ask Claude to translate the site.
      </span>
    </section>
  );
}

/** Old addresses that send visitors on. Moving a page adds one; add your own for links printed elsewhere. */
function RedirectsSetting({ doc, apply }: { doc: SiteDocument; apply: (ops: Operation[]) => unknown }) {
  const list = doc.settings.redirects ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const save = (next: { from: string; to: string }[]) => apply([{ op: "set_redirects", redirects: next }]);
  const pages = new Set(doc.pages.map((p) => p.path));
  const clean = (v: string) => "/" + v.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const fromPath = from.trim() ? clean(from) : "";
  const problem = !fromPath ? "" : pages.has(fromPath) ? "A page already lives at that address." : list.some((r) => r.from === fromPath) ? "That address already redirects." : "";
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Redirects</h3>
      <span className="muted small">Old addresses that send visitors (and search engines) on to new ones. Moving a page adds one automatically.</span>
      {list.length === 0 && <span className="muted small">None yet.</span>}
      {list.map((r) => (
        <div key={r.from} className="redirect-row">
          <span className="mono small">{r.from}</span>
          <Icon name="back" size={12} style={{ transform: "rotate(180deg)", color: "var(--ink-3)" }} />
          <span className="mono small grow">{r.to}</span>
          <button className="btn ghost icon sm" aria-label={`Remove the redirect from ${r.from}`} onClick={() => save(list.filter((x) => x.from !== r.from))}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <form
        className="redirect-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!fromPath || !to.trim() || problem) return;
          save([...list, { from: fromPath, to: to.trim() }]);
          setFrom("");
          setTo("");
        }}
      >
        <input className="input mono" aria-label="Redirect from" placeholder="/old-address" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input mono" aria-label="Redirect to" placeholder="/new-address or https://…" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn sm" disabled={!fromPath || !to.trim() || !!problem}>
          Add
        </button>
      </form>
      {problem && <span className="small" style={{ color: "var(--danger)" }}>{problem}</span>}
    </section>
  );
}
