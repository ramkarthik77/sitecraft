import { useEffect, useRef, useState } from "react";
import { ApiError, Library, type LibraryAsset, type Me } from "../api";
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

function useLibrary() {
  const toast = useToast();
  const [items, setItems] = useState<LibraryAsset[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const load = () => {
    Library.list({ q, tag })
      .then(setItems)
      .catch((e) => toast({ text: e.message, tone: "error" }));
    Library.tags().then(setTags).catch(() => {});
  };
  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tag]);
  return { items, tags, q, setQ, tag, setTag, load, toast };
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

function Grid(props: { items: LibraryAsset[]; selected?: string | null; onPick: (a: LibraryAsset) => void }) {
  return (
    <div className="asset-grid">
      {props.items.map((a) => (
        <button key={a.id} className={`asset-tile ${props.selected === a.id ? "on" : ""} ${a.expired ? "expired" : ""}`} onClick={() => props.onPick(a)} title={a.title}>
          <img src={`${a.url}?v=${a.version}`} alt="" loading="lazy" style={{ objectPosition: `${a.focalX * 100}% ${a.focalY * 100}%` }} />
          <span className="cap">
            <span className="t">{a.title || a.fileName}</span>
            {a.expired ? <span className="warn">Expired</span> : !a.alt ? <span className="warn soft">No alt text</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The company image library. */
export function AssetsPage({ me }: { me: Me }) {
  const lib = useLibrary();
  const [open, setOpen] = useState<LibraryAsset | null>(null);
  const [drag, setDrag] = useState(false);
  const canEdit = me.role !== "agent";
  const onFiles = async (files: FileList | File[]) => {
    const added = await uploadAll(files, lib.toast);
    lib.load();
    if (added.length === 1) setOpen(added[0]!);
  };
  return (
    <main
      className={`dash-main assets ${drag ? "dragging" : ""}`}
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
      <div className="dash-head">
        <h1>Assets</h1>
        <span className="muted">One image library for every site. Claude picks from it too.</span>
      </div>
      <Toolbar lib={lib} onFiles={canEdit ? (f) => void onFiles(f) : undefined} />
      <div className="asset-layout">
        <div>
          {lib.items && lib.items.length === 0 && (
            <div className="empty drop-hint">{lib.q || lib.tag ? "No images match." : "No images yet. Upload some, or drop files anywhere on this page."}</div>
          )}
          {lib.items && <Grid items={lib.items} selected={open?.id} onPick={setOpen} />}
        </div>
        {open && <AssetDetail key={open.id} asset={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={(a) => (setOpen(a), lib.load())} onDeleted={() => (setOpen(null), lib.load())} />}
      </div>
      {drag && <div className="drop-overlay">Drop images to add them to the library</div>}
    </main>
  );
}

function AssetDetail(props: { asset: LibraryAsset; canEdit: boolean; onClose: () => void; onChanged: (a: LibraryAsset) => void; onDeleted: () => void }) {
  const toast = useToast();
  const [a, setA] = useState(props.asset);
  const [tags, setTags] = useState(props.asset.tags.join(", "));
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
        <label className="small muted" htmlFor="a-exp">
          Usage rights end
        </label>
        <input id="a-exp" className="input" type="date" value={a.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => void save({ expiresAt: e.target.value || null })} />
        {a.expired && <div className="err">Expired: this image is no longer served on any site.</div>}
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
          {lib.items && <Grid items={lib.items.filter((x) => !x.expired)} onPick={props.onPick} />}
        </div>
      </div>
    </div>
  );
}
