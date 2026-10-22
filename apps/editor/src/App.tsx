import { useEffect, useMemo, useRef, useState } from "react";
import { renderPage } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { api, getToken, setToken, Sites, type Branch, type Me, type SiteSummary } from "./api";
import { Editor } from "./Editor";
import { Icon, Logo } from "./components/Icon";
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
    if (!getToken()) return setChecking(false);
    api<Me>("GET", "/me")
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!me) return <Login onDone={setMe} />;

  const m = /^\/sites\/([^/]+)/.exec(loc.path);
  if (m) {
    const q = new URLSearchParams(loc.search);
    return <Editor key={m[1]} siteId={m[1]!} me={me} branch={q.get("branch") ?? "main"} review={q.get("review") === "1"} />;
  }
  return <Home me={me} />;
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
  const [scale, setScale] = useState(0.22);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Sites.head(siteId, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
  }, [siteId]);
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
      {doc && !empty && <iframe title="Site thumbnail" srcDoc={html} tabIndex={-1} aria-hidden="true" loading="lazy" style={{ transform: `scale(${scale})` }} />}
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

function Home({ me }: { me: Me }) {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("landing");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQueryText] = useState("");
  const [show, setShow] = useState<"all" | "live" | "drafts">("all");
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Sites.list()
      .then(async (list) => {
        setSites(list);
        // Branches waiting for review, across every site.
        const all = await Promise.all(
          list.map((s) =>
            Sites.branches(s.id)
              .then((bs) => bs.filter((b) => b.name !== "main" && b.hasChanges).map((b) => ({ site: s, branch: b })))
              .catch(() => [] as PendingReview[]),
          ),
        );
        setReviews(all.flat().sort((a, b) => b.branch.updatedAt.localeCompare(a.branch.updatedAt)));
      })
      .catch((e) => toast({ text: e.message, tone: "error" }));
  }, [toast]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await Sites.create(name.trim(), template);
      navigate(`/sites/${s.id}`);
    } catch (err) {
      toast({ text: (err as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const preview = async (r: PendingReview) => {
    const w = window.open("", "_blank");
    const { url } = await Sites.previewUrl(r.site.id, r.branch.name);
    if (w) w.location.href = url;
  };

  const inReview = new Set(reviews.map((r) => r.site.id));
  const visible = (sites ?? []).filter((s) => {
    if (query && !`${s.name} ${s.slug} ${s.domain ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (show === "live") return !!s.liveUrl;
    if (show === "drafts") return !s.liveUrl;
    return true;
  });
  const showCreate = creating || (sites !== null && sites.length === 0);

  return (
    <div className="dash">
      <nav className="dash-nav" aria-label="Workspace">
        <span className="brand">
          <Logo size={26} /> Sitecraft
        </span>
        <a className="nav-link" href="/" aria-current="page" onClick={(e) => e.preventDefault()}>
          <Icon name="grid" size={15} /> Sites
        </a>
        <a className="nav-link" href="#reviews">
          <Icon name="review" size={15} /> Reviews
          {reviews.length > 0 && <span className="badge">{reviews.length}</span>}
        </a>
        <div className="connect-card">
          <strong>
            <Icon name="terminal" size={14} /> Claude Code
          </strong>
          <p>Claude builds and edits sites here on its own branches. Connect it with an agent token and this address:</p>
          <code>{mcpAddress()}</code>
          <button
            className="btn sm agent-outline"
            onClick={() => {
              void navigator.clipboard?.writeText(mcpAddress()).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Icon name="copy" size={13} />
            {copied ? "Copied" : "Copy address"}
          </button>
        </div>
        <div className="me-row">
          <span className="avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="grow" title={me.name}>
            {me.name}
            <br />
            <span className="muted">{me.role}</span>
          </span>
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
        </div>
      </nav>

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
            <button className="btn primary" style={{ height: 36 }} onClick={() => setCreating((c) => !c)} aria-expanded={showCreate}>
              <Icon name="plus" size={14} /> New site
            </button>
          )}
        </div>

        {showCreate && (
          <form className="create-panel" onSubmit={create}>
            <input className="input" aria-label="Site name" placeholder="Name your site, e.g. Northstar Coffee" value={name} onChange={(e) => setName(e.target.value)} autoFocus={creating} />
            <select className="select" aria-label="Template" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="landing">Landing page</option>
              <option value="saas">Product site</option>
              <option value="blank">Blank</option>
            </select>
            <button className="btn light" disabled={!name.trim() || busy}>
              Create site
            </button>
          </form>
        )}

        {reviews.length > 0 && (
          <section id="reviews" aria-labelledby="reviews-title">
            <h2 id="reviews-title">
              Waiting for your review <span className="muted">{reviews.length === 1 ? "1 branch" : `${reviews.length} branches`}</span>
            </h2>
            <div className="review-grid">
              {reviews.map((r) => (
                <article key={`${r.site.id}:${r.branch.name}`} className="review-card">
                  <div className="top">
                    <span className="branch">{r.branch.name}</span>
                    <span className="on">on</span>
                    <span className="site">{r.site.name}</span>
                    <span className="when">{ago(r.branch.updatedAt)}</span>
                  </div>
                  <p>
                    {/claude|agent/i.test(r.branch.lastChangeBy) ? "Claude" : r.branch.lastChangeBy}: {r.branch.lastMessage || "Changes ready"}
                  </p>
                  <div className="actions">
                    <a
                      className="btn agent"
                      href={`/sites/${r.site.id}?branch=${encodeURIComponent(r.branch.name)}&review=1`}
                      onClick={(e) => (e.preventDefault(), navigate(`/sites/${r.site.id}?branch=${encodeURIComponent(r.branch.name)}&review=1`))}
                    >
                      Review
                    </a>
                    <button className="btn agent-outline" onClick={() => void preview(r)}>
                      Preview
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

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
          {sites && sites.length === 0 && <div className="empty">No sites yet. Name your first one above, or ask Claude Code to create one.</div>}
          {sites && sites.length > 0 && visible.length === 0 && <div className="empty">No sites match. Clear the search or pick another filter.</div>}
          <div className="site-grid">
            {visible.map((s) => (
              <a key={s.id} className="site-card" href={`/sites/${s.id}`} onClick={(e) => (e.preventDefault(), navigate(`/sites/${s.id}`))}>
                <Thumb siteId={s.id} />
                <div className="meta">
                  <strong>
                    {s.name}
                    {inReview.has(s.id) ? (
                      <span className="status review">In review</span>
                    ) : s.liveUrl ? (
                      <span className="status live">Live</span>
                    ) : (
                      <span className="status draft">Draft</span>
                    )}
                  </strong>
                  <span className="sub">
                    {s.liveUrl ? s.liveUrl.replace(/^https?:\/\//, "") : "Not published"}
                    {s.updatedAt ? ` · edited ${ago(s.updatedAt)}` : ""}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
