import { useCallback, useEffect, useState } from "react";
import { History, Tokens, type ActivityItem, type Me, type SiteAccess } from "../api";
import { ago, initials } from "../format";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";

/** A site's audit trail as sentences people can read, and who can open the site. */

const isAgent = (actor: string, role: string) => role === "agent" || /claude|agent/i.test(actor);
const pagesText = (pages?: { path: string; title: string }[]) => {
  if (!pages?.length) return "";
  const names = pages.map((p) => (p.path === "/" ? "Home" : p.title || p.path));
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
};

/** What an entry means, in a sentence. */
export function describe(i: ActivityItem): { text: string; tone: "edit" | "live" | "review" | "settings" | "danger" } {
  const d = i.detail as Record<string, unknown> & { pages?: { path: string; title: string }[] };
  const branch = typeof d.branch === "string" && d.branch !== "main" ? ` on ${d.branch}` : "";
  const msg = typeof d.message === "string" ? d.message : "";
  switch (i.action) {
    case "version.edit": {
      const where = pagesText(d.pages);
      const what = where ? `edited ${where}${d.theme ? " and the theme" : ""}` : d.theme ? "changed the theme" : "edited the site";
      return { text: `${what}${branch}${msg ? `: ${msg}` : ""}`, tone: "edit" };
    }
    case "version.restore":
      return { text: `${msg ? msg.charAt(0).toLowerCase() + msg.slice(1) : "restored an earlier version"}${branch}`, tone: "edit" };
    case "site.create":
    case "version.create":
      return { text: "created the site", tone: "edit" };
    case "version.brand":
      return { text: msg ? msg.charAt(0).toLowerCase() + msg.slice(1) : "updated the brand", tone: "settings" };
    case "version.name":
      return { text: `named version ${d.versionId} “${d.label}”`, tone: "edit" };
    case "version.unname":
      return { text: `removed the name from version ${d.versionId}`, tone: "edit" };
    case "site.publish":
      return { text: `published version ${d.versionId}`, tone: "live" };
    case "site.rollback":
      return { text: "rolled the live site back to an earlier publish", tone: "danger" };
    case "branch.merge":
      return { text: `merged ${d.branch} into main${d.force ? " (replacing newer changes)" : ""}`, tone: "live" };
    case "branch.create":
      return { text: `started branch ${d.branch ?? d.name ?? ""}`, tone: "edit" };
    case "branch.delete":
      return { text: `deleted branch ${d.branch ?? d.name ?? ""}`, tone: "edit" };
    case "branch.approve":
      return { text: `approved ${d.branch ?? "a branch"}${d.note ? `: “${d.note}”` : ""}`, tone: "review" };
    case "approval.override":
      return { text: `merged ${d.branch ?? "a branch"} with ${d.have ?? 0} of ${d.need ?? "?"} required approvals (admin override)`, tone: "danger" };
    case "site.approvals":
      return { text: `set approvals needed to publish to ${d.required ?? "?"}`, tone: "review" };
    case "schedule.create":
      return { text: `scheduled ${d.branch && d.branch !== "main" ? `a release of ${d.branch}` : "publishing"}${d.runAt ? ` for ${new Date(String(d.runAt)).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`, tone: "live" };
    case "schedule.cancel":
      return { text: "cancelled a scheduled release", tone: "live" };
    case "schedule.failed":
      return { text: `scheduled release failed${d.error ? `: ${d.error}` : ""}`, tone: "danger" };
    case "site.update":
      return { text: "changed the site's name or domain", tone: "settings" };
    case "site.brand":
      return { text: d.brand ? `switched the site to the ${d.brand} brand` : "stopped following a brand", tone: "settings" };
    case "forms.export":
      return { text: "downloaded form entries", tone: "settings" };
    case "forms.delete":
      return { text: `deleted ${d.count ?? ""} form entries${d.form ? ` from ${d.form}` : ""}`.replace("  ", " "), tone: "danger" };
    default:
      return { text: i.action.replace(/[._]/g, " "), tone: "settings" };
  }
}

const KINDS = [
  ["", "Everything"],
  ["edits", "Edits"],
  ["publishing", "Publishing"],
  ["reviews", "Reviews"],
  ["settings", "Settings"],
] as const;

export function ActivityLog({ siteId, slug, onOpenVersion }: { siteId: string; slug: string; onOpenVersion?: (versionId: number) => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [people, setPeople] = useState<{ name: string; count: number }[]>([]);
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");
  const [more, setMore] = useState(false);
  const toast = useToast();
  const load = useCallback(
    async (before?: string) => {
      const r = await History.activity(siteId, { kind, actor, before });
      setMore(r.items.length >= 100);
      setPeople(r.people);
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
    },
    [siteId, kind, actor],
  );
  useEffect(() => {
    setItems(null);
    void load().catch((e) => toast({ text: e.message, tone: "error" }));
  }, [load, toast]);

  let lastDay = "";
  return (
    <section className="activity" aria-labelledby="ov-activity">
      <div className="section-head">
        <h2 id="ov-activity">Activity</h2>
        <select className="select" aria-label="Person" value={actor} onChange={(e) => setActor(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.name} value={p.name}>
              {/claude|agent/i.test(p.name) ? `Claude (${p.name})` : p.name}
            </option>
          ))}
        </select>
        <button className="btn ghost sm" onClick={() => void History.activityCsv(siteId, slug)}>
          <Icon name="download" size={13} /> Download
        </button>
      </div>
      <div className="seg" role="group" aria-label="Kind of activity">
        {KINDS.map(([k, l]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Every change is recorded with who made it and when. Entries can't be edited or deleted.
      </p>
      {items === null && <div className="tm-loading small" />}
      {items?.length === 0 && <div className="empty">Nothing here yet.</div>}
      <ol className="act-list">
        {items?.map((i) => {
          const day = new Date(i.at).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;
          const d = describe(i);
          const agent = isAgent(i.actor, i.role);
          const v = typeof i.detail.versionId === "number" ? i.detail.versionId : undefined;
          return (
            <li key={i.id}>
              {showDay && <div className="act-day">{new Date(i.at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</div>}
              <div className={`act-row t-${d.tone}`}>
                <span className={`tm-avatar ${agent ? "agent" : ""}`} aria-hidden="true">
                  {agent ? "C" : initials(i.actor)}
                </span>
                <span className="grow">
                  <span>
                    <strong>{agent ? "Claude" : i.actor}</strong> {d.text}
                  </span>
                  <span className="muted small">
                    {new Date(i.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {i.role}
                    {agent && i.actor !== "Claude" ? ` · ${i.actor}` : ""}
                  </span>
                </span>
                {v && onOpenVersion && i.action.startsWith("version.") && i.action !== "version.unname" && (
                  <button className="btn ghost sm" onClick={() => onOpenVersion(v)}>
                    See version
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {more && (
        <button className="btn ghost sm" onClick={() => void load(items?.[items.length - 1]?.at)}>
          Show older
        </button>
      )}
    </section>
  );
}

export function AccessList({ siteId, me }: { siteId: string; me: Me }) {
  const [list, setList] = useState<SiteAccess[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const toast = useToast();
  const load = useCallback(() => {
    History.access(siteId)
      .then(setList)
      .catch(() => setList([]));
  }, [siteId]);
  useEffect(load, [load]);
  const admin = me.role === "admin";
  return (
    <section className="access" aria-labelledby="ov-access">
      <h3 id="ov-access">
        Who has access <span className="muted">{list?.length ?? ""}</span>
      </h3>
      {me.local && <p className="muted small">On this computer you're the owner. In the cloud, everyone with a sign-in for this site is listed here.</p>}
      <ul className="access-list">
        {list?.map((a) => {
          const agent = a.role === "agent";
          const key = a.id ?? `${a.name}:${a.createdAt}`;
          return (
            <li key={key}>
              <span className={`tm-avatar ${agent ? "agent" : ""}`} aria-hidden="true">
                {initials(a.name)}
              </span>
              <span className="grow">
                <span className="access-name">
                  {a.name}
                  <span className={`role-chip r-${a.role}`}>{agent ? "Claude" : a.role}</span>
                </span>
                <span className="muted small">
                  {a.scope === "all sites" ? "All sites" : "Only this site"}
                  {a.lastUsedAt ? ` · active ${ago(a.lastUsedAt)}` : " · never used"}
                  {a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                </span>
              </span>
              {admin && a.id &&
                (confirm === a.id ? (
                  <span className="access-confirm">
                    <button
                      className="btn sm danger"
                      onClick={() =>
                        void Tokens.revoke(a.id!)
                          .then(() => (toast({ text: `${a.name} can no longer sign in` }), setConfirm(null), load()))
                          .catch((e) => toast({ text: e.message, tone: "error" }))
                      }
                    >
                      Revoke
                    </button>
                    <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="btn ghost icon sm" aria-label={`Revoke access for ${a.name}`} title="Revoke access" onClick={() => setConfirm(a.id!)}>
                    <Icon name="close" size={13} />
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {admin && !me.local && (
        <a className="btn ghost sm" href="/access" onClick={(e) => (e.preventDefault(), history.pushState(null, "", "/access"), dispatchEvent(new PopStateEvent("popstate")))}>
          <Icon name="plus" size={12} /> Give someone access
        </a>
      )}
      {!admin && <p className="muted small">Ask an admin to add or remove people.</p>}
    </section>
  );
}
