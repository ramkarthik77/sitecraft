# Making new sections and components

How new building blocks get into Sitecraft, from an author arranging a section in the editor to a developer adding a new kind of element in code.

**Most new sections need no code.** An author builds one from existing elements, makes it a component, and shares it through a brand or a template. Code is for things the elements can't do yet: new HTML, new behavior, new settings.

| You want | Who | Where | Code? |
|---|---|---|---|
| A section for one site (a pricing table your way) | Author | Editor → Make reusable component | No |
| The same header and footer on every site | Admin | Brands page | No |
| A starting point for new sites | Author | Site settings → Save as template | No |
| A ready-made section in everyone's Insert panel and for Claude | Developer | `packages/schema/src/blocks.ts` | Small |
| A new kind of element (accordion, map, countdown) | Developer | Schema, renderer, editor, MCP | Yes |
| A new kind of edit (sort a list, swap two pages) | Developer | `packages/schema/src/ops.ts` | Yes |

---

## Part 1: For authors

### Terms

| Word | Means |
|---|---|
| **Element** | One piece: heading, text, image, button, stack, grid, form, story, and so on (Insert → Elements) |
| **Section** | A full-width band of a page, built from elements. Insert → Sections has ready-made ones |
| **Component** | A section or element you made reusable. Every copy on every page is the same; edit one and they all change |
| **Brand component** | A component that belongs to a brand (usually header and footer). Every site on the brand gets it, and it updates when the brand does |
| **Template** | A saved copy of a whole site that new sites start from |

### Build a section

1. **Start from the closest ready-made section** (Insert → Sections), or from a **Section** element with a **Stack** inside it.
2. **Arrange with stacks and grids.** A Stack lines things up in a column or a row; a Grid makes columns of cards. Set gap and padding in **Layout**.
3. **Use the theme, not fixed values.** Pick colors from the theme swatches (`var(--color-primary)`, `var(--color-text)`...) and fonts from `var(--font-heading)` and `var(--font-body)`. Then the section follows brand changes, and it passes the brand check on locked brands.
4. **Check tablet and phone.** Switch to Tablet and Phone in the top bar; fields you change there override desktop only (they turn blue).
5. **Name the layers** (Inspector → Layer name): "Pricing", "Plan card", "Price". The names show in Layers, in review diffs and to Claude.
6. **Fill in the words people can't see**: image alt text, button links, the page title and description.
7. **Add motion if it helps** (Inspector → Motion): an entrance, a scroll effect, a hover. Keep to one entrance style per page.

### Make it reusable

Select the section's outer layer, then **Make reusable component** in the inspector. The section becomes a component, and the original spot becomes the first copy.

- Place more copies from **Insert → Components**.
- Editing inside any copy changes every copy on the site.
- Need one copy to differ? Make a second component.

### Use it on other sites

| Way | When | How |
|---|---|---|
| **Brand** | Shared parts that must stay the same everywhere (header, footer, legal bar) | An admin opens **Brands**, chooses **Update theme and components from a site**, and saves. Every site on the brand gets the components; on a locked brand they can only be changed on the Brands page |
| **Template** | A starting point that sites then change freely | **Site settings → Save as template**. New sites made from it get a copy |

### Make it content-driven (CMS)

For repeated content (posts, people, products), don't copy the section for each item.

1. Make a collection in **CMS**.
2. On a list's card or the item page, select the heading, text, image or link and pick a field under **Content from** in the inspector.
3. Use **Insert → From the CMS** to place a list anywhere.

See [CMS.md](CMS.md).

### Make it work in every language

