# Per-Paper Repaired Markdown Cache — Design

- Date: 2026-05-23
- Status: Draft for review
- Topic: fixing garbled PDF formulas by caching a per-paper repaired markdown

## 1. Problem

Scientific PDF formulas reach the model as structure-less garbled text.

Zotero's full-text cache is produced by poppler/`pdftotext`, which linearizes
the page. A typeset formula `f^l_\theta` loses its 2D structure and is
extracted as separate glyphs across lines (`f l` / `θ`). The plugin reads that
cache verbatim (`zotero-source.ts:readFulltextCache`), `retrieval.ts` slices a
passage from it, and `message-format.ts` sends it to the model.

Confirmed by direct evidence — the persisted `context.retrievedPassages[0].text`
for the π0.5 thread contained:

```
ED,τ,ω
[
H
(x1:M , f l
θ (ot, l))
+α∥
∥ω − at:t+H − f a
θ (aτ,ω
t:t+H , ot, l)∥
∥
2
]
```

The model cannot reconstruct `f^l_\theta` from `f l θ` — the
superscript/subscript assignment is genuinely lost. It guesses (`fθ^l`), and
the renderer faithfully renders the wrong guess. The renderer fixes already
landed (`normalizeLatexLikeText` command-termination, `aligned` row grouping)
are correct but downstream — they cannot recover information destroyed at
extraction time.

External benchmark context: *Benchmarking Document Parsers on Mathematical
Formula Extraction from PDFs* (arXiv 2512.09874, ICPR 2026) scored 20+ parsers
on 2,052 formulas. Multimodal models top the table (Qwen3-VL 9.76, Gemini 3 Pro
9.75; Mathpix 9.64; MinerU 9.17) while linear text extraction is worst
(PyMuPDF4LLM 6.67, GROBID 5.70). Zotero's cache is the bottom tier. The model
the plugin already talks to is, given the *image*, a top-tier formula parser.
(n=1 benchmark, synthetic PDFs — treated as indicative, not definitive.)

## 2. Goal & success criteria

Build, once per paper, a markdown file that represents the paper's text with
garbled regions repaired — formulas, tables, and broken text blocks — cached
on disk, and reused across turns and sessions. It serves three roles:

1. **Cleaner model context** — retrieval reads the repaired markdown instead of
   the garbled cache; formulas appear as correct `$$LaTeX$$`.
2. **User-inspectable artifact** — the user opens the markdown to verify the
   parsing is accurate; each formula keeps its screenshot as ground truth.
3. **Linked back to the PDF** — each formula stores `{pageIndex, rects}` so a
   future "查看原文" jump is possible.

Success criteria:

- For the π0.5 paper, the cached `paper.md` shows Equation (1) as a correct
  screenshot + a `$$...$$` transcription, and a chat asking about the loss
  receives the LaTeX as text (no garbled `f l θ`).
- In the normal path, chat-time context remains text (LaTeX); screenshots enter
  the chat context only as a bounded per-passage fallback when LaTeX
  transcription was unavailable (§10).
- Detector unit tests: flags the real garbled sample, does not flag clean prose.
- All degradations end no worse than today's behavior (raw cache passthrough).

### Phasing

Development is split; Phase 2 is gated on the user confirming Phase 1 output.

- **Phase 1 — markdown conversion (build now).** The build pipeline (§6),
  storage (§5), and a single temporary verification button (§7). Produces
  `paper.md` + `figures/` for a paper. No chat behaviour changes.
- **Phase 2 — chat integration (deferred).** §8 (retrieval reads `paper.md`)
  and §9's lazy on-first-chat trigger. Started only after the user verifies
  Phase 1 output is correct.

The temporary button is removed once Phase 2 lands.

### Already implemented (uncommitted)

Earlier work in the tree (uncommitted) already covers the detector:

