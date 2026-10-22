import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLLECTION_PRESETS,
  FIELD_TYPES,
  checkFieldValue,
  findInTree,
  formatValue,
  itemTitle,
  itemUrl,
  slugify,
  uniqueName,
  templatePageOf,
  type Collection,
  type CollectionField,
  type CollectionItem,
  type FieldType,
  type Operation,
  type Page,
  type SiteDocument,
  type SiteNode,
} from "@sitecraft/schema";
import { renderMarkdown } from "@sitecraft/renderer";
import { Sites } from "../api";
import { AssetPicker } from "./Assets";
import { Icon } from "./Icon";

type Apply = (ops: Operation[], coalesceKey?: string) => (string | null)[] | null;

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  richtext: "Rich text",
  image: "Image",
  date: "Date",
  link: "Link",
  number: "Number",
  boolean: "Yes / no",
};

const PRESET_HINT: Record<string, string> = {
  blog: "Posts with a cover image, date, author and body",
  team: "People with a role, photo and bio",
  products: "Products with a price, image and buy link",
  jobs: "Openings with a location, team and apply link",
  blank: "Just a title; add your own fields",
};

// ---------------------------------------------------------------------------
// Left rail: the list of collections.

export function CmsRail(props: { doc: SiteDocument; activeId: string | null; onOpen: (id: string) => void; apply: Apply }) {
  const collections = props.doc.collections ?? [];
  const [creating, setCreating] = useState(collections.length === 0);
  const [preset, setPreset] = useState("blog");
  const [name, setName] = useState("Blog");

  const create = () => {
    const created = props.apply([{ op: "add_collection", name: name.trim() || COLLECTION_PRESETS[preset]!.name, preset }]);
    if (created?.[0]) {
      setCreating(false);
      props.onOpen(created[0]);
    }
  };

  return (
    <div style={{ paddingTop: 8 }}>
      {collections.map((c) => (
        <div key={c.id} className={`list-row ${c.id === props.activeId ? "active" : ""}`} onClick={() => props.onOpen(c.id)}>
          <Icon name="database" size={14} />
          <span className="grow">{c.name}</span>
          <span className="muted small">{c.items.length}</span>
        </div>
      ))}
      {creating ? (
        <form
          className="cms-new"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="section-title" style={{ padding: "0 0 2px" }}>
            New collection
          </div>
          <div className="preset-list" role="radiogroup" aria-label="Start from">
            {Object.entries(COLLECTION_PRESETS).map(([key, p]) => (
              <button
                type="button"
                key={key}
                role="radio"
                aria-checked={preset === key}
                className="preset"
                onClick={() => {
                  setPreset(key);
                  setName(p.name);
                }}
              >
                <span className="name">{key === "blank" ? "Blank" : p.name}</span>
                <span className="hint">{PRESET_HINT[key]}</span>
              </button>
            ))}
          </div>
          <label className="small muted" htmlFor="cms-name">
            Name
          </label>
          <input id="cms-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="muted small">Adds a list page and a page template, so each item gets its own page.</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn sm primary" disabled={!name.trim()}>
              Create collection
            </button>
            {collections.length > 0 && (
              <button type="button" className="btn sm ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div style={{ padding: 12 }}>
          <button className="btn sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} />
            New collection
          </button>
        </div>
      )}
      <p className="muted small" style={{ padding: "4px 16px", lineHeight: 1.5 }}>
        Collections hold content like posts or products. Show them with a list from Insert, and design each item's page on its template.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Center: the item table.

function cellText(c: Collection, f: CollectionField, item: CollectionItem, lang: string): string {
  const v = item.values[f.id];
  if (f.type === "richtext" && typeof v === "string") return v.replace(/[#*_`>[\]()-]/g, "").replace(/\s+/g, " ").trim();
  return formatValue(f, v, lang);
}

export function CmsTable(props: {
  doc: SiteDocument;
  collection: Collection;
  itemId: string | null;
  onSelect: (id: string | null) => void;
  apply: Apply;
  onOpenPage: (pageId: string, itemId?: string) => void;
}) {
  const { doc, collection: c } = props;
  const [query, setQuery] = useState("");
  const shown = c.fields.slice(1).filter((f) => f.type !== "boolean" && f.type !== "image").slice(0, 3);
  const image = c.fields.find((f) => f.type === "image");
  const template = templatePageOf(doc, c.id);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return c.items;
    return c.items.filter((i) => i.slug.includes(q) || Object.values(i.values).some((v) => String(v).toLowerCase().includes(q)));
  }, [c.items, query]);

  const add = () => {
    const values: Record<string, string> = { [c.fields[0]!.id]: "Untitled" };
    const date = c.fields.find((f) => f.type === "date");
    if (date) values[date.id] = new Date().toISOString().slice(0, 10);
    const created = props.apply([{ op: "add_item", collectionId: c.id, values, draft: true }]);
    if (created?.[0]) props.onSelect(created[0]);
  };

  return (
    <div className="cms-view" onClick={(e) => e.target === e.currentTarget && props.onSelect(null)}>
      <div className="cms-head">
        <div>
          <h2>{c.name}</h2>
          <span className="muted small">
            {c.items.length} {c.items.length === 1 ? "item" : "items"}
            {template ? (
              <>
                {" · "}pages at <span className="mono">{template.path}</span>
              </>
            ) : (
              " · no item pages"
            )}
          </span>
        </div>
        <div className="spacer" />
        <label className="rail-search cms-search">
          <Icon name="search" size={13} />
          <span className="sr-only">Search items</span>
          <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {template && (
          <button className="btn" onClick={() => props.onOpenPage(template.id)}>
            <Icon name="pages" size={14} />
            Edit template
          </button>
        )}
        <button className="btn" onClick={() => props.onSelect(null)} aria-pressed={props.itemId === null}>
          <Icon name="settings" size={14} />
          Fields
        </button>
        <button className="btn primary" onClick={add}>
          <Icon name="plus" size={14} />
          New item
        </button>
      </div>
      {c.items.length === 0 ? (
        <div className="empty" style={{ textAlign: "center" }}>
          No items yet. Click <b>New item</b>, or ask Claude to add some.
        </div>
      ) : (
        <table className="table cms-table">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>{c.fields[0]!.name}</th>
              {shown.map((f) => (
                <th key={f.id}>{f.name}</th>
              ))}
              <th style={{ width: 90 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const thumb = image ? item.values[image.id] : undefined;
              return (
                <tr key={item.id} className={item.id === props.itemId ? "active" : ""} onClick={() => props.onSelect(item.id)}>
                  <td>
                    <span className="cms-title">
                      {image && (thumb ? <img src={String(thumb)} alt="" /> : <span className="thumb-empty" aria-hidden="true" />)}
                      <span>
                        <span className="t">{itemTitle(c, item)}</span>
                        <span className="mono muted s">{item.slug}</span>
                      </span>
                    </span>
                  </td>
                  {shown.map((f) => (
                    <td key={f.id} className="muted clip">
                      {cellText(c, f, item, doc.settings.lang)}
                    </td>
                  ))}
                  <td>
                    <span className={`status ${item.draft ? "draft" : "live"}`} style={{ marginLeft: 0 }}>
                      {item.draft ? "Draft" : "Published"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {items.length === 0 && c.items.length > 0 && <div className="empty">No items match “{query}”.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel: one item's fields.

/** An input that keeps what you type and only saves values the field accepts. */
function CheckedInput(props: { field: CollectionField; value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState("");
  useEffect(() => setDraft(props.value), [props.value]);
  const save = (v: string) => {
    const why = v === "" ? null : checkFieldValue(props.field, v);
    setError(why ? `${props.field.name} ${why}.` : "");
    if (!why && v !== props.value) props.onSave(v);
  };
  return (
    <>
      <input
        className="input"
        aria-label={props.field.name}
        value={draft}
        placeholder={props.placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError("");
        }}
        onBlur={() => save(draft.trim())}
        onKeyDown={(e) => e.key === "Enter" && save(draft.trim())}
      />
      {error && <div className="err">{error}</div>}
    </>
  );
}

function RichText(props: { field: CollectionField; value: string; onChange: (v: string) => void }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="rich-field">
      <div className="seg small-seg" role="group" aria-label={`${props.field.name} view`}>
        <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="rich-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(props.value) || "<p>Nothing written yet.</p>" }} />
      ) : (
        <textarea className="textarea rich" aria-label={props.field.name} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
      <span className="muted small">
        <span className="mono">## Heading</span> · <span className="mono">**bold**</span> · <span className="mono">- list</span> · <span className="mono">[link](https://…)</span>
      </span>
    </div>
  );
}

function ImageField(props: { field: CollectionField; value: string; siteId: string; onSave: (v: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <div className="image-field">
      {picking && <AssetPicker onClose={() => setPicking(false)} onPick={(a) => (setPicking(false), props.onSave(a.url))} />}
      {props.value ? <img src={props.value} alt="" /> : <span className="thumb-empty large" aria-hidden="true" />}
      <CheckedInput field={props.field} value={props.value} placeholder="https://… or upload" onSave={props.onSave} />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn sm" onClick={() => setPicking(true)}>
          Choose from library
        </button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {props.value && (
          <button type="button" className="btn sm ghost" onClick={() => props.onSave("")}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            props.onSave((await Sites.upload(props.siteId, f)).url);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

export function ItemInspector(props: {
  doc: SiteDocument;
  collection: Collection;
  item: CollectionItem;
  siteId: string;
  apply: Apply;
  onClose: () => void;
  onView: () => void;
}) {
  const { collection: c, item, apply } = props;
  const key = (f: string) => `item:${item.id}:${f}`;
  const set = (f: string, v: string | number | boolean | null) => apply([{ op: "update_item", collectionId: c.id, itemId: item.id, values: { [f]: v } }], key(f));
  // The slug follows the title until someone changes it by hand.
  const titleKey = c.fields[0]!.id;
  const setTitle = (v: string) => {
    const old = slugify(String(item.values[titleKey] ?? ""));
    // Only for drafts: a published item keeps its address.
    const auto = !!item.draft && (item.slug === old || new RegExp(`^${old}-\\d+$`).test(item.slug));
    const taken = new Set(c.items.filter((x) => x !== item).map((x) => x.slug));
    const slug = auto && v.trim() ? uniqueName(slugify(v), taken) : undefined;
    apply([{ op: "update_item", collectionId: c.id, itemId: item.id, values: { [titleKey]: v || null }, ...(slug && slug !== item.slug ? { slug } : {}) }], key(titleKey));
  };
  const index = c.items.indexOf(item);
  const url = itemUrl(props.doc, c, item);
  const [slug, setSlug] = useState(item.slug);
  useEffect(() => setSlug(item.slug), [item.slug]);

  return (
    <div>
      <div className="group">
        <h3>
          <span className="clip">{itemTitle(c, item)}</span>
          <button className="btn ghost icon sm" aria-label="Close item" onClick={props.onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>
        <label className="check">
          <input type="checkbox" checked={!!item.draft} onChange={(e) => apply([{ op: "update_item", collectionId: c.id, itemId: item.id, draft: e.target.checked }])} />
          Draft (left out when you publish)
        </label>
        {url && (
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={props.onView}>
            <Icon name="eye" size={13} />
            View on its page
          </button>
        )}
      </div>
      <div className="group">
        {c.fields.map((f) => {
          const v = item.values[f.id];
          const str = typeof v === "string" ? v : v === undefined ? "" : String(v);
          let input: React.ReactNode;
          switch (f.type) {
            case "richtext":
              input = <RichText field={f} value={str} onChange={(nv) => set(f.id, nv || null)} />;
              break;
            case "image":
              input = <ImageField field={f} value={str} siteId={props.siteId} onSave={(nv) => set(f.id, nv || null)} />;
              break;
            case "link":
              input = <CheckedInput field={f} value={str} placeholder="https://, /page or mailto:" onSave={(nv) => set(f.id, nv || null)} />;
              break;
            case "date":
              input = <input type="date" className="input" aria-label={f.name} value={str} onChange={(e) => set(f.id, e.target.value || null)} />;
              break;
            case "number":
              input = <input type="number" className="input" aria-label={f.name} value={str} onChange={(e) => set(f.id, e.target.value === "" ? null : Number(e.target.value))} />;
              break;
            case "boolean":
              input = (
                <label className="check">
                  <input type="checkbox" aria-label={f.name} checked={v === true} onChange={(e) => set(f.id, e.target.checked)} /> Yes
                </label>
              );
              break;
            default:
              input =
                f === c.fields[0] ? (
                  <input className="input" aria-label={f.name} value={str} onChange={(e) => setTitle(e.target.value)} />
                ) : (
                  <textarea className="textarea short" aria-label={f.name} value={str} onChange={(e) => set(f.id, e.target.value || null)} />
                );
          }
          return (
            <div key={f.id} className="field-stack">
              <label className="small muted">{f.name}</label>
              {input}
            </div>
          );
        })}
        <div className="field-stack">
          <label className="small muted" htmlFor="item-slug">
            Slug
          </label>
          <input
            id="item-slug"
            className="input mono"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => slug.trim() && slug !== item.slug && apply([{ op: "update_item", collectionId: c.id, itemId: item.id, slug }])}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          {url && <span className="muted small mono clip">{url}</span>}
        </div>
      </div>
      <div className="group">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" disabled={index <= 0} onClick={() => apply([{ op: "move_item", collectionId: c.id, itemId: item.id, index: index - 1 }])}>
            Move up
          </button>
          <button className="btn sm" disabled={index >= c.items.length - 1} onClick={() => apply([{ op: "move_item", collectionId: c.id, itemId: item.id, index: index + 1 }])}>
            Move down
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const values = Object.fromEntries(Object.entries(item.values).map(([k, x]) => [k, k === c.fields[0]!.id ? `${x} (copy)` : x]));
              apply([{ op: "add_item", collectionId: c.id, values, draft: true, index: index + 1 }]);
            }}
          >
            Duplicate
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              apply([{ op: "remove_item", collectionId: c.id, itemId: item.id }]);
              props.onClose();
            }}
          >
            Delete item
          </button>
        </div>
        <span className="muted small">List order is the order items appear when a list isn't sorted by a field.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel with no item selected: the collection's settings and fields.

export function CollectionInspector(props: { doc: SiteDocument; collection: Collection; apply: Apply; onDeleted: () => void; onOpenPage: (pageId: string) => void }) {
  const { doc, collection: c, apply } = props;
  const [newField, setNewField] = useState<{ name: string; type: FieldType } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const template = templatePageOf(doc, c.id);
  return (
    <div>
      <div className="group">
        <h3>
          <span>Collection</span>
          <span className="type-chip">{c.items.length} items</span>
        </h3>
        <div className="row">
          <label htmlFor="col-name">Name</label>
          <input id="col-name" className="input" value={c.name} onChange={(e) => e.target.value.trim() && apply([{ op: "update_collection", collectionId: c.id, name: e.target.value }], `col:${c.id}:name`)} />
        </div>
        {template ? (
          <div className="row">
            <label>Item pages</label>
            <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => props.onOpenPage(template.id)}>
              <span className="mono">{template.path}</span>
            </button>
          </div>
        ) : (
          <button
            className="btn sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              const created = apply([{ op: "add_page", path: `/${c.slug}/:slug`, title: `${c.name} item`, collectionId: c.id }]);
              if (created?.[0]) props.onOpenPage(created[0]);
            }}
          >
            Give each item a page
          </button>
        )}
      </div>
      <div className="group">
        <h3>Fields</h3>
        {c.fields.map((f, i) => (
          <div key={f.id} className="field-row">
            <input
              className="input"
              aria-label={`${f.name} field name`}
              value={f.name}
              onChange={(e) => e.target.value.trim() && apply([{ op: "update_field", collectionId: c.id, fieldId: f.id, name: e.target.value }], `field:${c.id}:${f.id}`)}
            />
            <span className="type-chip" title={`Key: ${f.id}`}>
              {i === 0 ? "Title" : FIELD_TYPE_LABEL[f.type]}
            </span>
            {i === 0 ? (
              <span style={{ width: 28 }} />
            ) : (
              <button className="btn ghost icon sm" aria-label={`Remove ${f.name}`} title="Remove field and its values" onClick={() => apply([{ op: "remove_field", collectionId: c.id, fieldId: f.id }])}>
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        ))}
        {newField ? (
          <form
            className="field-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (newField.name.trim() && apply([{ op: "add_field", collectionId: c.id, name: newField.name.trim(), type: newField.type }])) setNewField(null);
            }}
          >
            <input className="input" autoFocus aria-label="New field name" placeholder="Field name" value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} />
            <select className="select" aria-label="New field type" value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value as FieldType })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <button className="btn sm primary" disabled={!newField.name.trim()}>
              Add
            </button>
          </form>
        ) : (
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setNewField({ name: "", type: "text" })}>
            <Icon name="plus" size={13} />
            Add field
          </button>
        )}
        <span className="muted small">New fields aren't on the template yet. Add an element there and set Content from to the field.</span>
      </div>
      <div className="group">
        {confirming ? (
          <>
            <span className="small">Delete {c.name}, its {c.items.length} items, its item pages and every list showing it?</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm danger" onClick={() => (apply([{ op: "remove_collection", collectionId: c.id }]), props.onDeleted())}>
                Delete collection
              </button>
              <button className="btn sm ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="btn sm danger" style={{ alignSelf: "flex-start" }} onClick={() => setConfirming(true)}>
            Delete collection
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bindings: which collection an element can read from, and the inspector rows.

/** The collection an element shows items of: the nearest list around it, else the page's. */
export function bindingCollection(doc: SiteDocument, page: Page, nodeId: string): Collection | undefined {
  const chain: SiteNode[] = [];
  const walk = (n: SiteNode): boolean => {
    if (n.id === nodeId) return true;
    for (const k of n.children ?? []) {
      if (walk(k)) {
        chain.push(n);
        return true;
      }
    }
    return false;
  };
  if (!walk(page.root) && !doc.components.some((cm) => findInTree(cm.root, nodeId))) return undefined;
  const list = chain.find((n) => n.type === "collection-list");
  const id = list ? String(list.props.collectionId) : page.collectionId;
  return id ? (doc.collections ?? []).find((c) => c.id === id) : undefined;
}

type Source = { key: string; label: string };

/** Props each element type can bind, and which fields fit each. */
export function bindableProps(node: SiteNode, c: Collection): { prop: string; label: string; sources: Source[] }[] {
  const of = (...types: FieldType[]) => c.fields.filter((f) => types.includes(f.type)).map((f) => ({ key: f.id, label: f.name }));
  const page = { key: "url", label: "Item page" };
  const slug = { key: "slug", label: "Slug" };
  switch (node.type) {
    case "heading":
    case "text":
      return [{ prop: "text", label: "Text", sources: [...of("text", "number", "date", "boolean"), slug] }];
    case "richtext":
      return [{ prop: "markdown", label: "Text", sources: of("richtext", "text") }];
    case "image":
      return [
        { prop: "src", label: "Image", sources: of("image") },
        { prop: "alt", label: "Alt text", sources: of("text") },
      ];
    case "button":
      return [
        { prop: "label", label: "Label", sources: of("text", "number") },
        { prop: "href", label: "Link", sources: [page, ...of("link")] },
      ];
    case "link":
      return [{ prop: "href", label: "Link", sources: [page, ...of("link")] }];
    default:
      return [];
  }
}

export function BindingFields(props: { node: SiteNode; collection: Collection; apply: Apply }) {
  const { node, collection: c } = props;
  const rows = bindableProps(node, c);
  if (!rows.length) return null;
  const bind = (node.props.bind ?? {}) as Record<string, string>;
  const setBind = (prop: string, key: string) => {
    const next = { ...bind };
    if (key) next[prop] = key;
    else delete next[prop];
    props.apply([{ op: "update_node", nodeId: node.id, props: { bind: Object.keys(next).length ? next : null } }]);
  };
  return (
    <div className="group bind-group">
      <h3>
        <span>Content from {c.name}</span>
        <Icon name="database" size={13} />
      </h3>
      {rows.map((r) => (
        <div key={r.prop} className="row">
          <label htmlFor={`bind-${r.prop}`}>{r.label}</label>
          <select id={`bind-${r.prop}`} className={`select ${bind[r.prop] ? "bound" : ""}`} value={bind[r.prop] ?? ""} onChange={(e) => setBind(r.prop, e.target.value)}>
            <option value="">Fixed (type it below)</option>
            {r.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <span className="muted small">Each item shows its own {Object.values(bind).length ? "value" : "value once you pick a field"}.</span>
    </div>
  );
}

/** Settings for a collection list: which collection, how many, in what order. */
export function ListFields(props: { node: SiteNode; doc: SiteDocument; apply: Apply }) {
  const { node, doc, apply } = props;
  const p = node.props;
  const set = (k: string, v: unknown) => apply([{ op: "update_node", nodeId: node.id, props: { [k]: v === "" || v === undefined ? null : v } }], `${node.id}:list:${k}`);
  const c = (doc.collections ?? []).find((x) => x.id === p.collectionId);
  return (
    <>
      <div className="row">
        <label htmlFor="list-col">Shows</label>
        <select id="list-col" className="select" value={String(p.collectionId ?? "")} onChange={(e) => set("collectionId", e.target.value)}>
          {(doc.collections ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label htmlFor="list-limit">Up to</label>
        <input
          id="list-limit"
          className="input"
          type="number"
          min={1}
          max={500}
          placeholder="All items"
          value={p.limit === undefined ? "" : String(p.limit)}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            set("limit", e.target.value === "" || !(n >= 1) ? null : Math.min(500, n));
          }}
        />
      </div>
      <div className="row">
        <label htmlFor="list-sort">Order</label>
        <select id="list-sort" className="select" value={String(p.sortBy ?? "")} onChange={(e) => set("sortBy", e.target.value)}>
          <option value="">As listed in the CMS</option>
          {c?.fields
            .filter((f) => f.type !== "richtext" && f.type !== "image")
            .map((f) => (
              <option key={f.id} value={f.id}>
                By {f.name.toLowerCase()}
              </option>
            ))}
        </select>
      </div>
      {!!p.sortBy && (
        <div className="row">
          <label htmlFor="list-dir">Direction</label>
          <select id="list-dir" className="select" value={p.sortDir === "desc" ? "desc" : "asc"} onChange={(e) => set("sortDir", e.target.value)}>
            <option value="asc">{c?.fields.find((f) => f.id === p.sortBy)?.type === "date" ? "Oldest first" : "A to Z, low to high"}</option>
            <option value="desc">{c?.fields.find((f) => f.id === p.sortBy)?.type === "date" ? "Newest first" : "Z to A, high to low"}</option>
          </select>
        </div>
      )}
      <div className="row">
        <label htmlFor="list-empty">When empty</label>
        <input id="list-empty" className="input" value={String(p.empty ?? "")} onChange={(e) => set("empty", e.target.value)} />
      </div>
      <span className="muted small">Design the first card; every item uses it. Drafts show here but not on the live site.</span>
    </>
  );
}
