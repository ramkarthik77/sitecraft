import { useEffect, useMemo, useRef, useState } from "react";
import { renderPage } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { api, getToken, setToken, Sites, Templates, type Branch, type Me, type SavedTemplate, type SiteSummary } from "./api";
import { Editor } from "./Editor";
import { AccessPage } from "./components/Access";
import { BrandsPage, TemplatesPage } from "./components/Library";
import { AssetsPage } from "./components/Assets";
import { Icon, Logo } from "./components/Icon";
import { LayerScene, useTiltCards } from "./components/Scene3D";
import { HomePage, NewSiteDialog, SiteCard, SiteOverview, useSitesAndReviews } from "./components/Home";
import { ago, initials } from "./format";
import { navigate, useLocation } from "./router";
import { ToastProvider, useToast } from "./Toasts";

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const loc = useLocation();

  useEffect(() => {
    // The local app answers without a token; otherwise a saved token signs in.
    const sent = getToken();
    api<Me>("GET", "/me")
      .then(setMe)
      .catch(() => {
        // Forget the token only if it's the one that was refused, not one saved meanwhile.
        if (sent && getToken() === sent) setToken(null);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!me) return <Login onDone={setMe} />;

  const ov = /^\/sites\/([^/]+)\/overview\/?$/.exec(loc.path);
  if (ov) {
    return (
      <DashShell me={me} active="sites">
        <SiteOverview key={ov[1]} siteId={ov[1]!} me={me} />
      </DashShell>
    );
  }
  if (loc.path === "/sites" || loc.path === "/sites/") return <SitesList me={me} />;
  const m = /^\/sites\/([^/]+)/.exec(loc.path);
  if (m) {
    const q = new URLSearchParams(loc.search);
    return <Editor key={m[1]} siteId={m[1]!} me={me} branch={q.get("branch") ?? "main"} review={q.get("review") === "1"} />;
  }
  if (loc.path === "/templates") {
    return (
      <DashShell me={me} active="templates">
        <TemplatesPage me={me} />
      </DashShell>
    );
  }
  if (loc.path === "/brands") {
    return (
      <DashShell me={me} active="brands">
        <BrandsPage me={me} />
      </DashShell>
    );
  }
  if (loc.path === "/assets") {
    return (
      <DashShell me={me} active="assets">
        <AssetsPage me={me} />
      </DashShell>
    );
  }
  if (loc.path === "/access") {
    return (
      <DashShell me={me} active="access">
        <AccessPage me={me} />
      </DashShell>
    );
  }
  return (
    <DashShell me={me} active="home">
      <HomePage me={me} connectCommand={connectCommand(me)} />
    </DashShell>
  );
}

function Login({ onDone }: { onDone: (m: Me) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setToken(value.trim());
    try {
      onDone(await api<Me>("GET", "/me"));
    } catch {
      setToken(null);
      setError("That token wasn't accepted. Check it and try again.");
    }
  };
  return (
    <div className="login-wrap">
      <LayerScene />
      <div className="login-copy">
        <h2>Design it. Let Claude build it. Ship it together.</h2>
        <p>Every page is layers you and Claude edit side by side, on branches, with a person approving what goes live.</p>
      </div>
      <form className="login" onSubmit={submit}>
        <span className="brand">
          <Logo size={28} /> Sitecraft
        </span>
        <h1>Sign in</h1>
        <p>Paste your Sitecraft token. Your admin gives you one; for a local setup it's EDITOR_TOKEN in the .env file.</p>
        <label className="small muted" htmlFor="token">
          Token
        </label>
        <input id="token" className="input" autoFocus autoComplete="off" spellCheck={false} value={value} onChange={(e) => (setValue(e.target.value), setError(""))} placeholder="sc_…" />
        {error && <div className="err">{error}</div>}
        <button className="btn primary" disabled={!value.trim()}>
          Sign in
        </button>
      </form>
    </div>
  );
}

function Thumb({ siteId }: { siteId: string }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  useEffect(() => {
    Sites.head(siteId, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
  }, [siteId]);
  return <DocThumb doc={doc} />;
}

/** A live, scaled-down render of a document's home page. */
export function DocThumb({ doc }: { doc: SiteDocument | null }) {
  const [scale, setScale] = useState(0.22);
  const box = useRef<HTMLDivElement>(null);
  // Scale the 1200 px page to whatever width the card has.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const empty = !!doc && !(doc.pages[0]?.root.children?.length);
  const html = useMemo(() => (doc && !empty ? renderPage(doc, doc.pages[0]!, { mode: "editor" }) : ""), [doc, empty]);
  return (
    <div className="thumb" ref={box}>
      {empty && <span className="blank">Blank page</span>}
      {doc && !empty && <iframe title="Page thumbnail" srcDoc={html} tabIndex={-1} aria-hidden="true" loading="lazy" style={{ transform: `scale(${scale})` }} />}
    </div>
  );
}

interface PendingReview {
  site: SiteSummary;
  branch: Branch;
}

function mcpAddress(): string {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return local ? "http://localhost:4100/mcp" : `${location.origin}/mcp`;
}

/** What to paste into a terminal to connect Claude Code. */
function connectCommand(me: Me): string {
  return me.local
    ? `claude mcp add --transport http --scope user sitecraft ${mcpAddress()}`
    : `claude mcp add --transport http --scope user sitecraft ${mcpAddress()} --header "Authorization: Bearer <your agent token>"`;
}


type NavKey = "home" | "sites" | "templates" | "brands" | "assets" | "access";
const NAV: { key: NavKey; label: string; href: string; icon: string; admin?: boolean }[] = [
  { key: "home", label: "Home", href: "/", icon: "home" },
  { key: "sites", label: "Sites", href: "/sites", icon: "grid" },
  { key: "templates", label: "Templates", href: "/templates", icon: "pages" },
  { key: "brands", label: "Brands", href: "/brands", icon: "spark" },
  { key: "assets", label: "Assets", href: "/assets", icon: "image" },
  { key: "access", label: "Access", href: "/access", icon: "lock", admin: true },
];

/** The dashboard frame: workspace navigation, the Claude Code card and who's signed in. */
export function DashShell({ me, active, reviews = 0, children }: { me: Me; active: NavKey; reviews?: number; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dash">
      <nav className="dash-nav" aria-label="Workspace">
        <span className="brand">
          <Logo size={26} /> Sitecraft
        </span>
        {NAV.filter((n) => !n.admin || me.role === "admin").map((n) => (
          <a key={n.key} className="nav-link" href={n.href} aria-current={active === n.key ? "page" : undefined} onClick={(e) => (e.preventDefault(), navigate(n.href))}>
            <Icon name={n.icon} size={15} /> {n.label}
            {n.key === "sites" && reviews > 0 && <span className="badge" title={`${reviews} waiting for review`}>{reviews}</span>}
          </a>
        ))}
        <div className="connect-card">
          <strong>
            <Icon name="terminal" size={14} /> Claude Code
          </strong>
          <p>{me.local ? "Claude builds and edits sites here on its own branches. Run this once in a terminal:" : "Claude builds and edits sites here on its own branches. Connect it with your agent token:"}</p>
          <code>{connectCommand(me)}</code>
          <button
            className="btn sm agent-outline"
            onClick={() => {
              void navigator.clipboard?.writeText(connectCommand(me)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Icon name="copy" size={13} />
            {copied ? "Copied" : "Copy command"}
          </button>
        </div>
        <div className="me-row">
          <span className="avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="grow" title={me.name}>
            {me.name}
            <br />
            <span className="muted">{me.local ? "Local app on this computer" : me.role}</span>
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
      {children}
    </div>
  );
}

function SitesList({ me }: { me: Me }) {
  const { sites, reviews } = useSitesAndReviews();
  const [creating, setCreating] = useState(false);
  const [query, setQueryText] = useState("");
  const [show, setShow] = useState<"all" | "live" | "drafts">("all");
  const grid = useTiltCards<HTMLDivElement>();
  const inReview = new Set(reviews.map((r) => r.site.id));
  const visible = (sites ?? [])
    .filter((s) => {
      if (query && !`${s.name} ${s.slug} ${s.domain ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (show === "live") return !!s.liveUrl;
      if (show === "drafts") return !s.liveUrl;
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <DashShell me={me} active="sites" reviews={reviews.length}>
      <main className="dash-main">
        <div className="dash-head">
          <h1>Sites</h1>
          {sites && <span className="muted">{sites.length === 1 ? "1 site" : `${sites.length} sites`}</span>}
          <div className="spacer" />
          <label className="search">
            <Icon name="search" size={13} />
            <span className="sr-only">Search sites</span>
            <input placeholder="Search sites" value={query} onChange={(e) => setQueryText(e.target.value)} />
          </label>
          {me.role !== "agent" && (
            <button className="btn primary" style={{ height: 36 }} onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New site
            </button>
          )}
        </div>

        <section aria-labelledby="all-title">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 id="all-title">All sites</h2>
            <div className="seg" role="group" aria-label="Show">
              {(["all", "live", "drafts"] as const).map((k) => (
                <button key={k} aria-pressed={show === k} onClick={() => setShow(k)} style={{ height: 24 }}>
                  {k === "all" ? "All" : k === "live" ? "Live" : "Drafts"}
                </button>
              ))}
            </div>
          </div>
          {sites && sites.length === 0 && (
            <div className="empty-state">
              <strong>No sites yet</strong>
              <span>Create one from a template, or ask Claude Code to build one for you.</span>
              {me.role !== "agent" && (
                <button className="btn primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={14} /> New site
                </button>
              )}
            </div>
          )}
          {sites && sites.length > 0 && visible.length === 0 && <div className="empty">No sites match. Clear the search or pick another filter.</div>}
          <div className="site-grid" ref={grid}>
            {visible.map((s, i) => (
              <SiteCard key={s.id} site={s} inReview={inReview.has(s.id)} index={i} />
            ))}
          </div>
        </section>
        {creating && <NewSiteDialog onClose={() => setCreating(false)} />}
      </main>
    </DashShell>
  );
}
