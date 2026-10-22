import { useEffect, useState } from "react";
import { Sites, Tokens, type Me, type SiteSummary, type TokenInfo } from "../api";
import { ago } from "../format";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";

const EXPIRY = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
] as const;

const ROLE_HINT: Record<string, string> = {
  editor: "Signs in to the editor; edits, merges and publishes",
  agent: "For one person's Claude Code; works on branches only",
  admin: "Everything, including people and tokens",
};

function status(t: TokenInfo): { label: string; cls: string } {
  if (t.revokedAt) return { label: "Revoked", cls: "draft" };
  if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) return { label: "Expired", cls: "draft" };
  return { label: "Active", cls: "live" };
}

/** People, Claude Code tokens and the audit log, for admins. */
export function AccessPage({ me }: { me: Me }) {
  const toast = useToast();
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [draft, setDraft] = useState({ name: "", role: "editor", days: 90 as number | null, sites: [] as string[] });
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    Tokens.list()
      .then(setTokens)
      .catch((e) => toast({ text: e.message, tone: "error" }));
  useEffect(() => {
    void load();
    Sites.list().then(setSites).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me.role !== "admin") return <div className="empty">Only admins can manage access.</div>;
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "a deleted site";

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const t = await Tokens.create({ name: draft.name.trim(), role: draft.role, expiresInDays: draft.days, sites: draft.role === "admin" ? undefined : draft.sites });
      setMade({ name: t.name, token: t.token });
      setDraft({ name: "", role: draft.role, days: draft.days, sites: [] });
      void load();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    }
  };

  return (
    <main className="dash-main access">
      <div className="dash-head">
        <h1>Access</h1>
        <span className="muted">People and Claude Code sign in with tokens. Only a hash is stored.</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void Tokens.auditCsv().catch((e) => toast({ text: e.message, tone: "error" }))}>
          <Icon name="download" size={14} /> Download audit log
        </button>
      </div>

      {made && (
        <div className="callout token-made" role="status">
          <strong>Token for {made.name}</strong>
          <span>Copy it now and send it privately. It won't be shown again.</span>
          <code>{made.token}</code>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn sm primary"
              onClick={() =>
                void navigator.clipboard?.writeText(made.token).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Icon name="copy" size={13} /> {copied ? "Copied" : "Copy token"}
            </button>
            <button className="btn sm ghost" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <form className="create-panel token-form" onSubmit={create}>
        <input className="input" aria-label="Who it's for" placeholder="Who it's for, e.g. Priya Shah (Claude Code)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select className="select" aria-label="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} title={ROLE_HINT[draft.role]}>
          <option value="editor">Editor</option>
          <option value="agent">Claude Code (agent)</option>
          <option value="admin">Admin</option>
        </select>
        <select className="select" aria-label="Expires" value={String(draft.days)} onChange={(e) => setDraft({ ...draft, days: e.target.value === "null" ? null : Number(e.target.value) })}>
          {EXPIRY.map((x) => (
            <option key={x.label} value={String(x.days)}>
              {x.days ? `Expires in ${x.label}` : "Never expires"}
            </option>
          ))}
        </select>
        <button className="btn light" disabled={!draft.name.trim()}>
          Create token
        </button>
        {draft.role !== "admin" && sites.length > 0 && (
          <fieldset className="site-scope">
            <legend>Sites it can use</legend>
            <label className="check">
              <input type="checkbox" checked={draft.sites.length === 0} onChange={() => setDraft({ ...draft, sites: [] })} /> All sites
            </label>
            {sites.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={draft.sites.includes(s.id)}
                  onChange={(e) => setDraft({ ...draft, sites: e.target.checked ? [...draft.sites, s.id] : draft.sites.filter((x) => x !== s.id) })}
                />
                {s.name}
              </label>
            ))}
          </fieldset>
        )}
        <span className="muted small hint">{ROLE_HINT[draft.role]}</span>
      </form>

      <section>
        <h2>Tokens</h2>
        {tokens === null ? (
          <div className="empty">Loading…</div>
        ) : (
          <table className="table cms-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Sites</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const st = status(t);
                return (
                  <tr key={t.id} className={st.label !== "Active" ? "dim" : ""}>
                    <td>
                      <span className="t">{t.name}</span>
                      {t.createdBy && <span className="muted small"> · by {t.createdBy}</span>}
                    </td>
                    <td>{t.role === "agent" ? "Claude Code" : t.role[0]!.toUpperCase() + t.role.slice(1)}</td>
                    <td className="muted clip">{t.siteIds ? t.siteIds.map(siteName).join(", ") : "All"}</td>
                    <td className="muted">{t.lastUsedAt ? ago(t.lastUsedAt) : "Never"}</td>
                    <td className="muted">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "Never"}</td>
                    <td>
                      <span className={`status ${st.cls}`} style={{ marginLeft: 0 }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {!t.revokedAt &&
                        (confirm === t.id ? (
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            <button
                              className="btn sm danger"
                              onClick={async () => {
                                try {
                                  await Tokens.revoke(t.id);
                                  toast({ text: `Revoked ${t.name}. It stops working within seconds.` });
                                  setConfirm(null);
                                  void load();
                                } catch (err) {
                                  toast({ text: (err as Error).message, tone: "error" });
                                }
                              }}
                            >
                              Revoke
                            </button>
                            <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button className="btn sm" onClick={() => setConfirm(t.id)}>
                            Revoke…
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Tokens set in the server's environment (like the first admin token) come back when the server restarts; remove them from the environment to retire them. Give each person their own Claude Code token so history shows whose Claude made each change.
        </p>
      </section>
    </main>
  );
}
