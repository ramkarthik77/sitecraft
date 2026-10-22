import { Icon } from "./Icon";
import { BLOCK_DESCRIPTIONS, BLOCK_NAMES, type Collection, type ComponentDef, type SiteNode } from "@sitecraft/schema";

type NewNode = Omit<SiteNode, "id" | "children"> & { children?: NewNode[] };

/** Starting points for single elements dragged from the insert panel. */
export const ELEMENTS: Record<string, { label: string; glyph: string; make: () => NewNode }> = {
  heading: {
    label: "Heading",
    glyph: "H",
    make: () => ({ type: "heading", props: { text: "A clear headline", level: 2 }, style: { base: { fontFamily: "var(--font-heading)", fontSize: "40px", lineHeight: "1.1", color: "var(--color-text)", margin: "0" }, mobile: { fontSize: "30px" } } }),
  },
  text: {
    label: "Text",
    glyph: "¶",
    make: () => ({ type: "text", props: { text: "Say what this section is about in a sentence or two." }, style: { base: { fontSize: "18px", lineHeight: "1.6", color: "var(--color-muted)", margin: "0" } } }),
  },
  button: {
    label: "Button",
    glyph: "◉",
    make: () => ({ type: "button", props: { label: "Get started", href: "#" }, style: { base: { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "12px 20px", borderRadius: "var(--radius)", fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" } } }),
  },
  image: {
    label: "Image",
    glyph: "◩",
    make: () => ({ type: "image", props: { src: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1400&q=80", alt: "" }, style: { base: { width: "100%", borderRadius: "var(--radius)", objectFit: "cover", aspectRatio: "16 / 9" } } }),
  },
  stack: {
    label: "Stack",
    glyph: "≡",
    make: () => ({ type: "stack", props: {}, style: { base: { display: "flex", flexDirection: "column", gap: "16px", padding: "24px" } }, children: [] }),
  },
  row: {
    label: "Row",
    glyph: "⫼",
    make: () => ({ type: "stack", name: "Row", props: {}, style: { base: { display: "flex", flexDirection: "row", gap: "16px", alignItems: "center", flexWrap: "wrap" }, mobile: { flexDirection: "column", alignItems: "stretch" } }, children: [] }),
  },
  grid: {
    label: "Grid",
    glyph: "▦",
    make: () => ({ type: "grid", props: {}, style: { base: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }, mobile: { gridTemplateColumns: "1fr" } }, children: [] }),
  },
  section: {
    label: "Section",
    glyph: "▭",
    make: () => ({ type: "section", props: {}, style: { base: { padding: "96px 24px", display: "flex", flexDirection: "column", gap: "24px" }, mobile: { padding: "64px 20px" } }, children: [] }),
  },
  richtext: {
    label: "Rich text",
    glyph: "❡",
    make: () => ({ type: "richtext", props: { markdown: "## A short heading\n\nWrite longer text here, with **bold**, *italic*, lists and [links](https://example.com)." }, style: { base: { fontSize: "18px", lineHeight: "1.7", color: "var(--color-text)", maxWidth: "720px" } } }),
  },
  languages: {
    label: "Languages",
    glyph: "文",
    make: () => ({ type: "language-switch", props: {}, style: { base: { display: "flex", gap: "12px" } } }),
  },
  divider: { label: "Divider", glyph: "—", make: () => ({ type: "divider", props: {}, style: { base: { border: "0", borderTop: "1px solid var(--color-border)", margin: "0", width: "100%" } } }) },
  spacer: { label: "Spacer", glyph: "↕", make: () => ({ type: "spacer", props: {}, style: { base: { height: "48px" } } }) },
  embed: { label: "Video", glyph: "▶", make: () => ({ type: "embed", props: { url: "https://www.youtube.com/embed/aqz-KE-bpKQ", title: "Video" }, style: { base: { borderRadius: "var(--radius)" } } }) },
  form: {
    label: "Form",
    glyph: "✎",
    make: () => ({
      type: "form",
      props: { formName: "signup", successMessage: "Thanks! You're on the list." },
      style: { base: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "420px" } },
      children: [
        { type: "input", props: { name: "email", label: "Email", inputType: "email", required: true }, style: {} },
        { type: "button", props: { label: "Sign up", submit: true }, style: { base: { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "12px 20px", borderRadius: "var(--radius)", fontWeight: 600, border: "0" } } },
      ],
    }),
  },
};

/** Abstract thumbnails so each block is recognisable at a glance. */
function BlockThumb({ name }: { name: string }) {
  const bar = (w: string, h = 4, extra: React.CSSProperties = {}) => <span style={{ display: "block", width: w, height: h, background: "#c9cdc6", borderRadius: 2, ...extra }} />;
  const box: React.CSSProperties = { position: "absolute", inset: 6, display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" };
  switch (name) {
    case "navbar":
      return <div style={{ ...box, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>{bar("20%")}<span style={{ display: "flex", gap: 3 }}>{bar("10px")}{bar("10px")}{bar("14px", 6, { background: "#2f5bea" })}</span></div>;
    case "hero":
      return <div style={box}>{bar("70%", 6, { background: "#1c2024" })}{bar("50%")}{bar("24px", 6, { background: "#2f5bea" })}</div>;
    case "features":
    case "pricing":
      return <div style={{ ...box, flexDirection: "row", alignItems: "stretch" }}>{[0, 1, 2].map((i) => <span key={i} style={{ flex: 1, border: `1px solid ${name === "pricing" && i === 1 ? "#2f5bea" : "#c9cdc6"}`, borderRadius: 3 }} />)}</div>;
    case "cta":
      return <div style={{ ...box, background: "#2f5bea", inset: 0, alignItems: "center", padding: 6 }}>{bar("50%", 5, { background: "#fff" })}{bar("24px", 6, { background: "#fff" })}</div>;
    case "faq":
      return <div style={box}>{bar("90%")}{bar("90%")}{bar("90%")}</div>;
    case "logos":
      return <div style={{ ...box, flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}>{bar("14%")}{bar("14%")}{bar("14%")}{bar("14%")}</div>;
    case "testimonial":
      return <div style={{ ...box, alignItems: "center" }}>{bar("80%", 5, { background: "#1c2024" })}{bar("30%")}</div>;
    case "contact-form":
      return <div style={box}>{bar("60%", 6, { background: "#fff", border: "1px solid #c9cdc6" })}{bar("60%", 6, { background: "#fff", border: "1px solid #c9cdc6" })}{bar("20%", 6, { background: "#2f5bea" })}</div>;
    case "image-section":
      return <div style={{ ...box, background: "#d9dcd5", inset: 6, borderRadius: 3 }} />;
    case "footer":
      return <div style={{ ...box, justifyContent: "flex-end" }}><span style={{ display: "flex", justifyContent: "space-between" }}>{bar("20%")}{bar("35%")}</span></div>;
    default:
      return <div style={box}>{bar("50%", 5, { background: "#1c2024" })}{bar("85%")}{bar("75%")}</div>;
  }
}

export function Insert(props: {
  onInsertBlock: (name: string) => void;
  onInsertElement: (key: string) => void;
  collections: Collection[];
  onInsertList: (collectionId: string) => void;
  onOpenCms: () => void;
  components?: ComponentDef[];
  brandName?: string;
  onInsertComponent?: (componentId: string) => void;
}) {
  const comps = props.components ?? [];
  return (
    <div>
      {comps.length > 0 && (
        <>
          <div className="section-title">Components</div>
          <div className="comp-list">
            {comps.map((c) => (
              <button
                key={c.id}
                className="list-row comp-row"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", `comp:${c.id}`)}
                onClick={() => props.onInsertComponent?.(c.id)}
                title={`Add a copy of ${c.name}; edits to it change every copy`}
              >
                <Icon name="copy" size={13} />
                <span className="grow">{c.name}</span>
                {c.brandId && <span className="type-chip">{props.brandName ?? "Brand"}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-title">From the CMS</div>
      {props.collections.length ? (
        <div className="block-grid">
          {props.collections.map((c) => (
            <button
              key={c.id}
              className="block-card"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", `list:${c.id}`)}
              onClick={() => props.onInsertList(c.id)}
              title={`A section listing ${c.name} items`}
            >
              <span className="thumb">
                <div style={{ position: "absolute", inset: 6, display: "flex", gap: 3 }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ flex: 1, background: "#a8e6dc", borderRadius: 2 }} />
                      <span style={{ height: 4, width: "80%", background: "#c9cdc6", borderRadius: 2 }} />
                    </span>
                  ))}
                </div>
              </span>
              <span className="name">{c.name} list</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ padding: "0 18px", margin: "4px 0 8px", lineHeight: 1.5 }}>
          Lists of posts, products or people come from collections.{" "}
          <button className="linkish" onClick={props.onOpenCms}>
            Make one in the CMS tab
          </button>
          .
        </p>
      )}
      <div className="section-title">Elements</div>
      <div className="el-grid">
        {Object.entries(ELEMENTS).map(([key, el]) => (
          <button
            key={key}
            className="el-btn"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `el:${key}`)}
            onClick={() => props.onInsertElement(key)}
            title={`Add ${el.label.toLowerCase()} (or drag onto the page)`}
          >
            <span className="glyph" aria-hidden="true">
              {el.glyph}
            </span>
            {el.label}
          </button>
        ))}
      </div>
      <div className="section-title">Sections</div>
      <div className="block-grid">
        {BLOCK_NAMES.map((name) => (
          <button
            key={name}
            className="block-card"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `block:${name}`)}
            onClick={() => props.onInsertBlock(name)}
            title={BLOCK_DESCRIPTIONS[name]?.split(". content:")[0]}
          >
            <span className="thumb">
              <BlockThumb name={name} />
            </span>
            <span className="name">{name.replace(/-/g, " ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
