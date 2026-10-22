# Templates, brands, languages, assets, reviews and releases

How teams keep many sites consistent and launch on time: **templates** decide how a new site starts, **brands** keep the look and voice the same across sites afterwards.

| | Templates | Brands |
|---|---|---|
| What it is | A saved copy of a site | Colors, fonts, corner radius, shared components (header, footer), logo and written guidelines |
| When it applies | Once, when a site is created | All the time: sites follow brand updates |
| Like in AEM | Site templates | Editable template policies, style system, Experience Fragments for the shared header and footer |

## Templates

**Save one:** Templates → **Save a site as a template** (or Site settings → **Save as template**). It keeps the site's `main` version: pages, design, components and CMS fields. Tick **Include CMS items** to keep the posts or products too.

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
