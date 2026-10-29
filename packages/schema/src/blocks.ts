import { newId } from "./ids.js";
import type { SiteNode, Style, StyleSet } from "./types.js";

/**
 * Ready-made sections. The editor's insert panel and the MCP add_block tool
 * both build from these, so agents produce on-brand layouts by default.
 */

type Content = Record<string, unknown>;

function n(type: SiteNode["type"], props: Record<string, unknown>, style: StyleSet = {}, children?: SiteNode[], name?: string): SiteNode {
  const node: SiteNode = { id: newId(), type, props, style };
  if (name) node.name = name;
  if (children) node.children = children;
  return node;
}

const container: Style = { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" };

function section(name: string, children: SiteNode[], base: Style = {}, mobile: Style = {}): SiteNode {
  return n(
    "section",
    {},
    { base: { padding: "96px 24px", display: "flex", flexDirection: "column", ...base }, mobile: { padding: "64px 20px", ...mobile } },
    [n("stack", {}, { base: container }, children, "Container")],
    name,
  );
}

const heading = (text: string, level: number, base: Style = {}, mobile: Style = {}) =>
  n("heading", { text, level }, { base: { fontFamily: "var(--font-heading)", color: "var(--color-text)", margin: "0", ...base }, mobile });

const text = (t: string, base: Style = {}) =>
  n("text", { text: t }, { base: { color: "var(--color-muted)", fontSize: "18px", lineHeight: "1.6", margin: "0", ...base } });

const button = (label: string, href: string, variant: "primary" | "secondary" = "primary") =>
  n(
    "button",
    { label, href },
    {
      base:
        variant === "primary"
          ? { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 150ms ease, opacity 150ms ease" }
          : { background: "transparent", color: "var(--color-text)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: 600, textDecoration: "none", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" },
    },
  );

// An explicit empty value must remain empty on import: never replace absent
// source copy with a demo placeholder from a library block.
const str = (c: Content, k: string, d: string) => (typeof c[k] === "string" ? (c[k] as string) : d);

function items(c: Content, k: string, d: Array<Record<string, string>>): Array<Record<string, string>> {
  const v = c[k];
  if (Array.isArray(v) && v.length > 0) return v.map((x) => (typeof x === "object" && x ? (x as Record<string, string>) : { title: String(x) }));
  return d;
}

const scrollIn = { preset: "slide-up" as const, trigger: "scroll" as const, durationMs: 600 };

const BUILDERS: Record<string, (c: Content) => SiteNode> = {
  navbar(c) {
    const links = items(c, "links", [{ label: "Features", href: "#features" }, { label: "Pricing", href: "#pricing" }, { label: "FAQ", href: "#faq" }]);
    return n(
      "section",
      {},
      { base: { padding: "20px 24px", borderBottom: "1px solid var(--color-border)", position: "sticky", top: 0, zIndex: 10, backgroundColor: "var(--color-background)" } },
      [
        n("stack", {}, { base: { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "24px" } }, [
          n("link", { href: "/" }, { base: { textDecoration: "none", color: "var(--color-text)", fontWeight: 700, fontSize: "20px", fontFamily: "var(--font-heading)" } }, [n("text", { text: str(c, "brand", "Acme") }, { base: { margin: "0" } })], "Logo"),
          n(
            "stack",
            {},
            { base: { display: "flex", flexDirection: "row", gap: "28px", alignItems: "center" }, mobile: { gap: "16px" } },
            [
              ...links.map((l) => {
                const link = n("link", { href: l.href ?? "#" }, { base: { color: "var(--color-muted)", textDecoration: "none", fontSize: "15px" } }, [n("text", { text: l.label ?? l.title ?? "Link" }, { base: { margin: "0" } })]);
                link.hidden = { mobile: true };
                return link;
              }),
              button(str(c, "ctaLabel", "Get started"), str(c, "ctaHref", "#cta")),
            ],
            "Links",
          ),
        ], "Bar"),
      ],
      "Navbar",
    );
  },
  hero(c) {
    const node = section(
      "Hero",
      [
        n("text", { text: str(c, "eyebrow", "New — now in beta") }, { base: { color: "var(--color-primary)", fontWeight: 600, fontSize: "15px", margin: "0" } }, undefined, "Eyebrow"),
        heading(str(c, "headline", "Build beautiful sites, faster"), 1, { fontSize: "64px", lineHeight: "1.05", letterSpacing: "-0.02em", maxWidth: "820px" }, { fontSize: "40px" }),
        text(str(c, "subheadline", "Design visually, let Claude handle the busywork, and ship to the web in one click."), { fontSize: "20px", maxWidth: "640px" }),
        n("stack", {}, { base: { display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" } }, [
          button(str(c, "ctaLabel", "Get started"), str(c, "ctaHref", "#cta")),
          button(str(c, "secondaryLabel", "See how it works"), str(c, "secondaryHref", "#features"), "secondary"),
        ], "Buttons"),
      ],
      { padding: "128px 24px 96px" },
    );
    node.animation = { preset: "fade-in", trigger: "load", durationMs: 700 };
    return node;
  },
  features(c) {
    const list = items(c, "items", [
      { title: "Visual editing", body: "Drag, drop and style every element across desktop, tablet and phone." },
      { title: "Agent-ready", body: "Claude Code edits the same site through MCP, on its own branch." },
      { title: "One-click publish", body: "Static, fast pages served from a CDN with SEO built in." },
    ]);
    const node = section("Features", [
      heading(str(c, "headline", "Everything you need to launch"), 2, { fontSize: "40px", letterSpacing: "-0.01em" }, { fontSize: "30px" }),
      text(str(c, "subheadline", "A focused toolkit for teams that ship often.")),
      n(
        "grid",
        {},
        { base: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "20px", marginTop: "16px" }, tablet: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, mobile: { gridTemplateColumns: "1fr" } },
        list.map((it) =>
          n("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "10px", padding: "28px", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", backgroundColor: "var(--color-surface)" } }, [
            heading(it.title ?? "Feature", 3, { fontSize: "20px" }),
            text(it.body ?? "", { fontSize: "16px" }),
          ], "Card"),
        ),
        "Cards",
      ),
    ]);
    node.props.anchor = "features";
    node.animation = scrollIn;
    return node;
  },
  logos(c) {
    const list = items(c, "items", [{ title: "Northwind" }, { title: "Globex" }, { title: "Initech" }, { title: "Umbrella" }, { title: "Hooli" }]);
    return section("Logos", [
      text(str(c, "headline", "Trusted by teams at"), { textAlign: "center", fontSize: "15px" }),
      n("stack", {}, { base: { display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: "48px" }, mobile: { gap: "24px" } },
        list.map((l) => n("text", { text: l.title ?? "Logo" }, { base: { fontWeight: 700, fontSize: "22px", color: "var(--color-muted)", opacity: 0.7, margin: "0" } }))),
    ], { padding: "48px 24px" });
  },
  testimonial(c) {
    const node = section("Testimonial", [
      n("text", { text: str(c, "quote", "“We rebuilt our marketing site in a week, and Claude now ships the weekly updates.”") }, { base: { fontFamily: "var(--font-heading)", fontSize: "32px", lineHeight: "1.3", color: "var(--color-text)", textAlign: "center", margin: "0" }, mobile: { fontSize: "24px" } }, undefined, "Quote"),
      text(str(c, "author", "Jordan Lee, Head of Marketing"), { textAlign: "center", fontSize: "16px" }),
    ], { backgroundColor: "var(--color-surface)" });
    node.animation = scrollIn;
    return node;
  },
  pricing(c) {
    const plans = items(c, "items", [
      { title: "Starter", price: "$0", body: "1 site, preview links, community support" },
      { title: "Team", price: "$24", body: "Unlimited sites, custom domains, agent branches" },
      { title: "Enterprise", price: "Custom", body: "SSO, audit log, self-hosting, SLA" },
    ]);
    const node = section("Pricing", [
      heading(str(c, "headline", "Simple pricing"), 2, { fontSize: "40px", textAlign: "center" }, { fontSize: "30px" }),
      n("grid", {}, { base: { display: "grid", gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, minmax(0, 1fr))`, gap: "20px", marginTop: "16px" }, mobile: { gridTemplateColumns: "1fr" } },
        plans.map((p, i) =>
          n("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "14px", padding: "32px", borderRadius: "var(--radius)", border: i === 1 ? "2px solid var(--color-primary)" : "1px solid var(--color-border)", backgroundColor: "var(--color-background)" } }, [
            heading(p.title ?? "Plan", 3, { fontSize: "20px" }),
            n("text", { text: p.price ?? "" }, { base: { fontSize: "44px", fontWeight: 700, color: "var(--color-text)", margin: "0" } }, undefined, "Price"),
            text(p.body ?? "", { fontSize: "16px" }),
            button(p.cta ?? "Choose plan", p.href ?? "#cta", i === 1 ? "primary" : "secondary"),
          ], "Plan"),
        ), "Plans"),
    ]);
    node.props.anchor = "pricing";
    return node;
  },
  faq(c) {
    const qs = items(c, "items", [
      { title: "Can I use my own domain?", body: "Yes. Point a CNAME at your Sitecraft host and add the domain in site settings." },
      { title: "How do agents edit my site?", body: "Claude Code connects through the MCP server and works on a branch you review before publishing." },
      { title: "Can I export my site?", body: "Every publish is plain static HTML and CSS you can download." },
    ]);
    const node = section("FAQ", [
      heading(str(c, "headline", "Frequently asked questions"), 2, { fontSize: "40px" }, { fontSize: "30px" }),
      ...qs.map((q) =>
        n("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "8px", padding: "20px 0", borderBottom: "1px solid var(--color-border)" } }, [
          heading(q.title ?? "Question", 3, { fontSize: "20px" }),
          text(q.body ?? "", { fontSize: "16px" }),
        ], "Question"),
      ),
    ], {}, {});
    node.props.anchor = "faq";
    return node;
  },
  cta(c) {
    const node = section("Call to action", [
      heading(str(c, "headline", "Ready to build?"), 2, { fontSize: "44px", color: "var(--color-on-primary)", textAlign: "center" }, { fontSize: "32px" }),
      text(str(c, "subheadline", "Start free. Bring your team and your agents."), { color: "var(--color-on-primary)", opacity: 0.85, textAlign: "center" }),
      n("stack", {}, { base: { display: "flex", flexDirection: "row", justifyContent: "center" } }, [
        n("button", { label: str(c, "ctaLabel", "Create your site"), href: str(c, "ctaHref", "#") }, { base: { background: "var(--color-on-primary)", color: "var(--color-primary)", padding: "14px 28px", borderRadius: "var(--radius)", fontWeight: 700, textDecoration: "none" } }),
      ]),
    ], { backgroundColor: "var(--color-primary)" });
    node.props.anchor = "cta";
    node.animation = scrollIn;
    return node;
  },
  "contact-form"(c) {
    const node = section("Contact", [
      heading(str(c, "headline", "Get in touch"), 2, { fontSize: "40px" }, { fontSize: "30px" }),
      text(str(c, "subheadline", "We usually reply within one business day.")),
      n("form", { formName: str(c, "formName", "contact"), successMessage: "Thanks! We'll be in touch." }, { base: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "520px" } }, [
        n("input", { name: "name", label: "Name", inputType: "text", required: true }, {}),
        n("input", { name: "email", label: "Email", inputType: "email", required: true }, {}),
        n("input", { name: "message", label: "Message", inputType: "textarea" }, {}),
        n("button", { label: str(c, "ctaLabel", "Send message"), submit: true }, { base: { background: "var(--color-primary)", color: "var(--color-on-primary)", padding: "14px 24px", borderRadius: "var(--radius)", fontWeight: 600, border: "0", cursor: "pointer" } }),
      ], "Form"),
    ]);
    node.props.anchor = "contact";
    return node;
  },
  "text-section"(c) {
    return section("Text", [
      heading(str(c, "headline", "Our story"), 2, { fontSize: "36px" }, { fontSize: "28px" }),
      text(str(c, "body", "Write a few paragraphs here about what you do and why it matters."), { maxWidth: "720px" }),
    ]);
  },
  "image-section"(c) {
    return section("Image", [
      n("image", { src: str(c, "src", "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1600&q=80"), alt: str(c, "alt", "Product screenshot") }, { base: { width: "100%", borderRadius: "var(--radius)", objectFit: "cover", aspectRatio: "16 / 9" } }),
    ]);
  },
  story(c) {
    const steps = items(c, "items", [
      { title: "Design it", body: "Lay out pages visually with your brand's colors, type and components." },
      { title: "Let Claude build it", body: "Claude works on its own branch: new sections, copy, translations. Nothing goes live on its own." },
      { title: "Ship it together", body: "Review the changes side by side, approve, and publish in one click." },
    ]);
    const palette = ["var(--color-primary)", "var(--color-text)", "var(--color-muted)"];
    const visual = (s: Record<string, string>, i: number) =>
      s.src
        ? n("image", { src: s.src, alt: s.alt ?? s.title ?? "" }, { base: { width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "var(--radius)" } }, undefined, `Visual ${i + 1}`)
        : n(
            "stack",
            {},
            {
              base: { width: "100%", aspectRatio: "4 / 3", borderRadius: "var(--radius)", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px" },
              mobile: { padding: "24px" },
            },
            [
              n("text", { text: String(i + 1).padStart(2, "0") }, { base: { margin: "0", fontFamily: "var(--font-heading)", fontSize: "120px", lineHeight: "1", fontWeight: 600, letterSpacing: "-0.04em", color: palette[i % palette.length] }, mobile: { fontSize: "72px" } }),
              n("text", { text: s.title ?? `Step ${i + 1}` }, { base: { margin: "0", fontSize: "22px", fontWeight: 600, color: "var(--color-text)" } }),
            ],
            `Visual ${i + 1}`,
          );
    const step = (s: Record<string, string>, i: number) =>
      n("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "460px" } }, [
        n("text", { text: `Step ${i + 1}` }, { base: { margin: "0", fontSize: "14px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-primary)" } }),
        heading(s.title ?? `Step ${i + 1}`, 3, { fontSize: "44px", lineHeight: "1.1", letterSpacing: "-0.02em" }, { fontSize: "30px" }),
        text(s.body ?? ""),
      ], `Step ${i + 1}`);
    const intro = n("stack", {}, { base: { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "32px" } }, [
      heading(str(c, "headline", "How it works"), 2, { fontSize: "56px", letterSpacing: "-0.03em", lineHeight: "1.05" }, { fontSize: "36px" }),
      text(str(c, "subheadline", "Three steps from idea to a live site."), { maxWidth: "560px" }),
    ]);
    intro.children![0]!.scroll = { effect: "reveal", range: "in" };
    const story = n(
      "story",
      { side: c.side === "left" ? "left" : "right" },
      { base: { width: "100%", maxWidth: "1120px", margin: "0 auto" } },
      [n("stack", {}, { base: { width: "100%" } }, steps.map(visual), "Visuals"), ...steps.map(step)],
      "Story",
    );
    return n("section", {}, { base: { padding: "120px 24px", display: "flex", flexDirection: "column" }, mobile: { padding: "72px 20px" } }, [intro, story], "Story");
  },
  statement(c) {
    const node = section(
      "Statement",
      [
        n("text", { text: str(c, "eyebrow", "Why it matters") }, { base: { margin: "0", fontSize: "14px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-primary)" } }),
        heading(str(c, "headline", "Every team ships its own pages, and every page still looks like you."), 2, { fontSize: "clamp(40px, 6vw, 84px)", lineHeight: "1.04", letterSpacing: "-0.035em", fontWeight: 600, maxWidth: "1000px" }),
        text(str(c, "body", "Brands, templates and review keep a hundred sites consistent without slowing anyone down."), { fontSize: "20px", maxWidth: "620px" }),
      ],
      { padding: "160px 24px" },
      { padding: "96px 20px" },
    );
    const [eyebrow, h, body] = node.children![0]!.children!;
    eyebrow!.scroll = { effect: "fade", range: "in" };
    h!.scroll = { effect: "reveal", range: "in" };
    body!.scroll = { effect: "rise", range: "in" };
    return node;
  },
  "stacked-cards"(c) {
    const cards = items(c, "items", [
      { title: "Brand kits", body: "Colors, type and shared components every site follows, updated everywhere at once." },
      { title: "Branches and review", body: "People and Claude work side by side; a person approves what goes live." },
      { title: "One CMS, every language", body: "Collections, translations and scheduled releases from the same place." },
    ]);
    return section("Stacked cards", [
      heading(str(c, "headline", "Built for teams"), 2, { fontSize: "48px", letterSpacing: "-0.03em" }, { fontSize: "34px" }),
      n(
        "stack",
        {},
        { base: { display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "80px" } },
        cards.map((card, i) =>
          n(
            "stack",
            {},
            {
              base: {
                position: "sticky",
                top: `${96 + i * 24}px`,
                minHeight: "360px",
                padding: "48px",
                borderRadius: "calc(var(--radius) * 2)",
                backgroundColor: i % 2 ? "var(--color-text)" : "var(--color-surface)",
                color: i % 2 ? "var(--color-background)" : "var(--color-text)",
                border: "1px solid var(--color-border)",
                boxShadow: "0 -12px 40px rgba(0, 0, 0, 0.08)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: "12px",
              },
              mobile: { padding: "28px", minHeight: "280px", top: `${72 + i * 16}px` },
            },
            [
              heading(card.title ?? `Card ${i + 1}`, 3, { fontSize: "40px", letterSpacing: "-0.02em", color: "inherit" }, { fontSize: "28px" }),
              text(card.body ?? "", { color: "inherit", opacity: 0.75, maxWidth: "560px" }),
            ],
            `Card ${i + 1}`,
          ),
        ),
        "Cards",
      ),
    ]);
  },
  footer(c) {
    return n("section", {}, { base: { padding: "48px 24px", borderTop: "1px solid var(--color-border)" } }, [
      n("stack", {}, { base: { width: "100%", maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "row", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" } }, [
        n("text", { text: str(c, "brand", "Acme") }, { base: { fontWeight: 700, color: "var(--color-text)", margin: "0" } }),
        n("text", { text: str(c, "note", `© ${new Date().getFullYear()} Acme, Inc. All rights reserved.`) }, { base: { color: "var(--color-muted)", fontSize: "14px", margin: "0" } }),
      ]),
    ], "Footer");
  },
};

export const BLOCK_NAMES = Object.keys(BUILDERS);

export const BLOCK_DESCRIPTIONS: Record<string, string> = {
  navbar: "Sticky top bar with logo, links and a button. content: brand, links[{label,href}], ctaLabel, ctaHref",
  hero: "Large headline section. content: eyebrow, headline, subheadline, ctaLabel, ctaHref, secondaryLabel, secondaryHref",
  features: "Heading plus a responsive grid of cards. content: headline, subheadline, items[{title,body}]",
  logos: "Row of customer names. content: headline, items[{title}]",
  testimonial: "Centered quote. content: quote, author",
  pricing: "Plan cards. content: headline, items[{title,price,body,cta,href}]",
  faq: "Question and answer list. content: headline, items[{title,body}]",
  cta: "Colored call-to-action band. content: headline, subheadline, ctaLabel, ctaHref",
  "contact-form": "Contact form that stores submissions. content: headline, subheadline, formName, ctaLabel",
  "text-section": "Heading and paragraph. content: headline, body",
  "image-section": "Full-width image. content: src, alt",
  story: "Scroll story: a pinned visual changes as each step scrolls past (left or right of the text). content: headline, subheadline, side (left|right), items[{title,body,src?,alt?}]",
  statement: "One large statement that reveals as you scroll. content: eyebrow, headline, body",
  "stacked-cards": "Cards that pin and stack on top of each other while scrolling. content: headline, items[{title,body}]",
  footer: "Footer with brand and note. content: brand, note",
};

/** Build a fresh copy of a named block, filling in any provided content. */
export function buildBlock(name: string, content: Content = {}): SiteNode {
  const b = BUILDERS[name];
  if (!b) throw new Error(`Unknown block "${name}". Available: ${BLOCK_NAMES.join(", ")}`);
  return b(content);
}
