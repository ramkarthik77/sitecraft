import { useEffect, useSyncExternalStore } from "react";
import { Sites, Work, type SiteSummary, type WorkCounts, type WorkItem } from "./api";

/**
 * Data many screens share (the sites list and your work queue), loaded once,
 * kept for a minute, and refreshed after changes so counts in the sidebar
 * and on Home agree.
 */

interface State {
  sites: SiteSummary[] | null;
  work: { items: WorkItem[]; counts: WorkCounts } | null;
  loadedAt: number;
}
let state: State = { sites: null, work: null, loadedAt: 0 };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
let inflight: Promise<void> | null = null;

export function refreshShared(): Promise<void> {
  inflight ??= Promise.all([
    Sites.list()
      .then((sites) => set({ sites }))
      .catch(() => set({ sites: state.sites ?? [] })),
    Work.get()
      .then((work) => set({ work }))
      .catch(() => set({ work: state.work ?? { items: [], counts: { review: 0, changes: 0, claude: 0, release: 0, asset: 0, reviewDueToday: 0, assetWithin7: 0 } } })),
  ]).then(() => {
    set({ loadedAt: Date.now() });
    inflight = null;
  });
  return inflight;
}

export function useShared() {
  const s = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => state,
  );
  useEffect(() => {
    if (Date.now() - state.loadedAt > 60_000) void refreshShared();
  }, []);
  return s;
}

export const siteById = (id: string) => state.sites?.find((s) => s.id === id || s.slug === id) ?? null;
