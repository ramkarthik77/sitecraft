import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Sites, type Me, type SiteSummary } from "../api";
import { navigate } from "../router";
import { useShared } from "../store";
import { Icon } from "./Icon";

/**
 * ⌘K: one place to jump to any site, page, collection or screen, or to run an
 * action. Screens add their own commands (the editor adds the open site's pages).
 */

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  keywords?: string;
  run: () => void;
}

// A tiny store: the open screen's commands, and whether the palette is open.
let screen: Command[] = [];
let state: { open: boolean; scope?: "sites" } = { open: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function setScreenCommands(cmds: Command[]) {
  screen = cmds;
  emit();
}
export function openPalette(scope?: "sites") {
  state = { open: true, scope };
  emit();
}
const closePalette = () => {
  state = { open: false };
  emit();
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const useStore = () => useSyncExternalStore(subscribe, () => state);
const useScreen = () => useSyncExternalStore(subscribe, () => screen);

/** Simple, predictable matching: every word must appear; matches at word starts rank first. */
function score(c: Command, words: string[]): number {
  if (!words.length) return 1;
  const hay = `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 4 : /[\s/·-]/.test(hay[i - 1] ?? "") ? 3 : 1;
    if (c.label.toLowerCase().startsWith(w)) s += 3;
  }
  return s;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const paletteKey = isMac ? "⌘K" : "Ctrl K";

export function CommandPalette({ me }: { me: Me }) {
  const { open, scope } = useStore();
  const cmds = useScreen();
  const [q, setQ] = useState("");
  const shared = useShared();
  const [fresh, setSites] = useState<SiteSummary[] | null>(null);
  // Sites already loaded for the sidebar show at once; a fresh list replaces them.
  const sites = fresh ?? shared.sites ?? [];
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K anywhere, even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        state.open ? closePalette() : openPalette();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    Sites.list()
      .then(setSites)
      .catch(() => {});
  }, [open]);

  const all = useMemo<Command[]>(() => {
    const go = (href: string) => () => navigate(href);
    const nav: Command[] = [
      { id: "go:home", group: "Go to", label: "Home", hint: "Command center", icon: "home", run: go("/") },
      ...(me.role !== "agent" ? [{ id: "go:work", group: "Go to", label: "My work", hint: "Everything waiting for you", icon: "inbox", keywords: "queue inbox tasks todo", run: go("/work") }] : []),
      { id: "go:sites", group: "Go to", label: "All sites", hint: "By therapy area, brand and market", icon: "globe", keywords: "directory portfolio", run: go("/sites") },
      { id: "go:reviews", group: "Go to", label: "Reviews", hint: "MLR sign-off", icon: "shield", keywords: "mlr medical legal regulatory approvals sign", run: go("/reviews") },
      { id: "go:claude", group: "Go to", label: "Claude's drafts", hint: "Branches Claude made", icon: "sparkle", keywords: "agent ai", run: go("/reviews?show=claude") },
      { id: "go:releases", group: "Go to", label: "Releases", hint: "What goes live when", icon: "calendar", keywords: "schedule calendar publish", run: go("/releases") },
      { id: "go:assets", group: "Go to", label: "Asset library", hint: "Approved images, job codes, rights", icon: "image", keywords: "images photos dam expiry", run: go("/assets") },
      { id: "go:brands", group: "Go to", label: "Brands", icon: "spark", run: go("/brands") },
      { id: "go:templates", group: "Go to", label: "Templates", icon: "pages", run: go("/templates") },
      { id: "go:components", group: "Go to", label: "Components", icon: "components", keywords: "isi safety blocks", run: go("/components") },
      ...(me.role !== "agent" ? [{ id: "go:audit", group: "Go to", label: "Audit log", hint: "Who did what, verified", icon: "audit", keywords: "history compliance trail", run: go("/audit") }] : []),
      ...(me.role !== "agent" ? [{ id: "go:settings", group: "Go to", label: "Settings", hint: "Rules and reviewers", icon: "settings", keywords: "policy disciplines job codes", run: go("/settings") }] : []),
      ...(me.role === "admin" ? [{ id: "go:access", group: "Go to", label: "Access", hint: "People and tokens", icon: "users", keywords: "users tokens invite", run: go("/access") }] : []),
      ...(me.role !== "agent" ? [{ id: "do:newsite", group: "Actions", label: "New site", icon: "plus", keywords: "create", run: go("/sites?new=1") }] : []),
    ];
    const siteCmds: Command[] = [...sites]
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .flatMap((s) => [
        { id: `site:${s.id}`, group: "Sites", label: s.name, hint: [s.market, s.liveUrl ? "Live" : "Draft"].filter(Boolean).join(" · "), icon: "globe", keywords: `${s.slug} ${s.domain ?? ""} ${s.therapyArea ?? ""} ${s.brandName ?? ""} ${s.market ?? ""} ${s.audience ?? ""} ${s.jobCode ?? ""} overview`, run: go(`/sites/${s.id}/overview`) },
        { id: `edit:${s.id}`, group: "Sites", label: `Edit ${s.name}`, hint: "Open the editor", icon: "pages", keywords: `${s.slug} editor`, run: go(`/sites/${s.id}`) },
      ]);
    return scope === "sites" ? siteCmds.filter((c) => c.id.startsWith("site:")) : [...cmds, ...siteCmds, ...nav];
  }, [cmds, sites, me.role, scope]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    const ranked = all.map((c, i) => ({ c, s: score(c, words), i })).filter((x) => x.s > 0);
    // Keep group order when not searching; rank by match when searching.
    if (words.length) ranked.sort((a, b) => b.s - a.s || a.i - b.i);
    return ranked.slice(0, 60).map((x) => x.c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    closePalette();
    c.run();
  };
  let lastGroup = "";

  return (
    <div className="cp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Quick find">
        <div className="cp-input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            aria-label="Find a site, page or action"
            placeholder={scope === "sites" ? "Switch to a site…" : "Find a site, page, collection or action…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(shown.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter") (e.preventDefault(), run(shown[active]));
              else if (e.key === "Escape") closePalette();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cp-list" ref={list} role="listbox" aria-label="Results">
          {shown.length === 0 && <div className="cp-empty muted">Nothing matches “{q}”.</div>}
          {shown.map((c, i) => {
            const head = !words.length && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="cp-group">{head}</div>}
                <button data-i={i} role="option" aria-selected={i === active} className={`cp-item ${i === active ? "on" : ""}`} onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                  <Icon name={c.icon ?? "spark"} size={14} />
                  <span className="grow">{c.label}</span>
                  {c.hint && <span className="cp-hint">{c.hint}</span>}
                  {words.length > 0 && <span className="cp-tag">{c.group}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cp-foot muted small">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span className="grow" />
          <span>{paletteKey} anywhere</span>
        </div>
      </div>
    </div>
  );
}
