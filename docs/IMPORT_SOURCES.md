# Multi-source content import: URL, PDF and Word

**Status:** reviewable feature on PR #15; no automatic publishing. For broader migration notes see [IMPORT_FIDELITY.md](IMPORT_FIDELITY.md).

## Supported sources

| Source | Extraction | Structured output | Important limitations |
| --- | --- | --- | --- |
| Website URL | SafeFetch + Playwright rendered HTML and layout hints | Sitecraft Sections when lossless, editable fallback otherwise | Dynamic forms, app state, personalisation and accessibility require review |
| DOCX (.docx) | Bounded OpenXML ZIP extraction, headings, paragraphs, lists, tables, embedded PNG/JPEG/GIF/WebP | Editable Sitecraft pages and sections; copied images stored as DRAFT | Word table cells become text rows; styles are approximated; older .doc files unsupported |
| PDF (.pdf) | Mozilla PDF.js selective text extraction, page boundaries, basic font-size heading detection | One long Sitecraft page or individual editable pages | Scanned PDFs require OCR outside this feature; tables/columns, vector graphics and embedded images require manual review |

No contents are published by import. **File imports always use an `import/...` branch.** An author reviews the result and requests approval; reviewers sign current version; a permitted person merges and publishes. For regulated websites, use the site's MLR and asset-rights controls.

## User workflow

1. Open **Import** from Sites or Templates, choose **Website URL** or **PDF / Word file**.
2. For PDF/DOCX select a file no larger than 12 MB, select **Separate PDF pages** or **One long editable page**. Choose **Create a new site** or select an existing site.
3. Optionally enable Claude semantic section classification. This transmits extracted section text and structure to the configured model. The default is **off** for privacy.
4. Confirm source and image reuse rights. Import.
5. Open the reported `import/...` branch in the editor, fix low-confidence sections and tables, inspect media/alt text, and request review. An import is **not** an approved or published site.

The importer creates normal validated Sitecraft operations only (`add_page`, `update_page`, `add_block`, `add_node`, etc.). Existing site imports add new namespaced pages, never overwrite main. All file changes are versioned and audited.

## API

Authenticated raw-binary upload (not multipart):

```bash
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $SITECRAFT_TOKEN" \
  -H "Content-Type: application/pdf" \
  --data-binary @brochure.pdf \
  "http://localhost:4000/api/imports/file?filename=brochure.pdf&mode=pages&rightsConfirmed=1"
```

For Word, use `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; file extension must be `.docx`. Optional query params: `siteId=<uuid>` for existing-site import, `name=`, `mode=single|pages`, `rightsConfirmed=1` (mandatory permission acknowledgement), and `ai=1` to opt in to Claude. Response includes `site`, `branch`, `pages`, `warnings`, and `report`.

URL import retains `POST /api/imports` with `{url,maxPages,render,ai,rightsConfirmed}` for compatibility. URL import currently works on main, but does not auto-publish; consider requiring an import review branch for all sources in the next enterprise hardening stage.

## Architecture

```text
Website URL ── safeFetch + Playwright ─┐
DOCX bytes ── bounded OpenXML extract ├── ImportedPage / structured IR
PDF bytes ─── PDF.js text/pages ───────┘          │
                                            optional Claude classification
                                                  │
                                    conservative semanticOps() mapping
                                                  │
                             repo.applyOps() + packages/schema validation
                                                  │
                                 editable import branch + audit + MLR
```

DOCX raster images are ingested into the Sitecraft asset library as **DRAFT** and must be approved separately. PDF graphics and extracted vector images are not yet exported. The Claude classifier suggests *allowlisted* block types; it does not produce executable HTML, arbitrary code, or raw unvalidated Sitecraft documents. With Claude disabled or unavailable, deterministic mapping still works.

## Limits and security

- Up to 12 MB per uploaded file and up to 25 PDF pages; a maximum of 450 editable content blocks to keep operations and review bounded. Very long documents produce warnings.
- Encrypted PDFs, password-protected Word files, macro documents, old `.doc`, scanned-only PDFs, PDF embedded multimedia and OCR are not supported.
- Image ingestion restricts file types, byte size and dimensions. Uploads do not grant an asset approval or usage rights.
- Importers should eventually run in a dedicated job queue and sandbox for enterprise untrusted uploads; present synchronous operation is not an industrial migration service.
- AI classification is optional, requires configured approved Claude endpoint credentials, and should not be enabled for confidential content without organizational approval.
- Test with representative real authorized sites and documents for reading order, image licensing, source fidelity and medical/legal/regulatory compliance before deployment.

## Validation

Run `pnpm test`, `pnpm build`, and the existing browser suite. New tests in `apps/api/test/import-document.test.ts` generate a real DOCX OpenXML ZIP and a text-based PDF, verify extraction, review-branch isolation, existing-site imports and invalid-format rejection. No production content is required.
