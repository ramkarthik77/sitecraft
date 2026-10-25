import { useEffect, useMemo, useState } from "react";
import { History, type CalendarEvent, type Me, type WorkItem, type WorkKind } from "../api";
import { useShared } from "../store";
import { NewSiteDialog } from "./Home";
import { Icon } from "./Icon";
import { ConnectClaude, go, PageHead, Pill, siteUrl } from "./Shell";
import { SiteTile } from "./Directory";
import { Checklist } from "./Guide";

/** Home (what needs you today across every site) and My work (all of it). */

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** "Today · 4:00 PM", "Mon · 9:00 AM", "Oct 31", or "Overdue · Oct 20". */
export function dueLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 864e5);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (d.getTime() < now.getTime() && diff < 0) return `Overdue · ${date}`;
  if (diff === 0) return `Today · ${time}`;
  if (diff === 1) return `Tomorrow · ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: "short" })} · ${time}`;
  return date;
}

export const WORK_META: Record<WorkKind, { icon: string; tag: string; tone: "agent" | "human" | "warn" | "danger" | "ok"; action: string }> = {
  review: { icon: "shield", tag: "MLR review", tone: "human", action: "Review" },
  changes: { icon: "alert", tag: "Changes requested", tone: "danger", action: "Make changes" },
  claude: { icon: "sparkle", tag: "Claude branch", tone: "agent", action: "Review" },
  release: { icon: "calendar", tag: "Release", tone: "warn", action: "View release" },
  asset: { icon: "image", tag: "Asset rights", tone: "warn", action: "Open asset" },
};

export function WorkRow({ item }: { item: WorkItem }) {
  const m = WORK_META[item.kind];
  const due = dueLabel(item.due);
  return (
    <li className={`wq-row k-${item.kind}`}>
      <span className={`wq-ic t-${m.tone}`} aria-hidden="true">
        <Icon name={m.icon} size={15} />
      </span>
      <a className="grow wq-main" href={item.link} onClick={go(item.link)}>
        <strong>{item.title}</strong>
        <span className="muted small">{[item.siteName, item.detail].filter(Boolean).join(" · ")}</span>
      </a>
      <span className="wq-side">
        {due && <span className={`wq-due ${due.startsWith("Overdue") || due.startsWith("Today") ? "soon" : ""}`}>{due}</span>}
        <Pill tone={m.tone}>{m.tag}</Pill>
      </span>
      <a className={`btn sm ${item.kind === "claude" ? "agent-outline" : ""}`} href={item.link} onClick={go(item.link)}>
        {m.action}
      </a>
    </li>
  );
}

function Stat({ href, icon, label, value, sub, tone }: { href: string; icon: string; label: string; value: number | string; sub: React.ReactNode; tone: string }) {
  return (
    <a className={`stat t-${tone}`} href={href} onClick={go(href)}>
      <span className="stat-top">
        <span>{label}</span>
        <span className="stat-ic" aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
      </span>
      <strong className="stat-num">{value}</strong>
      <span className="stat-sub">
        {sub}
        <Icon name="arrow" size={13} />
      </span>
    </a>
  );
}

const FILTERS: [string, string, (i: WorkItem) => boolean][] = [
  ["all", "All", () => true],
  ["reviews", "Reviews", (i) => i.kind === "review" || i.kind === "changes"],
  ["claude", "Claude drafts", (i) => i.kind === "claude"],
  ["releases", "Releases", (i) => i.kind === "release"],
  ["assets", "Assets", (i) => i.kind === "asset"],
];

function Queue({ items, limit, filters = FILTERS.slice(0, 3) }: { items: WorkItem[] | null; limit?: number; filters?: typeof FILTERS }) {
  const [f, setF] = useState("all");
  const pick = filters.find((x) => x[0] === f) ?? filters[0]!;
  const shown = (items ?? []).filter(pick[2]);
  return (
    <>
      <div className="seg" role="group" aria-label="Show">
        {filters.map(([k, l, test]) => (
          <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>
            {l}
            {items && k !== "all" ? <span className="seg-n">{items.filter(test).length}</span> : null}
          </button>
        ))}
      </div>
      {items === null && <div className="tm-loading small" />}
      {items && shown.length === 0 && <div className="empty">Nothing waiting for you here.</div>}
      <ul className="wq">
        {shown.slice(0, limit ?? shown.length).map((i) => (
          <WorkRow key={i.id} item={i} />
        ))}
      </ul>
      {limit && shown.length > limit && <span className="muted small">Showing {limit} of {shown.length}</span>}
    </>
  );
}

