import { createContext, useContext, useRef, useState } from "react";
import { findCollection, languageName, TRANSLATABLE, type Breakpoint, type Collection, type Operation, type Page, type SiteDocument, type SiteNode, type Style, type StyleProperty } from "@sitecraft/schema";
import { Sites } from "../api";
import { AssetPicker } from "./Assets";
import { Icon } from "./Icon";
import { BindingFields, ListFields } from "./Cms";
import { nodeLabel } from "./Layers";

type Apply = (ops: Operation[], coalesceKey?: string) => void;

const BP_NAME: Record<Breakpoint, string> = { base: "desktop", tablet: "tablet", mobile: "phone" };
const FALLBACK: Record<Breakpoint, Breakpoint[]> = { base: [], tablet: ["base"], mobile: ["tablet", "base"] };

function inherited(n: SiteNode, bp: Breakpoint, key: StyleProperty): string {
  for (const b of FALLBACK[bp]) {
    const v = n.style[b]?.[key];
    if (v !== undefined) return String(v);
  }
  return "";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function TextInput(props: { value: string; placeholder?: string; onChange: (v: string) => void; override?: boolean; label: string; list?: string }) {
  return (
    <input
      className={`input ${props.override ? "override" : ""}`}
      aria-label={props.label}
      value={props.value}
      placeholder={props.placeholder}
      list={props.list}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ThemeColors = createContext<Record<string, string | number>>({});

/** Show the real color for theme tokens like var(--color-primary). */
function useResolvedColor(v: string): string {
  const colors = useContext(ThemeColors);
  const m = /^var\(--color-([a-z0-9-]+)\)$/.exec(v.trim());
  return m ? String(colors[m[1]!] ?? "") : v;
}

function ColorInput(props: { value: string; placeholder?: string; onChange: (v: string) => void; label: string; override?: boolean }) {
  const shown = useResolvedColor(props.value || props.placeholder || "");
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={`${props.label} picker`}
        className={HEX.test(shown) ? "" : "unset"}
        value={HEX.test(shown) ? (shown.length === 4 ? "#" + [...shown.slice(1)].map((c) => c + c).join("") : shown) : "#000000"}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <TextInput label={props.label} value={props.value} placeholder={props.placeholder} onChange={props.onChange} override={props.override} list="theme-colors" />
    </div>
  );
}

function StyleRow(props: { node: SiteNode; bp: Breakpoint; prop: StyleProperty; label: string; apply: Apply; kind?: "color" | "select"; options?: string[] }) {
  const { node, bp, prop } = props;
  const own = node.style[bp]?.[prop];
  const value = own === undefined ? "" : String(own);
  const placeholder = inherited(node, bp, prop);
  const set = (v: string) => props.apply([{ op: "update_node", nodeId: node.id, breakpoint: bp, style: { [prop]: v.trim() === "" ? null : v } }], `${node.id}:${bp}:${prop}`);
  const override = bp !== "base" && own !== undefined;
  if (props.kind === "select") {
    return (
      <Field label={props.label}>
        <select className={`select ${override ? "override" : ""}`} aria-label={props.label} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">{placeholder ? `${placeholder} (inherited)` : "—"}</option>
          {props.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={props.label}>
      {props.kind === "color" ? (
        <ColorInput label={props.label} value={value} placeholder={placeholder} onChange={set} override={override} />
      ) : (
        <TextInput label={props.label} value={value} placeholder={placeholder} onChange={set} override={override} />
      )}
    </Field>
  );
}

function ContentFields({ node, apply, siteId, doc, locale }: { node: SiteNode; apply: Apply; siteId: string; doc: SiteDocument; locale?: string }) {
  const p = node.props;
  // Props bound to a collection field come from each item, so there's nothing to type.
  const bound = new Set(Object.keys((p.bind as Record<string, string> | undefined) ?? {}));
  const free = (prop: string) => !bound.has(prop);
  // In another language, translatable text is edited as that language's translation.
  const tkeys = locale ? TRANSLATABLE[node.type] ?? [] : [];
  const tr = (locale ? (p.i18n as Record<string, Record<string, string>> | undefined)?.[locale] : undefined) ?? {};
  const set = (key: string, v: unknown) =>
    tkeys.includes(key)
      ? apply([{ op: "set_translation", locale: locale!, nodeId: node.id, values: { [key]: v === "" ? null : String(v) } }], `${node.id}:tr:${locale}:${key}`)
      : apply([{ op: "update_node", nodeId: node.id, props: { [key]: v === "" ? null : v } }], `${node.id}:props:${key}`);
  const base = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const str = (k: string) => (tkeys.includes(k) ? tr[k] ?? "" : base(k));
  /** In another language, the original text shows as the placeholder. */
  const ph = (k: string, d?: string) => (tkeys.includes(k) ? base(k) : d);
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const pages = doc.pages.map((x) => x.path);
  const linkList = (
    <datalist id="page-links">
      {pages.map((x) => (
        <option key={x} value={x} />
      ))}
    </datalist>
  );

  switch (node.type) {
    case "heading":
      return (
        <>
          {free("text") && (
            <Field label="Text">
              <textarea className="textarea" aria-label="Text" value={str("text")} placeholder={ph("text")} onChange={(e) => set("text", e.target.value)} />
            </Field>
          )}
          <Field label="Level">
            <select className="select" aria-label="Heading level" value={String(p.level ?? 2)} onChange={(e) => set("level", Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((l) => (
                <option key={l} value={l}>
                  H{l}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    case "text":
      return free("text") ? (
        <Field label="Text">
          <textarea className="textarea" aria-label="Text" value={str("text")} placeholder={ph("text")} onChange={(e) => set("text", e.target.value)} />
        </Field>
      ) : null;
    case "richtext":
      return free("markdown") ? (
        <Field label="Text">
          <textarea className="textarea rich" aria-label="Rich text" value={str("markdown")} placeholder={ph("markdown", "## Heading, **bold**, - list, [link](https://…)")} onChange={(e) => set("markdown", e.target.value)} />
        </Field>
      ) : null;
    case "story": {
      const [visuals, ...steps] = node.children ?? [];
      const frames = visuals?.children?.length ?? 0;
      const lastStep = steps[steps.length - 1];
      const lastFrame = visuals?.children?.[frames - 1];
      return (
        <>
          <Field label="Visual">
            <div className="seg" role="group" aria-label="Visual side">
              {(["left", "right"] as const).map((side) => (
                <button key={side} aria-pressed={(p.side === "left" ? "left" : "right") === side} onClick={() => set("side", side)}>
                  {side === "left" ? "On the left" : "On the right"}
                </button>
              ))}
            </div>
          </Field>
          <p className="muted small" style={{ margin: 0 }}>
            {steps.length} {steps.length === 1 ? "step" : "steps"} and {frames} {frames === 1 ? "visual" : "visuals"}. The visual stays pinned while each step scrolls past and changes to the one in the same position. On the canvas they're all shown so you can edit them; Preview shows the scrolling.
          </p>
          {lastStep && (
            <button
              className="btn sm"
              onClick={() => apply([{ op: "duplicate_node", nodeId: lastStep.id }, ...(lastFrame ? [{ op: "duplicate_node", nodeId: lastFrame.id } as Operation] : [])])}
            >
              <Icon name="plus" size={12} /> Add a step
            </button>
          )}
        </>
      );
    }
    case "progress":
      return (
        <p className="muted small" style={{ margin: 0 }}>
          A thin bar along the top of the window that fills as people read down the page. Set its color and height in Style.
        </p>
      );
    case "language-switch":
      return (
        <p className="muted small" style={{ margin: 0 }}>
          {(doc.settings.locales ?? []).length
            ? "Links to this page in each of the site's languages, named in that language."
            : "Add languages in Site settings and this shows a link to each version of the page."}
        </p>
      );
    case "collection-list":
      return <ListFields node={node} doc={doc} apply={apply as never} />;
    case "button":
      return (
        <>
          {free("label") && (
            <Field label="Label">
              <TextInput label="Label" value={str("label")} placeholder={ph("label")} onChange={(v) => set("label", v)} />
            </Field>
          )}
          {!p.submit && (
            <>
              {free("href") && (
                <Field label="Link to">
                  <TextInput label="Link" value={str("href")} placeholder="/pricing or https://" list="page-links" onChange={(v) => set("href", v)} />
                </Field>
              )}
              <label className="check">
                <input type="checkbox" checked={!!p.newTab} onChange={(e) => set("newTab", e.target.checked || null)} /> Open in a new tab
              </label>
            </>
          )}
          {linkList}
        </>
      );
    case "link":
      return (
        <>
          {free("href") && (
            <Field label="Link to">
              <TextInput label="Link" value={str("href")} list="page-links" onChange={(v) => set("href", v)} />
            </Field>
          )}
          <label className="check">
            <input type="checkbox" checked={!!p.newTab} onChange={(e) => set("newTab", e.target.checked || null)} /> Open in a new tab
          </label>
          {linkList}
        </>
      );
    case "image":
      if (!free("src")) {
        return free("alt") ? (
          <Field label="Alt text">
            <TextInput label="Alt text" value={str("alt")} placeholder={ph("alt", "Describe the image")} onChange={(v) => set("alt", v)} />
          </Field>
        ) : null;
      }
      return (
        <>
          <Field label="Image URL">
            <TextInput label="Image URL" value={str("src")} onChange={(v) => set("src", v)} />
          </Field>
          <Field label="">
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" onClick={() => setPicking(true)}>
                Choose from library
              </button>
              <button className="btn sm ghost" disabled={uploading} onClick={() => file.current?.click()}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </span>
            {picking && (
              <AssetPicker
                onClose={() => setPicking(false)}
                onPick={(a) => {
                  setPicking(false);
                  // The library's alt text and focal point come along; the crop keeps the focal point in view.
                  apply([
                    { op: "update_node", nodeId: node.id, props: { src: a.url, ...(a.alt && !str("alt") ? { alt: a.alt } : {}) } },
                    { op: "update_node", nodeId: node.id, breakpoint: "base", style: { objectPosition: `${Math.round(a.focalX * 100)}% ${Math.round(a.focalY * 100)}%` } },
                  ]);
                }}
              />
            )}
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const r = await Sites.upload(siteId, f);
                  set("src", r.url);
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </Field>
          {free("alt") && (
            <Field label="Alt text">
              <TextInput label="Alt text" value={str("alt")} placeholder={ph("alt", "Describe the image")} onChange={(v) => set("alt", v)} />
            </Field>
          )}
        </>
      );
    case "section":
      return (
        <Field label="Anchor">
          <TextInput label="Anchor id" value={str("anchor")} placeholder="pricing → #pricing" onChange={(v) => set("anchor", v.replace(/[^a-z0-9-]/gi, "").toLowerCase())} />
        </Field>
      );
    case "form":
      return (
        <>
          <Field label="Form name">
            <TextInput label="Form name" value={str("formName")} onChange={(v) => set("formName", v.replace(/[^\w-]/g, ""))} />
          </Field>
          <Field label="Success">
            <TextInput label="Success message" value={str("successMessage")} onChange={(v) => set("successMessage", v)} />
          </Field>
        </>
      );
    case "input":
      return (
        <>
          <Field label="Label">
            <TextInput label="Label" value={str("label")} onChange={(v) => set("label", v)} />
          </Field>
          <Field label="Field name">
            <TextInput label="Field name" value={str("name")} onChange={(v) => set("name", v.replace(/[^\w-]/g, ""))} />
          </Field>
          <Field label="Type">
            <select className="select" aria-label="Input type" value={str("inputType") || "text"} onChange={(e) => set("inputType", e.target.value)}>
              {["text", "email", "tel", "number", "url", "textarea"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={!!p.required} onChange={(e) => set("required", e.target.checked || null)} /> Required
          </label>
        </>
      );
    case "embed":
      return (
        <Field label="Embed URL">
          <TextInput label="Embed URL" value={str("url")} placeholder="https://www.youtube.com/embed/…" onChange={(v) => set("url", v)} />
        </Field>
      );
    case "instance": {
      const comp = doc.components.find((c) => c.id === p.componentId);
      if (comp?.brandId && doc.brand) {
        return (
          <p className="muted small" style={{ margin: 0 }}>
            {comp.name} from the {doc.brand.name} brand.{doc.brand.locked ? " It's edited in Brands and updates every site at once." : " Brand updates replace edits made here."}
          </p>
        );
      }
      return <p className="muted small" style={{ margin: 0 }}>Instance of {comp?.name ?? "a component"}. Edits inside it change every copy.</p>;
    }
    default:
      return null;
  }
}

const TEXTY = new Set(["heading", "text", "button", "link", "input", "richtext"]);
const BOXY = new Set(["section", "stack", "grid", "form", "link", "instance", "collection-list"]);

export function NodeInspector(props: {
  node: SiteNode;
  bp: Breakpoint;
  apply: Apply;
  siteId: string;
  doc: SiteDocument;
  isRoot: boolean;
  bindCollection?: Collection;
  onComment?: () => void;
  commentCount?: number;
  /** Editing this language's translation (not the main language). */
  locale?: string;
}) {
  const { node, bp, apply } = props;
  const S = (prop: StyleProperty, label: string, kind?: "color" | "select", options?: string[]) => (
    <StyleRow key={prop} node={node} bp={bp} prop={prop} label={label} apply={apply} kind={kind} options={options} />
  );
  const anim = node.animation;
  const overrides = bp !== "base" ? Object.keys(node.style[bp] ?? {}).length : 0;

  return (
    <ThemeColors.Provider value={props.doc.theme.colors}>
      <div className="group">
        <h3>
          <span>{nodeLabel(node)}</span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {props.onComment && (
              <button className="btn ghost sm comment-on" onClick={props.onComment} title="Comment on this element">
                <Icon name="comment" size={13} />
                {props.commentCount ? props.commentCount : "Comment"}
              </button>
            )}
            <span className="type-chip">{node.type === "heading" ? `H${Number(node.props.level) || 2}` : node.type}</span>
          </span>
        </h3>
        <Field label="Layer name">
          <TextInput label="Layer name" value={node.name ?? ""} placeholder={node.type} onChange={(v) => apply([{ op: "update_node", nodeId: node.id, name: v }], `${node.id}:name`)} />
        </Field>
        {props.locale && (TRANSLATABLE[node.type] ?? []).length > 0 && (
          <TranslationNote node={node} locale={props.locale} main={props.doc.settings.lang} />
        )}
        <ContentFields node={node} apply={apply} siteId={props.siteId} doc={props.doc} locale={props.locale} />
        {!props.isRoot && node.type !== "instance" && node.type !== "collection-list" && BOXY.has(node.type) && (
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => apply([{ op: "create_component", nodeId: node.id, name: node.name || "Component" }])}>
            Make reusable component
          </button>
        )}
      </div>

      {props.bindCollection && <BindingFields node={node} collection={props.bindCollection} apply={apply as never} />}

      {bp !== "base" && (
        <div className="group" style={{ paddingBottom: 0, borderBottom: 0 }}>
          <div className="bp-note">
            Editing the {BP_NAME[bp]} layout. Blue fields override desktop{overrides ? ` (${overrides} set here)` : ""}; empty fields inherit.
          </div>
        </div>
      )}

      {BOXY.has(node.type) && (
        <div className="group">
          <h3>Layout</h3>
          {S("display", "Display", "select", ["flex", "grid", "block", "none"])}
          {S("flexDirection", "Direction", "select", ["column", "row", "row-reverse", "column-reverse"])}
          {S("alignItems", "Align", "select", ["stretch", "flex-start", "center", "flex-end", "baseline"])}
          {S("justifyContent", "Justify", "select", ["flex-start", "center", "flex-end", "space-between", "space-around"])}
          {S("flexWrap", "Wrap", "select", ["nowrap", "wrap"])}
          {S("gap", "Gap")}
          {S("gridTemplateColumns", "Columns")}
        </div>
      )}

      <div className="group">
        <h3>Size and spacing</h3>
        <div className="row2">
          {S("width", "Width")}
          {S("maxWidth", "Max W")}
        </div>
        <div className="row2">
          {S("height", "Height")}
          {S("minHeight", "Min H")}
        </div>
        {S("padding", "Padding")}
        {S("margin", "Margin")}
      </div>

      {TEXTY.has(node.type) && (
        <div className="group">
          <h3>Type</h3>
          {S("fontSize", "Size")}
          {S("fontWeight", "Weight", "select", ["400", "500", "600", "700", "800"])}
          {S("lineHeight", "Line height")}
          {S("letterSpacing", "Tracking")}
          {S("textAlign", "Align", "select", ["left", "center", "right"])}
          {S("color", "Color", "color")}
          {S("fontFamily", "Font")}
        </div>
      )}

      <div className="group">
        <h3>Fill and border</h3>
        {S("background", "Fill", "color")}
        {S("border", "Border")}
        {S("borderRadius", "Radius")}
        {S("boxShadow", "Shadow")}
        {S("opacity", "Opacity")}
        {node.type === "image" && S("objectFit", "Fit", "select", ["cover", "contain", "fill"])}
        {node.type === "image" && S("aspectRatio", "Ratio")}
      </div>

      <MotionGroup node={node} apply={apply as never} />

      {!props.isRoot && (
        <div className="group">
          <h3>Visibility</h3>
          {(["base", "tablet", "mobile"] as Breakpoint[]).map((b) => (
            <label key={b} className="check">
              <input
                type="checkbox"
                checked={!!node.hidden?.[b]}
                onChange={(e) => {
                  const hidden = { ...(node.hidden ?? {}), [b]: e.target.checked };
                  if (!e.target.checked) delete hidden[b];
                  apply([{ op: "update_node", nodeId: node.id, hidden: Object.keys(hidden).length ? hidden : null }]);
                }}
              />
              Hide on {BP_NAME[b]}
            </label>
          ))}
        </div>
      )}
    </ThemeColors.Provider>
  );
}

function TranslationNote({ node, locale, main }: { node: SiteNode; locale: string; main: string }) {
  const tr = (node.props.i18n as Record<string, Record<string, string>> | undefined)?.[locale] ?? {};
  const stale = (TRANSLATABLE[node.type] ?? []).filter((k) => tr[k] && tr[`~${k}`] !== undefined && tr[`~${k}`] !== node.props[k]);
  return (
    <div className="tr-note small">
      Translating to <b>{languageName(locale)}</b>. Empty fields show the {languageName(main)} text.
      {stale.length > 0 && <span className="warn soft" style={{ marginLeft: 6 }}>The {languageName(main)} text changed since this was translated</span>}
    </div>
  );
}

export function PageInspector(props: { doc: SiteDocument; page: Page; apply: Apply; onDeletePage: () => void; locale?: string }) {
  const { doc, page, apply } = props;
  const theme = doc.theme;
  const setColor = (name: string, v: string) => apply([{ op: "set_theme", colors: { [name]: v } }], `theme:${name}`);
  const collection = page.collectionId ? findCollection(doc, page.collectionId) : undefined;
  return (
    <div>
      {collection && (
        <div className="group bind-group">
          <h3>
            <span>{collection.name} template</span>
            <span className="type-chip">CMS</span>
          </h3>
          <span className="small" style={{ lineHeight: 1.5 }}>
            Every {collection.name} item gets a page at <span className="mono">{page.path}</span> built from this design. Select an element and use <b>Content from</b> to show a field.
          </span>
          <span className="muted small">Each item page uses the item's title, first text field and first image for its title, description and share image.</span>
        </div>
      )}
      <div className="group">
        <h3>Page</h3>
        {props.locale ? (
          <>
            <div className="tr-note small">
              Translating to <b>{languageName(props.locale)}</b>.
            </div>
            <Field label="Title">
              <TextInput label="Page title" value={page.i18n?.[props.locale]?.title ?? ""} placeholder={page.title} onChange={(v) => apply([{ op: "set_translation", locale: props.locale!, pageId: page.id, values: { title: v || null } }], `page:${page.id}:tr:title`)} />
            </Field>
            <Field label="Description">
              <textarea className="textarea" aria-label="SEO description" value={page.i18n?.[props.locale]?.description ?? ""} placeholder={page.description} onChange={(e) => apply([{ op: "set_translation", locale: props.locale!, pageId: page.id, values: { description: e.target.value || null } }], `page:${page.id}:tr:desc`)} />
            </Field>
          </>
        ) : (
          <Field label="Title">
            <TextInput label="Page title" value={page.title} onChange={(v) => v && apply([{ op: "update_page", pageId: page.id, title: v }], `page:${page.id}:title`)} />
          </Field>
        )}
        {page.path === "/" || page.collectionId ? (
          <Field label="Path">
            {page.path === "/" ? (
              <span className="mono muted small">/ (the home page)</span>
            ) : (
              <TextInput label="Page path" value={page.path} onChange={(v) => apply([{ op: "update_page", pageId: page.id, path: v }], `page:${page.id}:path`)} />
            )}
          </Field>
        ) : (
          <>
            <Field label="Path">
              <PathInput key={page.id + page.path} path={page.path} onMove={(to) => apply([{ op: "move_page", pageId: page.id, path: to }])} />
            </Field>
            <Field label="Parent">
              <select
                className="select"
                aria-label="Parent page"
                value={parentPath(page.path, doc.pages.map((p) => p.path))}
                onChange={(e) => {
                  const leaf = page.path.split("/").filter(Boolean).pop()!;
                  apply([{ op: "move_page", pageId: page.id, path: e.target.value === "/" ? `/${leaf}` : `${e.target.value}/${leaf}` }]);
                }}
              >
                <option value="/">None (top level)</option>
                {doc.pages
                  .filter((p) => p.path !== "/" && !p.collectionId && p.id !== page.id && !p.path.startsWith(page.path + "/"))
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((p) => (
                    <option key={p.id} value={p.path}>
                      {p.title} ({p.path})
                    </option>
                  ))}
              </select>
            </Field>
            <span className="muted small">Moving a page moves the pages under it too. Old addresses keep working: they redirect to the new ones.</span>
          </>
        )}
        {!props.locale && (
          <Field label="Description">
            <textarea className="textarea" aria-label="SEO description" value={page.description ?? ""} placeholder="Shown in search results" onChange={(e) => apply([{ op: "update_page", pageId: page.id, description: e.target.value }], `page:${page.id}:desc`)} />
          </Field>
        )}
        {!props.locale && (
          <Field label="Job code">
            <input
              key={`${page.id}:${page.jobCode ?? ""}`}
              className="input mono"
              aria-label="Job code"
              defaultValue={page.jobCode ?? ""}
              placeholder="e.g. US-CAL-2400123"
              onBlur={(e) => e.target.value.trim() !== (page.jobCode ?? "") && apply([{ op: "update_page", pageId: page.id, jobCode: e.target.value.trim() }])}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        )}
        <Field label="Share image">
          <TextInput label="Social share image" value={page.ogImage ?? ""} placeholder="https://…" onChange={(v) => apply([{ op: "update_page", pageId: page.id, ogImage: v }], `page:${page.id}:og`)} />
        </Field>
        {page.path !== "/" && (
          <label className="check">
            <input type="checkbox" checked={!!page.unpublished} onChange={(e) => apply([{ op: "update_page", pageId: page.id, unpublished: e.target.checked }])} />
            Hide from the published site
          </label>
        )}
        {doc.pages.length > 1 && (
          <button className="btn sm danger" style={{ alignSelf: "flex-start" }} onClick={props.onDeletePage}>
            Delete page
          </button>
        )}
      </div>
      {doc.brand && (
        <div className="group bind-group">
          <h3>
            <span>{doc.brand.name} brand</span>
            <span className="type-chip">{doc.brand.locked ? "Locked" : `v${doc.brand.version}`}</span>
          </h3>
          <span className="small" style={{ lineHeight: 1.5 }}>
            {doc.brand.locked
              ? "Colors, fonts, corner radius and the brand's shared components come from the brand. Use theme colors (var(--color-…)) on elements. Admins change the brand in Brands."
              : "Theme changes here apply to this site only, until the next brand update replaces them."}
          </span>
          {doc.brand.guidelines && (
            <details>
              <summary className="small">Brand guidelines</summary>
              <p className="small muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {doc.brand.guidelines}
              </p>
            </details>
          )}
        </div>
      )}
      <fieldset className="group plain" disabled={!!doc.brand?.locked}>
        <h3>Theme colors</h3>
        {Object.entries(theme.colors).map(([name, v]) => (
          <Field key={name} label={name.replace(/-/g, " ")}>
            <ColorInput label={`${name} color`} value={String(v)} onChange={(nv) => setColor(name, nv)} />
          </Field>
        ))}
        <datalist id="theme-colors">
          {Object.keys(theme.colors).map((n) => (
            <option key={n} value={`var(--color-${n})`} />
          ))}
        </datalist>
      </fieldset>
      <fieldset className="group plain" disabled={!!doc.brand?.locked}>
        <h3>Theme type and shape</h3>
        <Field label="Headings">
          <TextInput label="Heading font" value={theme.fonts.heading} onChange={(v) => apply([{ op: "set_theme", fonts: { heading: v } }], "theme:fh")} />
        </Field>
        <Field label="Body">
          <TextInput label="Body font" value={theme.fonts.body} onChange={(v) => apply([{ op: "set_theme", fonts: { body: v } }], "theme:fb")} />
        </Field>
        <Field label="Radius">
          <TextInput label="Corner radius" value={theme.radius} onChange={(v) => apply([{ op: "set_theme", radius: v }], "theme:r")} />
        </Field>
        <span className="muted small">Google Fonts load automatically when named in quotes, like 'Fraunces', serif.</span>
      </fieldset>
    </div>
  );
}

export type { Style };

const ENTRANCES: [string, string][] = [
  ["fade-in", "Fade in"],
  ["slide-up", "Slide up"],
  ["slide-down", "Slide down"],
  ["slide-left", "Slide in from right"],
  ["slide-right", "Slide in from left"],
  ["scale-in", "Scale in"],
  ["zoom-out", "Zoom out"],
  ["blur-in", "Blur in"],
  ["flip-up", "Flip up (3D)"],
  ["rise", "Rise"],
];
const SCROLLS: [string, string][] = [
  ["fade", "Fade"],
  ["rise", "Rise"],
  ["scale", "Scale up"],
  ["reveal", "Reveal from the top"],
  ["slide-left", "Slide in from right"],
  ["slide-right", "Slide in from left"],
  ["blur", "Unblur"],
  ["zoom", "Zoom out (images)"],
];
const HOVERS: [string, string][] = [
  ["lift", "Lift"],
  ["grow", "Grow"],
  ["glow", "Glow"],
  ["tilt", "Tilt toward the pointer (3D)"],
  ["dim", "Dim"],
];

/** Ask the canvas to play an element's entrance once, so you can see it while editing. */
export function playMotion(nodeId: string) {
  window.dispatchEvent(new CustomEvent("sc-play", { detail: { nodeId } }));
}

function MotionGroup({ node, apply }: { node: SiteNode; apply: (ops: Operation[], coalesceKey?: string) => void }) {
  const anim = node.animation;
  const setAnim = (next: Record<string, unknown> | null, key?: string) => {
    apply([{ op: "update_node", nodeId: node.id, animation: next } as Operation], key);
    if (next) setTimeout(() => playMotion(node.id), 60);
  };
  const hasKids = (node.children?.length ?? 0) > 1 || node.type === "collection-list";
  const num = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  return (
    <div className="group motion">
      <h3>
        Motion
        {anim && (
          <button className="btn ghost sm" onClick={() => playMotion(node.id)} aria-label="Play the entrance on the canvas">
            <Icon name="play" size={12} /> Play
          </button>
        )}
      </h3>
      <Field label="Entrance">
        <select
          className="select"
          aria-label="Animation"
          value={anim?.preset ?? "none"}
          onChange={(e) => setAnim(e.target.value === "none" ? null : { ...(anim ?? { trigger: "scroll", durationMs: 600 }), preset: e.target.value })}
        >
          <option value="none">None</option>
          {ENTRANCES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {anim && (
        <>
          <Field label="Starts">
            <select className="select" aria-label="Animation trigger" value={anim.trigger} onChange={(e) => setAnim({ ...anim, trigger: e.target.value })}>
              <option value="scroll">When scrolled into view</option>
              <option value="load">On page load</option>
            </select>
          </Field>
          <div className="row2">
            <Field label="Duration">
              <TextInput label="Duration ms" value={String(anim.durationMs ?? 600)} onChange={(v) => setAnim({ ...anim, durationMs: num(v, 10000) }, `${node.id}:anim:d`)} />
            </Field>
            <Field label="Delay">
              <TextInput label="Delay ms" value={String(anim.delayMs ?? 0)} onChange={(v) => setAnim({ ...anim, delayMs: num(v, 10000) }, `${node.id}:anim:l`)} />
            </Field>
          </div>
          <div className="field-stack">
            <span className="small muted">Feel</span>
            <div className="seg" role="group" aria-label="Easing">
              {(["smooth", "spring", "ease-out", "linear"] as const).map((e) => (
                <button key={e} aria-pressed={(anim.easing ?? "smooth") === e} onClick={() => setAnim({ ...anim, easing: e === "smooth" ? undefined : e })}>
                  {e === "ease-out" ? "Ease out" : e[0]!.toUpperCase() + e.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {hasKids && (
            <label className="check">
              <input type="checkbox" checked={!!anim.staggerMs} onChange={(e) => setAnim({ ...anim, staggerMs: e.target.checked ? 120 : undefined })} />
              One child at a time
              {anim.staggerMs ? (
                <span className="stagger-ms">
                  <TextInput label="Gap between children ms" value={String(anim.staggerMs)} onChange={(v) => setAnim({ ...anim, staggerMs: num(v, 2000) || 1 }, `${node.id}:anim:s`)} />
                  ms apart
                </span>
              ) : null}
            </label>
          )}
        </>
      )}
      <Field label="While scrolling">
        <select
          className="select"
          aria-label="Scroll effect"
          value={node.scroll?.effect ?? "none"}
          onChange={(e) => apply([{ op: "update_node", nodeId: node.id, scroll: e.target.value === "none" ? null : { effect: e.target.value, range: node.scroll?.range ?? "in" } } as Operation])}
        >
          <option value="none">None</option>
          {SCROLLS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {node.scroll && (
        <div className="field-stack">
          <div className="seg" role="group" aria-label="Scroll range">
            {(
              [
                ["in", "Coming in"],
                ["out", "Leaving"],
                ["both", "In and out"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} aria-pressed={node.scroll!.range === v} onClick={() => apply([{ op: "update_node", nodeId: node.id, scroll: { ...node.scroll!, range: v } } as Operation])}>
                {l}
              </button>
            ))}
          </div>
          <span className="muted small">Moves with the scrollbar, so scrolling back plays it in reverse. It replaces the entrance.</span>
        </div>
      )}
      <Field label="Hover">
        <select
          className="select"
          aria-label="Hover effect"
          value={node.hover?.preset ?? "none"}
          onChange={(e) => apply([{ op: "update_node", nodeId: node.id, hover: e.target.value === "none" ? (node.hover?.style ? { style: node.hover.style } : null) : { ...node.hover, preset: e.target.value } } as Operation])}
        >
          <option value="none">None</option>
          {HOVERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-stack">
        <span className="small muted range-label">
          Parallax <span>{!node.parallax ? "Off" : node.parallax > 0 ? "Slower than scroll" : "Faster than scroll"}</span>
        </span>
        <div className="range-row">
          <input
            type="range"
            min={-50}
            max={50}
            step={5}
            aria-label="Parallax"
            value={Math.round((node.parallax ?? 0) * 100)}
            onChange={(e) => apply([{ op: "update_node", nodeId: node.id, parallax: Number(e.target.value) / 100 } as Operation], `${node.id}:parallax`)}
          />
        </div>
      </div>
      <span className="muted small">Entrances and parallax play on the published site and in previews; hover effects work on the canvas too. Visitors who ask for reduced motion see the page without movement.</span>
    </div>
  );
}

/** The address of the nearest page above this one, or "/" for top level. */
function parentPath(path: string, all: string[]): string {
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const p = "/" + parts.slice(0, i).join("/");
    if (all.includes(p)) return p;
  }
  return "/";
}

/** A page address that applies when you press Enter or leave the field, as a move with a redirect. */
function PathInput({ path, onMove }: { path: string; onMove: (to: string) => void }) {
  const [v, setV] = useState(path);
  const commit = () => {
    const to = "/" + v.trim().toLowerCase().replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-");
    if (to !== path && to !== "/") onMove(to);
    else setV(path);
  };
  return (
    <input
      className="input mono"
      aria-label="Page path"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") (setV(path), (e.currentTarget as HTMLInputElement).blur());
      }}
    />
  );
}
