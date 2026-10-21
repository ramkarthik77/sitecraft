import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTAINER_TYPES, findInTree, findNodeInDocument, type Breakpoint, type Operation, type SiteNode } from "@sitecraft/schema";
import { getToken, Sites, type Branch, type Me, type SiteSummary } from "./api";
import { Canvas, type CanvasEvent } from "./components/Canvas";
import { HistoryDrawer, ReviewDrawer, SettingsDrawer } from "./components/Drawers";
import { ELEMENTS, Insert } from "./components/Insert";
import { Layers } from "./components/Layers";
import { NodeInspector, PageInspector } from "./components/Inspector";
import { navigate, setQuery } from "./router";
import { useToast } from "./Toasts";
import { useEditor } from "./useEditor";

type Tab = "layers" | "insert" | "pages";
type DrawerKind = null | "review" | "history" | "settings";

const SAVE_LABEL = { loading: "Loading…", saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Not saved", conflict: "Out of date" } as const;

export function Editor(props: { siteId: string; me: Me; branch: string; review: boolean }) {
  const { siteId, me, branch } = props;
  const pushToast = useToast();
  const toast = useCallback((text: string, tone?: "error" | "agent") => pushToast({ text, tone }), [pushToast]);
  const ed = useEditor(siteId, branch, (m) => toast(m, "error"));
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bp, setBp] = useState<Breakpoint>("base");
  const [tab, setTab] = useState<Tab>("layers");
  const [drawer, setDrawer] = useState<DrawerKind>(props.review && branch !== "main" ? "review" : null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [newPage, setNewPage] = useState<{ path: string; title: string } | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const [publishing, setPublishing] = useState(false);

  const doc = ed.doc;
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0] ?? null;
  const selected = useMemo(() => (doc && selectedId ? findNodeInDocument(doc, selectedId)?.node ?? null : null), [doc, selectedId]);

  const loadBranches = useCallback(() => Sites.branches(siteId).then(setBranches).catch(() => {}), [siteId]);
  useEffect(() => {
    Sites.get(siteId)
      .then(setSite)
      .catch(() => navigate("/"));
    loadBranches();
  }, [siteId, loadBranches]);

  // Live updates when Claude (or a teammate) changes this branch.
  const edRef = useRef(ed);
  edRef.current = ed;
  useEffect(() => {
    const es = new EventSource(`/api/sites/${siteId}/events?token=${encodeURIComponent(getToken() ?? "")}`);
    es.addEventListener("change", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as { type: string; branch?: string; versionId?: number; actor: string; actorRole: string; message?: string };
      if (e.type === "branch" || e.type === "version") loadBranches();
      if (e.type === "deploy") Sites.get(siteId).then(setSite).catch(() => {});
      if (e.type !== "version" || e.branch !== branch || e.actor === me.name || e.versionId === edRef.current.currentVersion()) return;
      const tone = e.actorRole === "agent" ? "agent" : undefined;
      if (!edRef.current.isDirty()) {
        edRef.current.reload().catch(() => {});
        pushToast({ text: `${e.actor}: ${e.message ?? "updated this branch"}`, tone });
      } else {
        pushToast({ text: `${e.actor} changed this branch while you were editing.`, tone, action: { label: "Load their version", run: () => void edRef.current.reload() } }, 12000);
      }
    });
    return () => es.close();
  }, [siteId, branch, me.name, loadBranches, pushToast]);

  // Keep the selection valid when the document changes underneath it.
  useEffect(() => {
    if (doc && selectedId && !findNodeInDocument(doc, selectedId)) setSelectedId(null);
  }, [doc, selectedId]);

  const apply = ed.apply;

  const topLevelIndex = (root: SiteNode, id: string | null): number | null => {
    if (!id) return null;
    const idx = root.children?.findIndex((c) => c.id === id || !!findInTree(c, id)) ?? -1;
    return idx >= 0 ? idx : null;
  };

  const insertBlock = (name: string, at?: number) => {
    if (!page) return;
    const after = at ?? topLevelIndex(page.root, selectedId);
    const index = after === null ? undefined : after + (at === undefined ? 1 : 0);
    const created = apply([{ op: "add_block", parentId: page.root.id, block: name, index }]);
    if (created?.[0]) {
      setSelectedId(created[0]);
      setScrollTick((t) => t + 1);
    }
  };

  const placementFor = (targetId: string | null, before: boolean, preferInside: boolean): { parentId: string; index?: number } | null => {
    if (!doc || !page) return null;
    if (!targetId) return { parentId: page.root.id };
    const hit = findNodeInDocument(doc, targetId);
    if (!hit) return { parentId: page.root.id };
    if (preferInside && CONTAINER_TYPES.has(hit.node.type)) return { parentId: hit.node.id };
    if (!hit.parent) return { parentId: hit.node.id };
    return { parentId: hit.parent.id, index: hit.index + (before ? 0 : 1) };
  };

  const insertElement = (key: string, targetId = selectedId, before = false, preferInside = true) => {
    const el = ELEMENTS[key];
    const where = placementFor(targetId, before, preferInside);
    if (!el || !where) return;
    const created = apply([{ op: "add_node", parentId: where.parentId, index: where.index, node: el.make() as never }]);
    if (created?.[0]) setSelectedId(created[0]);
  };

  const onCanvas = (e: CanvasEvent) => {
    if (!doc || !page) return;
    if (e.type === "select") setSelectedId(e.id);
    else if (e.type === "text") {
      const n = findNodeInDocument(doc, e.id)?.node;
      if (n) apply([{ op: "update_node", nodeId: e.id, props: { [n.type === "button" ? "label" : "text"]: e.text } }]);
    } else if (e.type === "drop") {
      const [kind, value] = [e.payload.split(":")[0], e.payload.slice(e.payload.indexOf(":") + 1)];
      if (kind === "block") {
        const idx = topLevelIndex(page.root, e.id);
        insertBlock(value, idx === null ? page.root.children?.length ?? 0 : idx + (e.before ? 0 : 1));
      } else if (kind === "el") insertElement(value, e.id, e.before, true);
      else if (kind === "move" && e.id && value !== e.id) {
        const where = placementFor(e.id, e.before, false);
        if (where) apply([{ op: "move_node", nodeId: value, parentId: where.parentId, index: where.index }]);
      }
    } else if (e.type === "key") onKey(e.key, e.meta, e.shift);
  };

  const onKey = (key: string, meta: boolean, shift: boolean) => {
    if (meta && key === "z") return shift ? ed.redo() : ed.undo();
    if (meta && key === "y") return ed.redo();
    if (key === "Escape") return setSelectedId(null);
    if (!selectedId || !page || selectedId === page.root.id) return;
    if (key === "Delete" || key === "Backspace") apply([{ op: "remove_node", nodeId: selectedId }]);
    if (meta && key === "d") {
      const c = apply([{ op: "duplicate_node", nodeId: selectedId }]);
      if (c?.[0]) setSelectedId(c[0]);
    }
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (["Delete", "Backspace", "Escape"].includes(e.key) || (meta && ["z", "y", "d"].includes(e.key))) {
        e.preventDefault();
        onKey(e.key, meta, e.shiftKey);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const switchBranch = async (name: string) => {
    await ed.flush();
    setSelectedId(null);
    setQuery({ branch: name === "main" ? null : name, review: null });
  };

  const createBranch = async (name: string) => {
    try {
      await ed.flush();
      await Sites.createBranch(siteId, name, branch);
      setNewBranch(null);
      await loadBranches();
      await switchBranch(name);
      toast(`Created branch ${name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const openPreview = async () => {
    const w = window.open("", "_blank");
    await ed.flush();
    const { url } = await Sites.previewUrl(siteId, branch);
    if (w) w.location.href = url;
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await ed.flush();
      const r = await Sites.publish(siteId);
      toast(`Published to ${r.url.replace(/^https?:\/\//, "")}`);
      setSite(await Sites.get(siteId));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPublishing(false);
    }
  };

  const currentBranch = branches.find((b) => b.name === branch);
  const isAgentBranch = branch.startsWith("agent/") || currentBranch?.createdBy.includes("claude") || false;

  if (!doc || !page) {
    return (
      <div className="shell">
        <div className="topbar">
          <button className="btn ghost" onClick={() => navigate("/")}>
            ← Sites
          </button>
        </div>
        <div className="empty">Loading the site…</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost icon" aria-label="All sites" title="All sites" onClick={() => navigate("/")}>
          ←
        </button>
        <span className="site-name" title={site?.name}>
          {site?.name}
        </span>
        <span className={`branch-pill ${branch !== "main" ? "is-agent" : ""}`}>
          {newBranch === null ? (
            <select
              aria-label="Branch"
              value={branch}
              onChange={(e) => (e.target.value === "__new" ? setNewBranch("") : void switchBranch(e.target.value))}
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.hasChanges ? " •" : ""}
                </option>
              ))}
              {!branches.some((b) => b.name === branch) && <option value={branch}>{branch}</option>}
              <option value="__new">New branch…</option>
            </select>
          ) : (
            <form
              style={{ display: "flex", gap: 4 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (newBranch.trim()) void createBranch(newBranch.trim().toLowerCase().replace(/\s+/g, "-"));
              }}
            >
              <input className="input" autoFocus aria-label="New branch name" placeholder="my-change" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} style={{ width: 140 }} />
              <button className="btn sm primary">Create</button>
              <button type="button" className="btn sm ghost" onClick={() => setNewBranch(null)}>
                Cancel
              </button>
            </form>
          )}
        </span>
        <select className="select hide-narrow" aria-label="Page" style={{ width: 150 }} value={page.id} onChange={(e) => (setPageId(e.target.value), setSelectedId(null))}>
          {doc.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.path === "/" ? "Home" : p.path}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Breakpoint">
          {(["base", "tablet", "mobile"] as Breakpoint[]).map((b) => (
            <button key={b} aria-pressed={bp === b} onClick={() => setBp(b)} title={b === "base" ? "Desktop" : b === "tablet" ? "Tablet" : "Phone"}>
              {b === "base" ? "Desktop" : b === "tablet" ? "Tablet" : "Phone"}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className={`save-state hide-narrow ${ed.saveState === "error" || ed.saveState === "conflict" ? "error" : ""}`} aria-live="polite">
          {SAVE_LABEL[ed.saveState]}
        </span>
        <button className="btn ghost icon hide-narrow" aria-label="Undo" title="Undo (⌘Z)" disabled={!ed.canUndo} onClick={ed.undo}>
          ↶
        </button>
        <button className="btn ghost icon hide-narrow" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!ed.canRedo} onClick={ed.redo}>
          ↷
        </button>
        <button className="btn ghost hide-narrow" onClick={() => setDrawer("history")}>
          History
        </button>
        <button className="btn ghost hide-narrow" onClick={() => setDrawer("settings")}>
          Settings
        </button>
        <button className="btn" onClick={() => void openPreview()}>
          Preview
        </button>
        {branch !== "main" ? (
          <button className={`btn ${isAgentBranch ? "agent" : "primary"}`} onClick={() => setDrawer("review")}>
            Review and merge
          </button>
        ) : (
          me.role !== "agent" && (
            <button className="btn primary" disabled={publishing} onClick={() => void publish()}>
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )
        )}
        {site?.liveUrl && branch === "main" && (
          <a className="btn ghost hide-narrow" href={site.liveUrl} target="_blank" rel="noreferrer">
            View live
          </a>
        )}
      </header>

      {ed.saveState === "conflict" && (
        <div className="callout human" style={{ borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Someone else saved this branch after you opened it, so your latest edit wasn't saved.</span>
          <button className="btn sm" onClick={() => void ed.reload()}>
            Load the latest version
          </button>
        </div>
      )}

      <div className="workspace">
        <aside className="rail">
          <div className="tabs" role="tablist">
            {(["layers", "insert", "pages"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="rail-body">
            {tab === "layers" && <Layers root={page.root} selectedId={selectedId} onSelect={(id) => (setSelectedId(id), setScrollTick((n) => n + 1))} apply={(ops: Operation[]) => apply(ops)} />}
            {tab === "insert" && <Insert onInsertBlock={(n) => insertBlock(n)} onInsertElement={(k) => insertElement(k)} />}
            {tab === "pages" && (
              <div>
                {doc.pages.map((p) => (
                  <div key={p.id} className={`list-row ${p.id === page.id ? "active" : ""}`} onClick={() => (setPageId(p.id), setSelectedId(null))}>
                    <span className="grow">{p.title}</span>
                    <span className="muted small">{p.path}</span>
                  </div>
                ))}
                {newPage ? (
                  <form
                    style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const created = apply([{ op: "add_page", path: newPage.path, title: newPage.title || newPage.path, blocks: ["navbar", "text-section", "footer"] }]);
                      if (created?.[0]) {
                        setPageId(created[0]);
                        setNewPage(null);
                      }
                    }}
                  >
                    <input className="input" autoFocus aria-label="Page title" placeholder="Title, e.g. About us" value={newPage.title} onChange={(e) => setNewPage({ ...newPage, title: e.target.value })} />
                    <input className="input" aria-label="Page path" placeholder="/about" value={newPage.path} onChange={(e) => setNewPage({ ...newPage, path: e.target.value })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn sm primary" disabled={!newPage.path.trim()}>
                        Add page
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => setNewPage(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ padding: 12 }}>
                    <button className="btn sm" onClick={() => setNewPage({ path: "", title: "" })}>
                      New page
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <Canvas doc={doc} page={page} breakpoint={bp} selectedId={selectedId} zoom={1} scrollToSelected={scrollTick} onEvent={onCanvas} />

        <aside className="inspector" aria-label="Inspector">
          {selected ? (
            <NodeInspector node={selected} bp={bp} apply={apply} siteId={siteId} doc={doc} isRoot={selected.id === page.root.id} />
          ) : (
            <PageInspector doc={doc} page={page} apply={apply} onDeletePage={() => (apply([{ op: "remove_page", pageId: page.id }]), setPageId(null))} />
          )}
        </aside>
      </div>

      {drawer === "review" && (
        <ReviewDrawer
          siteId={siteId}
          branch={branch}
          toast={toast}
          onClose={() => (setDrawer(null), setQuery({ review: null }))}
          onMerged={() => {
            setDrawer(null);
            void switchBranch("main");
          }}
        />
      )}
      {drawer === "history" && <HistoryDrawer siteId={siteId} branch={branch} toast={toast} onClose={() => setDrawer(null)} onRestored={() => void ed.reload()} />}
      {drawer === "settings" && site && <SettingsDrawer site={site} toast={toast} onClose={() => setDrawer(null)} onSaved={setSite} />}
    </div>
  );
}
