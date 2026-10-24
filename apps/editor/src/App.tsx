import { useEffect, useMemo, useRef, useState } from "react";
import { renderPage } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { api, getToken, setToken, type Me } from "./api";
import { Editor } from "./Editor";
import { AccessPage } from "./components/Access";
import { BrandsPage, TemplatesPage } from "./components/Library";
import { AssetsPage } from "./components/Assets";
import { Logo } from "./components/Icon";
import { LayerScene } from "./components/Scene3D";
import { CommandPalette } from "./components/CommandPalette";
import { CalendarPage } from "./components/Calendar";
import { AppShell, type Crumb, type OrgNav, type SiteNav } from "./components/Shell";
import { CommandCenter, MyWork } from "./components/Work";
import { SitesDirectory } from "./components/Directory";
import { ReviewDetailPage, ReviewsPage } from "./components/Reviews";
import { ReleasesPage, SiteReleases } from "./components/Releases";
import { AuditLogPage, ComponentsPage, SettingsPage } from "./components/Governance";
import { SiteActivity, SiteAssets, SiteBranches, SiteHistory, SiteOverviewPage, SiteSettings } from "./components/SiteWorkspace";
import { useShared } from "./store";
import { useLocation } from "./router";
import { ToastProvider } from "./Toasts";

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
  return (
    <>
      <Screen me={me} loc={loc} />
      <CommandPalette me={me} />
    </>
  );
}

const SITE_PARTS: Record<string, { nav: SiteNav; label: string }> = {
  overview: { nav: "overview", label: "Overview" },
  branches: { nav: "branches", label: "Branches" },
  assets: { nav: "assets", label: "Assets" },
  reviews: { nav: "reviews", label: "Reviews" },
  history: { nav: "history", label: "History" },
  activity: { nav: "activity", label: "Activity and access" },
  settings: { nav: "settings", label: "Settings" },
  releases: { nav: "releases", label: "Releases" },
};

function SiteScreen({ me, siteId, part }: { me: Me; siteId: string; part: string }) {
  const { sites } = useShared();
  const site = sites?.find((s) => s.id === siteId || s.slug === siteId);
  const p = SITE_PARTS[part] ?? SITE_PARTS.overview!;
  const crumbs: Crumb[] = [{ label: "Sites", href: "/sites" }, { label: site?.name ?? "…", href: `/sites/${siteId}/overview` }, { label: p.label }];
  let body: React.ReactNode;
  if (p.nav === "branches") body = <SiteBranches siteId={siteId} me={me} />;
  else if (p.nav === "assets") body = <SiteAssets siteId={siteId} me={me} />;
  else if (p.nav === "reviews") body = <ReviewsPage me={me} siteId={siteId} />;
  else if (p.nav === "history") body = <SiteHistory siteId={siteId} me={me} />;
  else if (p.nav === "activity") body = <SiteActivity siteId={siteId} me={me} />;
  else if (p.nav === "settings") body = <SiteSettings siteId={siteId} me={me} />;
  else if (p.nav === "releases") body = site ? <SiteReleases me={me} site={site} /> : <main className="page"><div className="tm-loading" /></main>;
  else body = <SiteOverviewPage siteId={siteId} me={me} />;
  return (
    <AppShell me={me} site={{ id: siteId, active: p.nav }} crumbs={crumbs}>
      {body}
    </AppShell>
  );
}

const ORG: Record<string, { nav: OrgNav; crumbs: Crumb[]; render: (me: Me) => React.ReactNode }> = {
  "/": { nav: "home", crumbs: [{ label: "Command center" }], render: (me) => <CommandCenter me={me} /> },
  "/work": { nav: "work", crumbs: [{ label: "My work" }], render: (me) => <MyWork me={me} /> },
  "/sites": { nav: "sites", crumbs: [{ label: "Sites" }], render: (me) => <SitesDirectory me={me} /> },
  "/reviews": { nav: "reviews", crumbs: [{ label: "Reviews" }], render: (me) => <ReviewsPage me={me} /> },
  "/releases": { nav: "releases", crumbs: [{ label: "Releases" }], render: (me) => <ReleasesPage me={me} /> },
  "/calendar": { nav: "releases", crumbs: [{ label: "Releases", href: "/releases" }, { label: "Calendar" }], render: (me) => <CalendarPage me={me} /> },
  "/assets": { nav: "assets", crumbs: [{ label: "Assets" }], render: (me) => <AssetsPage me={me} /> },
  "/brands": { nav: "brands", crumbs: [{ label: "Brands" }], render: (me) => <BrandsPage me={me} /> },
  "/templates": { nav: "templates", crumbs: [{ label: "Templates" }], render: (me) => <TemplatesPage me={me} /> },
  "/components": { nav: "components", crumbs: [{ label: "Components" }], render: (me) => <ComponentsPage me={me} /> },
  "/audit": { nav: "audit", crumbs: [{ label: "Audit log" }], render: (me) => <AuditLogPage me={me} /> },
  "/access": { nav: "access", crumbs: [{ label: "Access" }], render: (me) => <AccessPage me={me} /> },
  "/settings": { nav: "settings", crumbs: [{ label: "Settings" }], render: (me) => <SettingsPage me={me} /> },
};

function Screen({ me, loc }: { me: Me; loc: { path: string; search: string } }) {
  const sp = /^\/sites\/([^/]+)\/([a-z]+)\/?$/.exec(loc.path);
  if (sp && SITE_PARTS[sp[2]!]) return <SiteScreen key={sp[1]} me={me} siteId={sp[1]!} part={sp[2]!} />;
  const m = /^\/sites\/([^/]+)\/?$/.exec(loc.path);
  if (m) {
    const q = new URLSearchParams(loc.search);
    return <Editor key={m[1]} siteId={m[1]!} me={me} branch={q.get("branch") ?? "main"} review={q.get("review") === "1"} />;
  }
  const rv = /^\/reviews\/([0-9a-f-]{36})\/?$/.exec(loc.path);
  if (rv) {
    return (
      <AppShell me={me} org="reviews" crumbs={[{ label: "Reviews", href: "/reviews" }, { label: "Review" }]}>
        <ReviewDetailPage key={rv[1]} me={me} id={rv[1]!} />
      </AppShell>
    );
  }
  const r = ORG[loc.path.replace(/\/+$/, "") || "/"] ?? ORG["/"]!;
  return (
    <AppShell key={r.nav} me={me} org={r.nav} crumbs={r.crumbs}>
      {r.render(me)}
    </AppShell>
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
        <p>Paste the sign-in token your admin gave you. It's stored only in this browser.</p>
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