- `src/context/formula-repair.ts` — `detectGarbledFormulaRuns(text, policy)`
  returning `GarbledFormulaRun[]` (`{start, end, text, score, lines, reasons}`).
- `tests/context/formula-repair.test.ts` — 3 passing tests (flags the π0.5
  garble; ignores clean prose; ignores a clean multi-step derivation).
- `src/context/policy.ts` — `garbledFormula*` thresholds and `minLocateConfidence`.

Phase 1 builds the remaining pipeline on top; it does NOT re-implement detection
or the policy thresholds.

## 3. Non-goals (scope boundary)

- A clickable "查看原文" jump from the rendered markdown. The build only
  **persists** the `{pageIndex, rects}` metadata so the jump becomes possible
  later.
- Background / automatic full-library pre-building.
- A built-in render or preview of `paper.md`. Verification uses an external
  editor — VSCode's markdown preview renders the embedded screenshots and the
  `$$…$$` math. The plugin only opens the output folder.
- Garble with no mechanical breakage signature — e.g. two columns cleanly
  interleaved into the wrong reading order, where every line still reads as
  fine prose. Catching that needs full layout analysis (Marker/MinerU
  territory) and is out of scope; the detector keys on visible extraction
  breakage, which covers garbled formulas, tables, and broken text blocks.
- Replacing Zotero's full-text index or annotations.

## 4. Approach

A per-paper build pipeline reuses the existing PDF locator, adds region
rendering and a one-time vision transcription, and writes a self-contained
markdown bundle. Retrieval then prefers the repaired markdown as its text
source.

```
                          BUILD (once per paper)
full-text cache ─▶ detectGarbledFormulaRuns() ─▶ garbled runs   (DONE)
                                            │
                  pdf-locator.locate(run) ─▶ {pageIndex, rects, confidence}
                                            │
                  renderRegion(page,rects) ─▶ figures/eq-pN-k.png
                                            │
                  transcribe(screenshots) ─▶ $$LaTeX$$   (build-time model call)
                                            │
                  assemble ─────────────────▶ papers/<itemKey>/paper.md

                          CHAT (every turn)
paper.md ─▶ retrieval.ts (chunks repaired text) ─▶ passage with $$LaTeX$$
         ─▶ message-format.ts ─▶ model receives correct LaTeX as text
```

Formula representation in `paper.md` (decision ①(ii) — screenshot **and**
one-time LaTeX; the screenshot is retained as the verification ground truth):

```markdown
![formula p.6](figures/eq-p6-1.png)
<!-- zai:loc page=5 rects=[[x1,y1,x2,y2],...] confidence=0.97 -->
$$
\mathbb{E}_{D,\tau,\omega}\left[ H(x_{1:M}, f^l_\theta(o_t,l)) + \alpha\left\| \omega - a_{t:t+H} - f^a_\theta(a^{\tau,\omega}_{t:t+H},o_t,l) \right\|^2 \right]
$$
```

## 5. Storage layout

```
<Zotero data dir>/zotero-ai-sidebar/papers/<itemKey>/
  paper.md                  repaired markdown
  figures/eq-p<page>-<n>.png formula screenshots
  meta.json                 build metadata (see §9)
```

- `<Zotero data dir>` is the same root used by `chat-history.ts` — both
  plugin-readable and user-reachable.
- `<itemKey>` is the Zotero 8-char item key (stable across machines), tying the
  cache to its item.
- The `<itemKey>/` folder is self-contained → exporting is copying the folder.
- Writing `figures/*.png` (binary) and creating the directory tree need
  `IOUtils` (`IOUtils.write`, `IOUtils.makeDirectory`) — the string-only
  `Zotero.File` API used by `settings/paper-cache.ts` cannot write binary or
  make directories. `paper.md` / `meta.json` (text) can use either.

## 6. Build pipeline

