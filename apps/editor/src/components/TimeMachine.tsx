import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderPage } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { History, Schedules, Sites, type Deployment, type Schedule, type Version } from "../api";
import { initials } from "../format";
import { Icon } from "./Icon";

/**
 * History as a time machine: a readable timeline on the left, the chosen
 * version drawn on the stage with what changed since, and what you can do with
 * it on the right: restore a page, restore everything, bring back one section,
 * name it, or make a published version live again.
 */

type Filter = "all" | "page" | "published" | "named";
type Compare = Awaited<ReturnType<typeof History.compare>>;

interface Group {
  key: string;
  milestone: boolean;
  versions: Version[];
  actor: string;
  role: string;
  day: string;
}

const SESSION_GAP = 30 * 60_000;
const isAgent = (v: { actorRole?: string; role?: string; actor: string }) => (v.actorRole ?? v.role) === "agent" || /claude|agent/i.test(v.actor);
const who = (v: { actor: string; actorRole?: string }) => (isAgent(v) ? "Claude" : v.actor);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
const longWhen = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Edits by one person close together read as one session; merges, publishes, restores and names stand alone. */
export function groupVersions(list: Version[]): Group[] {
  const out: Group[] = [];
  for (const v of list) {
    const milestone = v.kind !== "edit" || !!v.label || v.published;
    const last = out[out.length - 1];
    const tail = last?.versions[last.versions.length - 1];
    if (
      !milestone &&
      last &&
      !last.milestone &&
      last.actor === v.actor &&
      last.day === dayKey(v.createdAt) &&
      tail &&
      new Date(tail.createdAt).getTime() - new Date(v.createdAt).getTime() < SESSION_GAP
    ) {
      last.versions.push(v);
    } else {
      out.push({ key: `g${v.id}`, milestone, versions: [v], actor: v.actor, role: v.actorRole, day: dayKey(v.createdAt) });
    }
  }
  return out;
}

function pagesOf(vs: Version[]) {
  const m = new Map<string, string>();
  for (const v of vs) for (const p of v.changes?.pages ?? []) m.set(p.id, p.path === "/" ? "Home" : p.title || p.path);
  return [...m.values()];
}
const countOf = (vs: Version[]) => vs.reduce((n, v) => n + (v.changes ? v.changes.added + v.changes.changed + v.changes.removed + (v.changes.theme ? 1 : 0) : 0), 0);

function Badge({ v }: { v: Version }) {
  if (v.live) return <span className="tm-badge live">Live now</span>;
  if (v.published) return <span className="tm-badge pub">Published</span>;
  if (v.kind === "merge") return <span className="tm-badge merge">Merged</span>;
  if (v.kind === "restore") return <span className="tm-badge restore">Restore</span>;
  if (v.kind === "brand") return <span className="tm-badge brand">Brand</span>;
  if (v.kind === "create") return <span className="tm-badge">Created</span>;
  return null;
}

