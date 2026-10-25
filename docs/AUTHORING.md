# Templates, brands, languages, assets, history, reviews and releases

How teams keep many sites consistent and launch on time: **templates** decide how a new site starts, **brands** keep the look and voice the same across sites afterwards.

| | Templates | Brands |
|---|---|---|
| What it is | A saved copy of a site | Colors, fonts, corner radius, shared components (header, footer), logo and written guidelines |
| When it applies | Once, when a site is created | All the time: sites follow brand updates |
| Like in AEM | Site templates | Editable template policies, style system, Experience Fragments for the shared header and footer |

## Templates

**Save one:** on any site's overview, **Save as template** (or Templates → **Save a site as a template**). It keeps the site's `main` version: pages, design, components and CMS fields. Tick **Include CMS items** to keep the posts or products too. Saving again from the same site offers **Update** for the template it made before.

**Make one from scratch:** Templates → **New template**. Name it and pick a starter; Sitecraft makes a working site for it in a **Templates** folder and opens it in the editor. Design it there, then **Save as template** on that site to update the template. **Edit its site** on the template card takes you back to it.

**Import one from a website:** Templates → **Import from a website** (or **New site → Import from a website instead**). Give the address and how many pages to bring (the home page, then pages linked from its navigation). Sitecraft rebuilds each page as sections you can edit (headings, text, images, buttons, links), takes the site's main colour and fonts, and links between the imported pages. It's a starting point for migrating a site you own, not a pixel copy: scripts, forms, embeds and detailed styling stay behind, and sites that draw their pages with JavaScript import mostly empty. Images keep loading from the original site until you replace them with approved library images. Only public addresses can be imported (never internal ones), and each import is in the audit log.

**From Figma:** ask Claude Code, connected to Figma and Sitecraft, to build a frame as a page or template. See [Designs from Figma](CLAUDE_CODE.md#designs-from-figma).

**Use one:** pick it under **Your templates** when creating a site, or **Use template** on the Templates page. The new site:

- gets the template's pages and design, with the source site's name replaced by the new one
- follows the template's brand, if the source site had one

Claude Code can use them as well: `list_templates`, then `create_site` with the template's name.

## Brands

### Create a brand

1. Style one site the way the brand should look: theme colors, fonts and corner radius in the page panel.
2. Make the shared parts reusable: select the navbar → **Make reusable component** (name it Header), same for the footer.
3. Brands → **New brand**, pick that site, write the guidelines, and choose whether to lock it.

### Put sites on a brand

Site settings → **Brand** (admins). The brand's colors, fonts and components are copied into the site's `main` as a new version, visible in History. Insert → **Components** lists the brand's header and footer to place on pages.

### Update a brand

Change colors, guidelines or the lock on the Brands page, or **Update theme and components from a site** after restyling the source site. **Save and update N sites** adds a new version to every site's `main`. Branches started earlier pick up the current brand when they're merged.

### Locked brands

When a brand is locked, in every site that follows it:

- theme colors, fonts and corner radius can't be changed
- the brand's shared components can only be edited on the Brands page
- new or restyled elements can only use the brand's colors (`var(--color-…)` or the brand's own values) and fonts

This is checked by the server on every save, for people and Claude alike. Unlocked brands only warn: **Review changes** lists anything off-brand that a branch added.

### Guidelines for Claude

Claude Code reads the brand guidelines at the top of every `get_site`, before it edits. Write them for a person who's never seen the brand:

```
Voice: warm, plain, confident. Short sentences.
Say: customers, teams. Avoid: synergy, leverage, users.
Headlines: sentence case, no exclamation marks.
Images: real people at work, natural light. No stock handshakes.
Logo: never stretch, recolor or put on busy photos.
```

`request_review` also lists anything off-brand Claude added, so it can fix it before handing over.

## Releases and scheduled publishing

**Publish later:** the clock next to **Publish** schedules publishing `main` at a date and time (your time zone). The time shows next to the button; change or cancel it in History.

**Release a branch:** for a launch that has to go live together (new pages, posts, prices, a banner), do the work on a branch, then **Review changes → Schedule release…**. At that time the branch is merged into `main` and the site is published, in one step. To take something down at a time (a promotion ending), make that change on a branch and schedule its release the same way.

