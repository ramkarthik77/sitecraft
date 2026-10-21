import { useEffect, useState, type ReactNode } from "react";
import { ApiError, Sites, type Deployment, type Diff, type SiteSummary, type Version } from "../api";

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
            ✕
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

export function SettingsDrawer(props: { site: SiteSummary; onClose: () => void; onSaved: (s: SiteSummary) => void; toast: (m: string, tone?: "error") => void }) {
  const [name, setName] = useState(props.site.name);
  const [domain, setDomain] = useState(props.site.domain ?? "");
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
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Form submissions</h3>
        {subs && subs.length === 0 && <div className="muted">No submissions yet. Add a form section and publish to start collecting them.</div>}
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
