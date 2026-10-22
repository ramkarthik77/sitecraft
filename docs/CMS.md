# The CMS: collections

Collections hold content that repeats: blog posts, products, team members, job openings, case studies. You write each item once, as data, and design how items look once, on a template. Lists on any page and a page per item update by themselves.

```
 Blog collection                     Template page /blog/:slug          Published site
 ┌───────────────────────────┐       ┌──────────────────────┐          /blog/welcome-to-the-blog
 │ Title  Date   Cover  Body │  ──▶  │ H1      ← Title      │   ──▶    /blog/how-we-work
 │ ...    ...    ...    ...  │       │ Image   ← Cover      │          /blog            (the list)
 └───────────────────────────┘       │ Text    ← Body       │          /                ("Latest posts")
                                     └──────────────────────┘
```

## Make a collection

1. Open a site and click the **CMS** tab on the left.
2. Pick a starting point:

   | Preset | Fields |
   |---|---|
   | Blog | Title, Summary, Cover image, Date, Author, Body |
   | Team | Name, Role, Photo, Bio |
   | Products | Name, Price, Image, Description, Buy link |
   | Jobs | Title, Location, Team, Description, Apply link |
   | Blank | Title, then add your own |

3. Name it and click **Create collection**.

This adds:

- the collection, with two example items you can edit or delete
- a list page at `/<slug>`, for example `/blog`, with the site's navbar and footer
- a template page at `/<slug>/:slug` that every item uses for its own page

A new site can also start with all of this: pick the **Blog** template when you create it.

## Add and edit items

In the CMS tab, the table shows every item. Click **New item**, or click a row to edit it on the right.

| Field type | What you enter |
|---|---|
| Text | A line or a short paragraph |
| Rich text | Longer writing in Markdown: `## Heading`, `**bold**`, `*italic*`, `- list`, `1. list`, `> quote`, `[link](https://…)`, `![alt](https://…)`. **Preview** shows how it reads. Raw HTML is shown as text, never run |
| Image | Upload, or paste an image address |
| Date | A date; shown as "October 1, 2026" in the site's language |
| Link | `https://…`, a page like `/contact`, `mailto:` or `tel:` |
| Number, Yes / no | A number, a checkbox |

- **Draft** items show in the editor and in previews but are left out when you publish. New items start as drafts. A draft's slug follows its title; once it's published, its address stays put unless you change the slug.
- **Slug** is the item's address: `/blog/<slug>`.
- **Move up / Move down** set the order used by lists that aren't sorted by a field.
- **Fields** (top right) lets you rename, add and remove fields. The first field is the title and stays first.

Every change is saved as a version like any other edit, so undo, history, branches and review all work for content too.

## Design the item page

Click **Edit template** (or open `/blog/:slug` from Pages). The picker next to the page name chooses which item the canvas shows.

Elements on a template show an item's field when **Content from** is set in the right-hand panel:

| Element | Can show |
|---|---|
| Heading, Text | Text, number, date or yes/no fields, or the slug |
| Rich text | Rich text or text fields |
| Image | An image field (and a text field as its alt text) |
| Button | A text field as its label; the item page or a link field as its link |
| Link | The item page or a link field |

Set it back to **Fixed** to type the content yourself. Elements showing a field get a teal outline on the canvas and can't be edited by double-clicking; change the item in the CMS instead.

Each item page takes its browser title, search description and share image from the item: its title, its first filled text field and its first image.

## Show items on any page

Open **Insert**. Under **From the CMS**, click or drag a collection's list onto the page. It adds a heading and a grid of cards linking to each item's page.

Select the list (the grid) to choose:

- **Shows**: which collection
- **Up to**: how many items, for example 3 for "Latest posts"
- **Order**: as listed in the CMS, or by a field. Blogs default to newest first by date
- **When empty**: the message shown when there's nothing to list

The first card is the design for all of them. Restyle it, or change what it shows with **Content from**, and every card follows.

## With Claude Code

Claude edits collections through the same operations, on a branch, so you review content like any other change. Try:

- *"Add a blog to the Northstar site and write three posts about our seasonal drinks, as drafts."*
- *"Here's our product list (CSV). Put it in a Products collection."*
- *"Show the latest three posts on the home page."*

The review lists each item added, changed or removed. See [CLAUDE_CODE.md](CLAUDE_CODE.md) for the tools.

## Publishing and export

**Publish** writes one page per published item (`/blog/<slug>/index.html`), the list pages, and a sitemap that includes every item. **Settings → Export** does the same into a .zip.

## Limits

- Up to 50 collections per site, 40 fields per collection and 5,000 items per collection.
- One template page per collection.
- Collections live inside the site document, so every version holds the content. That keeps history and branches simple; for tens of thousands of items, a separate content store would be the next step.