1. **Read source text** — full-text cache via `zotero-source.ts`.
2. **Detect garbled runs** — ALREADY IMPLEMENTED. `detectGarbledFormulaRuns(text,
   policy)` in `formula-repair.ts` returns `GarbledFormulaRun[]` with char
   offsets. Mechanical heuristic: it groups consecutive "math-like" lines (short
   ≤3-char lines, lines with math glyphs `α-ω ∥ ∑ ∫ √ …`, bracket-only lines, or
   dense formula-punctuation lines with no long words) into runs of
   ≥ `garbledFormulaMinRunLines`, kept only when the math-glyph or short-line
   fraction clears its threshold. The short-line signal also catches garbled
   tables and broken blocks, not just formulas. Clean prose and clean
   derivations do not fire (covered by the existing tests).
3. **Locate** — for each run, `getSharedPdfLocator(reader)` then
   `locate(runText)` → `{pageIndex, rects, confidence}`. The garbled text is
   verbatim in the PDF text layer, so exact match should hit; fuzzy is the
   fallback. If `confidence < policy.minLocateConfidence`, fall back to a
   whole-page crop and flag the formula as low-confidence.
4. **Render** — `renderRegion(pageIndex, rects)` renders the page to a canvas,
   crops to the union of `rects` plus padding, exports PNG to `figures/`.
   **Feasibility risk:** `pdf-locator.ts`'s page objects are typed for text
   extraction only; whether the runtime object exposes the pdf.js
   `render()`/`getViewport()` API, or whether the reader's already-rendered page
   `<canvas>` must be sampled instead, is unverified. The implementation plan
   opens with a feasibility spike for this.
5. **Transcribe** — send the region screenshots to the configured multimodal
   provider (a plugin utility call, like `translator.ts`), batched
   `policy.transcribeBatchSize` crops per call, asking for a faithful
   transcription per crop — `$$LaTeX$$` for math, a markdown table for a
   table, plain text for a text block. If the provider/model is not
   multimodal-capable, skip this step (screenshot-only fallback for that
   paper).
6. **Assemble** — copy prose verbatim; replace each garbled run with the
   screenshot embed + `zai:loc` comment + `$$LaTeX$$` block (§4). Write
   `paper.md` and `meta.json`.

## 7. Components & responsibilities

| File | Phase / change | Responsibility |
|---|---|---|
| `src/context/formula-repair.ts` | P1 — EXISTS + EXTEND | `detectGarbledFormulaRuns()` + test already in tree (uncommitted); ADD build orchestration + markdown assembly here |
| `src/context/paper-markdown-store.ts` | P1 — NEW | read/write `papers/<itemKey>/` (`paper.md`, `figures/`, `meta.json`); staleness check. Named to avoid collision with the existing `settings/paper-cache.ts` |
| `src/context/pdf-locator.ts` | P1 — CHANGE | reuse `locate()`; add `renderRegion(pageIndex, rects)` to the `PdfLocator` interface — keeps all reader/pdf.js access in one file |
| `src/context/transcribe.ts` | P1 — NEW | build-time screenshot→faithful markdown/LaTeX via the provider factory (mirrors `translate/translator.ts`) |
| `src/modules/sidebar.ts` | P1 — CHANGE | one temporary button — build the current item's cache, then reveal `papers/<itemKey>/` in the OS file manager; show build progress |
| `src/context/policy.ts` | P1 — EXISTS + EXTEND | `garbledFormula*` + `minLocateConfidence` already added (uncommitted); ADD render/figure/transcribe limits |
| `src/context/retrieval.ts` | P2 — CHANGE | take repaired `paper.md` as the text source when a cache exists |
| `src/context/message-format.ts` | P2 — CHANGE | when emitting a passage from `paper.md`, keep `$$LaTeX$$`, strip the local `![](figures/…)` embed line (meaningless to the model) |
| `src/context/zotero-source.ts` | P2 — CHANGE | expose "best available full text" — repaired md if cached, else raw cache |

## 8. Chat-time integration (Phase 2 — deferred)

