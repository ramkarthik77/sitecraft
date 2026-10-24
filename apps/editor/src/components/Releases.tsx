import { useCallback, useEffect, useState } from "react";
import { Approvals, audienceLabel, History, Schedules, Sites, type Blocker, type CalendarEvent, type Me, type Schedule, type SiteSummary } from "../api";
import { useShared } from "../store";
import { useToast } from "../Toasts";
import { CalendarPage } from "./Calendar";
import { Icon } from "./Icon";
import { go, PageHead, Pill, siteUrl } from "./Shell";
import { ScheduleForm, ScheduleList } from "./Schedule";

/** Releases: what goes live when, across sites, and whether it's ready. */

interface Readiness {
  ok: boolean;
  reason: string;
}

/** Is a scheduled release ready to run: sign-off done, nothing blocking publishing? */
async function readinessOf(e: CalendarEvent): Promise<Readiness> {
  try {
    const [r, a] = await Promise.all([Sites.readiness(e.siteId), e.branch !== "main" ? Approvals.get(e.siteId, e.branch) : Promise.resolve(null)]);
    if (a?.changesRequested) return { ok: false, reason: "Changes requested" };
    if (a && a.missing.length) return { ok: false, reason: `Needs ${a.missing.join(", ")} sign-off` };
    if (a && !a.met) return { ok: false, reason: `${a.approvals.length} of ${a.required} approvals` };
    if (!r.ready) return { ok: false, reason: blockerText(r.blockers) };
    return { ok: true, reason: "Ready" };
  } catch {
    return { ok: false, reason: "Couldn't check" };
  }
}
const blockerText = (b: Blocker[]) => {
  const kinds = new Set(b.map((x) => x.kind));
  if (kinds.has("asset-expired")) return "Asset rights expired";
  if (kinds.has("asset-unapproved")) return "Unapproved asset";
  if (kinds.has("asset-market")) return "Asset not cleared for market";
  return `${b.length} ${b.length === 1 ? "page needs" : "pages need"} a job code`;
};

