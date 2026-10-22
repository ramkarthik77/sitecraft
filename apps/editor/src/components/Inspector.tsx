import { createContext, useContext, useRef, useState } from "react";
import { findCollection, type Breakpoint, type Collection, type Operation, type Page, type SiteDocument, type SiteNode, type Style, type StyleProperty } from "@sitecraft/schema";
import { Sites } from "../api";
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

function ContentFields({ node, apply, siteId, doc }: { node: SiteNode; apply: Apply; siteId: string; doc: SiteDocument }) {
  const p = node.props;
  // Props bound to a collection field come from each item, so there's nothing to type.
  const bound = new Set(Object.keys((p.bind as Record<string, string> | undefined) ?? {}));
  const free = (prop: string) => !bound.has(prop);
  const set = (key: string, v: unknown) => apply([{ op: "update_node", nodeId: node.id, props: { [key]: v === "" ? null : v } }], `${node.id}:props:${key}`);
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
              <textarea className="textarea" aria-label="Text" value={str("text")} onChange={(e) => set("text", e.target.value)} />
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
          <textarea className="textarea" aria-label="Text" value={str("text")} onChange={(e) => set("text", e.target.value)} />
        </Field>
      ) : null;
    case "richtext":
      return free("markdown") ? (
        <Field label="Text">
          <textarea className="textarea rich" aria-label="Rich text" value={str("markdown")} placeholder="## Heading, **bold**, - list, [link](https://…)" onChange={(e) => set("markdown", e.target.value)} />
        </Field>
      ) : null;
    case "collection-list":
      return <ListFields node={node} doc={doc} apply={apply as never} />;
    case "button":
      return (
        <>
          {free("label") && (
            <Field label="Label">
              <TextInput label="Label" value={str("label")} onChange={(v) => set("label", v)} />
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
            <TextInput label="Alt text" value={str("alt")} placeholder="Describe the image" onChange={(v) => set("alt", v)} />
          </Field>
        ) : null;
      }
      return (
        <>
          <Field label="Image URL">
            <TextInput label="Image URL" value={str("src")} onChange={(v) => set("src", v)} />
          </Field>
          <Field label="">
            <button className="btn sm" disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? "Uploading…" : "Upload image"}
            </button>
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
              <TextInput label="Alt text" value={str("alt")} placeholder="Describe the image" onChange={(v) => set("alt", v)} />
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
    case "instance":
      return <p className="muted small" style={{ margin: 0 }}>Instance of {doc.components.find((c) => c.id === p.componentId)?.name ?? "a component"}. Edits inside it change every copy.</p>;
    default:
      return null;
  }
}

const TEXTY = new Set(["heading", "text", "button", "link", "input", "richtext"]);
const BOXY = new Set(["section", "stack", "grid", "form", "link", "instance", "collection-list"]);

export function NodeInspector(props: { node: SiteNode; bp: Breakpoint; apply: Apply; siteId: string; doc: SiteDocument; isRoot: boolean; bindCollection?: Collection }) {
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
          <span className="type-chip">{node.type === "heading" ? `H${Number(node.props.level) || 2}` : node.type}</span>
        </h3>
        <Field label="Layer name">
          <TextInput label="Layer name" value={node.name ?? ""} placeholder={node.type} onChange={(v) => apply([{ op: "update_node", nodeId: node.id, name: v }], `${node.id}:name`)} />
        </Field>
        <ContentFields node={node} apply={apply} siteId={props.siteId} doc={props.doc} />
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

      <div className="group">
        <h3>Motion</h3>
        <Field label="Effect">
          <select
            className="select"
            aria-label="Animation"
            value={anim?.preset ?? "none"}
            onChange={(e) =>
              apply([{ op: "update_node", nodeId: node.id, animation: e.target.value === "none" ? null : { preset: e.target.value, trigger: anim?.trigger ?? "scroll", durationMs: anim?.durationMs ?? 600 } }])
            }
          >
            <option value="none">None</option>
            <option value="fade-in">Fade in</option>
            <option value="slide-up">Slide up</option>
            <option value="slide-left">Slide in from right</option>
            <option value="scale-in">Scale in</option>
          </select>
        </Field>
        {anim && (
          <>
            <Field label="Starts">
              <select className="select" aria-label="Animation trigger" value={anim.trigger} onChange={(e) => apply([{ op: "update_node", nodeId: node.id, animation: { ...anim, trigger: e.target.value } }])}>
                <option value="scroll">When scrolled into view</option>
                <option value="load">On page load</option>
              </select>
            </Field>
            <div className="row2">
              <Field label="Duration">
                <TextInput label="Duration ms" value={String(anim.durationMs ?? 600)} onChange={(v) => apply([{ op: "update_node", nodeId: node.id, animation: { ...anim, durationMs: Math.min(10000, Number(v) || 0) } }], `${node.id}:anim:d`)} />
              </Field>
              <Field label="Delay">
                <TextInput label="Delay ms" value={String(anim.delayMs ?? 0)} onChange={(v) => apply([{ op: "update_node", nodeId: node.id, animation: { ...anim, delayMs: Math.min(10000, Number(v) || 0) } }], `${node.id}:anim:l`)} />
              </Field>
            </div>
          </>
        )}
        <span className="muted small">Effects play on the published site and in previews. Visitors who prefer reduced motion won't see them.</span>
      </div>

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

export function PageInspector(props: { doc: SiteDocument; page: Page; apply: Apply; onDeletePage: () => void }) {
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
        <Field label="Title">
          <TextInput label="Page title" value={page.title} onChange={(v) => v && apply([{ op: "update_page", pageId: page.id, title: v }], `page:${page.id}:title`)} />
        </Field>
        <Field label="Path">
          <TextInput label="Page path" value={page.path} onChange={(v) => apply([{ op: "update_page", pageId: page.id, path: v }], `page:${page.id}:path`)} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" aria-label="SEO description" value={page.description ?? ""} placeholder="Shown in search results" onChange={(e) => apply([{ op: "update_page", pageId: page.id, description: e.target.value }], `page:${page.id}:desc`)} />
        </Field>
        <Field label="Share image">
          <TextInput label="Social share image" value={page.ogImage ?? ""} placeholder="https://…" onChange={(v) => apply([{ op: "update_page", pageId: page.id, ogImage: v }], `page:${page.id}:og`)} />
        </Field>
        {doc.pages.length > 1 && (
          <button className="btn sm danger" style={{ alignSelf: "flex-start" }} onClick={props.onDeletePage}>
            Delete page
          </button>
        )}
      </div>
      <div className="group">
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
      </div>
      <div className="group">
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
      </div>
    </div>
  );
}

export type { Style };