export function CommandCenter({ me }: { me: Me }) {
  const { sites, work } = useShared();
  const [creating, setCreating] = useState(false);
  const [connect, setConnect] = useState(false);
  const [coming, setComing] = useState<CalendarEvent[] | null>(null);
  useEffect(() => {
    const from = new Date();
    const to = new Date(Date.now() + 14 * 864e5);
    History.calendar(from.toISOString(), to.toISOString())
      .then((e) => setComing(e.filter((x) => x.kind === "release" && x.status === "pending")))
      .catch(() => setComing([]));
  }, []);
  const c = work?.counts;
  const live = (sites ?? []).filter((s) => s.liveUrl).length;
  const markets = new Set((sites ?? []).map((s) => s.market).filter(Boolean)).size;
  const first = me.local ? "" : `, ${me.name.split(/[\s(]/)[0]}`;
  const recent = useMemo(() => [...(sites ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 4), [sites]);
  const canCreate = me.role !== "agent" && !me.limitedToSites;

  return (
    <main className="page">
      <PageHead
        eyebrow="Command center"
        title={`${greeting()}${first}.`}
        sub={`${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${live} live ${live === 1 ? "site" : "sites"}${markets ? ` · ${markets} ${markets === 1 ? "market" : "markets"}` : ""}`}
        actions={
          <>
            <button className="btn agent-outline" onClick={() => setConnect(true)}>
              <Icon name="sparkle" size={14} /> Work with Claude
            </button>
            {canCreate && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={14} /> Create site
              </button>
            )}
          </>
        }
      />

      <Checklist me={me} onCreate={() => setCreating(true)} onConnect={() => setConnect(true)} />

      <section aria-labelledby="attn">
        <div className="sec-head">
          <h2 id="attn">Needs your attention</h2>
          <span className="muted small">Today</span>
          <span className="grow" />
          <span className="muted small">People decide; Claude drafts</span>
        </div>
        <div className="stats">
          <Stat href="/work" icon="shield" label="MLR reviews" tone="human" value={c?.review ?? "–"} sub={c ? <><strong>{c.reviewDueToday} due today</strong>&nbsp;for you</> : " "} />
          <Stat href="/reviews?show=claude" icon="sparkle" label="Claude branches" tone="agent" value={c?.claude ?? "–"} sub={<><strong>{c?.claude ?? 0} ready</strong>&nbsp;for a person to review</>} />
          <Stat href="/releases" icon="calendar" label="Releases this week" tone="warn" value={c?.release ?? "–"} sub={coming?.[0] ? <>Next&nbsp;<strong>{dueLabel(coming[0].at)}</strong></> : "None scheduled"} />
          <Stat href="/assets?status=expiring" icon="clock" label="Assets expiring" tone="danger" value={c?.asset ?? "–"} sub={<><strong>{c?.assetWithin7 ?? 0} within 7 days</strong>&nbsp;or expired</>} />
        </div>
      </section>

      <div className="cols">
        <section className="card" aria-labelledby="pq">
          <div className="card-head">
            <div className="grow">
              <h2 id="pq">Priority queue</h2>
              <span className="muted small">Your work across every site, soonest first</span>
            </div>
          </div>
          <div className="card-body">
            <Queue items={work?.items ?? null} limit={6} />
          </div>
          <div className="card-foot">
            <a href="/work" onClick={go("/work")}>
              Open all work <Icon name="arrow" size={13} />
            </a>
          </div>
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="cu">
            <div className="card-head">
              <div className="grow">
                <h2 id="cu">Coming up</h2>
                <span className="muted small">Scheduled releases, next two weeks</span>
              </div>
              <a className="small" href="/releases" onClick={go("/releases")}>
                Releases <Icon name="arrow" size={12} />
              </a>
            </div>
            <div className="card-body">
              {coming === null && <div className="tm-loading small" />}
              {coming?.length === 0 && <div className="empty">Nothing scheduled. Schedule a release from a site's Releases.</div>}
              <ol className="timeline">
                {coming?.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <span className="tl-date">
                      <span>{new Date(e.at).toLocaleDateString([], { month: "short" })}</span>
                      <strong>{new Date(e.at).getDate()}</strong>
                    </span>
                    <span className="tl-dot" aria-hidden="true" />
                    <a className="grow" href={siteUrl(e.siteId, "releases")} onClick={go(siteUrl(e.siteId, "releases"))}>
                      <strong>{e.siteName}</strong>
                      <span className="muted small">
                        {e.branch === "main" ? "Publish" : `Release ${e.branch}`} · {new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                      </span>
                      {e.note && <span className="small">{e.note}</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          {!!c?.claude && (
            <a className="claude-card" href="/reviews?show=claude" onClick={go("/reviews?show=claude")}>
              <span className="connect-mark" aria-hidden="true">
                <Icon name="sparkle" size={15} />
              </span>
              <span className="grow">
                <strong>
                  Claude prepared {c.claude} {c.claude === 1 ? "branch" : "branches"}
                </strong>
                <span>Each change waits on its own branch for a person. Nothing publishes on its own.</span>
                <span className="claude-link">
                  Review Claude's work <Icon name="arrow" size={12} />
                </span>
              </span>
            </a>
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <section aria-labelledby="ys">
          <div className="sec-head">
            <h2 id="ys">Recent sites</h2>
            <span className="grow" />
            <a className="small" href="/sites" onClick={go("/sites")}>
              All {sites?.length} sites <Icon name="arrow" size={12} />
            </a>
          </div>
          <div className="tiles">
            {recent.map((s) => (
              <SiteTile key={s.id} site={s} />
            ))}
          </div>
        </section>
      )}
      {creating && <NewSiteDialog onClose={() => setCreating(false)} />}
      {connect && <ConnectClaude me={me} onClose={() => setConnect(false)} />}
    </main>
  );
}

export function MyWork({ me }: { me: Me }) {
  const { work } = useShared();
  void me;
  return (
    <main className="page">
      <PageHead
        eyebrow="Personal queue"
        title="My work"
        sub="Everything waiting for your decision, across every brand and market, soonest first."
        actions={
          <a className="btn agent-outline" href="/reviews?show=claude" onClick={go("/reviews?show=claude")}>
            <Icon name="sparkle" size={14} /> Review Claude's drafts
          </a>
        }
      />
      <section className="card">
        <div className="card-body">
          <Queue items={work?.items ?? null} filters={FILTERS} />
        </div>
      </section>
    </main>
  );
}