- If `main` changed after the branch was started, the release doesn't overwrite it: it's marked **Didn't run** in History, so someone can review and schedule it again.
- Scheduled runs are recorded in History and the audit log as "*name* (scheduled)".
- Only people can schedule; Claude prepares the branch and asks for review.
- On Cloudflare, schedules are checked every minute.

**Hide a page:** a page's **Hide from the published site** box keeps it out of the published site and the sitemap while you work on it. It still shows in the editor and in previews. The home page can't be hidden.

## Assets: the shared image library

**Assets** in the dashboard is one image library for every site, like AEM Assets.

- **Folders:** organise the library in nested folders (for example Calvexa › Autumn congress), like AEM Assets. **New folder** in the folder tree makes one inside the folder you're in; hover a folder to rename it, add a folder inside or delete it (what's in it moves up a level, nothing is deleted). Uploads go into the folder you're in. Move an image by dragging it onto a folder, or with **Folder** in its details.
- **Approval and rights:** each image has an approval status, a job code, the markets it's cleared for and when its usage rights end. Sites can't be published while they use an image that's expired, unapproved or not cleared for their market.
- **Upload** with the button or by dropping files anywhere on the page. PNG, JPEG, GIF and WebP, up to 10 MB. Files are checked to really be the image type they claim.
- **Describe** each image: title, **alt text**, tags, credit. Tiles show **No alt text** until it's written.
- **Focal point:** click the most important part of the image. When an image is placed from the library, its crop keeps that point in view (`objectPosition`).
- **Usage rights end:** after that date the image stops being served on every site (it returns *410 Gone*), so licensed photos come down on time.
- **Used on** lists every site, page and CMS collection whose `main` uses the image. Deleting a used image asks first.
- **Replace file…** swaps the picture but keeps its address, so every page using it updates at once.

In the editor, image elements and CMS image fields have **Choose from library**; the library's alt text comes along. Claude Code searches the same library with `search_assets` and uses those images instead of ones from elsewhere.

## Comments and approvals

**Comments** (the speech bubble in the top bar) belong to the branch you're on. Comment on the whole site, or select an element and click **Comment** in the right panel; elements with open comments get a yellow marker on the canvas. Reply, **@mention** people (or **@Claude**), and **Resolve** threads when they're handled. New comments show up live for everyone on the branch.

Claude Code reads them too: ask it to *"work through the comments on agent/hero-copy"*. It uses `list_comments`, makes the changes, replies with `add_comment` and resolves what it handled.

**Approvals** (Site settings → Reviews, admins) require 1–3 people to approve a branch before it's merged, like an AEM approval workflow:

- Approvals count for the branch's latest version. Any new change needs them again.
- People who changed the branch can't approve it, and Claude can never approve.
- Scheduled releases need their approvals too, or they don't run.
- Admins can **Merge without approval**; it's recorded in the audit log.

## Languages

One site, one design, many languages. Only the words change per language, so a layout fix shows up in every language at once.

1. **Site settings → Languages**: choose the main language and add others. Each one is published under its own path: `/fr/`, `/de/about`, `/es/blog/welcome`.
2. **Translate**: pick a language in the editor's top bar. The canvas shows that language; edit text on the canvas or in the inspector and it saves as the translation. Anything not translated yet shows the main-language text, so pages are never blank.
3. **CMS**: in a collection's fields, tick **Translate** on the text and rich-text fields that differ per language (not prices or dates). Each item then has a Translations section.
4. **Language switcher**: insert **Languages** from Insert → Elements; it links to the same page in each language, named in that language.
5. **Claude Code**: "Translate the site into French" uses `get_translations` and `set_translations` on a branch, so it goes through review like any other change.

What you get on publish: `lang` and `dir="rtl"` for Arabic and Hebrew, `hreflang` links between versions, and every language in the sitemap.

**Out of date**: each translation remembers the text it was made from. When someone changes the original, the translation is marked out of date in the inspector and in `get_translations`, until it's updated.

Removing a language deletes its translations; the confirmation says so.

Like in AEM: language copies and translation projects, without separate page trees to keep in sync.

## Motion

Select any element and open **Motion** in the inspector.