export function TimeMachine(props: {
  siteId: string;
  siteName: string;
  branch: string;
  /** The page open in the editor, for "This page" and as the first page shown. */
  pageId?: string;
  canWrite: boolean;
  canShip: boolean;
  canName: boolean;
  initialVersion?: number;
  onClose: () => void;
  /** After a restore, so the editor loads the new version. */
  onRestored?: () => void;
  toast: (m: string, tone?: "error") => void;
}) {
  const { siteId, branch } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [more, setMore] = useState(true);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<number | null>(props.initialVersion ?? null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [docs, setDocs] = useState<Record<number, SiteDocument>>({});
  const [meta, setMeta] = useState<Record<number, { actor: string; createdAt: string; message: string; label: string | null }>>({});
  const [compare, setCompare] = useState<Record<number, Compare>>({});
  const [highlight, setHighlight] = useState(true);
  const [stagePage, setStagePage] = useState<string | null>(null);
  const [node, setNode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveAt, setLiveAt] = useState("");
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      const q = filter === "page" ? { page: props.pageId } : filter === "published" || filter === "named" ? { only: filter } : {};
      const list = await Sites.versions(siteId, branch, { ...q, before, limit: 80 });
      setMore(list.length === 80);
      setVersions((cur) => (before && cur ? [...cur, ...list] : list));
      if (!before) setSelected((s) => s ?? list[0]?.id ?? null);
    },
    [filter, siteId, branch, props.pageId],
  );
  useEffect(() => {
    setVersions(null);
    void load().catch((e) => props.toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  const reloadSide = useCallback(() => {
    Sites.deployments(siteId).then(setDeps).catch(() => {});
    Schedules.list(siteId)
      .then((s) => setSchedules(s.filter((x) => x.status === "pending")))
      .catch(() => {});
  }, [siteId]);
  useEffect(reloadSide, [reloadSide]);

  // The selected version's document and how it differs from now.
  useEffect(() => {
    if (selected === null) return;
    setNode(null);
    setConfirmAll(false);
    if (!docs[selected])
      History.version(siteId, selected)
        .then((v) => {
          setDocs((d) => ({ ...d, [selected]: v.document }));
          setMeta((m) => ({ ...m, [selected]: { actor: v.actor, createdAt: v.createdAt, message: v.message, label: v.label } }));
        })
        .catch((e) => props.toast(e.message, "error"));
    if (!compare[selected])
      History.compare(siteId, selected)
        .then((c) => setCompare((m) => ({ ...m, [selected]: c })))
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, siteId]);

  const groups = useMemo(() => groupVersions(versions ?? []), [versions]);
  const flat = versions ?? [];
  const current = flat.find((v) => v.id === selected) ?? null;
  const doc = selected !== null ? docs[selected] : undefined;
  const diff = selected !== null ? compare[selected] : undefined;
  // The current version, or one identical to it: nothing to restore.
  const sameAsNow = !!diff && !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.pagesAdded.length && !diff.pagesRemoved.length && !diff.pagesChanged.length && !diff.themeChanged && !diff.content.length;
  const isHead = (!!flat[0] && selected === flat[0].id && filter === "all") || sameAsNow;
  const deployment = deps.find((d) => d.versionId === selected);
  const info = current ?? (selected !== null ? meta[selected] : undefined);

  // Which page to draw: the editor's page if it existed then, else the first one that changed.
  const page = useMemo(() => {
    if (!doc) return null;
    const want = stagePage ?? props.pageId;
    return doc.pages.find((p) => p.id === want) ?? doc.pages.find((p) => current?.changes?.pageIds.includes(p.id)) ?? doc.pages[0]!;
  }, [doc, stagePage, props.pageId, current]);

  useEffect(() => setName(current?.label ?? ""), [current?.id, current?.label]);

  // Keyboard: Escape closes, arrows walk the timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") props.onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = flat.findIndex((v) => v.id === selected);
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) setSelected(next.id);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flat, selected, props]);

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      props.toast(done);
      props.onRestored?.();
      setDocs({});
      setCompare({});
      setSelected(null);
      await load();
      reloadSide();
    } catch (e) {
      props.toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const jumpToLive = async () => {
    if (!liveAt) return;
    const at = new Date(liveAt);
    const r = await History.liveAt(siteId, at.toISOString()).catch((e) => (props.toast(e.message, "error"), null));
    if (!r) return;
    if (!r.live) {
      setLiveNote(`Nothing was live on ${longWhen(at.toISOString())}.`);
      return;
    }
    setFilter("all");
    setSelected(r.live.versionId);
    setLiveNote(`The live site on ${longWhen(at.toISOString())}: published ${longWhen(r.live.since)} by ${r.live.by}${r.live.reason === "rollback" ? " (a rollback)" : ""}.`);
  };

  return (
    <div className="tm" role="dialog" aria-modal="true" aria-label="History">
      <header className="tm-head">
        <div className="tm-title">
          <Icon name="history" size={16} />
          <strong>History</strong>
          <span className="muted">{props.siteName}</span>
          <span className="tm-branch mono">{branch}</span>
        </div>
        <div className="seg" role="group" aria-label="Show">
          {(
            [
              ["all", "Everything"],
              ...(props.pageId ? [["page", "This page"] as const] : []),
              ["published", "Published"],
              ["named", "Named"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => (setFilter(k as Filter), setSelected(null))}>
              {l}
            </button>
          ))}
        </div>
        <form
          className="tm-liveat"
          onSubmit={(e) => {
            e.preventDefault();
            void jumpToLive();
          }}
        >
          <label className="small muted" htmlFor="tm-at">
            Live site on
          </label>
          <input id="tm-at" type="datetime-local" className="input" value={liveAt} onChange={(e) => setLiveAt(e.target.value)} />
          <button className="btn sm" disabled={!liveAt}>
            Show
          </button>
        </form>
        <button className="btn ghost icon" aria-label="Close history" title="Close (Esc)" onClick={props.onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className="tm-body">
        <aside className="tm-timeline" aria-label="Versions">
          {schedules.length > 0 && filter === "all" && (
            <div className="tm-day">
              <div className="tm-daylabel">Coming up</div>
              {schedules.map((s) => (
                <div key={s.id} className="tm-item upcoming">
                  <span className="tm-dot up" aria-hidden="true" />
                  <div className="grow">
                    <strong>{s.branch === "main" ? "Publish main" : `Release ${s.branch}`}</strong>
                    <span className="muted small">
                      {longWhen(s.runAt)}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </div>
                  {props.canShip && (
                    <button className="btn ghost sm" onClick={() => void Schedules.cancel(siteId, s.id).then(reloadSide)}>
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {versions === null && <div className="tm-empty muted">Loading history…</div>}
          {versions?.length === 0 && <div className="tm-empty muted">{filter === "named" ? "No named versions yet. Name one from the panel on the right." : filter === "published" ? "Nothing published yet." : "No changes yet."}</div>}
          {groups.map((g, gi) => {
            const first = g.versions[0]!;
            const lastV = g.versions[g.versions.length - 1]!;
            const showDay = gi === 0 || groups[gi - 1]!.day !== g.day;
            const expanded = open.has(g.key);
            const inGroup = g.versions.some((v) => v.id === selected);
            const pages = pagesOf(g.versions);
            return (
              <div key={g.key} className="tm-group">
                {showDay && <div className="tm-daylabel">{dayLabel(first.createdAt)}</div>}
                <div className={`tm-item ${g.milestone ? "milestone" : ""} ${inGroup ? "on" : ""} kind-${first.live ? "live" : first.published ? "pub" : first.kind}${first.label ? " named" : ""}`}>
                  <span className={`tm-dot ${isAgent(first) ? "agent" : ""}`} aria-hidden="true" />
                  <button className="tm-pick" onClick={() => setSelected(first.id)} aria-current={inGroup ? "true" : undefined}>
                    <span className={`tm-avatar ${isAgent(first) ? "agent" : ""}`} aria-hidden="true">
                      {isAgent(first) ? "C" : initials(first.actor)}
                    </span>
                    <span className="grow">
                      <span className="tm-line">
                        <strong>{first.label ?? (g.milestone ? first.message : `${who(first)} edited`)}</strong>
                        <Badge v={first} />
                      </span>
                      <span className="muted small">
                        {g.milestone ? who(first) : `${g.versions.length} ${g.versions.length === 1 ? "save" : "saves"} · ${countOf(g.versions)} changes`}
                        {pages.length ? ` · ${pages.slice(0, 3).join(", ")}${pages.length > 3 ? ` +${pages.length - 3}` : ""}` : ""}
                      </span>
                    </span>
                    <span className="muted small tm-time">{g.versions.length > 1 && time(lastV.createdAt) !== time(first.createdAt) ? `${time(lastV.createdAt)}–${time(first.createdAt)}` : time(first.createdAt)}</span>
                  </button>
                  {g.versions.length > 1 && (
                    <button
                      className="btn ghost icon sm tm-expand"
                      aria-label={expanded ? "Hide the saves in this session" : "Show the saves in this session"}
                      aria-expanded={expanded}
                      onClick={() => setOpen((s) => (s.has(g.key) ? (s.delete(g.key), new Set(s)) : new Set(s.add(g.key))))}
                    >
                      <Icon name="chevron" size={13} style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
                    </button>
                  )}
                </div>
                {expanded && (
                  <div className="tm-saves">
                    {g.versions.map((v) => (
                      <button key={v.id} className={`tm-save ${v.id === selected ? "on" : ""}`} onClick={() => setSelected(v.id)}>
                        <span className="grow">{v.message}</span>
                        <span className="muted small">{time(v.createdAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {versions && more && (
            <button className="btn ghost sm tm-more" onClick={() => void load(flat[flat.length - 1]?.id)}>
              Show older
            </button>
          )}
        </aside>

        <section className="tm-stage" aria-label="Version preview">
          {liveNote && (
            <div className="tm-note">
              <Icon name="clock" size={13} /> {liveNote}
              <button className="btn ghost sm" onClick={() => setLiveNote(null)}>
                Clear
              </button>
            </div>
          )}
          {doc && page && (
            <div className="tm-stagebar">
              <div className="tm-pages" role="tablist" aria-label="Pages in this version">
                {doc.pages.map((p) => {
                  const touched = current?.changes?.pageIds.includes(p.id);
                  return (
                    <button key={p.id} role="tab" aria-selected={p.id === page.id} className={p.id === page.id ? "on" : ""} onClick={() => (setStagePage(p.id), setNode(null))}>
                      {touched && <span className="tm-touched" title="Changed in this version" />}
                      {p.path === "/" ? "Home" : p.title || p.path}
                    </button>
                  );
                })}
              </div>
              {!isHead && (
                <label className="check tm-hl">
                  <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Show what's different now
                </label>
              )}
            </div>
          )}
          {doc && page ? (
            <Stage key={`${selected}:${page.id}`} doc={doc} pageId={page.id} diff={!isHead && highlight ? diff : undefined} selected={node} onPick={setNode} />
          ) : (
            <div className="tm-loading" aria-hidden="true" />
          )}
          {!isHead && highlight && diff && (
            <div className="tm-legend">
              <span>
                <i className="hl-changed" /> {diff.changed.length} changed since
              </span>
              <span>
                <i className="hl-removed" /> {diff.removed.length} no longer there
              </span>
              <span>
                <i className="hl-added" /> {diff.added.length} added since
              </span>
              {diff.pagesAdded.length + diff.pagesRemoved.length > 0 && (
                <span className="muted">
                  Pages: {[...diff.pagesRemoved.map((p) => `${p} removed since`), ...diff.pagesAdded.map((p) => `${p} added since`)].join(", ")}
                </span>
              )}
            </div>
          )}
        </section>

        <aside className="tm-detail" aria-label="This version">
          {info ? (
            <>
              <div className="tm-dhead">
                {current && <Badge v={current} />}
                <h2>{info.label ?? info.message}</h2>
                <p className="muted">
                  {who({ actor: info.actor, actorRole: current?.actorRole })} · {longWhen(info.createdAt)}
                </p>
                {info.label && <p className="muted small">{info.message}</p>}
              </div>

              {current?.changes && (
                <div className="tm-changes">
                  <div className="tm-counts">
                    <span className="c-add">+{current.changes.added}</span>
                    <span className="c-chg">~{current.changes.changed}</span>
                    <span className="c-del">−{current.changes.removed}</span>
                    <span className="muted small">elements</span>
                  </div>
                  <ul>
                    {current.changes.pages.map((p) => (
                      <li key={p.id}>
                        <button className="link-btn" onClick={() => setStagePage(p.id)}>
                          {p.path === "/" ? "Home" : p.title || p.path}
                        </button>
                        <span className="muted small">
                          {p.status === "added" ? "new page" : p.status === "removed" ? "page removed" : [p.added && `${p.added} added`, p.changed && `${p.changed} changed`, p.removed && `${p.removed} removed`].filter(Boolean).join(", ") || "page settings"}
                        </span>
                      </li>
                    ))}
                    {current.changes.theme && <li>Theme colors, fonts or corners</li>}
                    {current.changes.components && <li>Shared components</li>}
                    {current.changes.settings && <li>Site settings or brand</li>}
                    {current.changes.content.map((c) => (
                      <li key={c} className="muted small">
                        {c.replace(/^[~+-] /, "")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isHead ? (
                <p className="tm-hint muted small">{sameAsNow && !(flat[0] && selected === flat[0].id && filter === "all") ? "This version is the same as the site today." : "This is the current version."} Pick an earlier one on the left to look at it, compare it, or bring parts of it back.</p>
              ) : (
                props.canWrite && (
                  <div className="tm-actions">
                    {page && (
                      <button className="btn primary" disabled={busy} onClick={() => void act(() => Sites.restore(siteId, branch, selected!, { pageId: page.id }), `Restored ${page.path === "/" ? "Home" : page.path} from this version`)}>
                        <Icon name="undo" size={13} /> Restore {page.path === "/" ? "Home" : page.title || page.path} only
                      </button>
                    )}
                    <button
                      className="btn"
                      disabled={busy || !node || node === page?.root.id}
                      title={node ? undefined : "Click a section on the stage first"}
                      onClick={() => void act(() => Sites.restore(siteId, branch, selected!, { nodeId: node! }), "Brought that section back into today's version")}
                    >
                      <Icon name="copy" size={13} /> {node && node !== page?.root.id ? "Bring this section into today's version" : "Click a section to bring it back"}
                    </button>
                    {confirmAll ? (
                      <div className="tm-confirm">
                        <span className="small">Every page, the theme and the CMS go back to this version. It's saved as a new version, so you can undo it.</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn sm danger" disabled={busy} onClick={() => void act(() => Sites.restore(siteId, branch, selected!), "Restored the whole site to this version")}>
                            Restore everything
                          </button>
                          <button className="btn sm ghost" onClick={() => setConfirmAll(false)}>
                            Keep
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn ghost" onClick={() => setConfirmAll(true)}>
                        Restore the whole site…
                      </button>
                    )}
                  </div>
                )
              )}

              {deployment && !deployment.current && props.canShip && (
                <button className="btn agent-outline" disabled={busy} onClick={() => void act(() => Sites.rollback(siteId, deployment.id), "That published version is live again")}>
                  <Icon name="external" size={13} /> Make this published version live again
                </button>
              )}

              {props.canName && current && (
                <form
                  className="tm-name"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void History.name(siteId, current.id, name.trim() || null)
                      .then(() => {
                        props.toast(name.trim() ? `Named "${name.trim()}"` : "Name removed");
                        setVersions((vs) => vs?.map((v) => (v.id === current.id ? { ...v, label: name.trim() || null } : v)) ?? vs);
                      })
                      .catch((err) => props.toast(err.message, "error"));
                  }}
                >
                  <label className="small muted" htmlFor="tm-name">
                    Name this version
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input id="tm-name" className="input" placeholder="e.g. Before the rebrand" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                    <button className="btn sm" disabled={name.trim() === (current.label ?? "")}>
                      {current.label && !name.trim() ? "Remove" : "Save"}
                    </button>
                  </div>
                  <span className="muted small">Named versions are easy to find and are always kept.</span>
                </form>
              )}
            </>
          ) : (
            <div className="tm-loading small" />
          )}
        </aside>
      </div>
    </div>
  );
}

/** One page of a version, drawn at full size and scaled to fit, with changes outlined. Click to pick a section. */
function Stage(props: { doc: SiteDocument; pageId: string; diff?: Compare; selected: string | null; onPick: (id: string | null) => void }) {
  const { doc, pageId, diff, selected, onPick } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(800);
  const page = doc.pages.find((p) => p.id === pageId)!;
  const html = useMemo(() => {
    const sel = (ids: string[]) => ids.map((id) => `[data-node-id="${id.replace(/"/g, "")}"]`).join(",");
    const css = [
      "[data-node-id]{cursor:pointer}",
      "[data-node-id]:hover{outline:1px solid rgba(91,140,255,.7);outline-offset:-1px}",
      diff?.changed.length ? `${sel(diff.changed)}{outline:2px solid #f5b94a!important;outline-offset:2px;background-image:linear-gradient(rgba(245,185,74,.06),rgba(245,185,74,.06))}` : "",
      diff?.removed.length ? `${sel(diff.removed)}{outline:2px dashed #ff8a80!important;outline-offset:2px;background-image:linear-gradient(rgba(255,138,128,.08),rgba(255,138,128,.08))}` : "",
    ].join("");
    return renderPage(doc, page, { mode: "editor" }).replace("</head>", `<style>${css}</style><style id="sc-pick"></style></head>`);
  }, [doc, page, diff]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 2) / 1200)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The picked section, outlined in blue.
  useEffect(() => {
    const d = frame.current?.contentDocument;
    const st = d?.getElementById("sc-pick");
    if (st) st.textContent = selected ? `[data-node-id="${selected.replace(/"/g, "")}"]{outline:2px solid #5b8cff!important;outline-offset:2px;box-shadow:0 0 0 6px rgba(91,140,255,.18)}` : "";
  }, [selected, html]);

  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const measure = () => setHeight(Math.max(600, d.documentElement.scrollHeight));
    measure();
    setTimeout(measure, 300);
    d.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        const n = (e.target as Element).closest?.("[data-node-id]");
        onPick(n?.getAttribute("data-node-id") ?? null);
      },
      true,
    );
    const st = d.getElementById("sc-pick");
    if (st && selected) st.textContent = `[data-node-id="${selected}"]{outline:2px solid #5b8cff!important;outline-offset:2px}`;
  };

  return (
    <div className="tm-canvas" ref={wrap}>
      <div className="tm-frame" style={{ height: height * scale, width: 1200 * scale }}>
        <iframe ref={frame} title="Version preview" sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} style={{ width: 1200, height, transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}
