import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, Approvals, audienceLabel, cap, Reviews, Sites, type ApprovalInfo, type Me, type Review, type ReviewDetail, type ReviewEvent } from "../api";
import { ago, initials } from "../format";
import { navigate } from "../router";
import { refreshShared, useShared } from "../store";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";
import { editorHref, go, PageHead, Pill, siteUrl } from "./Shell";
import { dueLabel, WorkRow } from "./Work";

/**
 * MLR review: ask for review of a branch, sign off by discipline with an
 * electronic signature, send it back with a reason, and see every step.
 */

const STATUS: Record<Review["status"], { label: string; tone: "human" | "ok" | "danger" | "muted" | "agent" }> = {
  open: { label: "Waiting for review", tone: "human" },
  approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes requested", tone: "danger" },
  merged: { label: "Merged", tone: "muted" },
  withdrawn: { label: "Withdrawn", tone: "muted" },
};

/** With no sign-off required, an "approved" review is simply ready to merge. */
const statusOf = (r: Review) => (r.status === "approved" && !r.approvals?.required ? { label: "Ready to merge", tone: "ok" as const } : STATUS[r.status]);

/** Who did it, in words: Claude, or the person. */
const who = (name: string, role: string) => (role === "agent" ? "Claude" : name);

function useEsc(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
}

// ── Dialogs ─────────────────────────────────────────────────────────────

