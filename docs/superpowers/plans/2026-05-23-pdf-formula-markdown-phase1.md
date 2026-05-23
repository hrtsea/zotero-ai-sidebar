# PDF Formula Markdown Cache — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-paper "repaired markdown" cache that replaces garbled PDF formula text with screenshots + transcribed LaTeX, triggered by one temporary button, so the user can verify accuracy before chat integration (Phase 2).

**Architecture:** A build pipeline — detect garbled runs (already done) → locate each run in the PDF via `pdf-locator` → render + crop a screenshot → transcribe to LaTeX via the configured multimodal model → assemble `papers/<itemKey>/paper.md` + `figures/` + `meta.json`. A temporary sidebar button runs the build and opens the output folder.

**Tech Stack:** TypeScript; Zotero 7/8/9 plugin; pdf.js (via the Zotero Reader); `IOUtils` for binary/dir file I/O; vitest + happy-dom for tests.

**Spec:** `docs/superpowers/specs/2026-05-23-pdf-formula-markdown-cache-design.md`

**Already done (uncommitted — NOT tasks here):**
- `src/context/formula-repair.ts` — `detectGarbledFormulaRuns(text, policy) → GarbledFormulaRun[]`
- `tests/context/formula-repair.test.ts` — 3 passing tests
- `src/context/policy.ts` — `garbledFormula*` thresholds + `minLocateConfidence`

**Verification commands:** `npm test` (vitest), `npm run build` (`zotero-plugin build` + `tsc --noEmit`).

---

### Task 1: Feasibility spike — PDF page rendering

This is a **spike**, not TDD. It resolves the one open unknown before Task 4. `pdf-locator.ts` only ever calls `getTextContent()` on its page objects; whether those runtime objects also expose the pdf.js rendering API (`getViewport()`, `render()`) is unverified.

**Files:**
- Temp probe: add to `src/modules/sidebar.ts` (removed at end of task)

- [ ] **Step 1: Add a temporary probe function**

In `src/modules/sidebar.ts`, near `getActiveReader`, add:

```typescript
// TEMP SPIKE — remove after Task 1.
function probePdfRender(win: Window): void {
  const reader: any = getActiveReader(win);
  const views = [
    reader?._internalReader?._primaryView,
    reader?._internalReader?._secondaryView,
  ].filter(Boolean);
  const win0: any = views[0]?._iframeWindow ?? reader?._iframeWindow;
  const app = win0?.wrappedJSObject?.PDFViewerApplication ?? win0?.PDFViewerApplication;
  const doc = app?.pdfDocument;
  const viewer = app?.pdfViewer;
  const out: Record<string, unknown> = {
    hasDocument: !!doc,
    docGetPage: typeof doc?.getPage,
    viewerPagesCount: viewer?.pagesCount,
  };
  void (async () => {
    try {
      const page = await doc?.getPage?.(1);
      out.pageRender = typeof page?.render;
      out.pageGetViewport = typeof page?.getViewport;
      const pv = viewer?.getPageView?.(0);
      out.pageViewCanvas = !!pv?.canvas;
      out.pageViewCanvasTag = pv?.canvas?.tagName;
    } catch (e) {
      out.error = String(e);
    }
    (globalThis as any).Zotero?.debug?.(`[zai-spike] ${JSON.stringify(out)}`);
  })();
}
```

Call it once from an existing debug entry point, or temporarily from the sidebar mount.

- [ ] **Step 2: Run in real Zotero and read the result**

Build + install the XPI, open a PDF in the Reader, trigger `probePdfRender`, and read the Zotero debug log (`Help → Debug Output Logging`, or the `zotero` console). Record the JSON line.

- [ ] **Step 3: Decide the rendering path**

