import { useEffect, useState } from "react";

export function navigate(to: string) {
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return loc;
}

export function setQuery(params: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? `?${s}` : ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
