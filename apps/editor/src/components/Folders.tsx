import { useCallback, useEffect, useMemo, useState } from "react";
import { Folders, type Folder, type FolderKind } from "../api";
import { useToast } from "../Toasts";
import { Icon } from "./Icon";

/**
 * A folder tree for sites or library assets, like AEM's content tree: pick a
 * folder to see what's in it, make, rename and delete folders, and drop sites
 * or assets onto a folder to move them there.
 */

/** "all" shows everything, "none" what isn't in a folder, otherwise a folder id. */
export type FolderPick = "all" | "none" | string;
export const DRAG_TYPE = "application/x-sitecraft-item";

export function useFolders(kind: FolderKind) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const reload = useCallback(() => Folders.list(kind).then(setFolders, () => setFolders([])), [kind]);
  useEffect(() => void reload(), [reload]);
  return { folders, reload };
}

/** The folders from the top down to this one. */
export function folderPath(folders: Folder[], id: string | null | undefined): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  for (let at = id ? byId.get(id) : undefined; at && out.length < 50; at = at.parentId ? byId.get(at.parentId) : undefined) out.unshift(at);
  return out;
}
export const pathText = (folders: Folder[], id: string | null | undefined) => folderPath(folders, id).map((f) => f.name).join(" › ");

/** Options for a select: every folder, indented under its parent. */
export function folderOptions(folders: Folder[]): { id: string; label: string; depth: number }[] {
  const kids = new Map<string | null, Folder[]>();
  for (const f of folders) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f]);
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: f.id, label: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function FolderSelect({ folders, value, onChange, label, rootLabel = "No folder (top level)" }: { folders: Folder[]; value: string | null; onChange: (id: string | null) => void; label: string; rootLabel?: string }) {
  return (
    <select className="select" aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{rootLabel}</option>
      {folderOptions(folders).map((o) => (
        <option key={o.id} value={o.id}>
          {" ".repeat(o.depth)}
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Where you are in the tree, with each level clickable. */
export function FolderCrumbs({ folders, current, onPick, rootLabel }: { folders: Folder[]; current: FolderPick; onPick: (p: FolderPick) => void; rootLabel: string }) {
  const path = current === "all" || current === "none" ? [] : folderPath(folders, current);
  return (
    <nav className="fcrumbs" aria-label="Folder">
      <button onClick={() => onPick("all")} aria-current={current === "all" ? "true" : undefined}>
        <Icon name="folder" size={13} /> {rootLabel}
      </button>
      {current === "none" && (
        <span>
          <Icon name="chevronRight" size={11} /> <strong>Not in a folder</strong>
        </span>
      )}
      {path.map((f, i) => (
        <span key={f.id}>
          <Icon name="chevronRight" size={11} />
          {i === path.length - 1 ? <strong>{f.name}</strong> : <button onClick={() => onPick(f.id)}>{f.name}</button>}
        </span>
      ))}
    </nav>
  );
}

export function FolderTree(props: {
  kind: FolderKind;
  folders: Folder[] | null;
  current: FolderPick;
  onPick: (p: FolderPick) => void;
  onChanged: () => void;
  /** Move something dropped on a folder (null: out of any folder). */
  onDropItem?: (itemId: string, folderId: string | null) => void;
  canEdit: boolean;
  rootLabel: string;
  total?: number;
  unfiled?: number;
}) {
  const { folders, current, onPick, canEdit } = props;
  const toast = useToast();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null | undefined>(undefined); // parent id, null for top level
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const kids = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders ?? []) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    for (const l of m.values()) l.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);
  // Keep the way to the current folder open.
  useEffect(() => {
    if (!folders || current === "all" || current === "none") return;
    setOpen((o) => new Set([...o, ...folderPath(folders, current).map((f) => f.id)]));
  }, [folders, current]);

  const fail = (e: unknown) => toast({ text: (e as Error).message, tone: "error" });
  const create = async (parentId: string | null) => {
    if (!text.trim()) return setAdding(undefined);
    try {
      const f = await Folders.create(props.kind, text.trim(), parentId);
      setAdding(undefined);
      setText("");
      if (parentId) setOpen((o) => new Set([...o, parentId]));
      props.onChanged();
      onPick(f.id);
    } catch (e) {
      fail(e);
    }
  };
  const rename = async (f: Folder) => {
    setRenaming(null);
    if (!text.trim() || text.trim() === f.name) return;
    await Folders.update(f.id, { name: text.trim() }).then(props.onChanged, fail);
  };
  const remove = async (f: Folder) => {
    if (!confirm(`Delete the folder "${f.name}"? What's in it moves up a level; nothing else is deleted.`)) return;
    await Folders.remove(f.id).then(() => {
      toast({ text: `Deleted ${f.name}. Its contents moved up a level.` });
      if (current === f.id) onPick(f.parentId ?? "all");
      props.onChanged();
    }, fail);
  };
  const dropProps = (folderId: string | null) =>
    props.onDropItem
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            setOver(folderId ?? "root");
          },
          onDragLeave: () => setOver(null),
          onDrop: (e: React.DragEvent) => {
            const raw = e.dataTransfer.getData(DRAG_TYPE);
            setOver(null);
            if (!raw) return;
            e.preventDefault();
            const item = JSON.parse(raw) as { kind: FolderKind; id: string };
            if (item.kind === props.kind) props.onDropItem!(item.id, folderId);
          },
        }
      : {};

  const input = (onDone: () => void, placeholder: string) => (
    <input
      className="input ftree-input"
      autoFocus
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") (setText(""), setAdding(undefined), setRenaming(null));
      }}
    />
  );

  const branch = (parent: string | null, depth: number): React.ReactNode => (
    <>
      {(kids.get(parent) ?? []).map((f) => {
        const has = (kids.get(f.id)?.length ?? 0) > 0;
        const isOpen = open.has(f.id);
        return (
          <li key={f.id} role="treeitem" aria-expanded={has ? isOpen : undefined} aria-selected={current === f.id}>
            <div className={`ftree-row ${current === f.id ? "on" : ""} ${over === f.id ? "over" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} {...dropProps(f.id)}>
              <button className="ftree-twist" aria-label={isOpen ? `Collapse ${f.name}` : `Expand ${f.name}`} disabled={!has} onClick={() => setOpen((o) => (o.has(f.id) ? new Set([...o].filter((x) => x !== f.id)) : new Set([...o, f.id])))}>
                {has && <Icon name={isOpen ? "chevron" : "chevronRight"} size={11} />}
              </button>
              {renaming === f.id ? (
                input(() => void rename(f), "Folder name")
              ) : (
                <button className="ftree-name" onClick={() => onPick(f.id)} title={f.name}>
                  <Icon name="folder" size={13} />
                  <span className="grow">{f.name}</span>
                  {f.count > 0 && <span className="ftree-n">{f.count}</span>}
                </button>
              )}
              {canEdit && renaming !== f.id && (
                <span className="ftree-acts">
                  <button aria-label={`New folder in ${f.name}`} title="New folder inside" onClick={() => (setText(""), setAdding(f.id), setOpen((o) => new Set([...o, f.id])))}>
                    <Icon name="plus" size={11} />
                  </button>
                  <button aria-label={`Rename ${f.name}`} title="Rename" onClick={() => (setText(f.name), setRenaming(f.id))}>
                    <Icon name="pen" size={11} />
                  </button>
                  <button aria-label={`Delete ${f.name}`} title="Delete folder" onClick={() => void remove(f)}>
                    <Icon name="trash" size={11} />
                  </button>
                </span>
              )}
            </div>
            {(isOpen || adding === f.id) && (
              <ul role="group">
                {branch(f.id, depth + 1)}
                {adding === f.id && <li style={{ paddingLeft: 26 + (depth + 1) * 14 }}>{input(() => void create(f.id), "New folder name")}</li>}
              </ul>
            )}
          </li>
        );
      })}
    </>
  );

  return (
    <div className="ftree">
      <div className="ftree-head">
        <span className="facet-h">Folders</span>
        {canEdit && (
          <button className="btn ghost sm" onClick={() => (setText(""), setAdding(current !== "all" && current !== "none" ? current : null))}>
            <Icon name="plus" size={12} /> New folder
          </button>
        )}
      </div>
      <ul role="tree" aria-label={`${props.rootLabel} folders`}>
        <li role="treeitem" aria-selected={current === "all"}>
          <div className={`ftree-row ${current === "all" ? "on" : ""}`}>
            <span className="ftree-twist" />
            <button className="ftree-name" onClick={() => onPick("all")}>
              <Icon name="grid" size={13} />
              <span className="grow">{props.rootLabel}</span>
              {props.total !== undefined && <span className="ftree-n">{props.total}</span>}
            </button>
          </div>
        </li>
        {branch(null, 0)}
        {adding === null && <li style={{ paddingLeft: 26 }}>{input(() => void create(null), "New folder name")}</li>}
        <li role="treeitem" aria-selected={current === "none"}>
          <div className={`ftree-row ${current === "none" ? "on" : ""} ${over === "root" ? "over" : ""}`} {...dropProps(null)}>
            <span className="ftree-twist" />
            <button className="ftree-name muted" onClick={() => onPick("none")}>
              <Icon name="inbox" size={13} />
              <span className="grow">Not in a folder</span>
              {!!props.unfiled && <span className="ftree-n">{props.unfiled}</span>}
            </button>
          </div>
        </li>
      </ul>
      {folders && folders.length === 0 && <p className="muted small ftree-hint">Make folders to organise by therapy area, brand, campaign or anything else. Drag items onto a folder to move them.</p>}
    </div>
  );
}