- If `pageRender === "function"` and `pageGetViewport === "function"` → **Path A** (pdf.js `render()`). Task 4 uses it.
- Else if `pageViewCanvas === true` → **Path B** (sample the Reader's already-rendered page `<canvas>` via `drawImage`). Task 4 uses the Path B variant.
- If neither → STOP. Report to the user; the screenshot approach needs rethinking.

- [ ] **Step 4: Remove the probe and commit the decision**

Delete `probePdfRender` and its call site. Record the chosen path in this plan file (edit the Task 4 heading).

```bash
git add src/modules/sidebar.ts docs/superpowers/plans/2026-05-23-pdf-formula-markdown-phase1.md
git commit -m "chore: pdf render feasibility spike (path decided)"
```

---

### Task 2: Add Phase 1 policy limits

**Files:**
- Modify: `src/context/policy.ts`
- Test: `tests/context/policy.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `tests/context/policy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_POLICY } from "../../src/context/policy";

describe("DEFAULT_CONTEXT_POLICY phase-1 limits", () => {
  it("defines render/figure/transcribe limits", () => {
    expect(DEFAULT_CONTEXT_POLICY.formulaRenderScale).toBeGreaterThan(1);
    expect(DEFAULT_CONTEXT_POLICY.formulaRenderMaxEdgePx).toBeGreaterThan(100);
    expect(DEFAULT_CONTEXT_POLICY.formulaCropPaddingPt).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONTEXT_POLICY.maxFiguresPerPaper).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_POLICY.transcribeBatchSize).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_POLICY.paperBuildTimeoutMs).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/context/policy.test.ts`
Expected: FAIL — properties are `undefined`.

- [ ] **Step 3: Add the fields**

In `src/context/policy.ts`, add to the `ContextPolicy` interface (after `minLocateConfidence`):

```typescript
  formulaRenderScale: number;
  formulaRenderMaxEdgePx: number;
  formulaCropPaddingPt: number;
  maxFiguresPerPaper: number;
  transcribeBatchSize: number;
  paperBuildTimeoutMs: number;
```

And to `DEFAULT_CONTEXT_POLICY`:

```typescript
  formulaRenderScale: 3,
  formulaRenderMaxEdgePx: 2000,
  formulaCropPaddingPt: 6,
  maxFiguresPerPaper: 60,
  transcribeBatchSize: 6,
  paperBuildTimeoutMs: 120_000,
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/context/policy.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context/policy.ts tests/context/policy.test.ts
git commit -m "feat: add phase-1 paper-markdown build limits to context policy"
```

---

### Task 3: `paper-markdown-store.ts` — cache storage

**Files:**
- Create: `src/context/paper-markdown-store.ts`
- Test: `tests/context/paper-markdown-store.test.ts`

The store owns the `papers/<itemKey>/` directory. `isPaperCacheStale` and `paperFolderPath` are pure. Binary writes use `IOUtils` (a Firefox global available in Zotero).

- [ ] **Step 1: Write the failing test (pure functions first)**

Create `tests/context/paper-markdown-store.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import {
  paperFolderPath,
  isPaperCacheStale,
  type PaperBuildMeta,
} from "../../src/context/paper-markdown-store";

function meta(over: Partial<PaperBuildMeta> = {}): PaperBuildMeta {
  return {
    itemKey: "ABCD1234",
    pdfAttachmentID: 7,
    pdfByteSize: 1000,
    pdfMtimeMs: 5000,
    pluginVersion: "0.4.2",
    builtAt: "2026-05-23T00:00:00.000Z",
    formulaCount: 3,
    lowConfidenceCount: 0,
    ...over,
  };
}

describe("paper-markdown-store pure helpers", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/prof" } },
    });
  });

  it("builds a per-item folder path under the data dir", () => {
    expect(paperFolderPath("ABCD1234")).toBe(
      "/data/zotero-ai-sidebar/papers/ABCD1234",
    );
  });

  it("treats a missing meta as stale", () => {
    expect(isPaperCacheStale(null, { byteSize: 1000, mtimeMs: 5000 })).toBe(true);
  });

  it("treats matching size+mtime as fresh", () => {
    expect(
      isPaperCacheStale(meta(), { byteSize: 1000, mtimeMs: 5000 }),
    ).toBe(false);
  });

  it("treats a changed pdf size or mtime as stale", () => {
    expect(isPaperCacheStale(meta(), { byteSize: 2000, mtimeMs: 5000 })).toBe(true);
    expect(isPaperCacheStale(meta(), { byteSize: 1000, mtimeMs: 9999 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/context/paper-markdown-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/context/paper-markdown-store.ts`:

```typescript
// Per-paper repaired-markdown cache: papers/<itemKey>/{paper.md,figures/,meta.json}.
// Distinct from settings/paper-cache.ts (frozen full text). Binary figure
// writes and directory creation use IOUtils (a Firefox global in Zotero).

export interface PaperBuildMeta {
  itemKey: string;
  pdfAttachmentID: number;
  pdfByteSize: number;
  pdfMtimeMs: number;
  pluginVersion: string;
  builtAt: string;
  formulaCount: number;
  lowConfidenceCount: number;
}

export interface PaperFigure {
  name: string; // e.g. "eq-p6-1.png"
  png: Uint8Array;
}

interface ZoteroGlobal {
  DataDirectory?: { dir?: string; path?: string };
  Profile: { dir: string };
}

interface IOUtilsLike {
  makeDirectory(path: string, options?: { ignoreExisting?: boolean }): Promise<void>;
  writeUTF8(path: string, data: string): Promise<number>;
  write(path: string, data: Uint8Array): Promise<number>;
  readUTF8(path: string): Promise<string>;
}

function zotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

function io(): IOUtilsLike {
  return (globalThis as unknown as { IOUtils: IOUtilsLike }).IOUtils;
}

function dataRoot(): string {
  const Z = zotero();
  return Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
}

export function paperFolderPath(itemKey: string): string {
  return `${dataRoot()}/zotero-ai-sidebar/papers/${itemKey}`;
}

// Stale when there is no meta, or the source PDF's size/mtime changed.
export function isPaperCacheStale(
  meta: PaperBuildMeta | null,
  pdf: { byteSize: number; mtimeMs: number },
): boolean {
  if (!meta) return true;
  return meta.pdfByteSize !== pdf.byteSize || meta.pdfMtimeMs !== pdf.mtimeMs;
}

// Writes paper.md + figures/*.png + meta.json. Returns the folder path.
export async function writeRepairedPaper(
  itemKey: string,
  markdown: string,
  figures: PaperFigure[],
  meta: PaperBuildMeta,
): Promise<string> {
  const folder = paperFolderPath(itemKey);
  const IO = io();
  await IO.makeDirectory(folder, { ignoreExisting: true });
  await IO.makeDirectory(`${folder}/figures`, { ignoreExisting: true });
  for (const figure of figures) {
    await IO.write(`${folder}/figures/${figure.name}`, figure.png);
  }
  await IO.writeUTF8(`${folder}/paper.md`, markdown);
  await IO.writeUTF8(`${folder}/meta.json`, JSON.stringify(meta, null, 2));
  return folder;
}

export async function readPaperMeta(
  itemKey: string,
): Promise<PaperBuildMeta | null> {
  try {
    const raw = await io().readUTF8(`${paperFolderPath(itemKey)}/meta.json`);
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as PaperBuildMeta)
      : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/context/paper-markdown-store.test.ts` → Expected: PASS.

- [ ] **Step 5: Add an I/O round-trip test**

Append to the test file — mock `globalThis.IOUtils` with an in-memory map, call `writeRepairedPaper` then `readPaperMeta`, assert the meta round-trips and `paper.md` content was written. Run the file again; Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context/paper-markdown-store.ts tests/context/paper-markdown-store.test.ts
git commit -m "feat: add per-paper repaired-markdown cache store"
```

---

### Task 4: `renderRegion()` in `pdf-locator.ts` — [PATH SET BY TASK 1]

**Files:**
- Modify: `src/context/pdf-locator.ts` (`PdfLocator` interface + `createPdfLocator` return object)

Add `renderRegion(pageIndex, rects)` to the `PdfLocator` interface. It renders the page to a canvas, crops to the union of `rects` (expanded by `policy.formulaCropPaddingPt`, converted from PDF points to pixels via the render scale), and returns PNG bytes.

- [ ] **Step 1: Extend the `PdfLocator` interface**

In `src/context/pdf-locator.ts`, add to `interface PdfLocator`:

```typescript
  renderRegion(
    pageIndex: number,
    rects: PdfRect[],
  ): Promise<Uint8Array | null>;
```

- [ ] **Step 2: Implement `renderRegion` (Path A — pdf.js render)**

In the object returned by `createPdfLocator`, add. (If Task 1 chose Path B, instead read pixels from `viewer.getPageView(pageIndex).canvas` with `drawImage` of the sub-rect — same crop math, no `page.render`.)

```typescript
async renderRegion(pageIndex, rects) {
  if (!rects.length) return null;
  const page: any = await source.getPage?.(pageIndex);
  if (!page || typeof page.render !== "function") return null;
  const scale = DEFAULT_CONTEXT_POLICY.formulaRenderScale;
  const viewport = page.getViewport({ scale });
  const doc = (globalThis as any).document as Document;
  const canvas = doc.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // rects are PDF user-space; map to canvas px via viewport.convertToViewportRectangle.
  const pad = DEFAULT_CONTEXT_POLICY.formulaCropPaddingPt;
  const boxes = rects.map((r) =>
    viewport.convertToViewportRectangle([
      r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad,
    ]),
  );
  const xs = boxes.flatMap((b) => [b[0], b[2]]);
  const ys = boxes.flatMap((b) => [b[1], b[3]]);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(canvas.width, Math.max(...xs));
  const y1 = Math.min(canvas.height, Math.max(...ys));
  const w = Math.max(1, Math.round(x1 - x0));
  const h = Math.max(1, Math.round(y1 - y0));
  const crop = doc.createElement("canvas");
  crop.width = w;
  crop.height = h;
  crop.getContext("2d")!.drawImage(
    canvas, Math.round(x0), Math.round(y0), w, h, 0, 0, w, h,
  );
  const blob: Blob = await new Promise((res, rej) =>
    crop.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
```

Note: `source.getPage` exists only on the `documentSource` / `pageViewSource` paths; the `processed` path has no renderable page → `renderRegion` returns `null`, and the caller (Task 6) treats that formula as render-failed (spec §10).

- [ ] **Step 3: Verify the build typechecks**

Run: `npm run build`
Expected: `tsc --noEmit` passes (no test — rendering needs a live viewer; covered by Task 8 manual verification).

- [ ] **Step 4: Commit**

```bash
git add src/context/pdf-locator.ts
git commit -m "feat: add renderRegion to the PDF locator"
```

---

### Task 5: `transcribe.ts` — screenshot → LaTeX

**Files:**
- Create: `src/context/transcribe.ts`
- Test: `tests/context/transcribe.test.ts`

Mirrors `src/translate/translator.ts`: build one `Message` carrying the figure images, call `getProvider(preset).stream(...)`, accumulate text, parse a JSON `{id: latex}` map. The parser is pure → tested directly.

- [ ] **Step 1: Write the failing test for the parser**

Create `tests/context/transcribe.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseTranscriptionResponse } from "../../src/context/transcribe";

describe("parseTranscriptionResponse", () => {
  it("parses a fenced JSON id→latex map", () => {
    const text = '```json\n{"eq-p6-1": "\\\\alpha + \\\\beta", "eq-p6-2": "x^2"}\n```';
    const map = parseTranscriptionResponse(text);
    expect(map.get("eq-p6-1")).toBe("\\alpha + \\beta");
    expect(map.get("eq-p6-2")).toBe("x^2");
  });

  it("parses bare JSON with surrounding prose", () => {
    const map = parseTranscriptionResponse('Here:\n{"a": "y=1"}\nDone.');
    expect(map.get("a")).toBe("y=1");
  });

  it("returns an empty map on unparseable output", () => {
    expect(parseTranscriptionResponse("sorry, no").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/context/transcribe.test.ts` → Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transcribe.ts`**

Create `src/context/transcribe.ts`:

```typescript
import type { Message, ModelPreset } from "../providers/types";
import { getProvider } from "../providers/factory";

export interface TranscribeFigure {
  id: string;          // matches the figure file stem, e.g. "eq-p6-1"
  pngDataUrl: string;  // "data:image/png;base64,..."
}

const SYSTEM_PROMPT =
  "You transcribe cropped images of scientific-paper regions. Each image is " +
  "tagged with an id. Output ONLY a JSON object mapping every id to a faithful " +
  "transcription: LaTeX (no $ delimiters) for a formula, a GitHub-flavored " +
  "markdown table for a table, plain text for a text block. Do not add commentary.";

// Pure: extract the id→transcription map from model output.
export function parseTranscriptionResponse(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return result;
  try {
    const obj: unknown = JSON.parse(body.slice(start, end + 1));
    if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === "string") result.set(key, value);
      }
    }
  } catch {
    // unparseable → empty map; caller treats every figure as un-transcribed
  }
  return result;
}

// Build-time utility call. Returns id→transcription; missing ids = failed.
export async function transcribeFigures(
  figures: TranscribeFigure[],
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  if (!figures.length) return new Map();
  const message: Message = {
    role: "user",
    content:
      "Transcribe each tagged image. ids: " +
      figures.map((f) => f.id).join(", "),
    images: figures.map((f) => ({
      id: f.id,
      marker: `[id=${f.id}]`,
      name: `${f.id}.png`,
      mediaType: "image/png",
      dataUrl: f.pngDataUrl,
      size: f.pngDataUrl.length,
    })),
  };
  let text = "";
  for await (const chunk of getProvider(preset).stream(
    [message],
    SYSTEM_PROMPT,
    preset,
    signal,
  )) {
    if (chunk.type === "text_delta") text += chunk.text;
    if (chunk.type === "error") return new Map();
  }
  return parseTranscriptionResponse(text);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/context/transcribe.test.ts` → Expected: PASS.

- [ ] **Step 5: Add a `transcribeFigures` test with a mocked provider**

Append a test that `vi.mock`s `../../src/providers/factory` so `getProvider` returns a stub whose `stream` yields one `{type:"text_delta", text:'{"eq-p6-1":"x^2"}'}` chunk; assert `transcribeFigures([{id:"eq-p6-1",...}], preset, signal)` resolves to a map with `eq-p6-1 → x^2`. Run; Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context/transcribe.ts tests/context/transcribe.test.ts
git commit -m "feat: add build-time formula screenshot transcription"
```

---

### Task 6: Build orchestration + markdown assembly in `formula-repair.ts`

**Files:**
- Modify: `src/context/formula-repair.ts` (add `assembleRepairedMarkdown` + `buildRepairedPaper`)
- Test: `tests/context/formula-repair.test.ts` (extend)

`assembleRepairedMarkdown` is pure (splice source text + run repairs → markdown) → TDD. `buildRepairedPaper` is the orchestration glue (locator + render + transcribe + store) → typecheck + Task 8 manual verification.

- [ ] **Step 1: Write the failing test for `assembleRepairedMarkdown`**

Append to `tests/context/formula-repair.test.ts`:

```typescript
import { assembleRepairedMarkdown } from "../../src/context/formula-repair";

describe("assembleRepairedMarkdown", () => {
  it("splices run repairs into the source, keeping prose verbatim", () => {
    const source = "Intro line.\nGARBLE\nOutro line.";
    const md = assembleRepairedMarkdown(source, [
      {
        start: source.indexOf("GARBLE"),
        end: source.indexOf("GARBLE") + "GARBLE".length,
        figureName: "eq-p1-1.png",
        latex: "\\alpha",
        pageIndex: 0,
        rects: [[1, 2, 3, 4]],
        confidence: 0.97,
      },
    ]);
    expect(md).toContain("Intro line.");
    expect(md).toContain("Outro line.");
    expect(md).toContain("![formula p.1](figures/eq-p1-1.png)");
    expect(md).toContain("<!-- zai:loc page=0");
    expect(md).toContain("$$\n\\alpha\n$$");
    expect(md).not.toContain("GARBLE");
  });

  it("keeps the garbled text and marks it when a repair has no latex", () => {
    const source = "A\nGARBLE\nB";
    const md = assembleRepairedMarkdown(source, [
      {
        start: 2,
        end: 8,
        figureName: "eq-p1-1.png",
        latex: null,
        pageIndex: 0,
        rects: [[1, 2, 3, 4]],
        confidence: 0.4,
      },
    ]);
    expect(md).toContain("![formula p.1](figures/eq-p1-1.png)");
    expect(md).toContain("zai:unrepaired");
    expect(md).toContain("GARBLE");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/context/formula-repair.test.ts`
Expected: FAIL — `assembleRepairedMarkdown` not exported.

- [ ] **Step 3: Implement `assembleRepairedMarkdown`**

Append to `src/context/formula-repair.ts`:

```typescript
export interface RunRepair {
  start: number;
  end: number;
  figureName: string;
  latex: string | null; // null = transcription unavailable
  pageIndex: number;
  rects: number[][];
  confidence: number;
}

// Splice run repairs into the source text. Prose between runs is copied
// verbatim; each run becomes a screenshot embed + zai:loc comment, then
// either a $$LaTeX$$ block or the kept garbled text marked zai:unrepaired.
export function assembleRepairedMarkdown(
  source: string,
  repairs: RunRepair[],
): string {
  const ordered = [...repairs].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const r of ordered) {
    parts.push(source.slice(cursor, r.start));
    const loc = `<!-- zai:loc page=${r.pageIndex} rects=${JSON.stringify(
      r.rects,
    )} confidence=${r.confidence} -->`;
    parts.push(`\n![formula p.${r.pageIndex + 1}](figures/${r.figureName})\n${loc}\n`);
    if (r.latex) {
      parts.push(`$$\n${r.latex}\n$$\n`);
    } else {
      parts.push(`<!-- zai:unrepaired -->\n\`\`\`\n${source.slice(r.start, r.end)}\n\`\`\`\n`);
    }
    cursor = r.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/context/formula-repair.test.ts` → Expected: PASS (all detector + assembly tests).

- [ ] **Step 5: Implement `buildRepairedPaper` orchestration**

Append to `src/context/formula-repair.ts`. This is integration glue (no unit test — exercised in Task 8):

```typescript
import { getSharedPdfLocator } from "./pdf-locator";
import { transcribeFigures } from "./transcribe";
import { writeRepairedPaper, type PaperBuildMeta } from "./paper-markdown-store";
import type { ModelPreset } from "../providers/types";

export interface BuildRepairedPaperArgs {
  itemKey: string;
  fullText: string;
  reader: unknown;
  preset: ModelPreset;
  pdf: { attachmentID: number; byteSize: number; mtimeMs: number };
  pluginVersion: string;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(binary)}`;
}

// Detect → locate → render → transcribe → assemble → write. Returns the
// cache folder path, or null when there is nothing to repair / build failed.
export async function buildRepairedPaper(
  args: BuildRepairedPaperArgs,
): Promise<string | null> {
  const runs = detectGarbledFormulaRuns(args.fullText);
  if (!runs.length) return null;

  const locator = await getSharedPdfLocator(args.reader);
  const capped = runs.slice(0, DEFAULT_CONTEXT_POLICY.maxFiguresPerPaper);

  const repairs: RunRepair[] = [];
  const figures: { name: string; png: Uint8Array }[] = [];
  const transcribeInput: { id: string; pngDataUrl: string }[] = [];
  let lowConfidence = 0;

  for (let i = 0; i < capped.length; i++) {
    const run = capped[i];
    args.onProgress?.(i, capped.length);
    const located = await locator.locate(run.text);
    if (!located) continue;
    if (located.confidence < DEFAULT_CONTEXT_POLICY.minLocateConfidence) {
      lowConfidence++;
    }
    const png = await locator.renderRegion(located.pageIndex, located.rects);
    if (!png) continue;
    const figureName = `eq-p${located.pageIndex + 1}-${i + 1}.png`;
    figures.push({ name: figureName, png });
    transcribeInput.push({ id: figureName.replace(/\.png$/, ""), pngDataUrl: bytesToPngDataUrl(png) });
    repairs.push({
      start: run.start,
      end: run.end,
      figureName,
      latex: null,
      pageIndex: located.pageIndex,
      rects: located.rects,
      confidence: located.confidence,
    });
  }
  if (!repairs.length) return null;

  const latexById = await transcribeFigures(transcribeInput, args.preset, args.signal);
  for (const repair of repairs) {
    const id = repair.figureName.replace(/\.png$/, "");
    repair.latex = latexById.get(id) ?? null;
  }

  const markdown = assembleRepairedMarkdown(args.fullText, repairs);
  const meta: PaperBuildMeta = {
    itemKey: args.itemKey,
    pdfAttachmentID: args.pdf.attachmentID,
    pdfByteSize: args.pdf.byteSize,
    pdfMtimeMs: args.pdf.mtimeMs,
    pluginVersion: args.pluginVersion,
    builtAt: new Date().toISOString(),
    formulaCount: repairs.length,
    lowConfidenceCount: lowConfidence,
  };
  args.onProgress?.(capped.length, capped.length);
  return writeRepairedPaper(args.itemKey, markdown, figures, meta);
}
```

- [ ] **Step 6: Verify the build typechecks**

Run: `npm run build` → Expected: `tsc --noEmit` passes.

- [ ] **Step 7: Commit**

```bash
git add src/context/formula-repair.ts tests/context/formula-repair.test.ts
git commit -m "feat: add repaired-markdown assembly and build orchestration"
```

---

### Task 7: Temporary sidebar button

**Files:**
- Modify: `src/modules/sidebar.ts`

Add one temporary button near the existing bottom-row buttons (`设置` / `复制MD` at `sidebar.ts:659+`). On click: resolve the item + PDF attachment + reader + active preset, call `buildRepairedPaper`, then reveal the folder.

- [ ] **Step 1: Add the button next to the existing bottom-row buttons**

After the `settings` button block in `src/modules/sidebar.ts`, add:

```typescript
const buildMd = buttonEl(doc, "PDF→MD");
buildMd.className = "build-md-button";
buildMd.title = "把当前论文 PDF 转成修复版 markdown（临时验证按钮）";
buildMd.addEventListener("click", () => {
  void runPaperMarkdownBuild(doc, win, buildMd);
});
bottomRow.append(buildMd);
```

- [ ] **Step 2: Implement the click handler**

Add near the other sidebar helpers in `src/modules/sidebar.ts`:

```typescript
// TEMPORARY (Phase 1 verification). Removed when Phase 2 chat integration lands.
async function runPaperMarkdownBuild(
  doc: Document,
  win: Window,
  button: HTMLButtonElement,
): Promise<void> {
  const itemID = getSelectedItemID(win);
  if (itemID == null) {
    flashButton(button, "无条目");
    return;
  }
  const reader = getActiveReader(win);
  if (!reader) {
    flashButton(button, "先开 PDF");
    return;
  }
  const preset = getActivePreset();           // existing helper for the current model preset
  const attachments = await getPdfAttachmentsForItem(itemID); // existing PDF-attachment lookup
  const attachment = attachments[0];
  if (!preset || !attachment) {
    flashButton(button, "无 PDF/模型");
    return;
  }
  const original = button.textContent ?? "PDF→MD";
  button.disabled = true;
  try {
    const fullText = await getItemFullText(itemID);   // existing zotero-source full-text read
    const stat = await IOUtils.stat(attachment.getFilePath());
    const folder = await buildRepairedPaper({
      itemKey: getItemKey(itemID),
      fullText,
      reader,
      preset,
      pdf: {
        attachmentID: attachment.id,
        byteSize: stat.size ?? 0,
        mtimeMs: stat.lastModified ?? 0,
      },
      pluginVersion: getPluginVersion(),
      signal: new AbortController().signal,
      onProgress: (done, total) => {
        button.textContent = `转换 ${done}/${total}`;
      },
    });
    if (!folder) {
      flashButton(button, "无乱码公式");
      return;
    }
    Zotero.File.reveal(`${folder}/paper.md`);   // opens the folder in the OS file manager
    flashButton(button, "已生成");
  } catch (err) {
    Zotero.debug(`[zai] paper-markdown build failed: ${String(err)}`);
    flashButton(button, "失败");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
```

NOTE for the implementer: `getActivePreset`, `getPdfAttachmentsForItem`, `getItemFullText`, `getItemKey`, `getPluginVersion` — wire these to the existing sidebar/`zotero-source` equivalents found during implementation (the sidebar already resolves preset + item full text for normal chat). If an exact helper does not exist, add a thin local one; do not duplicate logic.

- [ ] **Step 3: Add minimal button CSS**

In `addon/content/sidebar.css`, add `.build-md-button` to the existing bottom-row button selector group (around line 474) so it inherits the standard button style. No new rule body needed if it joins the shared selector list.

- [ ] **Step 4: Verify the build**

Run: `npm run build` → Expected: `tsc --noEmit` passes, XPI built.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sidebar.ts addon/content/sidebar.css
git commit -m "feat: add temporary PDF→markdown build button to the sidebar"
```

---

### Task 8: Manual end-to-end verification

Not TDD — a procedure. Confirms the live pieces (`locate` + `renderRegion` + provider transcription) that unit tests cannot cover.

- [ ] **Step 1: Install and run**

```bash
npm run build
cp .scaffold/build/zotero-ai-sidebar.xpi /home/qwer/.zotero/zotero/24q8duho.default/extensions/zotero-ai-sidebar@local.xpi
```
Restart Zotero (`cd ~/Downloads/Zotero_linux-x86_64 && ./zotero`).

- [ ] **Step 2: Build the π0.5 paper**

Open the π0.5 paper's PDF in the Reader, open the AI sidebar, click **PDF→MD**. The button shows `转换 N/M` progress, then `已生成`, and the OS file manager opens `papers/<itemKey>/`.

- [ ] **Step 3: Verify the output in VSCode**

Open `papers/<itemKey>/paper.md` in VSCode (markdown preview). Confirm:
- Equation (1)'s region shows a correct screenshot (`figures/eq-p*-1.png`).
- A `$$…$$` block under it renders as the correct formula.
- Surrounding prose is intact and verbatim.
- `meta.json` has a plausible `formulaCount`.

- [ ] **Step 4: Record the result**

If the formula screenshot/LaTeX is correct → Phase 1 done; report to the user for the Phase 2 go/no-go. If wrong → file the specific failure (wrong crop region? bad transcription? locate miss?) and return to the relevant task.

---

## Self-Review

- **Spec coverage:** §5 storage → Task 3; §6 step 2 detection → already done; step 3 locate → reused in Task 6; step 4 render → Tasks 1+4; step 5 transcribe → Task 5; step 6 assemble → Task 6; §7 button → Task 7; §9 staleness → Task 3 (`isPaperCacheStale`); §10 degradation → Task 6 (`continue` on locate/render failure, `latex:null` path) + Task 7 (flash messages). §8/§9-lazy are Phase 2 — correctly absent.
- **Type consistency:** `GarbledFormulaRun` (existing) → `RunRepair` (Task 6) → `assembleRepairedMarkdown` (Task 6); `PaperBuildMeta`/`PaperFigure` (Task 3) consumed by `writeRepairedPaper` (Task 3) and `buildRepairedPaper` (Task 6); `TranscribeFigure`/`transcribeFigures` (Task 5) consumed by Task 6. Figure id = file stem (`eq-pN-k`), consistent across Tasks 5–6.
- **Open dependency:** Task 7 names sidebar helpers (`getActivePreset` etc.) to be wired to existing equivalents at implementation time — flagged inline in Task 7 Step 2.
