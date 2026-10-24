import { useEffect, useMemo, useState } from "react";
import { History, type CalendarEvent, type Me } from "../api";
import { navigate } from "../router";
import { Icon } from "./Icon";

/**
 * What goes live when, across every site you can see: scheduled releases,
 * what was published, and rollbacks, in the time zone you pick.
 */

const ZONES = [
  ["local", "Your time zone"],
  ["UTC", "UTC"],
  ["America/New_York", "New York"],
  ["America/Chicago", "Chicago"],
  ["America/Los_Angeles", "Los Angeles"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Berlin"],
  ["Asia/Kolkata", "India"],
  ["Asia/Tokyo", "Tokyo"],
  ["Australia/Sydney", "Sydney"],
] as const;
const KINDS = [
  ["release", "Scheduled releases"],
  ["published", "Published"],
  ["rollback", "Rollbacks"],
] as const;

const zoneOpt = (z: string) => (z === "local" ? {} : { timeZone: z });
/** The calendar day an instant falls on, in a time zone, as YYYY-MM-DD. */
function dayIn(iso: string, zone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { ...zoneOpt(zone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const timeIn = (iso: string, zone: string) => new Date(iso).toLocaleTimeString([], { ...zoneOpt(zone), hour: "numeric", minute: "2-digit" });
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function label(e: CalendarEvent) {
  if (e.kind === "release") return e.branch === "main" ? "Publish main" : `Release ${e.branch}`;
  if (e.kind === "rollback") return "Rolled back";
  return "Published";
}

export function CalendarPage({ me }: { me: Me }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [zone, setZone] = useState(() => {
    try {
      return localStorage.getItem("sitecraft.calendar.zone") ?? "local";
    } catch {
      return "local";
    }
  });
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.map((k) => k[0])));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [day, setDay] = useState(() => keyOf(new Date()));
  const [error, setError] = useState("");

  // The six weeks shown, Monday first.
  const weeks = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  useEffect(() => {
    setEvents(null);
    const from = new Date(weeks[0]!.getTime() - 864e5).toISOString();
    const to = new Date(weeks[41]!.getTime() + 2 * 864e5).toISOString();
    History.calendar(from, to)
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, [weeks]);
  useEffect(() => {
    try {
      localStorage.setItem("sitecraft.calendar.zone", zone);
    } catch {
      /* private window */
    }
  }, [zone]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      if (!kinds.has(e.kind)) continue;
      const k = dayIn(e.at, zone);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events, kinds, zone]);
  const today = dayIn(new Date().toISOString(), zone);
  const upcoming = (events ?? []).filter((e) => e.kind === "release" && e.status === "pending" && e.at > new Date().toISOString()).slice(0, 6);
  const selected = byDay.get(day) ?? [];
  const open = (e: CalendarEvent) =>
    navigate(e.kind === "release" ? `/sites/${e.siteId}/overview` : `/sites/${e.siteId}?open=history${e.versionId ? `&version=${e.versionId}` : ""}`);
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <main className="dash-main cal">
      <div className="dash-head">
        <h1>Calendar</h1>
        <span className="muted">What goes live when, across your sites</span>
        <div className="spacer" />
        <label className="cal-zone">
          <Icon name="clock" size={13} />
          <span className="sr-only">Time zone</span>
          <select className="select" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Time zone">
            {ZONES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn ghost icon sm" aria-label="Previous month" onClick={() => shift(-1)}>
            <Icon name="back" size={14} />
          </button>
          <h2>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
          <button className="btn ghost icon sm" aria-label="Next month" onClick={() => shift(1)}>
            <Icon name="back" size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              setDay(keyOf(d));
            }}
          >
            Today
          </button>
        </div>
        <div className="cal-kinds" role="group" aria-label="Show">
          {KINDS.map(([k, l]) => (
            <label key={k} className={`cal-kind k-${k} ${kinds.has(k) ? "on" : ""}`}>
              <input type="checkbox" checked={kinds.has(k)} onChange={() => setKinds((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s.add(k))))} />
              <i aria-hidden="true" /> {l}
            </label>
          ))}
        </div>
      </div>
      {error && <div className="err">{error}</div>}

      <div className="cal-layout">
        <div className="cal-grid" role="grid" aria-label={month.toLocaleDateString([], { month: "long", year: "numeric" })}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="cal-dow" role="columnheader">
              {d}
            </div>
          ))}
          {weeks.map((d) => {
            const k = keyOf(d);
            const list = byDay.get(k) ?? [];
            const out = d.getMonth() !== month.getMonth();
            return (
              <button key={k} role="gridcell" aria-selected={k === day} className={`cal-day ${out ? "out" : ""} ${k === today ? "today" : ""} ${k === day ? "on" : ""}`} onClick={() => setDay(k)}>
                <span className="cal-num">{d.getDate()}</span>
                <span className="cal-events">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className={`cal-chip k-${e.kind} ${e.status === "failed" ? "failed" : ""}`} title={`${label(e)} · ${e.siteName} · ${timeIn(e.at, zone)}`}>
                      <b>{timeIn(e.at, zone)}</b> {e.siteName}
                    </span>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                </span>
              </button>
            );
          })}
          {events === null && <div className="cal-loading" aria-hidden="true" />}
        </div>

        <aside className="cal-side" aria-label="Selected day">
          <h3>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h3>
          {selected.length === 0 ? (
            <p className="muted small">Nothing on this day.</p>
          ) : (
            <ol className="cal-agenda">
              {selected.map((e) => (
                <li key={e.id} className={`k-${e.kind}`}>
                  <span className="cal-time">{timeIn(e.at, zone)}</span>
                  <div className="grow">
                    <strong>{label(e)}</strong>
                    <span className="muted small">
                      {e.siteName} · {/claude|agent/i.test(e.by) ? "Claude" : e.by}
                      {e.note ? ` · ${e.note}` : ""}
                      {e.status === "failed" ? " · failed" : e.kind === "release" && e.status === "done" ? " · done" : ""}
                    </span>
                  </div>
                  <button className="btn ghost sm" onClick={() => open(e)}>
                    {e.kind === "release" ? "Open site" : "See version"}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <h3 style={{ marginTop: 22 }}>Coming up</h3>
          {upcoming.length === 0 ? (
            <p className="muted small">No releases scheduled. Schedule one from a site's Publish menu{me.role === "agent" ? "" : " in the editor"}.</p>
          ) : (
            <ol className="cal-agenda">
              {upcoming.map((e) => (
                <li key={e.id} className="k-release">
                  <span className="cal-time">{new Date(e.at).toLocaleDateString([], { ...zoneOpt(zone), month: "short", day: "numeric" })}</span>
                  <div className="grow">
                    <strong>{label(e)}</strong>
                    <span className="muted small">
                      {e.siteName} · {timeIn(e.at, zone)}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </main>
  );
}
