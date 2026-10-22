import { useState } from "react";
import { Schedules, type Schedule } from "../api";
import { Icon } from "./Icon";

/** "Tue, Oct 28, 9:00 AM" in the viewer's time zone. */
export function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The value for a datetime-local input, an hour from now on the hour. */
function defaultLocal() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Pick a time and schedule publishing main, or releasing a branch. */
export function ScheduleForm(props: { siteId: string; branch: string; onDone: (s: Schedule) => void; onCancel: () => void; toast: (m: string, tone?: "error") => void }) {
  const [at, setAt] = useState(defaultLocal());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const release = props.branch !== "main";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <form
      className="schedule-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const s = await Schedules.create(props.siteId, { branch: props.branch, runAt: new Date(at).toISOString(), note: note.trim() || undefined });
          props.toast(release ? `Scheduled: ${props.branch} goes live ${when(s.runAt)}` : `Scheduled to publish ${when(s.runAt)}`);
          props.onDone(s);
        } catch (err) {
          props.toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong className="small">{release ? `Release ${props.branch}` : "Schedule publishing"}</strong>
      <span className="muted small">{release ? "At this time the branch is merged into main and the site is published, all at once." : "At this time main is published as it is then."}</span>
      <input className="input" type="datetime-local" aria-label="Publish at" required value={at} min={defaultLocal().slice(0, 10) + "T00:00"} onChange={(e) => setAt(e.target.value)} />
      <span className="muted small">Your time zone: {tz}</span>
      <input className="input" aria-label="Note" placeholder="Note, e.g. Black Friday launch (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn sm primary" disabled={busy || !at}>
          {release ? "Schedule release" : "Schedule"}
        </button>
        <button type="button" className="btn sm ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const LABEL: Record<Schedule["status"], string> = { pending: "Scheduled", running: "Publishing", done: "Published", failed: "Didn't run", cancelled: "Cancelled" };

/** Upcoming and recent scheduled publishing for a site. */
export function ScheduleList(props: { siteId: string; items: Schedule[]; canChange: boolean; onChanged: () => void; toast: (m: string, tone?: "error") => void }) {
  if (!props.items.length) return <div className="muted small">Nothing scheduled. Use the clock next to Publish, or Schedule release when reviewing a branch.</div>;
  return (
    <div className="schedule-list">
      {props.items.map((s) => (
        <div key={s.id} className={`schedule-row ${s.status}`}>
          <Icon name="clock" size={14} />
          <span className="grow">
            <span>
              {s.branch === "main" ? "Publish main" : <>Release <span className="mono">{s.branch}</span></>} · {when(s.runAt)}
            </span>
            <span className="muted small">
              {LABEL[s.status]}
              {s.note ? ` · ${s.note}` : ""} · by {s.createdBy}
              {s.result && s.status !== "done" ? ` · ${s.result}` : ""}
            </span>
          </span>
          {s.status === "pending" && props.canChange && (
            <button
              className="btn sm ghost"
              onClick={async () => {
                try {
                  await Schedules.cancel(props.siteId, s.id);
                  props.toast("Cancelled");
                  props.onChanged();
                } catch (e) {
                  props.toast((e as Error).message, "error");
                }
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
