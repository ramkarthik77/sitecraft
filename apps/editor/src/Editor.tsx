import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTAINER_TYPES, findCollection, findInTree, findNodeInDocument, itemTitle, type Breakpoint, type Operation, type SiteNode } from "@sitecraft/schema";
import { Sites, type Branch, type Me, type SiteSummary, type Version } from "./api";
import { Canvas, type CanvasEvent } from "./components/Canvas";
import { bindingCollection, CmsRail, CmsTable, CollectionInspector, ItemInspector } from "./components/Cms";
import { HistoryDrawer, ReviewDrawer, SettingsDrawer } from "./components/Drawers";
import { Icon, Logo } from "./components/Icon";
import { ELEMENTS, Insert } from "./components/Insert";
import { Layers } from "./components/Layers";
import { NodeInspector, PageInspector } from "./components/Inspector";
import { navigate, setQuery } from "./router";
import { useToast } from "./Toasts";
import { useEditor } from "./useEditor";
import { ago, initials } from "./format";

type Tab = "layers" | "insert" | "pages" | "cms";
const TAB_LABEL: Record<Tab, string> = { layers: "Layers", insert: "Insert", pages: "Pages", cms: "CMS" };
type DrawerKind = null | "review" | "history" | "settings";

const SAVE_LABEL = { loading: "Loading…", saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Not saved", conflict: "Out of date" } as const;
const BREAKPOINTS: { bp: Breakpoint; label: string; icon: string; px: number }[] = [
  { bp: "base", label: "Desktop", icon: "desktop", px: 1200 },
  { bp: "tablet", label: "Tablet", icon: "tablet", px: 810 },
  { bp: "mobile", label: "Phone", icon: "phone", px: 390 },
];

/** What a branch changed and who changed it, for highlighting and the activity bar. */
interface BranchWork {
  changed: Set<string>;
  top: string[];
  count: number;
  agentVersions: Version[];
  onlyAgent: boolean;
}

const NO_WORK: BranchWork = { changed: new Set(), top: [], count: 0, agentVersions: [], onlyAgent: false };

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
  const [filter, setFilter] = useState("");
  const [drawer, setDrawer] = useState<DrawerKind>(props.review && branch !== "main" ? "review" : null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [newPage, setNewPage] = useState<{ path: string; title: string } | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [work, setWork] = useState<BranchWork>(NO_WORK);
  const [cmsId, setCmsId] = useState<string | null>(null);
  const [cmsItemId, setCmsItemId] = useState<string | null>(null);
  /** On a template page, the item the canvas shows. */
  const [templateItem, setTemplateItem] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const doc = ed.doc;
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0] ?? null;
  const selected = useMemo(() => (doc && selectedId ? findNodeInDocument(doc, selectedId)?.node ?? null : null), [doc, selectedId]);
  const cmsCollection = doc && tab === "cms" && cmsId ? findCollection(doc, cmsId) ?? null : null;
  const cmsItem = cmsCollection && cmsItemId ? cmsCollection.items.find((i) => i.id === cmsItemId) ?? null : null;
  const pageCollection = doc && page?.collectionId ? findCollection(doc, page.collectionId) : undefined;
  const shownItem = pageCollection ? pageCollection.items.find((i) => i.id === templateItem) ?? pageCollection.items[0] : undefined;

  // Opening the CMS tab shows the first collection.
  useEffect(() => {
    if (tab !== "cms" || !doc) return;
    const cols = doc.collections ?? [];
    if (!cmsId || !cols.some((c) => c.id === cmsId)) {
      setCmsId(cols[0]?.id ?? null);
      setCmsItemId(null);
    }
  }, [tab, doc, cmsId]);

  const openPage = (id: string, itemId?: string) => {
    setTab("layers");
    setPageId(id);
    setSelectedId(null);
    setTemplateItem(itemId ?? null);
  };

  const loadBranches = useCallback(() => Sites.branches(siteId).then(setBranches).catch(() => {}), [siteId]);
  useEffect(() => {
    Sites.get(siteId)
      .then(setSite)
      .catch(() => navigate("/"));
    loadBranches();
  }, [siteId, loadBranches]);

  // Relative times ("2 min ago") stay current.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // What this branch changed compared to main, and how much of it was Claude.
  const docRef = useRef(doc);
  docRef.current = doc;
  const loadWork = useCallback(async () => {
    if (branch === "main") return setWork(NO_WORK);
    try {
      const [diff, versions] = await Promise.all([Sites.diff(siteId, branch), Sites.versions(siteId, branch)]);
      const current = branches.find((b) => b.name === branch);
      const own = versions.filter((v) => !current?.baseVersionId || v.id > current.baseVersionId);
      const agentVersions = own.filter((v) => v.actorRole === "agent");
      const changed = new Set([...diff.added, ...diff.changed]);
      const d = docRef.current;
      const top = [...changed].filter((id) => {
        const parent = d ? findNodeInDocument(d, id)?.parent?.id : undefined;
        return !parent || !changed.has(parent);
      });
      setWork({ changed, top, count: diff.summary.length, agentVersions, onlyAgent: own.length > 0 && agentVersions.length === own.length });
    } catch {
      setWork(NO_WORK);
    }
  }, [siteId, branch, branches]);

  // Refresh after every save, ours or anyone's.
  useEffect(() => {
    const t = setTimeout(() => void loadWork(), 300);
    return () => clearTimeout(t);
  }, [loadWork, ed.versionId]);

  // Live updates when Claude (or a teammate) changes this branch.
  const edRef = useRef(ed);
  edRef.current = ed;
  useEffect(() => {
    // The stream signs in with a one-minute ticket, never the token itself; reconnects fetch a new one.
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const onChange = (msg: Event) => {
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
    };
    const connect = async () => {
      try {
        const { ticket } = await Sites.eventsTicket(siteId);
        if (stopped) return;
        es = new EventSource(`/api/sites/${siteId}/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener("change", onChange);
        es.onerror = () => {
          es?.close();
          if (!stopped) retry = setTimeout(() => void connect(), 3000);
        };
      } catch {
        if (!stopped) retry = setTimeout(() => void connect(), 5000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
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

  const insertList = (collectionId: string, at?: number) => {
    if (!page) return;
    const after = at ?? topLevelIndex(page.root, selectedId);
    const index = after === null ? undefined : after + (at === undefined ? 1 : 0);
    const created = apply([{ op: "add_collection_list", parentId: page.root.id, collectionId, index }]);
    if (created?.[0]) {
      setSelectedId(created[0]);
      setScrollTick((t) => t + 1);
    }
  };

  const insertComponent = (componentId: string, at?: number) => {
    if (!page || !doc) return;
    const comp = doc.components.find((c) => c.id === componentId);
    if (!comp) return;
    const after = at ?? topLevelIndex(page.root, selectedId);
    const index = after === null ? undefined : after + (at === undefined ? 1 : 0);
    const created = apply([{ op: "add_node", parentId: page.root.id, index, node: { type: "instance", name: comp.name, props: { componentId }, style: {} } as never }]);
    if (created?.[0]) {
      setSelectedId(created[0]);
      setScrollTick((t) => t + 1);
    }
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
      if (kind === "block" || kind === "list" || kind === "comp") {
        const idx = topLevelIndex(page.root, e.id);
        const at = idx === null ? page.root.children?.length ?? 0 : idx + (e.before ? 0 : 1);
        if (kind === "block") insertBlock(value, at);
        else if (kind === "list") insertList(value, at);
        else insertComponent(value, at);
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
    if (cmsCollection) return; // the canvas is hidden; don't delete what's selected on it
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
  const agentActive = work.agentVersions.length > 0;
  const lastAgent = work.agentVersions[0];
  const agentLive = !!lastAgent && now - new Date(lastAgent.createdAt).getTime() < 3 * 60_000;
  const isAgentBranch = work.onlyAgent || branch.startsWith("agent/") || (currentBranch?.lastChangeBy ?? "").toLowerCase().includes("claude");

  if (!doc || !page) {
    return (
      <div className="shell">
        <div className="topbar">
          <button className="btn ghost" onClick={() => navigate("/")}>
            <Icon name="back" /> Sites
          </button>
        </div>
        <div className="empty">Loading the site…</div>
      </div>
    );
  }

  const pageLabel = page.path === "/" ? "Home" : pageCollection && shownItem ? page.path.replace(":slug", shownItem.slug) : page.path;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" onClick={(e) => (e.preventDefault(), navigate("/"))} aria-label="All sites" style={{ display: "flex" }}>
          <Logo size={26} />
        </a>
        <nav className="crumbs hide-narrow" aria-label="Breadcrumb">
          <a href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
            Sites
          </a>
          <span aria-hidden="true">/</span>
          <span className="current" title={site?.name}>
            {site?.name}
          </span>
        </nav>

        {newBranch === null ? (
          <span className={`picker branch has-dot ${branch !== "main" ? (isAgentBranch ? "is-agent" : "is-human") : ""}`}>
            {branch !== "main" && <span className="dot" aria-hidden="true" />}
            <select aria-label="Branch" value={branch} onChange={(e) => (e.target.value === "__new" ? setNewBranch("") : void switchBranch(e.target.value))}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.hasChanges ? " •" : ""}
                </option>
              ))}
              {!branches.some((b) => b.name === branch) && <option value={branch}>{branch}</option>}
              <option value="__new">New branch…</option>
            </select>
            <Icon name="chevron" size={14} style={{ position: "absolute", right: 9, pointerEvents: "none", color: "var(--ink-3)" }} />
          </span>
        ) : (
          <form
            style={{ display: "flex", gap: 4 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newBranch.trim()) void createBranch(newBranch.trim().toLowerCase().replace(/\s+/g, "-"));
            }}
          >
            <input className="input mono" autoFocus aria-label="New branch name" placeholder="my-change" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} style={{ width: 150, height: 32 }} />
            <button className="btn sm primary" style={{ height: 32 }}>
              Create
            </button>
            <button type="button" className="btn sm ghost" style={{ height: 32 }} onClick={() => setNewBranch(null)}>
              Cancel
            </button>
          </form>
        )}

        <span className="picker hide-narrow">
          <select aria-label="Page" value={page.id} onChange={(e) => (setPageId(e.target.value), setSelectedId(null))}>
            {doc.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.path === "/" ? "Home" : p.path}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} style={{ position: "absolute", right: 9, pointerEvents: "none", color: "var(--ink-3)" }} />
        </span>
        {pageCollection && !cmsCollection && (
          <span className="picker cms hide-narrow" title={`Which ${pageCollection.name} item the template shows`}>
            <Icon name="database" size={13} style={{ position: "absolute", left: 9, pointerEvents: "none", color: "var(--cms)" }} />
            <select aria-label="Item shown" value={shownItem?.id ?? ""} onChange={(e) => setTemplateItem(e.target.value)} style={{ paddingLeft: 28 }}>
              {pageCollection.items.length === 0 && <option value="">Example item</option>}
              {pageCollection.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemTitle(pageCollection, i)}
                  {i.draft ? " (draft)" : ""}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={14} style={{ position: "absolute", right: 9, pointerEvents: "none", color: "var(--ink-3)" }} />
          </span>
        )}

        <div className="spacer" />
        <div className="seg" role="group" aria-label="Breakpoint">
          {BREAKPOINTS.map((b) => (
            <button key={b.bp} aria-pressed={bp === b.bp} onClick={() => setBp(b.bp)} title={`${b.label}, ${b.px} px`}>
              <Icon name={b.icon} size={14} />
              <span>{b.label}</span>
              {bp === b.bp && <span className="px">{b.px}</span>}
            </button>
          ))}
        </div>
        <div className="spacer" />

        <div className="presence hide-narrow" aria-label="People on this branch">
          <span className="avatar" title={`${me.name} (you)`}>
            {initials(me.name)}
          </span>
          {agentActive && (
            <span className={`avatar agent ${agentLive ? "live" : ""}`} title={`Claude${lastAgent ? `, last change ${ago(lastAgent.createdAt, now)}` : ""}`}>
              <Icon name="spark" size={13} />
            </span>
          )}
        </div>

        <span className="save-wrap hide-narrow" aria-live="polite">
          {ed.saveState === "saved" && <Icon name="check" size={13} style={{ color: "var(--ok)" }} />}
          <span className={`save-state ${ed.saveState === "error" || ed.saveState === "conflict" ? "error" : ""}`}>{SAVE_LABEL[ed.saveState]}</span>
          {ed.versionId > 0 && <span className="version">v{ed.versionId}</span>}
        </span>

        <button className="btn ghost icon hide-narrow" aria-label="Undo" title="Undo (⌘Z)" disabled={!ed.canUndo} onClick={ed.undo}>
          <Icon name="undo" />
        </button>
        <button className="btn ghost icon hide-narrow" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!ed.canRedo} onClick={ed.redo}>
          <Icon name="redo" />
        </button>
        <button className="btn ghost icon hide-narrow" aria-label="History" title="History" onClick={() => setDrawer("history")}>
          <Icon name="history" />
        </button>
        <button className="btn ghost icon hide-narrow" aria-label="Settings" title="Site settings" onClick={() => setDrawer("settings")}>
          <Icon name="settings" />
        </button>
        <button className="btn" onClick={() => void openPreview()}>
          <Icon name="eye" size={15} />
          Preview
        </button>
        {branch !== "main" ? (
          <button className={`btn ${isAgentBranch ? "agent" : "primary"}`} onClick={() => setDrawer("review")}>
            Review changes
            {work.count > 0 && <span className="badge">{work.count}</span>}
          </button>
        ) : (
          me.role !== "agent" && (
            <button className="btn primary" disabled={publishing} onClick={() => void publish()}>
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )
        )}
        {site?.liveUrl && branch === "main" && (
          <a className="btn ghost icon hide-narrow" href={site.liveUrl} target="_blank" rel="noreferrer" aria-label="View live site" title="View live site">
            <Icon name="external" />
          </a>
        )}
      </header>

      {ed.saveState === "conflict" && (
        <div className="callout human" style={{ borderRadius: 0, borderWidth: "0 0 1px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>Someone else saved this branch after you opened it, so your latest edit wasn't saved.</span>
          <button className="btn sm" onClick={() => void ed.reload()}>
            Load the latest version
          </button>
        </div>
      )}

      <div className="workspace">
        <aside className="rail">
          <div className="tabs" role="tablist">
            {(["layers", "insert", "pages", "cms"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  if (t === "cms") setSelectedId(null);
                }}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {tab === "layers" && (
            <label className="rail-search">
              <Icon name="search" size={13} />
              <span className="sr-only">Find a layer</span>
              <input placeholder="Find a layer" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          <div className="rail-body">
            {tab === "layers" && (
              <Layers
                root={page.root}
                selectedId={selectedId}
                onSelect={(id) => (setSelectedId(id), setScrollTick((n) => n + 1))}
                apply={(ops: Operation[]) => apply(ops)}
                agentIds={agentActive ? work.changed : undefined}
                changeLabel={work.onlyAgent ? "Claude" : "Changed"}
                filter={filter}
              />
            )}
            {tab === "insert" && (
              <Insert
                onInsertBlock={(n) => insertBlock(n)}
                onInsertElement={(k) => insertElement(k)}
                collections={doc.collections ?? []}
                onInsertList={(id) => insertList(id)}
                components={doc.components}
                brandName={doc.brand?.name}
                onInsertComponent={(id) => insertComponent(id)}
                onOpenCms={() => setTab("cms")}
              />
            )}
            {tab === "cms" && (
              <CmsRail
                doc={doc}
                activeId={cmsId}
                apply={apply}
                onOpen={(id) => {
                  setCmsId(id);
                  setCmsItemId(null);
                }}
              />
            )}
            {tab === "pages" && (
              <div style={{ paddingTop: 8 }}>
                {doc.pages.map((p) => (
                  <div key={p.id} className={`list-row ${p.id === page.id ? "active" : ""}`} onClick={() => (setPageId(p.id), setSelectedId(null))}>
                    <Icon name={p.collectionId ? "database" : "pages"} size={14} style={p.collectionId ? { color: "var(--cms)" } : undefined} />
                    <span className="grow">{p.title}</span>
                    <span className="mono muted">{p.path}</span>
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
                    <input className="input mono" aria-label="Page path" placeholder="/about" value={newPage.path} onChange={(e) => setNewPage({ ...newPage, path: e.target.value })} />
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
                      <Icon name="plus" size={13} />
                      New page
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button className="rail-foot" style={{ border: 0, borderTop: "1px solid var(--line)", background: "transparent", textAlign: "left", cursor: "pointer" }} onClick={() => setSelectedId(null)} title="Edit the theme">
            <span className="small muted">Theme</span>
            <span className="swatches">
              {Object.entries(doc.theme.colors)
                .slice(0, 6)
                .map(([name, v]) => (
                  <span key={name} className="swatch" style={{ background: String(v) }} title={`${name} ${v}`} />
                ))}
              <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>
                {fontName(doc.theme.fonts.heading)}
              </span>
            </span>
          </button>
        </aside>

        <div style={{ position: "relative", minWidth: 0, minHeight: 0, display: "grid" }}>
          {cmsCollection ? (
            <CmsTable doc={doc} collection={cmsCollection} itemId={cmsItem?.id ?? null} onSelect={setCmsItemId} apply={apply} onOpenPage={openPage} />
          ) : (
          <Canvas
            doc={doc}
            page={page}
            itemId={shownItem?.id}
            breakpoint={bp}
            selectedId={selectedId}
            zoom={1}
            scrollToSelected={scrollTick}
            onEvent={onCanvas}
            agentIds={agentActive ? work.top : undefined}
            agentLabel={work.onlyAgent ? "Claude" : "Changed on this branch"}
            pageLabel={pageLabel}
          />
          )}
          {branch !== "main" && agentActive && !cmsCollection && (
            <section className="agent-bar" aria-label="Claude's activity on this branch">
              <span className="who-line">
                <span className={`pulse ${agentLive ? "live" : ""}`} aria-hidden="true" />
                Claude on <span className="mono">{branch}</span>
              </span>
              <ol>
                {work.agentVersions.slice(0, 3).map((v) => (
                  <li key={v.id} title={v.message}>
                    {v.message}
                  </li>
                ))}
              </ol>
              <span className="when">{ago(lastAgent!.createdAt, now)}</span>
              <button className="btn sm agent-outline" onClick={() => setDrawer("review")}>
                See all changes
              </button>
            </section>
          )}
        </div>

        <aside className="inspector" aria-label="Inspector">
          {cmsCollection ? (
            cmsItem ? (
              <ItemInspector
                key={cmsItem.id}
                doc={doc}
                collection={cmsCollection}
                item={cmsItem}
                siteId={siteId}
                apply={apply}
                onClose={() => setCmsItemId(null)}
                onView={() => {
                  const tpl = doc.pages.find((p) => p.collectionId === cmsCollection.id);
                  if (tpl) openPage(tpl.id, cmsItem.id);
                }}
              />
            ) : (
              <CollectionInspector doc={doc} collection={cmsCollection} apply={apply} onDeleted={() => setCmsId(null)} onOpenPage={(id) => openPage(id)} />
            )
          ) : selected ? (
            <NodeInspector node={selected} bp={bp} apply={apply} siteId={siteId} doc={doc} isRoot={selected.id === page.root.id} bindCollection={bindingCollection(doc, page, selected.id)} />
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
      {drawer === "settings" && site && (
        <SettingsDrawer
          site={site}
          toast={toast}
          isAdmin={me.role === "admin"}
          canEdit={me.role !== "agent"}
          onClose={() => setDrawer(null)}
          onSaved={setSite}
          onBrandChanged={() => (branch === "main" ? void ed.reload() : toast("The brand is on main now. Merge or start a new branch to see it here."))}
        />
      )}
    </div>
  );
}

function fontName(stack: string): string {
  const m = /'([^']+)'|"([^"]+)"/.exec(stack);
  return (m?.[1] ?? m?.[2] ?? stack.split(",")[0] ?? "").trim();
}