- `retrieval.ts` chunks `paper.md` instead of the garbled cache when a cache
  exists for the item. Retrieval logic is otherwise unchanged.
- A retrieved chunk containing a formula carries the `$$LaTeX$$` text.
  `message-format.ts` strips the `![](figures/…)` image line and the `zai:loc`
  comment before sending — the model receives clean LaTeX text only.
- Normal path: no screenshot is sent into the chat context — the model receives
  LaTeX text. Screenshots otherwise exist for the user's verification and as
  build-time transcription input.
- Fallback: if a formula has no `$$LaTeX$$` (transcription unavailable, §10),
  its screenshot is attached as multimodal context for that passage only — the
  bounded per-turn-repair fallback. This is the single path by which an image
  enters chat context.

## 9. Triggering & cache invalidation

- **Trigger**: Phase 1 — the temporary button (§7) builds, or rebuilds, the
  cache for the current item on demand. Phase 2 — additionally lazy: on the
  first chat about an item with a PDF and no fresh cache, build with visible
  progress.
- **`meta.json`** records: `itemKey`, source PDF attachment id, the PDF file
  size + mtime (cheap staleness signal), plugin version, build timestamp,
  formula count, low-confidence count.
- **Invalidation**: if the PDF's size/mtime differs from `meta.json`, the cache
  is treated as stale — the plugin offers rebuild rather than silently using or
  silently discarding it.

## 10. Error handling & degradation

Every failure path ends no worse than today's raw-cache passthrough:

- Reader not open → `locate()`/`renderRegion()` unavailable → skip build this
  turn; chat uses the raw cache. Retry on a later turn when the reader is open.
- `locate()` low confidence → whole-page crop for that formula; flag in
  `meta.json`.
- pdf.js render fails → that formula keeps its garbled text, marked unrepaired.
- Provider not multimodal / transcription fails → screenshot-only `paper.md`
  (no `$$LaTeX$$`); chat falls back to attaching that screenshot as multimodal
  context for the affected passage.
- `detectGarbledFormulaRuns()` finds nothing → no cache built; normal path.
- Budget exceeded (`policy`) → cap figures/transcription; remaining formulas
  stay as garbled text, marked.

## 11. Testing strategy

- `detectGarbledFormulaRuns()` — DONE. `tests/context/formula-repair.test.ts`
  already covers the π0.5 garble (flagged), clean prose (not flagged), and a
  clean derivation (not flagged).
- Markdown assembly — unit: given garbled text + stubbed locate/render/
  transcribe results, the emitted `paper.md` has the expected embed + `zai:loc`
  + `$$` blocks and verbatim prose.
- `paper-markdown-store.ts` — unit: round-trip read/write against a mocked
  `Zotero` / `IOUtils`; staleness detection on changed PDF size/mtime.
- `transcribe.ts` — unit with a mocked provider.
- `renderRegion()` + `locate()` — integration; manual verification against a
  real reader, since they need the live PDF.js viewer. Gated by the §6 step-4
  feasibility spike.

## 12. Deferred / out of scope

See §3. Phase 2 — chat integration (§8) and the lazy on-first-chat trigger
(§9) — is deferred and gated on the user confirming Phase 1 output. Further
follow-ups: clickable 查看原文 from the markdown; automatic background
building; non-formula garble repair.

## 13. Documentation updates

- `docs/HARNESS_ENGINEERING.md` and the CLAUDE.md "Code Reference Map": add the
  per-paper markdown cache subsystem and its files.
- CLAUDE.md note: this design does **not** violate the "screenshots are
  model-decided / no automatic sending" non-negotiable in the normal path —
  chat-time context stays text (LaTeX); build-time transcription is a plugin
  utility call, consistent with `translator.ts`. The one exception is the
  bounded transcription-failed image fallback (§8/§10), which should be called
  out explicitly. Add a sentence describing the cache so the build-time model
  call and the fallback are documented, not mistaken for hidden behavior.
