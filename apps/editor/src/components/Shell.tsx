import { useEffect, useRef, useState } from "react";
import { audienceLabel, Notifications, setToken, type Me, type Notification } from "../api";
import { ago, initials } from "../format";
import { navigate } from "../router";
import { siteById, useShared } from "../store";
import { describe } from "./Activity";
import { openPalette, paletteKey } from "./CommandPalette";
import { Icon, Logo } from "./Icon";

/**
 * The frame around every screen except the page editor: a sidebar that shows
 * the organisation's areas, or one site's areas once you're inside a site,
 * and a top bar with where you are, search and notifications.
 */

export type OrgNav = "home" | "work" | "sites" | "reviews" | "releases" | "assets" | "brands" | "templates" | "components" | "audit" | "access" | "settings";
export type SiteNav = "overview" | "assets" | "reviews" | "history" | "activity" | "settings" | "branches" | "releases";
export interface Crumb {
  label: string;
  href?: string;
}

export const go = (href: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  navigate(href);
};

export const siteUrl = (id: string, part: SiteNav | "" = "overview") => `/sites/${id}/${part}`;
export const editorHref = (id: string, q: Record<string, string> = {}) => {
  const s = new URLSearchParams(q).toString();
  return `/sites/${id}${s ? `?${s}` : ""}`;
};

function NavLink({ href, icon, label, on, count, tone, title }: { href: string; icon: string; label: string; on?: boolean; count?: number; tone?: "agent" | "warn"; title?: string }) {
  return (
    <a className="sn-link" href={href} aria-current={on ? "page" : undefined} onClick={go(href)} title={title}>
      <Icon name={icon} size={15} />
      <span className="grow">{label}</span>
      {!!count && <span className={`sn-count ${tone ?? ""}`}>{count}</span>}
    </a>
  );
}

export function mcpAddress(): string {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return local ? "http://localhost:4100/mcp" : `${location.origin}/mcp`;
}
export function connectCommand(me: Me): string {
  return me.local
    ? `claude mcp add --transport http --scope user sitecraft ${mcpAddress()}`
    : `claude mcp add --transport http --scope user sitecraft ${mcpAddress()} --header "Authorization: Bearer <your Claude token>"`;
}

