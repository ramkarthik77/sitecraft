import { useCallback, useEffect, useState } from "react";
import { Audit, cap, Components, DISCIPLINES, Sites, Tokens, type AuditCheck, type AuditEntry, type Me, type SharedComponent, type SiteSummary, type TokenInfo } from "../api";
import { initials } from "../format";
import { refreshShared, useShared } from "../store";
import { useToast } from "../Toasts";
import { describe } from "./Activity";
import { Icon } from "./Icon";
import { go, PageHead, Pill, siteUrl } from "./Shell";

/** The organisation's audit log, shared components, and the rules every site follows. */

const ACTIONS = [
  ["", "All events"],
  ["version.", "Edits"],
  ["review.", "Review requests"],
  ["branch.approve", "Sign-offs"],
  ["branch.merge", "Merges"],
  ["site.publish", "Publishing"],
  ["schedule.", "Schedules"],
  ["token.", "Access"],
  ["asset.", "Assets"],
  ["site.", "Site settings"],
] as const;

export function IntegrityBanner({ check, onCheck }: { check: AuditCheck | null; onCheck: () => void }) {
  if (!check) return <div className="integrity checking">Checking the audit trail…</div>;
  return (
    <div className={`integrity ${check.ok ? "ok" : "bad"}`} role="status">
      <Icon name={check.ok ? "shield" : "alert"} size={16} />
      <span className="grow">
        <strong>{check.ok ? "Integrity verified" : "The audit trail doesn't match"}</strong>
        <span className="small">
          {check.ok
            ? `All ${check.entries.toLocaleString()} entries are linked and unchanged. Checked ${new Date(check.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
            : `Entry ${check.brokenAt} or one next to it was changed or removed outside Sitecraft. Entries before it are intact.`}
        </span>
        {check.head && (
          <span className="small mono" title="Record this somewhere else to prove later that no newest entries were removed">
            Latest entry {check.head.seq} · fingerprint {check.head.hash.slice(0, 16)}…
          </span>
        )}
      </span>
      <button className="btn sm ghost" onClick={onCheck}>
        Check again
      </button>
    </div>
  );
}

export function AuditLogPage({ me }: { me: Me }) {
  const { sites } = useShared();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [people, setPeople] = useState<{ name: string; count: number }[]>([]);
  const [check, setCheck] = useState<AuditCheck | null>(null);
  const [f, setF] = useState({ action: "", actor: "", siteId: "", q: "" });
  const [more, setMore] = useState(false);
  const toast = useToast();
  const verify = useCallback(() => {
    setCheck(null);
    Audit.verify().then(setCheck, (e) => toast({ text: e.message, tone: "error" }));
  }, [toast]);
  const load = useCallback(
    async (before?: number) => {
      const r = await Audit.list({ ...f, before, limit: 100 });
      setMore(r.items.length >= 100);
      setPeople(r.people);
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
    },
    [f],
  );
  useEffect(verify, [verify]);
  useEffect(() => {
    setItems(null);
    const t = setTimeout(() => void load().catch((e) => toast({ text: e.message, tone: "error" })), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, f.q, toast]);

  let lastDay = "";
  return (
    <main className="page">
      <PageHead
        eyebrow="Governance"
        title="Audit log"
        sub="Every action by people and Claude, in order, with who, when and what. Entries can't be edited or deleted, and each one is chained to the one before, so tampering shows."
        actions={
          me.role === "admin" && (
            <button className="btn" onClick={() => void Audit.csv().catch((e) => toast({ text: e.message, tone: "error" }))}>
              <Icon name="download" size={14} /> Export events
            </button>
          )
        }
      />
      <IntegrityBanner check={check} onCheck={verify} />
      <section className="card">
        <div className="dir-tools">
          <label className="search">
            <Icon name="search" size={13} />
            <span className="sr-only">Search the audit log</span>
            <input placeholder="Search details, e.g. a job code or branch" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </label>
          <select className="select" aria-label="Kind of event" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            {ACTIONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Person" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Site" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
            <option value="">All sites</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="card-body">
          {items === null && <div className="tm-loading small" />}
          {items?.length === 0 && <div className="empty">No events match.</div>}
          <ol className="audit-list">
            {items?.map((i) => {
              const day = new Date(i.at).toDateString();
              const showDay = day !== lastDay;
              lastDay = day;
              const agent = i.role === "agent";
              const d = describe({ id: i.id, at: i.at, actor: i.actor, role: i.role, action: i.action, detail: i.detail as never });
              const onBehalf = typeof i.detail.onBehalfOf === "string" ? i.detail.onBehalfOf : null;
              return (
                <li key={i.seq}>
                  {showDay && <div className="act-day">{new Date(i.at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</div>}
                  <div className={`audit-row t-${d.tone}`}>
                    <span className="audit-time mono">{new Date(i.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className={`tm-avatar ${agent ? "agent" : ""}`} aria-hidden="true">
                      {agent ? "C" : initials(i.actor)}
                    </span>
                    <span className="grow">
                      <span>
                        <strong>{agent ? "Claude" : i.actor}</strong> {d.text}
                      </span>
                      <span className="muted small">
                        {[i.siteName ?? (i.siteId ? "deleted site" : "Organization"), agent ? `${i.actor}${onBehalf ? `, working for ${onBehalf}` : ""}` : i.role, i.action].join(" · ")}
                      </span>
                    </span>
                    <span className="audit-ref mono" title={`Entry ${i.seq} · fingerprint ${i.hash}`}>
                      #{i.seq}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {more && (
            <button className="btn ghost sm" onClick={() => void load(items?.[items.length - 1]?.seq)}>
              Show older
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export function ComponentsPage({ me }: { me: Me }) {
  const [list, setList] = useState<SharedComponent[] | null>(null);
  useEffect(() => void Components.list().then(setList, () => setList([])), []);
  const byBrand = new Map<string, SharedComponent[]>();
  for (const c of list ?? []) byBrand.set(c.brandName, [...(byBrand.get(c.brandName) ?? []), c]);
  return (
    <main className="page">
      <PageHead
        eyebrow="Shared libraries"
        title="Components"
        sub="Reusable parts that come with a brand, like the safety information block or an evidence card. Sites following the brand get updates when the brand changes."
        actions={
          <a className="btn" href="/brands" onClick={go("/brands")}>
            <Icon name="spark" size={14} /> Manage in Brands
          </a>
        }
      />
      {list === null && <div className="tm-loading" />}
      {list?.length === 0 && (
        <div className="empty-state">
          <strong>No shared components yet</strong>
          <span>
            Make a component in a site (select a section, then Make component), then {me.role === "admin" ? "create or update a brand from that site" : "ask an admin to add it to a brand"}.
          </span>
        </div>
      )}
      {[...byBrand.entries()].map(([brand, cs]) => (
        <section key={brand} className="card">
          <div className="card-head">
            <div className="grow">
              <h2>{brand}</h2>
              <span className="muted small">
                v{cs[0]!.brandVersion} · {cs[0]!.sites} {cs[0]!.sites === 1 ? "site follows it" : "sites follow it"}
              </span>
            </div>
            {cs[0]!.locked && <Pill tone="human">Locked brand</Pill>}
          </div>
          <div className="card-body comp-grid">
            {cs.map((c) => (
              <div key={c.id} className="comp-card">
                <span className="comp-ic" aria-hidden="true">
                  <Icon name="components" size={16} />
                </span>
                <strong>{c.name}</strong>
                <span className="muted small">
                  {cap(c.type)} · {c.locked ? "Protected: sites can't change it" : "Shared"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

const RULES = [
  ["branch", "Main is protected", "Changes are made on branches and merged by a person, after the sign-off each site needs."],
  ["sparkle", "Claude drafts, people decide", "Claude edits only on branches, can ask for review, and can't approve, sign, merge or publish."],
  ["users", "No one approves their own work", "Not the people who changed a branch, and not the person Claude was working for."],
  ["pen", "Sign-off is an electronic signature", "With MLR on, reviewers type their name and sign in again; the signature is bound to that exact version."],
  ["audit", "The audit trail can't be changed", "Entries can't be edited or deleted, and each is chained to the last so tampering shows."],
  ["image", "Asset rights are enforced", "Publishing stops when a page uses a library image that's expired, unapproved or not cleared for the site's market."],
] as const;

export function SettingsPage({ me }: { me: Me }) {
  const { sites } = useShared();
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const toast = useToast();
  const admin = me.role === "admin";
  const loadTokens = useCallback(() => void (admin ? Tokens.list().then(setTokens, () => setTokens([])) : setTokens([])), [admin]);
  useEffect(loadTokens, [loadTokens]);

  const setPolicy = async (s: SiteSummary, p: { reviewDisciplines?: string[]; requireJobCodes?: boolean }) => {
    try {
      await Sites.policy(s.id, p);
      toast({ text: `Updated review rules for ${s.name}` });
      void refreshShared();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };
  const people = (tokens ?? []).filter((t) => !t.revokedAt && t.role !== "agent");

  return (
    <main className="page">
      <PageHead eyebrow="Administration" title="Settings" sub="The rules every site follows, each site's review rules, and who reviews for which discipline." />

      <section className="card">
        <div className="card-head">
          <div className="grow">
            <h2>Built-in rules</h2>
            <span className="muted small">Always on. They're part of how Sitecraft works, so they can't be switched off here.</span>
          </div>
          <Pill tone="ok">Enforced</Pill>
        </div>
        <div className="card-body rules-grid">
          {RULES.map(([icon, title, body]) => (
            <div key={title} className="rule">
              <span className="rule-ic" aria-hidden="true">
                <Icon name={icon} size={15} />
              </span>
              <span className="grow">
                <strong>{title}</strong>
                <span className="muted small">{body}</span>
              </span>
              <Icon name="lock" size={13} label="Locked" style={{ color: "var(--ink-3)" }} />
            </div>
          ))}
          {me.agentCanPublish && (
            <div className="rule warn">
              <span className="rule-ic" aria-hidden="true">
                <Icon name="alert" size={15} />
              </span>
              <span className="grow">
                <strong>Claude may publish here</strong>
                <span className="muted small">AGENT_CAN_PUBLISH is on for this server. Turn it off for regulated sites.</span>
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="grow">
            <h2>Review rules by site</h2>
            <span className="muted small">{admin ? "Choose which disciplines must sign off, and whether every page needs a job code." : "Only admins change these."}</span>
          </div>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th scope="col">Site</th>
              {DISCIPLINES.map((d) => (
                <th key={d} scope="col">
                  {cap(d)}
                </th>
              ))}
              <th scope="col">Job codes required</th>
            </tr>
          </thead>
          <tbody>
            {(sites ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={siteUrl(s.id, "settings")} onClick={go(siteUrl(s.id, "settings"))}>
                    <strong>{s.name}</strong>
                  </a>
                </td>
                {DISCIPLINES.map((d) => {
                  const on = (s.reviewDisciplines ?? []).includes(d);
                  return (
                    <td key={d}>
                      <input
                        type="checkbox"
                        aria-label={`${cap(d)} sign-off for ${s.name}`}
                        checked={on}
                        disabled={!admin}
                        onChange={() => void setPolicy(s, { reviewDisciplines: on ? (s.reviewDisciplines ?? []).filter((x) => x !== d) : [...(s.reviewDisciplines ?? []), d] })}
                      />
                    </td>
                  );
                })}
                <td>
                  <input type="checkbox" aria-label={`Job codes required for ${s.name}`} checked={!!s.requireJobCodes} disabled={!admin} onChange={() => void setPolicy(s, { requireJobCodes: !s.requireJobCodes })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {admin && (
        <section className="card">
          <div className="card-head">
            <div className="grow">
              <h2>Reviewers</h2>
              <span className="muted small">Who signs off for each discipline. People can hold more than one.</span>
            </div>
            <a className="small" href="/access" onClick={go("/access")}>
              Add people in Access <Icon name="arrow" size={12} />
            </a>
          </div>
          <table className="dtable">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                {DISCIPLINES.map((d) => (
                  <th key={d} scope="col">
                    {cap(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens === null && (
                <tr>
                  <td colSpan={5}>Loading…</td>
                </tr>
              )}
              {people.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                  </td>
                  <td className="muted">{t.role}</td>
                  {DISCIPLINES.map((d) => {
                    const on = (t.disciplines ?? []).includes(d);
                    return (
                      <td key={d}>
                        <input
                          type="checkbox"
                          aria-label={`${t.name} reviews for ${d}`}
                          checked={on}
                          onChange={() => {
                            const next = on ? (t.disciplines ?? []).filter((x) => x !== d) : [...(t.disciplines ?? []), d];
                            setTokens((list) => list?.map((x) => (x.id === t.id ? { ...x, disciplines: next } : x)) ?? list);
                            void Tokens.update(t.id, { disciplines: next }).then(
                              () => toast({ text: `${t.name} ${on ? "no longer reviews" : "now reviews"} for ${d}` }),
                              (e) => (toast({ text: e.message, tone: "error" }), loadTokens()),
                            );
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {me.local && <p className="muted small" style={{ padding: "0 18px 16px" }}>On this computer you're the only person, so you can sign for any discipline, but not for work you or Claude changed. In the cloud, add reviewers in Access.</p>}
        </section>
      )}
    </main>
  );
}
