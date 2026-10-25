import { useEffect, useMemo, useState } from "react";
import type { SiteDocument } from "@sitecraft/schema";
import { audienceLabel, Sites, type Me, type SiteSummary } from "../api";
import { DocThumb } from "../App";
import { ago } from "../format";
import { setQuery } from "../router";
import { useToast } from "../Toasts";
import { DRAG_TYPE, FolderCrumbs, FolderTree, pathText, useFolders, type FolderPick } from "./Folders";
import { refreshShared, useShared } from "../store";
import { NewSiteDialog } from "./Home";
import { Icon } from "./Icon";
import { go, PageHead, Pill, siteUrl } from "./Shell";

/** The portfolio: every site, filed by therapy area › brand › market › audience. */

export function siteStatus(s: SiteSummary): { label: string; tone: "ok" | "human" | "warn" | "muted" } {
  if (s.openReviews) return { label: "In review", tone: "human" };
  if (s.nextRelease) return { label: "Scheduled", tone: "warn" };
  if (s.liveUrl) return { label: "Live", tone: "ok" };
  return { label: "Draft", tone: "muted" };
}

/** A stable colour per brand, for the little site marks. */
const HUES = [222, 168, 262, 32, 340, 200, 128, 12];
export function brandHue(name: string | null | undefined) {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}
export function SiteMark({ site, size = 32 }: { site: SiteSummary; size?: number }) {
  const hue = brandHue(site.brandName ?? site.name);
  return (
    <span className="site-mark" aria-hidden="true" style={{ width: size, height: size, background: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 80% 82%)`, borderColor: `hsl(${hue} 40% 32%)` }}>
      {(site.brandName ?? site.name).charAt(0).toUpperCase()}
    </span>
  );
}

export const portfolioPath = (s: SiteSummary) => [s.therapyArea, s.brandName, s.market, audienceLabel(s.audience)].filter(Boolean) as string[];

export function SiteTile({ site }: { site: SiteSummary }) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  useEffect(() => {
    Sites.head(site.id, "main")
      .then((h) => setDoc(h.document))
      .catch(() => {});
  }, [site.id]);
  const st = siteStatus(site);
  const href = siteUrl(site.id);
  return (
    <a className="tile" href={href} onClick={go(href)}>
      <DocThumb doc={doc} />
      <span className="tile-meta">
        <span className="tile-name">
          <strong>{site.name}</strong>
          <Pill tone={st.tone}>{st.label}</Pill>
        </span>
        <span className="muted small">{[site.jobCode, site.updatedAt ? `edited ${ago(site.updatedAt)}` : ""].filter(Boolean).join(" · ") || " "}</span>
      </span>
    </a>
  );
}

const FACETS = [
  ["therapy", "Therapy area", (s: SiteSummary) => s.therapyArea ?? ""],
  ["brand", "Brand", (s: SiteSummary) => s.brandName ?? ""],
  ["market", "Market", (s: SiteSummary) => s.market ?? ""],
  ["audience", "Audience", (s: SiteSummary) => audienceLabel(s.audience)],
  ["status", "Status", (s: SiteSummary) => siteStatus(s).label],
] as const;

export function SitesDirectory({ me }: { me: Me }) {
  const { sites } = useShared();
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(FACETS.map(([k]) => [k, params.get(k) ?? ""])));
  const [view, setView] = useState<"list" | "grouped">(params.get("view") === "grouped" ? "grouped" : "list");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [folder, setFolder] = useState<FolderPick>(params.get("folder") ?? "all");
  const { folders, reload: reloadFolders } = useFolders("site");
  const toast = useToast();
  useEffect(
    () => setQuery({ q: q || null, view: view === "grouped" ? view : null, folder: folder === "all" ? null : folder, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])) }),
    [q, f, view, folder],
  );
  const moveSite = async (siteId: string, folderId: string | null) => {
    try {
      await Sites.setFolder(siteId, folderId);
      const name = sites?.find((x) => x.id === siteId)?.name ?? "Site";
      toast({ text: folderId ? `Moved ${name} to ${pathText(folders ?? [], folderId)}` : `Moved ${name} out of its folder` });
      void refreshShared();
      void reloadFolders();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };

  const all = sites ?? [];
  const options = useMemo(() => Object.fromEntries(FACETS.map(([k, , get]) => [k, [...new Set(all.map(get).filter(Boolean))].sort()])), [all]);
  const inFolder = (s: SiteSummary) => (folder === "all" ? true : folder === "none" ? !s.folderId : s.folderId === folder);
  const subfolders = folder === "all" || folder === "none" ? [] : (folders ?? []).filter((x) => x.parentId === folder).sort((a, b) => a.name.localeCompare(b.name));
  const shown = all.filter((s) => {
    if (!inFolder(s)) return false;
    if (q && !`${s.name} ${s.slug} ${s.domain ?? ""} ${s.jobCode ?? ""} ${portfolioPath(s).join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
    return FACETS.every(([k, , get]) => !f[k] || get(s) === f[k]);
  });
  const markets = new Set(shown.map((s) => s.market).filter(Boolean)).size;
  const filtered = !!q || Object.values(f).some(Boolean);
  const canCreate = me.role !== "agent" && !me.limitedToSites;

  // Grouped: therapy area › brand, with the sites (one per market and audience) under each.
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, SiteSummary[]>>();
    for (const s of shown) {
      const ta = s.therapyArea ?? "Not filed yet";
      const br = s.brandName ?? "No brand";
      if (!m.has(ta)) m.set(ta, new Map());
      const g = m.get(ta)!;
      if (!g.has(br)) g.set(br, []);
      g.get(br)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "Not filed yet" ? 1 : b === "Not filed yet" ? -1 : a.localeCompare(b)));
  }, [shown]);

  return (
    <main className="page">
      <PageHead
        eyebrow="Site directory"
        title="All sites"
        sub="Browse the portfolio by therapy area, brand, market and audience."
        actions={
          canCreate && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> Create site
            </button>
          )
        }
      />
      <div className="dir-layout">
      <aside className="dir-tree card">
        <FolderTree
          kind="site"
          folders={folders}
          current={folder}
          onPick={setFolder}
          onChanged={() => (void reloadFolders(), void refreshShared())}
          onDropItem={canCreate ? (id, to) => void moveSite(id, to) : undefined}
          canEdit={canCreate}
          rootLabel="All sites"
          total={all.length}
          unfiled={all.filter((x) => !x.folderId).length}
        />
      </aside>
      <section className="card">
        <div className="dir-bar">
          <FolderCrumbs folders={folders ?? []} current={folder} onPick={setFolder} rootLabel="All sites" />
        </div>
        <div className="dir-tools">
          <label className="search">
            <Icon name="search" size={13} />
            <span className="sr-only">Search sites</span>
            <input placeholder="Search name, domain or job code" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {FACETS.map(([k, label]) => (
            <select key={k} className="select" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
              <option value="">{label}: all</option>
              {options[k]!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          {filtered && (
            <button className="btn ghost sm" onClick={() => (setQ(""), setF(Object.fromEntries(FACETS.map(([k]) => [k, ""]))))}>
              Clear
            </button>
          )}
          <span className="grow" />
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>
              <Icon name="list" size={13} /> List
            </button>
            <button aria-pressed={view === "grouped"} onClick={() => setView("grouped")}>
              <Icon name="folder" size={13} /> By brand
            </button>
          </div>
        </div>
        <div className="dir-count muted small">
          {!sites
            ? "Loading…"
            : folder === "all"
              ? `Showing ${shown.length} of ${all.length} ${all.length === 1 ? "site" : "sites"}${markets ? ` · ${markets} ${markets === 1 ? "market" : "markets"}` : ""}`
              : `${subfolders.length ? `${subfolders.length} ${subfolders.length === 1 ? "folder" : "folders"} · ` : ""}${shown.length} ${shown.length === 1 ? "site" : "sites"} here`}
        </div>
        {sites && all.length === 0 && (
          <div className="empty-state">
            <strong>No sites yet</strong>
            <span>Create one from a template, or ask Claude to build one for you.</span>
          </div>
        )}
        {sites && all.length > 0 && shown.length === 0 && subfolders.length === 0 && (
          <div className="empty">{folder !== "all" && !filtered ? "This folder is empty. Drag sites here from All sites, or create one." : "No sites match. Clear the search or a filter."}</div>
        )}

        {view === "list" && (shown.length > 0 || subfolders.length > 0) && (
          <table className="dtable">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Therapy area › brand › market › audience</th>
                <th scope="col">Pages</th>
                <th scope="col">Work</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {subfolders.map((sf) => (
                <tr key={sf.id} className="folder-row">
                  <td colSpan={5}>
                    <button className="dt-site as-btn" onClick={() => setFolder(sf.id)}>
                      <span className="site-mark folder-mark" aria-hidden="true">
                        <Icon name="folder" size={15} />
                      </span>
                      <span>
                        <strong>{sf.name}</strong>
                        <span className="muted small">
                          Folder · {sf.count} {sf.count === 1 ? "site" : "sites"}
                          {(folders ?? []).some((x) => x.parentId === sf.id) ? " and more folders" : ""}
                        </span>
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
              {shown.map((s) => {
                const st = siteStatus(s);
                const href = siteUrl(s.id);
                const path = portfolioPath(s);
                return (
                  <tr
                    key={s.id}
                    draggable={canCreate}
                    onDragStart={(e) => (e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "site", id: s.id })), (e.dataTransfer.effectAllowed = "move"))}
                    title={canCreate ? "Drag onto a folder to move it" : undefined}
                  >
                    <td>
                      <a className="dt-site" href={href} onClick={go(href)}>
                        <SiteMark site={s} />
                        <span>
                          <strong>{s.name}</strong>
                          <span className="muted small">{s.domain ?? (s.liveUrl ? s.liveUrl.replace(/^https?:\/\//, "") : `${s.slug} · not published`)}</span>
                        </span>
                      </a>
                    </td>
                    <td className="dt-path">
                      {path.length ? (
                        path.map((p, i) => (
                          <span key={i}>
                            {i > 0 && <Icon name="chevronRight" size={10} />}
                            {p}
                          </span>
                        ))
                      ) : (
                        <a className="muted small" href={siteUrl(s.id, "settings")} onClick={go(siteUrl(s.id, "settings"))}>
                          Not filed yet. Add it in Settings
                        </a>
                      )}
                    </td>
                    <td className="muted">{s.pageCount ?? "–"}</td>
                    <td>
                      <span className="dt-work">
                        {!!s.openReviews && <Pill tone="human">{s.openReviews} in review</Pill>}
                        {!!s.claudeBranches && <Pill tone="agent">{s.claudeBranches} from Claude</Pill>}
                        {!s.openReviews && !s.claudeBranches && <span className="muted small">–</span>}
                      </span>
                    </td>
                    <td>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {view === "grouped" && (
          <div className="dir-groups">
            {groups.map(([ta, brands]) => (
              <section key={ta} className="dg">
                <h2>
                  {ta} <span className="muted small">{[...brands.values()].flat().length}</span>
                </h2>
                {[...brands.entries()].map(([br, list]) => (
                  <div key={br} className="dg-brand">
                    <h3>{br}</h3>
                    <div className="dg-sites">
                      {list
                        .sort((a, b) => `${a.market}${a.audience}`.localeCompare(`${b.market}${b.audience}`))
                        .map((s) => {
                          const st = siteStatus(s);
                          return (
                            <a key={s.id} className="dg-site" href={siteUrl(s.id)} onClick={go(siteUrl(s.id))}>
                              <span className="dg-market">{s.market ?? "—"}</span>
                              <span className="grow">
                                <strong>{s.name}</strong>
                                <span className="muted small">{[audienceLabel(s.audience), s.jobCode].filter(Boolean).join(" · ") || s.slug}</span>
                              </span>
                              <Pill tone={st.tone}>{st.label}</Pill>
                            </a>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>
      </div>
      {creating && <NewSiteDialog folderId={folder !== "all" && folder !== "none" ? folder : null} onClose={() => setCreating(false)} />}
    </main>
  );
}