/** How to bring Claude in: it runs in Claude Code on your computer and connects here. */
export function ConnectClaude({ me, onClose }: { me: Me; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const cmd = connectCommand(me);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal connect" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <header>
          <span className="connect-mark" aria-hidden="true">
            <Icon name="sparkle" size={16} />
          </span>
          <h2 id="connect-title">Work with Claude</h2>
          <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className="muted">
          Claude runs in Claude Code and connects to Sitecraft. Ask it in plain words (“add a dosing page to Calvexa US HCP”) and it builds the change on its own branch for your team to review.
        </p>
        <ol className="connect-steps">
          {!me.local && (
            <li>
              <strong>Get a Claude token.</strong>
              <span className="muted">
                {me.role === "admin" ? (
                  <>
                    Create one in{" "}
                    <a href="/access" onClick={(e) => (onClose(), go("/access")(e))}>
                      Access
                    </a>{" "}
                    with the role Claude, set to work for you.
                  </>
                ) : (
                  "Ask an admin for one that works for you. Claude's changes then count as yours, so someone else approves them."
                )}
              </span>
            </li>
          )}
          <li>
            <strong>Run this once in a terminal.</strong>
            <code className="connect-cmd">{cmd}</code>
            <button
              className="btn sm agent-outline"
              onClick={() =>
                void navigator.clipboard?.writeText(cmd).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Icon name="copy" size={13} /> {copied ? "Copied" : "Copy command"}
            </button>
          </li>
          <li>
            <strong>Start Claude Code and ask for a change.</strong>
            <span className="muted">Its branches appear in Reviews and in each site's Branches, marked Claude.</span>
          </li>
        </ol>
        <ul className="rules" aria-label="What Claude can do">
          <li>
            <Icon name="check" size={13} /> Drafts changes on branches, never on main
          </li>
          <li>
            <Icon name="check" size={13} /> Asks for review, but can't approve or sign
          </li>
          <li>
            <Icon name="check" size={13} /> {me.agentCanPublish ? "This workspace lets Claude publish" : "Can't merge or publish; a person does"}
          </li>
          <li>
            <Icon name="check" size={13} /> Every edit is in the audit trail, with who it worked for
          </li>
        </ul>
      </div>
    </div>
  );
}

const NOTE_ICON: Record<string, string> = {
  "review.request": "shield",
  "review.changes": "alert",
  "review.resubmit": "shield",
  "branch.approve": "check",
  "branch.merge": "branch",
  "site.publish": "globe",
  "site.rollback": "history",
  "schedule.failed": "alert",
  "approval.override": "alert",
  "branch.create": "sparkle",
};

function noteHref(n: Notification): string {
  const d = n.detail as { reviewId?: string; branch?: string };
  if (d.reviewId) return `/reviews/${d.reviewId}`;
  if (n.siteId && n.action === "branch.create" && d.branch) return editorHref(n.siteId, { branch: d.branch, review: "1" });
  if (n.siteId) return siteUrl(n.siteId, n.action.startsWith("site.") ? "activity" : "overview");
  return "/audit";
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Notification[]; unread: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const load = () =>
    Notifications.list()
      .then(setData)
      .catch(() => setData({ items: [], unread: 0 }));
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", close);
    addEventListener("keydown", key);
    return () => (removeEventListener("mousedown", close), removeEventListener("keydown", key));
  }, [open]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) void Notifications.seen().then(() => setData((d) => (d ? { ...d, unread: 0 } : d)));
  };
  return (
    <div className="bell" ref={box}>
      <button className="tb-btn" aria-label={data?.unread ? `Notifications, ${data.unread} new` : "Notifications"} aria-expanded={open} onClick={toggle}>
        <Icon name="bell" size={15} />
        {!!data?.unread && <span className="bell-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            <span className="muted small">Last 30 days</span>
          </header>
          {data?.items.length === 0 && <div className="empty">Nothing new. Reviews, approvals and releases on your sites show up here.</div>}
          <ul>
            {data?.items.slice(0, 30).map((n) => {
              const agent = n.role === "agent";
              const text = describe({ id: n.id, at: n.at, actor: n.actor, role: n.role, action: n.action, detail: n.detail as never }).text;
              const href = noteHref(n);
              return (
                <li key={n.id} className={n.unread ? "unread" : ""}>
                  <a href={href} onClick={(e) => (setOpen(false), go(href)(e))}>
                    <span className={`bell-ic ${agent ? "agent" : ""}`} aria-hidden="true">
                      <Icon name={agent ? "sparkle" : (NOTE_ICON[n.action] ?? "activity")} size={13} />
                    </span>
                    <span className="grow">
                      <span>
                        <strong>{agent ? "Claude" : n.actor}</strong> {text}
                      </span>
                      <span className="muted small">
                        {n.siteName ? `${n.siteName} · ` : ""}
                        {ago(n.at)}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppShell({ me, org, site, crumbs, children }: { me: Me; org?: OrgNav; site?: { id: string; active: SiteNav }; crumbs: Crumb[]; children: React.ReactNode }) {
  const { work, sites } = useShared();
  const [connect, setConnect] = useState(false);
  const c = work?.counts;
  const orgName = me.orgName ?? "Sitecraft";
  const s = site ? (sites?.find((x) => x.id === site.id || x.slug === site.id) ?? siteById(site.id)) : null;
  const person = me.role !== "agent";

  return (
    <div className="app">
      <nav className="sidenav" aria-label={site ? "Site" : "Workspace"}>
        <a className="sn-brand" href="/" onClick={go("/")}>
          <Logo size={26} />
          <span>Sitecraft</span>
        </a>
        {!site ? (
          <>
            <div className="sn-org" title={orgName}>
              <span className="sn-org-mark" aria-hidden="true">
                {initials(orgName)}
              </span>
              <span className="grow">
                <strong>{orgName}</strong>
                <span>{me.local ? "Local workspace" : "Workspace"}</span>
              </span>
            </div>
            <div className="sn-group">Workspace</div>
            <NavLink href="/" icon="home" label="Home" on={org === "home"} />
            {person && <NavLink href="/work" icon="inbox" label="My work" on={org === "work"} count={c ? c.review + c.changes + c.claude : 0} />}
            <NavLink href="/sites" icon="globe" label="Sites" on={org === "sites"} />
            <NavLink href="/reviews" icon="shield" label="Reviews" on={org === "reviews"} count={c ? c.review + c.claude : 0} tone={c?.claude ? "agent" : undefined} />
            <NavLink href="/releases" icon="calendar" label="Releases" on={org === "releases"} count={c?.release} />
            <div className="sn-group">Shared libraries</div>
            <NavLink href="/assets" icon="image" label="Assets" on={org === "assets"} count={c?.asset} tone="warn" title={c?.asset ? `${c.asset} with rights expiring or expired` : undefined} />
            <NavLink href="/brands" icon="spark" label="Brands" on={org === "brands"} />
            <NavLink href="/templates" icon="pages" label="Templates" on={org === "templates"} />
            <NavLink href="/components" icon="components" label="Components" on={org === "components"} />
            {person && (
              <>
                <div className="sn-group">Administration</div>
                <NavLink href="/audit" icon="audit" label="Audit log" on={org === "audit"} />
                {me.role === "admin" && <NavLink href="/access" icon="users" label="Access" on={org === "access"} />}
                <NavLink href="/settings" icon="settings" label="Settings" on={org === "settings"} />
              </>
            )}
          </>
        ) : (
          <>
            <a className="sn-back" href="/sites" onClick={go("/sites")}>
              <Icon name="back" size={13} /> All sites
            </a>
            <button className="sn-site" onClick={() => openPalette("sites")} aria-label={`${s?.name ?? "This site"}. Switch site`}>
              <span className="sn-site-label">Site</span>
              <strong>{s?.name ?? "…"}</strong>
              <span className="muted small">{[s?.domain ?? s?.slug, s?.market, audienceLabel(s?.audience)].filter(Boolean).join(" · ") || " "}</span>
              <Icon name="chevron" size={13} style={{ position: "absolute", right: 10, top: 14 }} />
            </button>
            <div className="sn-group">Site</div>
            <NavLink href={siteUrl(site.id)} icon="home" label="Overview" on={site.active === "overview"} />
            <NavLink href={editorHref(site.id, { tab: "pages" })} icon="pages" label="Pages" title="Open the page editor" />
            <NavLink href={editorHref(site.id, { tab: "cms" })} icon="database" label="CMS" title="Open CMS content in the editor" />
            <NavLink href={siteUrl(site.id, "assets")} icon="image" label="Assets" on={site.active === "assets"} />
            <NavLink href={siteUrl(site.id, "reviews")} icon="shield" label="Reviews" on={site.active === "reviews"} count={s?.openReviews} />
            <NavLink href={siteUrl(site.id, "history")} icon="history" label="History" on={site.active === "history"} />
            <NavLink href={siteUrl(site.id, "activity")} icon="activity" label="Activity and access" on={site.active === "activity"} />
            {person && <NavLink href={siteUrl(site.id, "settings")} icon="settings" label="Settings" on={site.active === "settings"} />}
            <div className="sn-group">Collaboration</div>
            <NavLink href={siteUrl(site.id, "branches")} icon="branch" label="Branches" on={site.active === "branches"} count={s?.openBranches} tone={s?.claudeBranches ? "agent" : undefined} />
            <NavLink href={siteUrl(site.id, "releases")} icon="calendar" label="Releases" on={site.active === "releases"} count={s?.nextRelease ? 1 : 0} />
          </>
        )}
        <div className="grow" />
        <button className="sn-claude" onClick={() => setConnect(true)}>
          <span className="connect-mark" aria-hidden="true">
            <Icon name="sparkle" size={13} />
          </span>
          <span className="grow">
            <strong>Work with Claude</strong>
            <span>Connect Claude Code</span>
          </span>
        </button>
        <div className="sn-me">
          <span className="avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="grow" title={me.name}>
            <strong>{me.name}</strong>
            <span>{me.local ? "Owner · this computer" : [me.role === "agent" ? "Claude" : me.role, ...(me.disciplines ?? []).map((d) => `${d} reviewer`)].join(" · ")}</span>
          </span>
          {!me.local && (
            <button
              className="btn ghost icon sm"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => {
                setToken(null);
                location.reload();
              }}
            >
              <Icon name="logout" size={14} />
            </button>
          )}
        </div>
      </nav>
      <div className="app-main">
        <header className="topbar2">
          <nav className="tb-crumbs" aria-label="Breadcrumb">
            {[{ label: orgName, href: "/" }, ...crumbs].map((cr, i, all) => (
              <span key={i}>
                {i > 0 && <Icon name="chevronRight" size={12} />}
                {cr.href && i < all.length - 1 ? (
                  <a href={cr.href} onClick={go(cr.href)}>
                    {cr.label}
                  </a>
                ) : (
                  <span aria-current={i === all.length - 1 ? "page" : undefined}>{cr.label}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="grow" />
          <button className="tb-search" onClick={() => openPalette()} aria-label="Quick find">
            <Icon name="search" size={14} />
            <span className="grow">Search sites, pages and actions</span>
            <kbd>{paletteKey}</kbd>
          </button>
          <Bell />
        </header>
        <div className="app-scroll">{children}</div>
      </div>
      {connect && <ConnectClaude me={me} onClose={() => setConnect(false)} />}
    </div>
  );
}

/** The heading block at the top of a screen. */
export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="phead">
      <div className="grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p className="phead-sub">{sub}</p>}
      </div>
      {actions && <div className="phead-actions">{actions}</div>}
    </header>
  );
}

/** A small coloured status label. */
export function Pill({ tone, children }: { tone: "ok" | "agent" | "warn" | "danger" | "human" | "muted" | "cms"; children: React.ReactNode }) {
  return <span className={`pill p-${tone}`}>{children}</span>;
}
