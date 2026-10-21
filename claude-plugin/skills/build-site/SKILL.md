---
name: build-site
description: Build or change a website in Sitecraft through the sitecraft MCP tools — new sites, new pages or sections, copy edits, rebrands and responsive fixes. Use whenever the person asks for website or landing-page work in Sitecraft.
---

# Building sites in Sitecraft

Sitecraft is the team's visual website builder. People edit in the browser; you edit the same site through the `sitecraft` MCP tools. Your work always lands on a branch that a person reviews, merges and publishes.

## Workflow

1. **Find the site.** `list_sites`, or `create_site` with a template (`landing` for a single page, `saas` for a full product site, `blank` to start empty).
2. **Read before editing.** `get_site` returns every page as an outline with node ids. Use those ids; never guess them. `get_node` shows one element's full props and styles.
3. **Branch for the task.** `create_branch` named `agent/<short-task>`, for example `agent/pricing-page`. Never try to edit `main`.
4. **Make the change.**
   - New sections: `add_section` with a block from `list_blocks` and real `content` (headline, items, CTA labels). Blocks are responsive and on-brand already; prefer them over building sections node by node.
   - Copy: `update_text`.
   - Look and feel: `set_theme` for brand colors, fonts and radius across the site; `update_style` for one element.
   - Anything else, or several changes at once: `edit_site` with a list of operations (they apply atomically).
   - New pages: `add_page` with starting blocks, then fill them in.
5. **Check it.** Call `get_site` again to confirm the structure, and `get_preview_url` to get a link. If the person can open links, give them the preview.
6. **Hand off.** Finish with `request_review` and a short summary. Pass on the review link it returns. Don't call `merge_branch` or `publish_site` unless the person explicitly asks you to ship.

## Quality bar

- Write real copy for the person's business, specific and plain. No lorem ipsum, no "Feature 1".
- Use theme tokens (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`) instead of hard-coded colors so rebrands stay one change.
- Check phones: base styles apply everywhere; `breakpoint: "mobile"` overrides for screens up to 767px and `"tablet"` up to 1023px. Big headings usually need a smaller mobile size.
- Give every image meaningful `alt` text and every page a `title` and `description`.
- Keep link targets valid: page paths like `/pricing`, in-page anchors like `#faq` (sections have `props.anchor`), or full https URLs.

## When something fails

- **403 "Agents edit on a branch"**: you targeted `main`. Create a branch and retry there.
- **403 on merge or publish**: expected. Use `request_review` and give the person the link.
- **400 with validation errors**: read the message; it names the field (unknown style key, unsafe URL, missing parent). Fix that one thing and retry.
- **409 conflict**: someone changed the branch at the same moment. Re-read with `get_site` and redo the edit.
