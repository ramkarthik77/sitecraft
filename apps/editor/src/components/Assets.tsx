import { useEffect, useRef, useState } from "react";
import { ApiError, ASSET_STATUS_LABEL, Brands, Library, type Brand, type LibraryAsset, type Me } from "../api";
import { useShared } from "../store";
import { PageHead } from "./Shell";
import { ago } from "../format";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Upload several files; returns the ones that made it. */
async function uploadAll(files: FileList | File[], toast: (m: { text: string; tone?: "error" }) => void): Promise<LibraryAsset[]> {
  const done: LibraryAsset[] = [];
  for (const f of [...files]) {
    try {
      done.push(await Library.upload(f));
    } catch (e) {
      toast({ text: `${f.name}: ${(e as Error).message}`, tone: "error" });
    }
  }
  if (done.length) toast({ text: done.length === 1 ? `Added ${done[0]!.title}` : `Added ${done.length} images` });
  return done;
}

export interface AssetFilters {
  status: string;
  market: string;
  brand: string;
}

function useLibrary(initial: Partial<AssetFilters> = {}) {
  const toast = useToast();
  const [items, setItems] = useState<LibraryAsset[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [filters, setFilters] = useState<AssetFilters>({ status: "", market: "", brand: "", ...initial });
  const load = () => {
    const status = filters.status === "expiring" ? "" : filters.status;
    Library.list({ q, tag, status, market: filters.market, brand: filters.brand, expiring: filters.status === "expiring" ? "30" : "" })
      .then(setItems)
      .catch((e) => toast({ text: e.message, tone: "error" }));
    Library.tags().then(setTags).catch(() => {});
  };
  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tag, filters]);
  return { items, tags, q, setQ, tag, setTag, filters, setFilters, load, toast };
}

