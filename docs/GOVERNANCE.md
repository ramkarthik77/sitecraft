# Governance for regulated sites

How Sitecraft keeps pharma and other regulated sites in order: where each site sits, who signs off what, what blocks publishing, and how you prove it later.

## Where things are

| Area | What's there |
|---|---|
| **Home** | What needs you today: MLR reviews, Claude's branches, releases this week, assets whose rights expire. |
| **My work** | Everything waiting for your decision across every site, soonest first. |
| **Sites** | The portfolio, filed by therapy area › brand › market › audience. List or grouped by brand; filter by any of them. |
| **Reviews** | MLR reviews: waiting for me, all open, drafted by Claude, sent back, closed. |
| **Releases** | Scheduled publishing across sites, each marked ready or blocked (and why). Calendar view too. |
| **Assets** | The shared library: approval status, job code, markets each image is cleared for, usage rights and where it's used. |
| **Audit log** | Every action, chained so tampering shows. |
| **Settings** | Built-in rules, each site's review rules, and who reviews for which discipline. |

Open a site and the sidebar becomes that site's: **Overview, Pages, CMS, Assets, Reviews, History, Activity and access, Settings, Branches, Releases.** **All sites** takes you back.

## Filing a site

In the site's **Settings → Site and portfolio**: therapy area, market (a two-letter country code like `US`, or `GLOBAL`), audience (HCP, patient, caregiver, consumer, corporate) and the site's job code. The market also decides which library images the site may use.

## MLR sign-off

1. An admin turns on the disciplines a site needs in **Settings → Review rules by site** (medical, legal, regulatory), and marks who reviews for each in **Reviewers** (or when creating their sign-in in **Access**).
2. Changes are made on a branch, by a person or by Claude. The author sends it with **Request MLR review** (from **Branches**, or the editor's review panel). Claude does the same with its `request_review` tool.
3. Each discipline's reviewer opens it from **My work**, checks what changed, and either **Approve and sign** or **Ask for changes** with a reason.
4. Signing is an electronic signature: the reviewer types their name and enters their sign-in token again, and confirms the statement. Sitecraft records their name, the meaning ("Approved in medical review"), the time, and a SHA-256 fingerprint of exactly the version they approved.
5. A branch merges only when every required discipline has signed its latest version and nobody has asked for changes since. Editing the branch means signing again.

Nobody approves their own work: not the people who changed the branch, and not the person Claude was working for. Claude can't approve at all. Admins can merge without approval in an emergency; it's recorded as an override.

## What blocks publishing

Publishing (now or scheduled) stops when:

- **Job codes are required** on the site and a page has none (set it in the editor's page settings).
- A page uses a library image whose **usage rights have expired**, which **isn't approved**, or which **isn't cleared for the site's market**.

The site's overview shows *Ready to publish* or what's blocking, and Releases marks each scheduled release.

## Proving it later

- Every action is in the audit trail with who, when and what; Claude's entries say which person it worked for.
- The trail can't be edited or deleted, and **Audit log** verifies the hash chain (see [SECURITY.md](SECURITY.md#audit)).
- Each review keeps its full trail: who asked, who signed, who sent it back and why, and when it merged.
- History shows any earlier version, and what was live at any moment.

## A demo workspace

`scripts/demo-seed.mjs` fills an empty workspace with a made-up portfolio (two brands in immunology and neurology, five markets), reviewers, Claude branches, reviews in every state, releases and library assets:

```bash
SITECRAFT_URL=http://localhost:4000 SITECRAFT_TOKEN=<admin token> pnpm demo:seed
```

It prints sign-in tokens for the demo reviewers, so you can sign in as each. Set `ORG_NAME` on the server to show your organisation's name in the sidebar.

## What this is not

Sitecraft's signatures and audit trail are built to support regulated review, but validation for 21 CFR Part 11 or Annex 11 is a process your quality team owns (system validation, SOPs, training, identity proofing). Sign-in with tokens is not single sign-on; for production, put Sitecraft behind your identity provider.
