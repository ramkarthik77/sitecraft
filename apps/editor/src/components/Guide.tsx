import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Library, Templates, Tokens, type Me, type SiteSummary } from "../api";
import { navigate } from "../router";
import { useShared } from "../store";
import { Icon } from "./Icon";

/**
 * Getting started: a short guided tour that points at each part of the app,
 * different for editors, reviewers and admins, and a checklist on Home that
 * ticks itself off as people do the real things.
 */

interface Step {
  target: string;
  title: string;
  body: string;
}

const COMMON: Record<string, Step> = {
  home: { target: "nav:/", title: "Home", body: "Your command center: what needs you today across every site, and what goes live this week." },
  work: { target: "nav:/work", title: "My work", body: "Everything waiting for your decision, soonest first: reviews, sent-back changes, Claude's drafts, releases and expiring assets." },
  sites: { target: "nav:/sites", title: "Sites", body: "Every site, in folders like a content tree (therapy area › brand › market), with filters. Open a site and the sidebar becomes that site's." },
  reviews: { target: "nav:/reviews", title: "Reviews", body: "MLR review. Medical, legal and regulatory reviewers sign off each change here; Claude's drafts are in their own tab." },
  releases: { target: "nav:/releases", title: "Releases", body: "What goes live when, across all sites, and whether each release is ready or blocked." },
  assets: { target: "nav:/assets", title: "Assets", body: "The shared image library, in folders. Each image has a job code, the markets it's cleared for and when its rights end." },
  templates: { target: "nav:/templates", title: "Templates", body: "Approved starting points for new sites. Make one from scratch, or save any site as a template." },
  audit: { target: "nav:/audit", title: "Audit log", body: "Every action by people and Claude, chained so tampering shows. Search it by person, site or job code." },
  settings: { target: "nav:/settings", title: "Settings", body: "Turn on MLR sign-off and job codes per site, and choose who reviews for each discipline." },
  access: { target: "nav:/access", title: "Access", body: "Give people sign-ins and Claude tokens. Set who each Claude works for, so they can't approve its changes." },
  search: { target: "search", title: "Find anything", body: "Jump to any site, page or action. Press ⌘K (Ctrl K) from anywhere, even in the editor." },
  bell: { target: "bell", title: "Notifications", body: "Review requests, sign-offs, merges and releases on your sites, as they happen." },
  claude: { target: "claude", title: "Work with Claude", body: "Connect Claude Code. Claude drafts changes on its own branches; people review, sign and publish." },
  help: { target: "help", title: "Help is here", body: "Take this tour again, or open the getting-started checklist, any time." },
};

export function tourFor(me: Me): Step[] {
  const c = COMMON;
  if (me.role === "admin") return [c.home, c.sites, c.templates, c.assets, c.settings, c.access, c.audit, c.search, c.claude, c.help].filter(Boolean) as Step[];
  if (me.disciplines?.length) return [c.home, c.work, c.reviews, c.releases, c.audit, c.bell, c.search, c.help] as Step[];
  return [c.home, c.work, c.sites, c.templates, c.assets, c.releases, c.search, c.claude, c.help] as Step[];
}

// Who has seen the tour, per person, in this browser.
const KEY = (me: Me) => `sitecraft.tour.${me.name}`;
const seen = (me: Me) => {
  try {
    return localStorage.getItem(KEY(me)) === "done";
  } catch {
    return true;
  }
};
const markSeen = (me: Me) => {
  try {
    localStorage.setItem(KEY(me), "done");
  } catch {
    /* storage may be unavailable */
  }
};

let tourOpen = false;
const subs = new Set<() => void>();
export function startTour() {
  tourOpen = true;
  subs.forEach((f) => f());
}
const stopTour = () => {
  tourOpen = false;
  subs.forEach((f) => f());
};
const useTourOpen = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => tourOpen);