Text, button labels, image alt text and rich text translate per language (top bar → language). Bound CMS fields translate when the field is marked **Translate**. See [AUTHORING.md](AUTHORING.md#languages).

### Ask Claude

Claude builds sections the same way, on a branch for you to review:

> Add a pricing section with three plans, the middle one highlighted, using our brand colors. Then make it a reusable component called Pricing.

> Turn the team page into a CMS collection and list it on the About page.

> Add a story section explaining our onboarding in three steps, reveal the big headings as they scroll in, and translate it into French.

### A good section

- [ ] Theme colors and fonts only, no fixed hex values
- [ ] Looks right on Tablet and Phone
- [ ] Layers are named
- [ ] Images have alt text; links go somewhere
- [ ] Motion is calm: one entrance style, 400–900 ms
- [ ] Repeated content comes from the CMS

### When you need a developer

Ask for a new element when the elements can't express something: a new HTML element (an accordion, a table, a map), new behavior on the published site (a countdown, a carousel), or a new setting in the inspector. Send a sketch and which sites need it; Part 2 is what they'll do.

---

## Part 2: For developers

### Where things live

```
packages/schema     The document model. Types, validation, ops (every edit), blocks, outline for Claude.
packages/renderer   Document → HTML and CSS. Shared by the canvas, previews and publishing. No Node or DOM APIs.
apps/editor         React editor: Insert panel, Inspector, canvas bridge.
apps/api            Fastify API: storage, guardrails (assertCanWrite, assertCanShip), publishing.
apps/mcp            The MCP server Claude Code uses: tools that turn into ops.
claude-plugin       The skill that teaches Claude how to build sites here.
```

Three rules hold everything together:

1. **Every change to a document is an op** in `packages/schema/src/ops.ts`. The API, the editor and the MCP server never edit documents directly. Ops are validated, undoable and recorded in history.
2. **Everything rendered passes `packages/schema/src/validate.ts`**: safe hrefs, image sources, CSS values and allowed style keys. Never emit raw HTML from content.
3. **The renderer is pure**: plain functions from a document to strings, so the same code runs in the browser canvas, the API and the Cloudflare Worker.

### Recipe A: add a ready-made section (block)

A block is a function that returns a tree of existing elements. It gets you a card in Insert → Sections, `add_block` and `list_blocks` for Claude, and the brand check, with no renderer or editor changes.

**1. Write the builder** in `packages/schema/src/blocks.ts`, inside `BUILDERS`. Use the helpers at the top of the file: `section`, `heading`, `text`, `button`, `n`, `items` and `str`.

```ts
  timeline(c) {
    const events = items(c, "items", [
      { title: "2019", body: "Founded in a garage in Lisbon." },
      { title: "2022", body: "First 1,000 customers." },
      { title: "2026", body: "Offices in four countries." },
    ]);
    const row = (e: Record<string, string>) =>
      n("stack", {}, { base: { display: "flex", flexDirection: "row", gap: "32px", paddingTop: "24px", borderTop: "1px solid var(--color-border)" }, mobile: { flexDirection: "column", gap: "8px" } }, [
        heading(e.title ?? "", 3, { fontSize: "28px", minWidth: "120px" }),
        text(e.body ?? ""),
      ], e.title);
    const list = n("stack", {}, { base: { display: "flex", flexDirection: "column", gap: "24px" } }, events.map(row), "Events");
    list.animation = { preset: "slide-up", trigger: "scroll", durationMs: 600, staggerMs: 120 };
    return section("Timeline", [heading(str(c, "headline", "Our story"), 2, { fontSize: "44px" }, { fontSize: "32px" }), list]);
  },
```

Guidelines:

- Colors and fonts from theme variables (`var(--color-*)`, `var(--font-heading)`), so the block is on-brand everywhere and passes locked-brand checks.
- A `mobile` style for anything that won't fit at 390 px.
- `items(c, "items", defaults)` and `str(c, key, default)` so Claude can pass content and the block still looks finished without it.
- Name the layers. People see them in Layers, and Claude sees them in the outline.

**2. Describe it** in `BLOCK_DESCRIPTIONS`. Claude reads this through `list_blocks`, so list the content keys:

```ts
  timeline: "Dated events in order, coming in one at a time. content: headline, items[{title,body}]",
```

**3. Give it a thumbnail** in `apps/editor/src/components/Insert.tsx` → `BlockThumb`: a `case "timeline":` with a few bars, like the others.

**4. Test it** in `packages/schema/test/schema.test.ts`. Check that it builds, validates and takes content:

```ts
it("builds a timeline with content", () => {
  const doc = createStarterDocument({ template: "blank" });
  const { document } = applyOperations(doc, [{ op: "add_block", parentId: doc.pages[0]!.root.id, block: "timeline", content: { items: [{ title: "2020", body: "Hello" }] } }]);
  expect(JSON.stringify(document)).toContain("Hello");
});
```

**5. Build and check**: `pnpm build && pnpm test`, then `pnpm start` and insert it from the panel.

### Recipe B: add a new kind of element (node type)

Use this when no arrangement of existing elements produces the HTML or behavior you need. The example is an accordion, a question that opens to show its answer, using native `<details>` so it needs no script.

Touch these places, in this order:

| # | File | What |
|---|---|---|
| 1 | `packages/schema/src/types.ts` | Add `"accordion"` to `NODE_TYPES`. If it holds other elements, also add it to `CONTAINER_TYPES` |
| 2 | `packages/schema/src/validate.ts` | Check its props in the node `superRefine`: types, lengths, and safety for anything that becomes a URL |
| 3 | `packages/schema/src/i18n.ts` | Props people translate: add `accordion: ["title", "body"]` to `TRANSLATABLE` |
| 4 | `packages/schema/src/validate.ts` | Props the CMS can fill: add to `BINDABLE_PROPS` if new |
| 5 | `packages/schema/src/outline.ts` | A short `detail` in `describeNode` so Claude can tell elements apart |
| 6 | `packages/renderer/src/html.ts` | A `case` in `renderNode` |
| 7 | `packages/renderer/src/css.ts` | Base CSS in `RESET_CSS`, scoped to a `.sc-` class |
| 8 | `apps/editor/src/components/Insert.tsx` | An entry in `ELEMENTS` (label, glyph, starting props and style) |
| 9 | `apps/editor/src/components/Inspector.tsx` | Fields in `ContentFields` |
| 10 | `apps/editor/public/canvas-bridge.js` | A label in the `TYPE` map (shown on the canvas selection) |
| 11 | `apps/mcp/src/tools.ts` | Mention it and its props in `OPS_HELP`, so Claude knows `add_node` can make it |
| 12 | Tests and docs | See below |

The renderer case (step 6) escapes all text, and only uses `a()` for attributes, so ids, classes, motion and editor hooks keep working:

```ts
    case "accordion":
      return `<details${a(["sc-accordion"])}${p.open ? " open" : ""}><summary>${escapeText(p.title)}</summary><p>${escapeText(p.body)}</p></details>`;
```

`p` already has CMS bindings and translations applied, so the element works in lists and every language with no extra code.

The base CSS (step 7) uses theme variables, and authors' styles override it:

```ts
  ".sc-accordion{border-bottom:1px solid var(--color-border);padding:16px 0}.sc-accordion summary{cursor:pointer;font-weight:600;color:var(--color-text)}.sc-accordion p{margin:12px 0 0;color:var(--color-muted)}",
```

The inspector fields (step 9) follow the other cases. `free(key)` hides a field the CMS fills, and `ph(key)` shows the main-language text while you translate:

```tsx
    case "accordion":
      return (
        <>
          {free("title") && (
            <Field label="Question">
              <TextInput label="Question" value={str("title")} placeholder={ph("title")} onChange={(v) => set("title", v)} />
            </Field>
          )}
          {free("body") && (
            <Field label="Answer">
              <textarea className="textarea" aria-label="Answer" value={str("body")} placeholder={ph("body")} onChange={(e) => set("body", e.target.value)} />
            </Field>
          )}
          <label className="check">
            <input type="checkbox" checked={!!p.open} onChange={(e) => set("open", e.target.checked)} /> Open at first
          </label>
        </>
      );
```

Then:

- **Behavior on the published page?** See [Recipe D](#recipe-d-behavior-on-published-sites).
- **Editable by double-click on the canvas?** Text elements are listed in `canvas-bridge.js` (`['heading','text','button']`). Add yours only if it renders a single text node.

### Recipe C: add a new kind of edit (op)

1. In `packages/schema/src/ops.ts`, add a zod schema to the operation union, for example `z.object({ op: z.literal("sort_items"), collectionId: z.string(), by: z.string(), direction: z.enum(["asc", "desc"]) })`.
2. Add a `case` in the apply switch. Change the draft `doc`, and throw `OperationError` with a sentence a person can act on.
3. Return the id of anything you created (or `null`). The editor selects it, and Claude gets it back.

You don't need to add validation, brand checks, version history, undo or live updates. Every op batch is validated as a whole document afterwards, and saved, diffed and broadcast like any other.

4. Test the success case and each `OperationError` in `packages/schema/test/schema.test.ts`.
5. If Claude should use it directly, add it to `OPS_HELP`, or write a focused MCP tool in `apps/mcp/src/tools.ts` that builds the op. Tools build ops; they never write documents. Agent guardrails stay in `apps/api/src/routes/api.ts`.

### Recipe D: behavior on published sites

Published sites run one small script, `RUNTIME_SCRIPT` in `packages/renderer/src/html.ts`. It handles entrances, scroll effects, stories, tilt, forms and parallax. To add behavior:

- **Mark elements with a `data-sc-*` attribute** in the renderer (only in publish mode: `ctx.opts.mode !== "editor"`), and find them with `Q('[data-sc-yours]')` in the script.
- **Keep it small and plain.** No libraries, no network calls, feature-detect everything. Do nothing when `calm` is true (the visitor asked for reduced motion) if the behavior is decorative.
- **Prefer CSS.** Scroll timelines (`animation-timeline: view()`), `position: sticky` and `<details>` need no script at all.
- **The Content-Security-Policy updates itself.** The API hashes `RUNTIME_SCRIPT` (`RUNTIME_HASH` in `apps/api/src/security.ts`), so changing the script changes the allowed hash. Never add other inline scripts or `on*=` attributes; the policy blocks them, and the e2e suite fails on any violation.
- **No GSAP.** Its license forbids use in visual animation builders that compete with Webflow, which describes Sitecraft.

### Recipe E: allow a new style property

Add the camelCase name to `STYLE_PROPERTIES` in `packages/schema/src/types.ts`. The renderer turns it into CSS, the validator checks its values (`isSafeCssValue`), and Claude sees it in `update_style`. Add an inspector field only if authors need it often; the rest stays reachable for Claude and in future panels.

### Tests

| Command | Runs | Needs |
|---|---|---|
| `pnpm test` | Schema, renderer, API and MCP tests | Postgres at `TEST_DATABASE_URL` |
| `pnpm test:e2e` | The editor in Chromium, end to end, failing on any CSP violation | Postgres and Chromium |
| `E2E_VIDEO=1 pnpm test:e2e` | The same, recorded at a watchable pace into `test-results/<test>/video.webm` | ffmpeg |

For a new element, cover:

- [ ] Validation accepts good props and rejects bad ones (schema test)
- [ ] Publish output has the markup, escaped (renderer test)
- [ ] Editor output has `data-node-id` and no published-only hooks (renderer test)
- [ ] Translations and CMS bindings flow through, if it has text (renderer test)
- [ ] Claude can add it and sees it in `get_site` (MCP test), if Claude should use it
- [ ] An author can insert and edit it (e2e), if it has inspector fields

### Ship it

1. Work on a branch; `pnpm build && pnpm test && pnpm test:e2e`.
2. Update the docs:
   - Authors: [AUTHORING.md](AUTHORING.md) or [CMS.md](CMS.md).
   - Claude's tools: [CLAUDE_CODE.md](CLAUDE_CODE.md).
   - The skill: `claude-plugin/skills/build-site/SKILL.md`, if Claude should reach for the new thing.
3. Open a pull request. CI runs the same checks, and merging to `main` deploys to Cloudflare ([CLOUDFLARE.md](CLOUDFLARE.md)).
4. **Published sites are static files.** They pick up renderer changes the next time each site is published. The editor and previews show the change at once.

### Keep old sites working

Saved documents live for years.

- Only **add**: new node types, new optional props, new optional fields.
- Never rename or remove a type or prop that saved documents use.
- If a shape really must change, accept both shapes in validation and the renderer. Then convert old documents with an op that people or a script run on purpose.