| | Options |
|---|---|
| Entrance | Fade in, slide up/down/left/right, scale in, zoom out, blur in, flip up (3D), rise. Plays when the element scrolls into view or when the page loads |
| Timing | Duration, delay, and a feel: smooth, spring (a little overshoot), ease out or linear |
| One child at a time | On a stack, grid or CMS list, the children come in one after another, a set number of milliseconds apart |
| Hover | Lift, grow, glow, dim, or tilt, which follows the pointer in 3D |
| While scrolling | The effect follows the scrollbar instead of playing once: fade, rise, scale up, reveal from the top, slide, unblur, or zoom out for images. Choose when: coming in, leaving, or in and out. Scrolling back plays it in reverse. It replaces the entrance |
| Parallax | The element drifts slower or faster than the page as people scroll |

**Play** replays the entrance on the canvas. The canvas otherwise stays still while you edit; hover effects work there. Previews and the published site play everything.

Visitors whose device asks for reduced motion see the finished page with no movement. Motion runs from the site's own script under its security policy; nothing is loaded from elsewhere.

With Claude Code: "Animate the home page: hero comes in on load, feature cards one at a time, and the pricing cards tilt on hover" uses `set_motion`.

## Scroll stories

Product pages that explain something step by step, like the ones agencies hand-build, from three sections in Insert:

| Section | What it does |
|---|---|
| **Story** | A visual stays pinned beside the text while each step scrolls past, changing to that step's visual. On phones the visual pins to the top half and the words scroll underneath |
| **Statement** | One large sentence that reveals as it comes into view |
| **Stacked cards** | Cards that pin and stack on top of each other as you scroll |

And one element: **Progress bar**, a thin bar along the top of the window that fills as people read.

**Editing a story.** The first layer inside a story, *Visuals*, holds one visual per step, in order; the other layers are the steps. Put anything in a visual: an image, a diagram made of stacks and text, a video. **Add a step** in the inspector adds a step and a visual together. The canvas shows every visual so you can edit them; **Preview** shows the scrolling.

**How it runs.** Chrome, Edge and Safari drive scroll effects natively, smoothly and off the main thread. Other browsers get the same result from a small part of the site's own script. Nothing is loaded from elsewhere, so the site's security policy is unchanged, and visitors who ask for reduced motion see the finished page.

With Claude Code: "Add a story explaining our three-step onboarding, with the screenshot for each step, and reveal the big headings as they scroll in" uses `add_block` (story, statement) and `set_motion`.

## Finding your way

- **Home** is where you start: what needs you today, a getting-started checklist that ticks itself off, and recent sites. The **?** in the top bar takes the guided tour again (it's different for editors, reviewers and admins).
- **Sites** are in folders, like AEM's content tree: make folders such as Immunology › Calvexa, drag sites onto them, or pick a folder in the site's Settings. New sites go into the folder you're in.
- **A site's overview** (click a site) shows its pages with their status, the live link, changes waiting, CMS content, activity and who has access. **Open editor** goes in.
- **Quick find:** press **⌘K** (Ctrl K on Windows) anywhere to jump to a site, a page, a CMS collection, a screen, or an action such as Publish, Open history or New page. The arrow next to the site name in the editor switches sites.
- **Calendar** shows what goes live when across every site: scheduled releases, publishes and rollbacks, in the time zone you pick.

## History: the time machine

**History** in the editor (or the overview) opens every version of the site.

| | |
|---|---|
| Timeline | Grouped by day and by session: one person's edits close together read as one entry ("You edited · 4 saves · Home, About"); expand it to see each save. Merges, publishes, restores and named versions stand out as milestones. Releases that are scheduled appear at the top |
| Show | Everything, **This page** (only versions that changed the page you're on), Published, or Named |
| Look | The stage draws the version you pick. **Show what's different now** outlines what changed since in amber and what's no longer there in red |
| Restore | **Restore this page only**, **Bring this section into today's version** (click a section on the stage first), or **Restore the whole site**. Each restore is saved as a new version, so you can undo it |
| Name | Name a version ("Before the rebrand") in the panel, or press **⌘⇧S** in the editor. Named versions are always kept |
| Live site on | Pick a date and time to see exactly what was live then, including after rollbacks. A published version can be made live again from here |

Old edits are condensed after 90 days to the last one of each day; everything named, published or merged stays, and the activity log keeps every save.

## Moving pages

Drag a page onto another in the **Pages** panel to put it under that page (`/careers` becomes `/about/careers`), or onto **Drop here to make it a top-level page**. The page's **Parent** picker and its **Path** field do the same from the keyboard.

Pages under it move too, links inside the site follow, and **the old addresses redirect** to the new ones, on previews and published sites. See and edit the list in **Site settings → Redirects**, and add your own for addresses printed elsewhere.