/** The tour itself: a spotlight on one part of the screen at a time. */
export function Tour({ me }: { me: Me }) {
  const open = useTourOpen();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const steps = tourFor(me).filter((s) => !!document.querySelector(`[data-tour="${s.target}"]`) || !open);
  const step = steps[i];

  // First visit: start on its own once the sidebar is there.
  useEffect(() => {
    // Not for Claude, and not while a browser is being driven by tests.
    if (seen(me) || me.role === "agent" || navigator.webdriver) return;
    const t = setTimeout(() => document.querySelector('[data-tour="nav:/"]') && startTour(), 900);
    return () => clearTimeout(t);
  }, [me]);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const measure = useCallback(() => {
    const el = step ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    if (!el) return setBox(null);
    el.scrollIntoView({ block: "nearest" });
    setBox(el.getBoundingClientRect());
  }, [step]);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [open, measure]);

  const close = useCallback(() => {
    markSeen(me);
    stopTour();
  }, [me]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, close, steps.length]);

  if (!open || !step) return null;
  const pad = 6;
  const r = box ?? new DOMRect(innerWidth / 2 - 100, innerHeight / 2 - 30, 200, 60);
  // Put the card beside the target: to the right of sidebar items, below top-bar items.
  const right = r.left < 300;
  const cardStyle: React.CSSProperties = right
    ? { left: r.right + 18, top: Math.max(16, Math.min(r.top - 10, innerHeight - 240)) }
    : { top: r.bottom + 14, left: Math.max(16, Math.min(r.right - 360, innerWidth - 376)) };
  const last = i === steps.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-shade" onClick={close} />
      <div className="tour-spot" style={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }} />
      <div className={`tour-card ${right ? "at-right" : "below"}`} style={cardStyle}>
        <span className="tour-step">
          {i + 1} of {steps.length}
        </span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, n) => (
            <span key={n} className={n === i ? "on" : n < i ? "done" : ""} />
          ))}
        </div>
        <footer>
          <button className="btn ghost sm" onClick={close}>
            Skip tour
          </button>
          <span className="grow" />
          {i > 0 && (
            <button className="btn sm" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn sm primary" autoFocus onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "Finish" : "Next"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The ? in the top bar. */
export function HelpMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest(".help") && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [open]);
  void me;
  return (
    <div className="help bell">
      <button className="tb-btn" data-tour="help" aria-label="Help" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" style={{ fontWeight: 700 }}>
          ?
        </span>
      </button>
      {open && (
        <div className="bell-pop help-pop" role="menu" aria-label="Help">
          <button role="menuitem" onClick={() => (setOpen(false), navigate("/"), setTimeout(startTour, 300))}>
            <Icon name="sparkle" size={14} /> Take the tour
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              showChecklist();
              navigate("/");
            }}
          >
            <Icon name="check" size={14} /> Getting started checklist
          </button>
          <a role="menuitem" href="https://github.com/ramkarthik77/sitecraft/blob/main/docs/GOVERNANCE.md" target="_blank" rel="noreferrer">
            <Icon name="shield" size={14} /> Governance guide <Icon name="external" size={11} />
          </a>
          <a role="menuitem" href="https://github.com/ramkarthik77/sitecraft/blob/main/docs/AUTHORING.md" target="_blank" rel="noreferrer">
            <Icon name="pages" size={14} /> Authoring guide <Icon name="external" size={11} />
          </a>
        </div>
      )}
    </div>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────

const HIDE = (me: Me) => `sitecraft.checklist.${me.name}`;
let checklistBump = 0;
const listSubs = new Set<() => void>();
function showChecklist() {
  checklistBump++;
  listSubs.forEach((f) => f());
}

interface Item {
  key: string;
  title: string;
  why: string;
  done: boolean;
  action?: { label: string; href?: string; run?: () => void };
}

