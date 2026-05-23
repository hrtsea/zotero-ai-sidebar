# arXiv LaTeX-Source Analysis — Design

- Date: 2026-05-23
- Status: Draft for review
- Topic: use a paper's arXiv LaTeX source (not the garbled PDF text) as the AI analysis context

## 1. Problem

PDF text extraction linearizes and garbles formulas — Equation (1) of the π0.5
paper reaches the model as `f l θ ∥ ∥ 2` instead of `f^l_\theta`. No amount of
downstream repair fully recovers what extraction destroyed.

But for **arXiv papers, the authoritative LaTeX source is publicly available**.
arXiv requires authors to submit source, and serves it at
`https://export.arxiv.org/e-print/<id>`. The source `main.tex` contains every
formula exactly as written (`\mathbb{E}_{\mathcal{D},\tau,\omega}\big[\ldots\big]`),
every section, every figure reference. Feeding the source to the model is
"letting the AI read the real paper" — zero garble, because nothing was
extracted.

ML papers (this plugin's primary use case) are overwhelmingly on arXiv, so the
source route covers most real usage. The previously-designed PDF garble-repair
pipeline (`docs/superpowers/specs/2026-05-23-pdf-formula-markdown-cache-design.md`)
remains the fallback for non-arXiv papers.

## 2. Goal & success criteria

When AI analysis runs on an arXiv paper, the model's text context is the
paper's LaTeX source instead of the garbled PDF full-text cache.

Success criteria:

- For π0.5 (arXiv 2504.16054), starting AI analysis auto-downloads the source;
  the analysis context for that item is the cleaned `main.tex` — Equation (1)
  appears as exact LaTeX, no `f l θ`.
- The downloaded archive is not left on disk after extraction.
- The sidebar header shows a "LaTeX 源" indicator when the active item's
  analysis is using the arXiv source.
- Non-arXiv items, and every failure path, fall back to the existing PDF
  full-text flow — no regression.

## 3. Non-goals (Phase 1 scope boundary)

- Feeding figure **images** to the model. Figure files are extracted and stored
  (they are in the archive anyway) but Phase 1 sends only text; `\includegraphics`
  stays as a text reference. Multimodal figures are Phase 2.
- Converting `.tex` or LaTeX tables to Markdown. The model reads LaTeX natively;
  conversion only risks losing fidelity.
- Non-arXiv papers — always the PDF flow.
- Replacing the PDF garble-repair pipeline; it stays as the non-arXiv fallback,
  untouched.

## 4. Approach

```
AI analysis starts on an item
  → resolveArxivId(item)
       │ none → PDF full-text flow (unchanged), no badge
       ▼ found
     arXiv source already cached for this item?
       │ yes → use it
       ▼ no
     download arxiv.org/e-print/<id> via Zotero.HTTP  (in memory)
       → gunzip → untar → write files to arxiv/<itemKey>/   (no archive on disk)
  → getFullText(item) returns the cleaned main.tex
  → retrieval / message-format / chat — unchanged
  → sidebar header shows the "LaTeX 源" badge
```

Light cleanup of `main.tex`: strip `%` comments (respecting `\%`); keep
preamble macros, sections, and math verbatim. No Markdown conversion.

## 5. Storage layout

```
<Zotero data dir>/zotero-ai-sidebar/arxiv/<itemKey>/
  source/         all extracted files verbatim (main.tex, main.bbl, figures/, *.cls …)
  meta.json       { itemKey, arxivId, fetchedAt, mainTexRelPath, status }
```

- `<Zotero data dir>` is the root already used by `chat-history.ts` and
  `settings/paper-cache.ts`.
- `<itemKey>` is the Zotero item key — ties the cache to its item.
- The downloaded `.tar.gz` is processed **in memory** and never written to disk,
  which satisfies "delete the downloaded archive" by construction.
- `main.tex` is stored raw under `source/`; the comment-stripped form is
  produced on read (the original stays pristine).

## 6. Components & responsibilities

| File | Phase / change | Responsibility |
|---|---|---|
| `src/context/arxiv-id.ts` | P1 — NEW | `resolveArxivId(fields)` — extract an arXiv id from Zotero item metadata. Pure, tested. |
| `src/context/arxiv-archive.ts` | P1 — NEW | gunzip + untar a byte buffer into `{path, bytes}[]`. Pure (no I/O, no network), tested. |
| `src/context/arxiv-source.ts` | P1 — NEW | orchestration: fetch `e-print`, call `arxiv-archive`, pick + clean `main.tex`. |
| `src/context/arxiv-store.ts` | P1 — NEW | read/write `arxiv/<itemKey>/`; "is cached" check; load cleaned main text. |
| `src/context/tex-clean.ts` | P1 — NEW | `findMainTex(files)` + `stripTexComments(text)` + `inlineInputs(...)`. Pure, tested. |
| `src/context/zotero-source.ts` | P1 — CHANGE | `getFullText` returns the arXiv source text when cached for the item, else the PDF cache. |
| `src/modules/sidebar.ts` | P1 — CHANGE | on analysis start, `ensureArxivSource(item)`; render the "LaTeX 源" header badge. |
| `src/context/policy.ts` | P1 — CHANGE | `maxArxivSourceBytes`, `arxivFetchTimeoutMs`. |

## 7. arXiv id resolution

`resolveArxivId` inspects Zotero item fields in order, returning the first match:

1. `Extra` — lines like `arXiv: 2504.16054`, `tex.eprint: 2504.16054`.
2. `url` — `arxiv.org/abs/2504.16054`, `arxiv.org/pdf/2504.16054`.
3. `DOI` — `10.48550/arXiv.2504.16054`.
4. `archiveID` — `arXiv:2504.16054`.

Id patterns recognized: new style `\d{4}\.\d{4,5}` (optional `v\d+`); legacy
`[a-z\-]+(\.[A-Z]{2})?/\d{7}`. A trailing version (`v1`) is kept if present;
`e-print/<id>` resolves the latest version when none is given. No match → `null`.

## 8. Download & extraction

- **Fetch**: `GET https://arxiv.org/e-print/<id>` via `Zotero.HTTP.request`
  (`responseType: "arraybuffer"`, `timeout: policy.arxivFetchTimeoutMs`). NOT
  `fetch()` — arXiv's e-print response trips a Gecko `fetch` bug
  ("Content-Length header exceeds response Body"); the XHR-based `Zotero.HTTP`
  downloads the binary payload cleanly (verified: 15 MB, status 200). Response
  capped at `policy.maxArxivSourceBytes`.
- **Format**: arXiv e-print is normally a gzip'd tar; it may be a gzip'd single
  `.tex` (no tar), or — rarely — a PDF (no source). Discriminate by magic bytes:
  gzip `1f 8b`; after gunzip, tar if the 512-byte header checksum validates,
  else treat the bytes as a single `main.tex`; a `%PDF` payload → "no source".
- **Decompress**: gunzip via `DecompressionStream("gzip")` (a Web standard in
  Zotero's Firefox runtime).
- **Untar**: parse the 512-byte-header tar format (name @0, octal size @124,
  type flag @156; data padded to 512). Implemented in `arxiv-archive.ts` as a
  pure function over the byte buffer.
- **Write**: extracted files go to `arxiv/<itemKey>/source/` via `IOUtils`
  (`makeDirectory` + `write`). The archive bytes stay in memory and are
  discarded — nothing to clean up.

**Feasibility risk:** `DecompressionStream` availability and the tar parse in
the plugin runtime are unverified. The implementation plan opens with a spike
(a JS-console probe like the prior feature's render spike) before the extraction
tasks.

## 9. `main.tex` selection & cleanup (`tex-clean.ts`)

- **`findMainTex(files)`** — the `.tex` file containing `\documentclass` and
  `\begin{document}`; if several, prefer the one with `\begin{document}`.
- **`inlineInputs(text, files)`** — recursively replace `\input{f}` /
  `\include{f}` with the referenced file's content (π0.5 is single-file, but
  multi-file papers are common).
- **`stripTexComments(text)`** — remove `%`-to-end-of-line comments, treating
  `\%` as a literal percent (not a comment). Keep everything else verbatim.

The cleaned text is what `getFullText` returns for the item.

## 10. Context integration

`zotero-source.ts`'s `getFullText(itemID)` gains a first step: if
`arxiv-store` has a cached source for the item, return its cleaned `main.tex`;
otherwise the current PDF-cache behavior. `retrieval.ts` and `message-format.ts`
consume `getFullText` output unchanged — they now chunk LaTeX instead of garbled
text.

The download itself is triggered earlier, at analysis start: `sidebar.ts` calls
`ensureArxivSource(item)` (resolve id → download+extract if not cached, with
visible progress) before context assembly, so `getFullText` finds the cache.

## 11. Header badge

When the active item has a cached arXiv source in use, the sidebar header (the
title / `Item ID` row) shows a small static chip — text `LaTeX 源` — indicating
the analysis is reading the LaTeX source rather than the PDF. Absent for
non-arXiv items.

## 12. Error handling & fallback

Every failure degrades to the existing PDF full-text flow — never worse than
today:

- No arXiv id → no download, PDF flow, no badge.
- Fetch fails / times out / 404 (paper has no source) → PDF flow, no badge; a
  one-time non-blocking notice.
- Payload is a PDF, or exceeds `maxArxivSourceBytes`, or gunzip/untar fails →
  PDF flow.
- No `.tex` with `\documentclass` found in the archive → PDF flow.

## 13. Caching & invalidation

A populated `arxiv/<itemKey>/` with a valid `meta.json` is reused — no
re-download. arXiv source for a given id is immutable, so no staleness check is
needed; a manual "refresh" (delete + re-fetch) is the only invalidation and is
deferred unless requested.

## 14. Testing strategy

- `resolveArxivId` — unit: Extra / url / DOI / archiveID inputs (new + legacy
  ids) → correct id; non-arXiv metadata → `null`.
- `arxiv-archive` (gunzip+untar) — unit: a small fixture tar buffer → expected
  `{path, bytes}` list. (gunzip path tested against a fixture gzip buffer.)
- `tex-clean` — unit: `stripTexComments` keeps `\%`, drops real comments;
  `findMainTex` picks the `\documentclass` file; `inlineInputs` splices.
- `arxiv-store` — unit: round-trip read/write against a mocked `IOUtils`.
- Network fetch + `DecompressionStream` — integration; gated by the §8
  feasibility spike and manual verification in real Zotero.

## 15. Phasing

- **Phase 1 (this spec)** — text. Download, extract, store, use `main.tex` as
  context, header badge.
- **Phase 2 (deferred)** — figures: feed `figures/*` as multimodal images
  (model-driven or on a region basis); LaTeX-table-to-Markdown is an optional
  refinement.

## 16. Relationship to the PDF garble-repair work

The PDF garble-repair pipeline (separate spec, branch
`feature/pdf-formula-markdown-cache`) is **paused, not abandoned**: it becomes
the fallback for non-arXiv papers. This feature is the preferred path whenever
an arXiv source is obtainable.
