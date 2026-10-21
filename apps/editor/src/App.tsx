import { useEffect, useMemo, useState } from "react";
import { renderPage } from "@sitecraft/renderer";
import type { SiteDocument } from "@sitecraft/schema";
import { api, getToken, setToken, Sites, type Me, type SiteSummary } from "./api";
import { Editor } from "./Editor";
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
    <form className="login" onSubmit={submit}>
      <h1>Sign in to Sitecraft</h1>
      <p>Paste your Sitecraft token. For local development the editor token is in your .env file as EDITOR_TOKEN.</p>
      <label className="small muted" htmlFor="token">
        Token
      </label>
      <input id="token" className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="sc_…" />
      {error && <div className="err">{error}</div>}
      <button className="btn primary" disabled={!value.trim()}>
        Sign in
      </button>
    </form>
  );
}

function Thumb({ siteId }: { siteId: string }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  useEffect(() => {
    Sites.head(siteId, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
  }, [siteId]);
  const html = useMemo(() => (doc ? renderPage(doc, doc.pages[0]!, { mode: "editor" }) : ""), [doc]);
  return <div className="thumb">{doc && <iframe title="Site thumbnail" srcDoc={html} tabIndex={-1} aria-hidden="true" />}</div>;
}

function Home({ me }: { me: Me }) {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("landing");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Sites.list()
      .then(setSites)
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

  return (
    <div className="home">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Your sites</h1>
        <span className="muted small">
          Signed in as {me.name} ·{" "}
          <button
            className="btn ghost sm"
            onClick={() => {
              setToken(null);
              location.reload();
            }}
          >
            Sign out
          </button>
        </span>
      </div>
      <p className="lead">Design here, or ask Claude Code to build on a branch. Both edit the same site.</p>
      <form className="create" onSubmit={create}>
        <input className="input" aria-label="Site name" placeholder="New site name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="select" aria-label="Template" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="landing">Landing page</option>
          <option value="saas">Product site</option>
          <option value="blank">Blank</option>
        </select>
        <button className="btn primary" disabled={!name.trim() || busy}>
          Create site
        </button>
      </form>
      {sites && sites.length === 0 && <div className="empty">No sites yet. Name your first one above, or ask Claude Code to create one.</div>}
      <div className="sites">
        {sites?.map((s) => (
          <button key={s.id} className="site-card" onClick={() => navigate(`/sites/${s.id}`)}>
            <Thumb siteId={s.id} />
            <div className="meta">
              <strong>{s.name}</strong>
              <span className="muted small">{s.liveUrl ? `Live at ${s.liveUrl.replace(/^https?:\/\//, "")}` : "Not published yet"}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