export function ReleasesPage({ me }: { me: Me }) {
  const { sites } = useShared();
  const [view, setView] = useState<"list" | "calendar">(new URLSearchParams(location.search).get("view") === "calendar" ? "calendar" : "list");
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [ready, setReady] = useState<Record<string, Readiness>>({});
  useEffect(() => {
    History.calendar(new Date(Date.now() - 7 * 864e5).toISOString(), new Date(Date.now() + 90 * 864e5).toISOString())
      .then((e) => {
        setEvents(e);
        for (const x of e.filter((y) => y.kind === "release" && y.status === "pending")) void readinessOf(x).then((r) => setReady((m) => ({ ...m, [x.id]: r })));
      })
      .catch(() => setEvents([]));
  }, []);
  const site = (id: string) => sites?.find((s) => s.id === id);
  const pending = (events ?? []).filter((e) => e.kind === "release" && e.status === "pending");
  const weekEnd = Date.now() + 7 * 864e5;
  const week = pending.filter((e) => new Date(e.at).getTime() < weekEnd);
  const later = pending.filter((e) => new Date(e.at).getTime() >= weekEnd);
  const recent = (events ?? []).filter((e) => e.kind !== "release" || e.status !== "pending").filter((e) => new Date(e.at).getTime() < Date.now()).reverse().slice(0, 8);
  const okCount = pending.filter((e) => ready[e.id]?.ok).length;
  const blocked = pending.filter((e) => ready[e.id] && !ready[e.id]!.ok).length;

  const row = (e: CalendarEvent) => {
    const s = site(e.siteId);
    const r = ready[e.id];
    const d = new Date(e.at);
    return (
      <li key={e.id} className="rel-row">
        <span className="tl-date">
          <span>{d.toLocaleDateString([], { month: "short" })}</span>
          <strong>{d.getDate()}</strong>
        </span>
        <span className="rel-time mono">{d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span>
        <a className="grow wq-main" href={siteUrl(e.siteId, "releases")} onClick={go(siteUrl(e.siteId, "releases"))}>
          <strong>{e.siteName}</strong>
          <span className="muted small">{[s?.market, audienceLabel(s?.audience), e.note].filter(Boolean).join(" · ") || " "}</span>
        </a>
        <span className="mono small muted">{e.branch === "main" ? "main" : e.branch}</span>
        {r ? <Pill tone={r.ok ? "ok" : "danger"}>{r.reason}</Pill> : <Pill tone="muted">Checking…</Pill>}
        <a className="btn sm" href={siteUrl(e.siteId, "releases")} onClick={go(siteUrl(e.siteId, "releases"))}>
          View release
        </a>
      </li>
    );
  };

  return (
    <main className="page">
      <PageHead
        eyebrow="Release management"
        title="Releases"
        sub="Governed publishing across markets and sites. A release merges its branch and publishes at the time set, only if sign-off is complete and nothing blocks it."
        actions={
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>
              <Icon name="list" size={13} /> Schedule
            </button>
            <button aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
              <Icon name="calendar" size={13} /> Calendar
            </button>
          </div>
        }
      />
      {view === "calendar" ? (
        <div className="embed-cal">
          <CalendarPage me={me} />
        </div>
      ) : (
        <>
          <div className="stats small-stats">
            <div className="stat t-warn">
              <span className="stat-top">This week</span>
              <strong className="stat-num">{events ? week.length : "–"}</strong>
              <span className="stat-sub">across {new Set(week.map((e) => e.siteId)).size} sites</span>
            </div>
            <div className="stat t-ok">
              <span className="stat-top">Ready to publish</span>
              <strong className="stat-num">{events ? okCount : "–"}</strong>
              <span className="stat-sub">sign-off complete</span>
            </div>
            <div className="stat t-danger">
              <span className="stat-top">Blocked</span>
              <strong className="stat-num">{events ? blocked : "–"}</strong>
              <span className="stat-sub">sign-off, job codes or asset rights</span>
            </div>
          </div>
          <section className="card">
            <div className="card-head">
              <div className="grow">
                <h2>Release schedule</h2>
                <span className="muted small">Times in your time zone, {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              </div>
            </div>
            <div className="card-body">
              {events === null && <div className="tm-loading small" />}
              {events && pending.length === 0 && <div className="empty">Nothing scheduled. Open a site's Releases, or review a branch, to schedule one.</div>}
              {week.length > 0 && <h3 className="sub-h">This week</h3>}
              <ul className="wq">{week.map(row)}</ul>
              {later.length > 0 && <h3 className="sub-h">Later</h3>}
              <ul className="wq">{later.map(row)}</ul>
            </div>
          </section>
          {recent.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>Recently</h2>
              </div>
              <div className="card-body">
                <ul className="wq">
                  {recent.map((e) => (
                    <li key={e.id} className="rel-row past">
                      <span className="rel-time mono">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      <span className="grow">
                        <strong>{e.siteName}</strong>{" "}
                        <span className="muted">
                          {e.kind === "published" ? `published by ${e.by}` : e.kind === "rollback" ? `rolled back by ${e.by}` : e.status === "failed" ? `release didn't run: ${e.result ?? ""}` : `release ${e.status}`}
                        </span>
                      </span>
                      <Pill tone={e.kind === "rollback" || e.status === "failed" ? "danger" : "ok"}>{e.kind === "published" ? "Published" : e.kind === "rollback" ? "Rolled back" : e.status === "failed" ? "Didn't run" : "Done"}</Pill>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export function SiteReleases({ me, site }: { me: Me; site: SiteSummary }) {
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [form, setForm] = useState(false);
  const [readiness, setReadiness] = useState<{ ready: boolean; blockers: Blocker[] } | null>(null);
  const toast = useToast();
  const load = useCallback(() => {
    Schedules.list(site.id).then(setItems, () => setItems([]));
    Sites.readiness(site.id).then(setReadiness, () => setReadiness(null));
  }, [site.id]);
  useEffect(load, [load]);
  const t = (m: string, tone?: "error") => toast({ text: m, tone });
  const person = me.role !== "agent";
  return (
    <main className="page">
      <PageHead
        eyebrow="Site releases"
        title="Releases"
        sub="Schedule main to publish, or a reviewed branch to go live, at a set time."
        actions={
          person && (
            <button className="btn primary" onClick={() => setForm((x) => !x)} aria-expanded={form}>
              <Icon name="clock" size={14} /> Schedule publishing
            </button>
          )
        }
      />
      {readiness && (
        <section className={`card ready-card ${readiness.ready ? "ok" : "bad"}`}>
          <div className="card-body">
            <strong>
              <Icon name={readiness.ready ? "check" : "alert"} size={14} /> {readiness.ready ? "Main can be published" : "Main can't be published yet"}
            </strong>
            {!readiness.ready && (
              <ul>
                {readiness.blockers.map((b, i) => (
                  <li key={i}>{b.message}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {form && (
        <section className="card">
          <div className="card-body">
            <ScheduleForm siteId={site.id} branch="main" toast={t} onCancel={() => setForm(false)} onDone={() => (setForm(false), load())} />
            <p className="muted small">To release a branch, open it from Branches or Reviews and choose Schedule release.</p>
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-head">
          <h2>Scheduled and recent</h2>
        </div>
        <div className="card-body">{items === null ? <div className="tm-loading small" /> : <ScheduleList siteId={site.id} items={items} canChange={person} onChanged={load} toast={t} />}</div>
      </section>
    </main>
  );
}