function Toolbar(props: { lib: ReturnType<typeof useLibrary>; onFiles?: (f: FileList) => void }) {
  const { lib } = props;
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="asset-toolbar">
      <label className="search">
        <Icon name="search" size={13} />
        <span className="sr-only">Search images</span>
        <input placeholder="Search title, alt text, credit, tags" value={lib.q} onChange={(e) => lib.setQ(e.target.value)} />
      </label>
      <div className="tag-row" role="group" aria-label="Filter by tag">
        <button className={`tag ${lib.tag === "" ? "on" : ""}`} onClick={() => lib.setTag("")}>
          All
        </button>
        {lib.tags.slice(0, 12).map((t) => (
          <button key={t.tag} className={`tag ${lib.tag === t.tag ? "on" : ""}`} onClick={() => lib.setTag(lib.tag === t.tag ? "" : t.tag)}>
            {t.tag} <span className="muted">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="spacer" />
      {props.onFiles && (
        <>
          <button className="btn primary" onClick={() => file.current?.click()}>
            <Icon name="plus" size={14} /> Upload images
          </button>
          <input ref={file} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (e.target.files && props.onFiles!(e.target.files), (e.target.value = ""))} />
        </>
      )}
    </div>
  );
}

const soon = (a: LibraryAsset) => !!a.expiresAt && !a.expired && new Date(a.expiresAt).getTime() < Date.now() + 30 * 864e5;
function AssetFlag({ a }: { a: LibraryAsset }) {
  if (a.expired) return <span className="warn">Rights expired</span>;
  if (a.status !== "approved") return <span className="warn soft">{ASSET_STATUS_LABEL[a.status]}</span>;
  if (soon(a)) return <span className="warn soft">Expires {new Date(a.expiresAt!).toLocaleDateString([], { month: "short", day: "numeric" })}</span>;
  if (!a.alt) return <span className="warn soft">No alt text</span>;
  return null;
}

function Grid(props: { items: LibraryAsset[]; selected?: string | null; onPick: (a: LibraryAsset) => void; view?: "grid" | "list" }) {
  if (props.view === "list")
    return (
      <table className="dtable asset-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Job code</th>
            <th scope="col">Markets</th>
            <th scope="col">Status</th>
            <th scope="col">Rights end</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((a) => (
            <tr key={a.id} className={props.selected === a.id ? "on" : ""}>
              <td>
                <button className="at-name" onClick={() => props.onPick(a)}>
                  <img src={`${a.url}?v=${a.version}`} alt="" loading="lazy" />
                  <span>
                    <strong>{a.title || a.fileName}</strong>
                    <span className="muted small">
                      {a.contentType.replace("image/", "").toUpperCase()} · {kb(a.size)}
                    </span>
                  </span>
                </button>
              </td>
              <td className="mono small">{a.jobCode ?? "–"}</td>
              <td className="small">{a.markets.length ? a.markets.join(", ") : "All"}</td>
              <td>
                <span className={`pill p-${a.expired ? "danger" : a.status === "approved" ? "ok" : a.status === "withdrawn" ? "muted" : "warn"}`}>{a.expired ? "Expired" : ASSET_STATUS_LABEL[a.status]}</span>
              </td>
              <td className="small">{a.expiresAt ? new Date(a.expiresAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "No expiry"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div className="asset-grid">
      {props.items.map((a) => (
        <button key={a.id} className={`asset-tile ${props.selected === a.id ? "on" : ""} ${a.expired ? "expired" : ""}`} onClick={() => props.onPick(a)} title={a.title}>
          <img src={`${a.url}?v=${a.version}`} alt="" loading="lazy" style={{ objectPosition: `${a.focalX * 100}% ${a.focalY * 100}%` }} />
          <span className="cap">
            <span className="t">{a.title || a.fileName}</span>
            <AssetFlag a={a} />
          </span>
        </button>
      ))}
    </div>
  );
}

const STATUS_FACETS = [
  ["", "All assets"],
  ["approved", "Approved"],
  ["in_review", "In review"],
  ["draft", "Draft"],
  ["expiring", "Expiring in 30 days"],
  ["expired", "Rights expired"],
  ["withdrawn", "Withdrawn"],
] as const;

/** The company asset library: approved images with job codes, markets and usage rights. */
export function AssetsPage({ me }: { me: Me }) {
  const params = new URLSearchParams(location.search);
  const lib = useLibrary({ status: params.get("status") ?? "", market: params.get("market") ?? "" });
  const [open, setOpen] = useState<LibraryAsset | null>(null);
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [brands, setBrands] = useState<Brand[]>([]);
  const canEdit = me.role !== "agent" && !me.limitedToSites;
  const { sites } = useShared();
  const markets = [...new Set((sites ?? []).map((x) => x.market).filter(Boolean))].sort() as string[];
  useEffect(() => void Brands.list().then(setBrands, () => {}), []);
  // Open one asset from a link (?asset=…).
  useEffect(() => {
    const id = params.get("asset");
    if (id && lib.items && !open) {
      const hit = lib.items.find((x) => x.id === id);
      if (hit) setOpen(hit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.items]);
  const onFiles = async (files: FileList | File[]) => {
    const added = await uploadAll(files, lib.toast);
    lib.load();
    if (added.length === 1) setOpen(added[0]!);
  };
  const setF = (patch: Partial<AssetFilters>) => lib.setFilters({ ...lib.filters, ...patch });
  return (
    <main
      className={`page assets ${drag ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
      }}
    >
      <PageHead
        eyebrow="Shared libraries"
        title="Asset library"
        sub="One library of approved images for every site, with job codes, the markets each is cleared for, and usage rights. Claude picks from it too."
      />
      <div className="dam">
        <aside className="dam-facets" aria-label="Filter assets">
          <div className="facet">
            <span className="facet-h">Status</span>
            {STATUS_FACETS.map(([k, l]) => (
              <button key={k} className={`facet-opt ${lib.filters.status === k ? "on" : ""}`} aria-pressed={lib.filters.status === k} onClick={() => setF({ status: k })}>
                {l}
              </button>
            ))}
          </div>
          {markets.length > 0 && (
            <div className="facet">
              <span className="facet-h">Cleared for market</span>
              <button className={`facet-opt ${!lib.filters.market ? "on" : ""}`} aria-pressed={!lib.filters.market} onClick={() => setF({ market: "" })}>
                Any market
              </button>
              {markets.map((m) => (
                <button key={m} className={`facet-opt ${lib.filters.market === m ? "on" : ""}`} aria-pressed={lib.filters.market === m} onClick={() => setF({ market: m })}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {brands.length > 0 && (
            <div className="facet">
              <span className="facet-h">Brand</span>
              <button className={`facet-opt ${!lib.filters.brand ? "on" : ""}`} aria-pressed={!lib.filters.brand} onClick={() => setF({ brand: "" })}>
                Any brand
              </button>
              {brands.map((b) => (
                <button key={b.id} className={`facet-opt ${lib.filters.brand === b.id ? "on" : ""}`} aria-pressed={lib.filters.brand === b.id} onClick={() => setF({ brand: b.id })}>
                  {b.name}
                </button>
              ))}
              <button className={`facet-opt ${lib.filters.brand === "none" ? "on" : ""}`} aria-pressed={lib.filters.brand === "none"} onClick={() => setF({ brand: "none" })}>
                Corporate (no brand)
              </button>
            </div>
          )}
        </aside>
        <section className="card dam-main">
          <div className="dam-toolbar">
            <Toolbar lib={lib} onFiles={canEdit ? (f) => void onFiles(f) : undefined} />
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={view === "grid"} onClick={() => setView("grid")} aria-label="Grid view">
                <Icon name="grid" size={13} />
              </button>
              <button aria-pressed={view === "list"} onClick={() => setView("list")} aria-label="List view">
                <Icon name="list" size={13} />
              </button>
            </div>
          </div>
          <div className="muted small dam-count">{lib.items ? `${lib.items.length} ${lib.items.length === 1 ? "asset" : "assets"}` : "Loading…"}</div>
          <div className="asset-layout">
            <div>
              {lib.items && lib.items.length === 0 && (
                <div className="empty drop-hint">{lib.q || lib.tag || lib.filters.status || lib.filters.market || lib.filters.brand ? "No assets match." : "No images yet. Upload some, or drop files anywhere on this page."}</div>
              )}
              {lib.items && <Grid items={lib.items} selected={open?.id} onPick={setOpen} view={view} />}
            </div>
            {open && <AssetDetail key={open.id} asset={open} canEdit={canEdit} brands={brands} onClose={() => setOpen(null)} onChanged={(a) => (setOpen(a), lib.load())} onDeleted={() => (setOpen(null), lib.load())} />}
          </div>
        </section>
      </div>
      {drag && <div className="drop-overlay">Drop images to add them to the library</div>}
    </main>
  );
}

function AssetDetail(props: { asset: LibraryAsset; canEdit: boolean; brands?: Brand[]; onClose: () => void; onChanged: (a: LibraryAsset) => void; onDeleted: () => void }) {
  const toast = useToast();
  const [a, setA] = useState(props.asset);
  const [tags, setTags] = useState(props.asset.tags.join(", "));
  const [markets, setMarkets] = useState(props.asset.markets.join(", "));
  const [usage, setUsage] = useState<{ siteName: string; where: string[] }[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const replace = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Library.usage(a.id).then(setUsage).catch(() => setUsage([]));
  }, [a.id]);

  const save = async (patch: Parameters<typeof Library.update>[1]) => {
    try {
      const next = await Library.update(a.id, patch);
      setA(next);
      props.onChanged(next);
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  };

  return (
    <aside className="asset-detail" aria-label="Image details">
      <div className="asset-detail-head">
        <strong className="clip">{a.title || a.fileName}</strong>
        <button className="btn ghost icon sm" aria-label="Close" onClick={props.onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div
        className="focal"
        title={props.canEdit ? "Click the most important part of the image. Crops keep it in view." : undefined}
        onClick={(e) => {
          if (!props.canEdit) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          void save({ focalX: (e.clientX - r.left) / r.width, focalY: (e.clientY - r.top) / r.height });
        }}
      >
        <img src={`${a.url}?v=${a.version}`} alt={a.alt} />
        <span className="focal-dot" style={{ left: `${a.focalX * 100}%`, top: `${a.focalY * 100}%` }} aria-hidden="true" />
      </div>
      <span className="muted small">
        {a.width && a.height ? `${a.width} × ${a.height} · ` : ""}
        {kb(a.size)} · added by {a.createdBy} {ago(a.createdAt)}
        {props.canEdit ? " · click the image to set its focal point" : ""}
      </span>
      <fieldset className="asset-fields rights" disabled={!props.canEdit}>
        <label className="small muted" htmlFor="a-status">
          Approval
        </label>
        <select id="a-status" className="select" value={a.status} onChange={(e) => void save({ status: e.target.value as LibraryAsset["status"] })}>
          {(Object.keys(ASSET_STATUS_LABEL) as LibraryAsset["status"][]).map((k) => (
            <option key={k} value={k}>
              {ASSET_STATUS_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="small muted" htmlFor="a-code">
          Job code
        </label>
        <input id="a-code" className="input mono" defaultValue={a.jobCode ?? ""} placeholder="GLB-CAL-2600018" onBlur={(e) => e.target.value !== (a.jobCode ?? "") && void save({ jobCode: e.target.value })} />
        <label className="small muted" htmlFor="a-markets">
          Cleared for markets
        </label>
        <input
          id="a-markets"
          className="input mono"
          value={markets}
          placeholder="All markets, or e.g. US, GB"
          onChange={(e) => setMarkets(e.target.value.toUpperCase())}
          onBlur={() => void save({ markets: markets.split(/[,\s]+/).map((m) => m.trim()).filter(Boolean) })}
        />
        {props.brands && props.brands.length > 0 && (
          <>
            <label className="small muted" htmlFor="a-brand">
              Brand
            </label>
            <select id="a-brand" className="select" value={a.brandId ?? ""} onChange={(e) => void save({ brandId: e.target.value || null })}>
              <option value="">Corporate (no brand)</option>
              {props.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="small muted" htmlFor="a-exp">
          Usage rights end
        </label>
        <input id="a-exp" className="input" type="date" value={a.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => void save({ expiresAt: e.target.value || null })} />
        {a.expired && <div className="err">Rights expired: sites using it can't be published until it's replaced or renewed.</div>}
        {!a.expired && a.status !== "approved" && <div className="err soft">Not approved: sites using it can't be published.</div>}
      </fieldset>
      <fieldset className="asset-fields" disabled={!props.canEdit}>
        <label className="small muted" htmlFor="a-title">
          Title
        </label>
        <input id="a-title" className="input" defaultValue={a.title} onBlur={(e) => e.target.value !== a.title && void save({ title: e.target.value })} />
        <label className="small muted" htmlFor="a-alt">
          Alt text
        </label>
        <textarea id="a-alt" className="textarea short" defaultValue={a.alt} placeholder="Describe the image for people who can't see it" onBlur={(e) => e.target.value !== a.alt && void save({ alt: e.target.value })} />
        <label className="small muted" htmlFor="a-tags">
          Tags
        </label>
        <input id="a-tags" className="input" value={tags} placeholder="team, offsite, 2026" onChange={(e) => setTags(e.target.value)} onBlur={() => void save({ tags: tags.split(",").map((t) => t.trim()).filter(Boolean) })} />
        <label className="small muted" htmlFor="a-credit">
          Credit
        </label>
        <input id="a-credit" className="input" defaultValue={a.credit} placeholder="Photo: …" onBlur={(e) => e.target.value !== a.credit && void save({ credit: e.target.value })} />
      </fieldset>
      <div className="asset-usage">
        <strong className="small">Used on</strong>
        {usage === null ? (
          <span className="muted small">Checking…</span>
        ) : usage.length === 0 ? (
          <span className="muted small">Not used on any site's main version yet.</span>
        ) : (
          <ul>
            {usage.map((u) => (
              <li key={u.siteName} className="small">
                <b>{u.siteName}</b>: {u.where.join(", ") || "site settings"}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="asset-actions">
        <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(a.url).then(() => toast({ text: "Copied the image address" }))}>
          <Icon name="copy" size={13} /> Copy address
        </button>
        {props.canEdit && (
          <>
            <button className="btn sm" onClick={() => replace.current?.click()}>
              Replace file…
            </button>
            <input
              ref={replace}
              type="file"
              accept={a.contentType}
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const next = await Library.replace(a.id, f);
                  setA(next);
                  props.onChanged(next);
                  toast({ text: `Replaced. Every page using it now shows the new file.` });
                } catch (err) {
                  toast({ text: (err as Error).message, tone: "error" });
                }
              }}
            />
            {confirm ? (
              <button
                className="btn sm danger"
                onClick={async () => {
                  try {
                    await Library.remove(a.id, !!usage?.length);
                    props.onDeleted();
                  } catch (err) {
                    toast({ text: err instanceof ApiError ? err.message : String(err), tone: "error" });
                  }
                }}
              >
                {usage?.length ? "Delete, and break it on those sites" : "Delete image"}
              </button>
            ) : (
              <button className="btn sm ghost" onClick={() => setConfirm(true)}>
                Delete…
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** Pick an image from the library (or upload one) for an image element or CMS field. */
export function AssetPicker(props: { onPick: (a: LibraryAsset) => void; onClose: () => void }) {
  const lib = useLibrary();
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [props]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Choose an image">
        <div className="modal-head">
          <strong>Choose an image</strong>
          <button className="btn ghost icon sm" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <Toolbar
          lib={lib}
          onFiles={async (f) => {
            const added = await uploadAll(f, lib.toast);
            if (added.length === 1) props.onPick(added[0]!);
            else lib.load();
          }}
        />
        <div className="modal-body">
          {lib.items && lib.items.length === 0 && <div className="empty">No images yet. Upload one above.</div>}
          {lib.items && <Grid items={lib.items.filter((x) => !x.expired && x.status === "approved")} onPick={props.onPick} />}
          {lib.items && lib.items.some((x) => x.expired || x.status !== "approved") && <p className="muted small">Only approved images with current usage rights are shown.</p>}
        </div>
      </div>
    </div>
  );
}
