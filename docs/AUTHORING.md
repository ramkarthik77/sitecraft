# Templates and brands

How teams keep many sites consistent: **templates** decide how a new site starts, **brands** keep the look and voice the same across sites afterwards.

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