export function RequestReviewDialog({ siteId, branch, jobCode, onClose, onDone }: { siteId: string; branch: string; jobCode?: string | null; onClose: () => void; onDone: (r: Review) => void }) {
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(jobCode ?? "");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEsc(onClose);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await Reviews.request(siteId, branch, { title: title.trim(), jobCode: code.trim() || undefined, dueAt: due ? new Date(due).toISOString() : undefined, note: note.trim() || undefined });
      toast({ text: "Sent for review. Reviewers see it in My work." });
      void refreshShared();
      onDone(r);
    } catch (err) {
      const existing = err instanceof ApiError && err.status === 409 ? (err.data.reviewId as string | undefined) : undefined;
      if (existing) navigate(`/reviews/${existing}`);
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby="rr-title" onSubmit={submit}>
        <header>
          <h2 id="rr-title">Request MLR review</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className="muted small" style={{ margin: 0 }}>
          Reviewers sign off on the branch <span className="mono">{branch}</span> as it is now. If it changes, their sign-off is needed again.
        </p>
        <label className="field-stack">
          <span className="small muted">What's being reviewed</span>
          <input className="input" autoFocus required placeholder="e.g. Updated efficacy claims" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row2">
          <label className="field-stack">
            <span className="small muted">Job code</span>
            <input className="input mono" placeholder="US-CAL-2400123" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="field-stack">
            <span className="small muted">Review by</span>
            <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label className="field-stack">
          <span className="small muted">Note for reviewers</span>
          <textarea className="textarea" rows={3} placeholder="What changed and why; references for any claims" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <footer>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim() || busy}>
            {busy ? "Sending…" : "Send for review"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Approve, as an electronic signature when the site needs MLR sign-off. */
export function SignDialog({ siteId, branch, me, info, onClose, onDone }: { siteId: string; branch: string; me: Me; info: ApprovalInfo; onClose: () => void; onDone: () => void }) {
  const choices = info.myDisciplines.length ? [...info.myDisciplines].sort((a, b) => Number(info.missing.includes(b)) - Number(info.missing.includes(a))) : [];
  const [discipline, setDiscipline] = useState(choices[0] ?? "");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEsc(onClose);
  const sign = info.needsSignature;
  const meaning = discipline ? `Approved in ${discipline} review` : "Approved";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await Approvals.approve(siteId, branch, { note: note.trim() || undefined, discipline: discipline || undefined, signature: sign ? { name: name.trim(), token: token.trim() || undefined } : undefined });
      toast({ text: sign ? `Signed: ${meaning}` : "Approved" });
      void refreshShared();
      onDone();
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal form-modal sign" role="dialog" aria-modal="true" aria-labelledby="sign-title" onSubmit={submit}>
        <header>
          <h2 id="sign-title">{sign ? "Approve and sign" : "Approve"}</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {choices.length > 0 && (
          <fieldset className="field-stack">
            <legend className="small muted">Signing for</legend>
            <div className="seg" role="radiogroup" aria-label="Discipline">
              {choices.map((d) => (
                <button type="button" key={d} role="radio" aria-checked={discipline === d} aria-pressed={discipline === d} onClick={() => setDiscipline(d)}>
                  {cap(d)} {info.missing.includes(d) ? "" : "(done)"}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label className="field-stack">
          <span className="small muted">Comment (optional)</span>
          <textarea className="textarea" rows={2} placeholder="e.g. Claims match the approved label" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {sign && (
          <>
            <div className="sign-box">
              <span className="small muted">You're signing</span>
              <strong>{meaning}</strong>
              <span className="small muted">
                Branch <span className="mono">{branch}</span>, version {info.versionId}. Your name, the time and a fingerprint of exactly this version are recorded in the audit trail.
              </span>
            </div>
            <label className="field-stack">
              <span className="small muted">Type your full name ({me.name})</span>
              <input className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your full name" />
            </label>
            {info.signInWithToken && (
              <label className="field-stack">
                <span className="small muted">Your Sitecraft sign-in token, again</span>
                <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Sign-in token" />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I reviewed this content and approve it. This electronic signature is the same as my handwritten one.</span>
            </label>
          </>
        )}
        <footer>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (sign && (!agree || name.trim().toLowerCase() !== me.name.toLowerCase() || (info.signInWithToken && !token.trim())))}>
            <Icon name="pen" size={13} /> {busy ? "Signing…" : sign ? "Sign" : "Approve"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ChangesDialog({ review, me, onClose, onDone }: { review: Review; me: Me; onClose: () => void; onDone: () => void }) {
  const mine = (me.disciplines ?? []).filter((d) => review.approvals?.disciplines.includes(d));
  const [discipline, setDiscipline] = useState(mine[0] ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEsc(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ch-title"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await Reviews.changes(review.id, reason.trim(), discipline || undefined);
            toast({ text: "Sent back to the author with your reason" });
            void refreshShared();
            onDone();
          } catch (err) {
            toast({ text: (err as Error).message, tone: "error" });
            setBusy(false);
          }
        }}
      >
        <header>
          <h2 id="ch-title">Ask for changes</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {mine.length > 1 && (
          <div className="seg" role="group" aria-label="Discipline">
            {mine.map((d) => (
              <button type="button" key={d} aria-pressed={discipline === d} onClick={() => setDiscipline(d)}>
                {cap(d)}
              </button>
            ))}
          </div>
        )}
        <label className="field-stack">
          <span className="small muted">What needs to change, and why</span>
          <textarea className="textarea" rows={4} autoFocus required placeholder="e.g. Add the fair balance statement under the efficacy chart" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <span className="muted small">The branch can't be merged until the author makes changes and sends it again. Your reason is kept in the review and the audit trail.</span>
        <footer>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" disabled={!reason.trim() || busy}>
            Send back
          </button>
        </footer>
      </form>
    </div>
  );
}

// ── Sign-off panel (review screen and the editor's review drawer) ─────────

export function SignOff({ info, compact }: { info: ApprovalInfo; compact?: boolean }) {
  const rows = info.disciplines.length
    ? info.disciplines.map((d) => ({ key: d, label: cap(d), a: info.approvals.find((x) => x.discipline === d) }))
    : Array.from({ length: Math.max(info.required, info.approvals.length) }, (_, i) => ({ key: String(i), label: `Approval ${i + 1}`, a: info.approvals[i] }));
  if (!rows.length) return <span className="muted small">No approvals needed for this site. A person still merges.</span>;
  return (
    <ul className={`signoff ${compact ? "compact" : ""}`}>
      {rows.map((r) => (
        <li key={r.key} className={r.a ? "done" : ""}>
          <span className="so-ic" aria-hidden="true">
            <Icon name={r.a ? "check" : "clock"} size={12} />
          </span>
          <span className="grow">
            <strong>{r.label}</strong>
            <span className="muted small">{r.a ? `${r.a.approver}${r.a.signed ? " · signed" : ""} · ${ago(r.a.at)}${r.a.note ? ` · “${r.a.note}”` : ""}` : "Waiting"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Everything about approving one branch, for the editor's review drawer. */
export function BranchSignOff({ siteId, branch, me, refreshKey, onChanged }: { siteId: string; branch: string; me: Me; refreshKey?: number; onChanged?: () => void }) {
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [signing, setSigning] = useState(false);
  const [asking, setAsking] = useState(false);
  const toast = useToast();
  const load = useCallback(() => {
    Approvals.get(siteId, branch)
      .then(setInfo)
      .catch(() => {});
    Reviews.list({ siteId })
      .then((l) => setReview(l.find((r) => r.branch === branch) ?? null))
      .catch(() => setReview(null));
  }, [siteId, branch]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [load, refreshKey]);
  if (!info || branch === "main") return null;
  const done = () => (setSigning(false), load(), onChanged?.());
  return (
    <section className={`approvals ${info.met ? "met" : ""}`} aria-label="Approvals">
      <h3 style={{ margin: 0, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        {info.disciplines.length ? "MLR sign-off" : "Approvals"}
        {info.required > 0 && (
          <span className="badge">
            {info.approvals.length} of {info.required}
          </span>
        )}
        {review && <Pill tone={statusOf(review).tone}>{statusOf(review).label}</Pill>}
      </h3>
      <SignOff info={info} compact />
      {info.changesRequested && <div className="callout danger small">A reviewer asked for changes. Make them, then send the branch for review again.</div>}
      {!info.met && info.required > 0 && <span className="muted small">Sign-off counts for this version of the branch; a new change needs it again.</span>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {review === null && me.role !== undefined && (
          <button className="btn sm" onClick={() => setAsking(true)}>
            <Icon name="shield" size={13} /> Request MLR review
          </button>
        )}
        {review && (
          <a className="btn sm ghost" href={`/reviews/${review.id}`} onClick={go(`/reviews/${review.id}`)}>
            Open the review
          </a>
        )}
        {review?.status === "changes_requested" && (
          <button className="btn sm" onClick={() => void Reviews.resubmit(review.id).then(() => (toast({ text: "Sent for review again" }), load()), (e) => toast({ text: e.message, tone: "error" }))}>
            Send for review again
          </button>
        )}
        {info.canApprove && (
          <button className="btn sm primary" onClick={() => setSigning(true)}>
            <Icon name={info.needsSignature ? "pen" : "check"} size={13} /> {info.needsSignature ? "Approve and sign" : "Approve"}
          </button>
        )}
        {info.approvedByMe && (
          <button className="btn sm ghost" onClick={async () => (await Approvals.withdraw(siteId, branch).catch(() => {}), load())}>
            Withdraw my approval
          </button>
        )}
        {!info.canApprove && !info.approvedByMe && info.reason && <span className="muted small">{info.reason}</span>}
      </div>
      {signing && <SignDialog siteId={siteId} branch={branch} me={me} info={info} onClose={() => setSigning(false)} onDone={done} />}
      {asking && <RequestReviewDialog siteId={siteId} branch={branch} onClose={() => setAsking(false)} onDone={() => (setAsking(false), load())} />}
    </section>
  );
}

// ── Reviews inbox ───────────────────────────────────────────────────────

const TABS = [
  ["mine", "Waiting for me"],
  ["open", "All open"],
  ["claude", "Drafted by Claude"],
  ["back", "Sent back"],
  ["closed", "Closed"],
] as const;
type Tab = (typeof TABS)[number][0];

function DisciplineDots({ r }: { r: Review }) {
  if (!r.approvals) return null;
  const a = r.approvals;
  if (!a.disciplines.length) return <span className="muted small">{a.required ? `${a.have} of ${a.required} approvals` : "No approvals needed"}</span>;
  return (
    <span className="ddots" aria-label={`Sign-off: ${a.disciplines.map((d) => `${d} ${a.missing.includes(d) ? "waiting" : "done"}`).join(", ")}`}>
      {a.disciplines.map((d) => (
        <span key={d} className={a.missing.includes(d) ? "" : "done"} title={`${cap(d)}: ${a.missing.includes(d) ? "waiting" : "signed"}`}>
          {a.missing.includes(d) ? <Icon name="clock" size={10} /> : <Icon name="check" size={10} />}
          {d.charAt(0).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function ReviewRow({ r, showSite = true }: { r: Review; showSite?: boolean }) {
  const st = statusOf(r);
  const href = `/reviews/${r.id}`;
  return (
    <li className="rv-row">
      <span className={`wq-ic t-${r.byClaude ? "agent" : "human"}`} aria-hidden="true">
        <Icon name={r.byClaude ? "sparkle" : "shield"} size={15} />
      </span>
      <a className="grow wq-main" href={href} onClick={go(href)}>
        <strong>
          {r.title}
          {r.byClaude && <Pill tone="agent">Claude drafted</Pill>}
        </strong>
        <span className="muted small">
          {[showSite ? [r.brand, r.market, audienceLabel(r.audience)].filter(Boolean).join(" / ") || r.siteName : null, r.jobCode, r.branch].filter(Boolean).join(" · ")}
        </span>
      </a>
      <DisciplineDots r={r} />
      <span className="wq-side">
        {r.dueAt && !["merged", "withdrawn"].includes(r.status) && <span className={`wq-due ${/^(Today|Overdue)/.test(dueLabel(r.dueAt)) ? "soon" : ""}`}>{dueLabel(r.dueAt)}</span>}
        <Pill tone={st.tone}>{st.label}</Pill>
      </span>
      <span className="rv-by small muted" title={`Requested by ${who(r.requestedBy, r.requestedByRole)}`}>
        <span className={`tm-avatar ${r.requestedByRole === "agent" ? "agent" : ""}`} aria-hidden="true">
          {r.requestedByRole === "agent" ? "C" : initials(r.requestedBy)}
        </span>
      </span>
    </li>
  );
}

export function ReviewsPage({ me, siteId }: { me: Me; siteId?: string }) {
  const { work } = useShared();
  const [open, setOpen] = useState<Review[] | null>(null);
  const [closed, setClosed] = useState<Review[] | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const s = new URLSearchParams(location.search).get("show");
    return (TABS.find(([k]) => k === s)?.[0] ?? (me.role === "agent" ? "open" : "mine")) as Tab;
  });
  const toast = useToast();
  useEffect(() => {
    Reviews.list({ siteId })
      .then(setOpen)
      .catch((e) => (toast({ text: e.message, tone: "error" }), setOpen([])));
  }, [siteId, toast]);
  useEffect(() => {
    if (tab === "closed" && !closed) Reviews.list({ siteId, status: "closed" }).then(setClosed, () => setClosed([]));
  }, [tab, closed, siteId]);

  const claudeBranches = (work?.items ?? []).filter((i) => i.kind === "claude" && (!siteId || i.siteId === siteId));
  const list = useMemo(() => {
    const o = open ?? [];
    if (tab === "mine") return o.filter((r) => r.canReview);
    if (tab === "claude") return o.filter((r) => r.byClaude);
    if (tab === "back") return o.filter((r) => r.status === "changes_requested");
    if (tab === "closed") return closed ?? [];
    return o;
  }, [open, closed, tab]);
  const n = (t: Tab) => (open ? (t === "mine" ? open.filter((r) => r.canReview).length : t === "claude" ? open.filter((r) => r.byClaude).length + claudeBranches.length : t === "back" ? open.filter((r) => r.status === "changes_requested").length : t === "open" ? open.length : null) : null);
  const waiting = open?.filter((r) => r.status === "open").length ?? 0;
  const ready = open?.filter((r) => r.status === "approved").length ?? 0;

  return (
    <main className="page">
      <PageHead
        eyebrow={siteId ? "Site reviews" : "Governance"}
        title={siteId ? "Reviews" : "MLR reviews"}
        sub="Medical, legal and regulatory decisions stay with the people named for them. Claude drafts and asks for review; it never approves."
      />
      <div className="stats small-stats">
        <div className="stat t-human">
          <span className="stat-top">Waiting for review</span>
          <strong className="stat-num">{open ? waiting : "–"}</strong>
        </div>
        <div className="stat t-danger">
          <span className="stat-top">Sent back</span>
          <strong className="stat-num">{n("back") ?? "–"}</strong>
        </div>
        <div className="stat t-ok">
          <span className="stat-top">Signed off, ready to merge</span>
          <strong className="stat-num">{open ? ready : "–"}</strong>
        </div>
        <div className="stat t-agent">
          <span className="stat-top">From Claude</span>
          <strong className="stat-num">{n("claude") ?? "–"}</strong>
        </div>
      </div>
      <section className="card">
        <div className="card-head">
          <div className="tabs2" role="tablist" aria-label="Reviews">
            {TABS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {l}
                {n(k) !== null && <span className="seg-n">{n(k)}</span>}
              </button>
            ))}
          </div>
          <span className="grow" />
          <span className="muted small">Every decision is kept in the audit trail</span>
        </div>
        <div className="card-body">
          {open === null && <div className="tm-loading small" />}
          {open && list.length === 0 && !(tab === "claude" && claudeBranches.length) && (
            <div className="empty">{tab === "mine" ? "Nothing is waiting for your sign-off." : "Nothing here."}</div>
          )}
          <ul className="wq">
            {list.map((r) => (
              <ReviewRow key={r.id} r={r} showSite={!siteId} />
            ))}
          </ul>
          {tab === "claude" && claudeBranches.length > 0 && (
            <>
              <h3 className="sub-h">Claude's branches not yet sent for review</h3>
              <ul className="wq">
                {claudeBranches.map((i) => (
                  <WorkRow key={i.id} item={i} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

// ── One review ──────────────────────────────────────────────────────────

const EVENT_TEXT: Record<ReviewEvent["action"], string> = {
  request: "asked for review",
  approve: "signed off",
  request_changes: "asked for changes",
  resubmit: "sent it for review again",
  withdraw: "withdrew the review",
  merge: "merged it into main",
};

export function ReviewDetailPage({ me, id }: { me: Me; id: string }) {
  const [r, setR] = useState<ReviewDetail | null>(null);
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [dialog, setDialog] = useState<"sign" | "changes" | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = useCallback(() => {
    Reviews.get(id)
      .then((x) => {
        setR(x);
        return Approvals.get(x.siteId, x.branch).then(setInfo);
      })
      .catch((e) => (toast({ text: e.message, tone: "error" }), navigate("/reviews")));
  }, [id, toast]);
  useEffect(load, [load]);
  if (!r) return <main className="page"><div className="tm-loading" /></main>;

  const st = statusOf(r);
  const active = r.status === "open" || r.status === "changes_requested" || r.status === "approved";
  const isAuthor = r.authors.includes(me.name) || r.requestedBy === me.name;
  const person = me.role !== "agent";
  const editor = editorHref(r.siteId, { branch: r.branch, review: "1" });
  const merge = async () => {
    setBusy(true);
    try {
      await Sites.merge(r.siteId, r.branch);
      toast({ text: `Merged ${r.branch} into main. Publish or schedule it from the site.` });
      void refreshShared();
      load();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <PageHead
        eyebrow={r.byClaude ? "MLR review · drafted by Claude" : "MLR review"}
        title={
          <>
            {r.title} <Pill tone={st.tone}>{st.label}</Pill>
          </>
        }
        sub={
          <>
            <a href={siteUrl(r.siteId)} onClick={go(siteUrl(r.siteId))}>
              {r.siteName}
            </a>
            {[r.therapyArea, r.brand, r.market, audienceLabel(r.audience)].filter(Boolean).length ? ` · ${[r.therapyArea, r.brand, r.market, audienceLabel(r.audience)].filter(Boolean).join(" › ")}` : ""}
            {" · "}
            <span className="mono">{r.branch}</span>
            {r.jobCode ? ` · ${r.jobCode}` : ""}
            {r.dueAt && active ? ` · review by ${dueLabel(r.dueAt)}` : ""}
          </>
        }
        actions={
          <>
            <a className="btn" href={editor} onClick={go(editor)}>
              <Icon name="eye" size={14} /> Open in editor
            </a>
            {person && r.status === "open" && !isAuthor && (
              <button className="btn" onClick={() => setDialog("changes")}>
                <Icon name="alert" size={14} /> Ask for changes
              </button>
            )}
            {r.status === "changes_requested" && (isAuthor || me.role === "agent") && (
              <button className="btn" onClick={() => void Reviews.resubmit(r.id).then(() => (toast({ text: "Sent for review again" }), void refreshShared(), load()), (e) => toast({ text: e.message, tone: "error" }))}>
                Send for review again
              </button>
            )}
            {info?.canApprove && r.status !== "changes_requested" && active && (
              <button className="btn primary" onClick={() => setDialog("sign")}>
                <Icon name="pen" size={14} /> {info.needsSignature ? "Approve and sign" : "Approve"}
              </button>
            )}
            {r.status === "approved" && person && (me.agentCanPublish || me.role !== "agent") && (
              <button className="btn primary" disabled={busy} onClick={() => void merge()}>
                Merge into main
              </button>
            )}
          </>
        }
      />

      <div className="cols">
        <div className="stack">
          {r.note && (
            <section className="card">
              <div className="card-head">
                <h2>
                  Note from {who(r.requestedBy, r.requestedByRole)}
                </h2>
              </div>
              <div className="card-body">
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.note}</p>
              </div>
            </section>
          )}
          <section className="card" aria-labelledby="rv-changes">
            <div className="card-head">
              <div className="grow">
                <h2 id="rv-changes">What changed</h2>
                <span className="muted small">Compared with main when the branch started</span>
              </div>
              <a className="small" href={editor} onClick={go(editor)}>
                See it on the canvas <Icon name="arrow" size={12} />
              </a>
            </div>
            <div className="card-body">
              {!r.changes && <div className="empty">No changes to show.</div>}
              {r.changes && (
                <>
                  <div className="rv-counts">
                    <span>
                      <strong>{r.changes.added}</strong> added
                    </span>
                    <span>
                      <strong>{r.changes.changed}</strong> changed
                    </span>
                    <span>
                      <strong>{r.changes.removed}</strong> removed
                    </span>
                    <span className="muted">
                      on {r.changes.pages.length} {r.changes.pages.length === 1 ? "page" : "pages"}: {r.changes.pages.map((p) => (p.path === "/" ? "Home" : p.title || p.path)).join(", ") || "none"}
                    </span>
                  </div>
                  <div className="diff-lines">
                    {r.changes.summary.map((line, i) => (
                      <div key={i} className={`diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "chg"}`}>
                        {line}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="rv-sign">
            <div className="card-head">
              <div className="grow">
                <h2 id="rv-sign">Sign-off</h2>
                <span className="muted small">{info?.disciplines.length ? "Each discipline signs this version" : "Approvals of this version"}</span>
              </div>
              {info && info.required > 0 && (
                <span className="badge">
                  {info.approvals.length} of {info.required}
                </span>
              )}
            </div>
            <div className="card-body">
              {info && <SignOff info={info} />}
              {info && !info.canApprove && info.reason && r.status === "open" && <p className="muted small">{info.reason}</p>}
              {r.authors.length > 0 && (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Changed by {r.authors.map((a) => (/agent/i.test(a) && !/claude/i.test(a) ? `${a} (Claude)` : a)).join(", ")}. They can't sign off their own work.
                </p>
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="rv-trail">
            <div className="card-head">
              <h2 id="rv-trail">Review trail</h2>
            </div>
            <div className="card-body">
              <ol className="trail">
                {r.events.map((e) => (
                  <li key={e.id} className={`ev-${e.action}`}>
                    <span className={`tm-avatar ${e.role === "agent" ? "agent" : ""}`} aria-hidden="true">
                      {e.role === "agent" ? "C" : initials(e.actor)}
                    </span>
                    <span className="grow">
                      <span>
                        <strong>{who(e.actor, e.role)}</strong> {EVENT_TEXT[e.action] ?? e.action}
                        {e.discipline ? ` (${e.discipline})` : ""}
                      </span>
                      {e.reason && <span className="trail-reason">{e.reason}</span>}
                      <span className="muted small">
                        {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {e.versionId ? ` · version ${e.versionId}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              {active && (r.requestedBy === me.name || me.role === "admin") && (
                <button className="btn ghost sm" onClick={() => void Reviews.withdraw(r.id).then(() => (toast({ text: "Review withdrawn" }), load()), (e) => toast({ text: e.message, tone: "error" }))}>
                  Withdraw review
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      {dialog === "sign" && info && <SignDialog siteId={r.siteId} branch={r.branch} me={me} info={info} onClose={() => setDialog(null)} onDone={() => (setDialog(null), load())} />}
      {dialog === "changes" && <ChangesDialog review={r} me={me} onClose={() => setDialog(null)} onDone={() => (setDialog(null), load())} />}
    </main>
  );
}