/** On Home: the first things to do, ticked off from what's really been done. */
export function Checklist({ me, onCreate, onConnect }: { me: Me; onCreate: () => void; onConnect: () => void }) {
  const { sites, work } = useShared();
  const bump = useSyncExternalStore((f) => (listSubs.add(f), () => void listSubs.delete(f)), () => checklistBump);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE(me)) === "1";
    } catch {
      return false;
    }
  });
  const [extra, setExtra] = useState<{ templates: number; assets: number; reviewers: number } | null>(null);
  useEffect(() => {
    if (bump) setHidden(false);
  }, [bump]);
  useEffect(() => {
    Promise.all([
      Templates.list().then((l) => l.length, () => 0),
      Library.list({}).then((l) => l.length, () => 0),
      me.role === "admin" ? Tokens.list().then((l) => l.filter((t) => !t.revokedAt && (t.disciplines?.length ?? 0) > 0).length, () => 0) : Promise.resolve(0),
    ]).then(([templates, assets, reviewers]) => setExtra({ templates, assets, reviewers }));
  }, [me.role]);
  if (!sites || !extra || me.role === "agent") return null;

  const any = (f: (s: SiteSummary) => boolean) => sites.some(f);
  const items: Item[] = [
    { key: "site", title: "Create your first site", why: "From a template or a starter. You can change everything later.", done: sites.length > 0, action: { label: "New site", run: onCreate } },
    { key: "file", title: "File it in the portfolio", why: "Set its therapy area, market and audience in Settings, and put it in a folder in Sites.", done: any((s) => !!s.market && !!s.folderId), action: { label: "Open Sites", href: "/sites" } },
    { key: "tpl", title: "Save a template", why: "So every new market's site starts from the approved one.", done: extra.templates > 0, action: { label: "Open Templates", href: "/templates" } },
    { key: "assets", title: "Add approved images", why: "Upload into folders, with job codes, markets and rights dates.", done: extra.assets > 0, action: { label: "Open Assets", href: "/assets" } },
    { key: "claude", title: "Connect Claude", why: "Claude drafts on branches; nothing it does goes live without a person.", done: any((s) => (s.claudeBranches ?? 0) > 0) || (work?.counts.claude ?? 0) > 0, action: { label: "Show me how", run: onConnect } },
    ...(me.role === "admin"
      ? [
          { key: "rules", title: "Turn on MLR sign-off", why: "Choose medical, legal and regulatory sign-off, and job codes, per site.", done: any((s) => (s.reviewDisciplines?.length ?? 0) > 0), action: { label: "Open Settings", href: "/settings" } },
          { key: "people", title: "Name your reviewers", why: "Give reviewers a sign-in and the disciplines they sign for.", done: extra.reviewers > 0 || !!me.local, action: { label: "Open Access", href: "/access" } },
        ]
      : []),
  ];
  const done = items.filter((x) => x.done).length;
  if (hidden || done === items.length) return null;
  const hide = () => {
    try {
      localStorage.setItem(HIDE(me), "1");
    } catch {
      /* fine */
    }
    setHidden(true);
  };

  return (
    <section className="first-run checklist" aria-labelledby="gs">
      <div className="ck-head">
        <div className="grow">
          <h2 id="gs">Get started</h2>
          <span className="muted small">
            {done} of {items.length} done · ticks itself off as you go
          </span>
        </div>
        <button className="btn sm" onClick={startTour}>
          <Icon name="sparkle" size={13} /> Take the tour
        </button>
        <button className="btn ghost sm" onClick={hide}>
          Hide
        </button>
      </div>
      <div className="ck-bar" aria-hidden="true">
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ol className="ck-list">
        {items.map((x) => (
          <li key={x.key} className={x.done ? "done" : ""}>
            <span className="ck-mark" aria-label={x.done ? "Done" : "Not done yet"}>
              {x.done && <Icon name="check" size={12} />}
            </span>
            <span className="grow">
              <strong>{x.title}</strong>
              <span className="muted small">{x.why}</span>
            </span>
            {!x.done && x.action && (
              <button className="btn sm" onClick={() => (x.action!.run ? x.action!.run() : navigate(x.action!.href!))}>
                {x.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
