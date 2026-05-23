# arXiv LaTeX-Source Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When AI analysis runs on an arXiv paper, download the paper's LaTeX source and use its cleaned `main.tex` as the analysis text context — so the model reads exact formulas instead of garbled PDF text.

**Architecture:** On analysis start, resolve an arXiv id from the Zotero item, download `export.arxiv.org/e-print/<id>` (in memory), gunzip+untar it, store the extracted tree under `arxiv/<itemKey>/`, and have `getFullText` return the cleaned `main.tex`. A sidebar header badge marks when source-based analysis is active. Every failure falls back to the existing PDF flow.

**Tech Stack:** TypeScript; Zotero 7/8/9 plugin; `fetch` + `DecompressionStream` (gzip) + a hand-written tar parser; `IOUtils` for file I/O; vitest for tests.

**Spec:** `docs/superpowers/specs/2026-05-23-arxiv-source-analysis-design.md`

**Verification commands:** `npm test` (vitest), `npm run build` (`zotero-plugin build` + `tsc --noEmit`).

---

### Task 1: Feasibility spike — gzip + fetch in the plugin runtime

A **spike**, not TDD. Confirms `DecompressionStream` and arXiv `fetch` work before the download tasks. No production code.

- [ ] **Step 1: Run this in Zotero's Run JavaScript console** (Tools → Developer → Run JavaScript, "作为异步函数执行" checked):

```js
const out = { hasDecompressionStream: typeof DecompressionStream, hasFetch: typeof fetch };
try {
  const resp = await fetch("https://export.arxiv.org/e-print/2504.16054", {
    headers: { "User-Agent": "zotero-ai-sidebar/0.4 (test)" },
  });
  out.status = resp.status;
  const buf = new Uint8Array(await resp.arrayBuffer());
  out.bytes = buf.length;
  out.gzipMagic = buf[0] === 0x1f && buf[1] === 0x8b;
  if (out.gzipMagic) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    let total = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; total += r.value.length; }
    out.gunzippedBytes = total;
  }
} catch (e) { out.error = String(e); }
return JSON.stringify(out, null, 2);
```

- [ ] **Step 2: Record the result.** Expected good outcome: `hasDecompressionStream: "function"`, `status: 200`, `gzipMagic: true`, `gunzippedBytes` >> `bytes`.

- [ ] **Step 3: Decide.**
  - All good → proceed; Tasks 5/7 use `fetch` + `DecompressionStream` as written.
  - `fetch` blocked/CORS-fails → Task 7 must use Zotero's HTTP API (`Zotero.HTTP.request`) instead; note this in Task 7.
  - `DecompressionStream` missing → STOP, report to the user (need a JS gzip implementation).

No commit (no files changed).

---

### Task 2: Add arXiv policy limits

**Files:**
- Modify: `src/context/policy.ts`
- Test: `tests/context/policy.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `tests/context/policy.test.ts`:

```typescript
describe("DEFAULT_CONTEXT_POLICY arxiv limits", () => {
  it("defines arxiv fetch limits", () => {
    expect(DEFAULT_CONTEXT_POLICY.maxArxivSourceBytes).toBeGreaterThan(1_000_000);
    expect(DEFAULT_CONTEXT_POLICY.arxivFetchTimeoutMs).toBeGreaterThan(1000);
  });
});
```

(If the file lacks the import, add `import { DEFAULT_CONTEXT_POLICY } from "../../src/context/policy";` at the top.)

- [ ] **Step 2: Run, verify it fails.** Run: `npx vitest run tests/context/policy.test.ts` — Expected: FAIL (`undefined`).

- [ ] **Step 3: Implement.** In `src/context/policy.ts`, add to the `ContextPolicy` interface (after the last field) and to `DEFAULT_CONTEXT_POLICY`:

Interface:
```typescript
  maxArxivSourceBytes: number;
  arxivFetchTimeoutMs: number;
```
Object:
```typescript
  maxArxivSourceBytes: 80_000_000,
  arxivFetchTimeoutMs: 60_000,
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run tests/context/policy.test.ts` — Expected: PASS. Then `npm run build` — clean.

- [ ] **Step 5: Commit.**
```bash
git add src/context/policy.ts tests/context/policy.test.ts
git commit -m "feat: add arxiv fetch limits to context policy"
```

---

### Task 3: `arxiv-id.ts` — resolve an arXiv id from item metadata

**Files:**
- Create: `src/context/arxiv-id.ts`
- Test: `tests/context/arxiv-id.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/context/arxiv-id.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveArxivId } from "../../src/context/arxiv-id";

describe("resolveArxivId", () => {
  it("reads a new-style id from the Extra field", () => {
    expect(resolveArxivId({ extra: "arXiv: 2504.16054\nfoo: bar" })).toBe("2504.16054");
  });
  it("reads an id with a version suffix", () => {
    expect(resolveArxivId({ extra: "tex.eprint: 2504.16054v1" })).toBe("2504.16054v1");
  });
  it("reads an id from an arxiv abs/pdf url", () => {
    expect(resolveArxivId({ url: "https://arxiv.org/abs/2504.16054" })).toBe("2504.16054");
  });
  it("reads an id from a 10.48550 arXiv DOI", () => {
    expect(resolveArxivId({ doi: "10.48550/arXiv.2504.16054" })).toBe("2504.16054");
  });
  it("reads a legacy-style id", () => {
    expect(resolveArxivId({ url: "https://arxiv.org/abs/hep-th/9901001" })).toBe("hep-th/9901001");
  });
  it("returns null for non-arxiv metadata", () => {
    expect(resolveArxivId({ doi: "10.1145/3534678.3539043", url: "https://example.com" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run tests/context/arxiv-id.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/context/arxiv-id.ts`:

```typescript
// Resolve an arXiv id from Zotero item metadata fields. Pure — no I/O.

export interface ArxivIdFields {
  extra?: string;
  url?: string;
  doi?: string;
  archiveID?: string;
}

// new-style: 2504.16054 (+ optional v3); legacy: hep-th/9901001 (+ optional v2)
const NEW_STYLE = /(\d{4}\.\d{4,5})(v\d+)?/;
const LEGACY_STYLE = /([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

function extractArxivId(text: string): string | null {
  // Anchor on an "arxiv" mention when present, to avoid matching stray
  // numbers (e.g. a non-arXiv DOI). Fall back to a bare scan otherwise.
  const anchored = text.match(/ar[xX]iv[:.\s/]*([^\s]+)/);
  const haystacks = anchored ? [anchored[1], text] : [text];
  for (const h of haystacks) {
    const m = h.match(NEW_STYLE) ?? h.match(LEGACY_STYLE);
    if (m) return `${m[1]}${m[2] ?? ""}`;
  }
  return null;
}

export function resolveArxivId(fields: ArxivIdFields): string | null {
  for (const raw of [fields.extra, fields.archiveID, fields.url, fields.doi]) {
    const id = raw ? extractArxivId(raw) : null;
    if (id) return id;
  }
  return null;
}
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run tests/context/arxiv-id.test.ts` — Expected: PASS. If a case fails, adjust the regexes/anchoring until all six pass. Then `npm run build` — clean.

- [ ] **Step 5: Commit.**
```bash
git add src/context/arxiv-id.ts tests/context/arxiv-id.test.ts
git commit -m "feat: resolve arxiv id from zotero item metadata"
```

---

### Task 4: `tex-clean.ts` — main-file selection and comment stripping

**Files:**
- Create: `src/context/tex-clean.ts`
- Test: `tests/context/tex-clean.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/context/tex-clean.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  stripTexComments,
  findMainTex,
  inlineInputs,
} from "../../src/context/tex-clean";

describe("stripTexComments", () => {
  it("removes a line comment", () => {
    expect(stripTexComments("text % a comment")).toBe("text ");
  });
  it("keeps an escaped percent", () => {
    expect(stripTexComments("50\\% done % real comment")).toBe("50\\% done ");
  });
  it("keeps lines without comments", () => {
    expect(stripTexComments("a\nb")).toBe("a\nb");
  });
});

describe("findMainTex", () => {
  it("picks the file with documentclass + begin document", () => {
    const files = [
      { path: "sec1.tex", text: "\\section{Intro}" },
      { path: "main.tex", text: "\\documentclass{x}\n\\begin{document}\nhi\n\\end{document}" },
    ];
    expect(findMainTex(files)?.path).toBe("main.tex");
  });
  it("returns null when there is no .tex file", () => {
    expect(findMainTex([{ path: "a.png", text: "" }])).toBeNull();
  });
});

describe("inlineInputs", () => {
  it("splices an \\input file's content", () => {
    const files = [{ path: "method.tex", text: "METHOD BODY" }];
    expect(inlineInputs("before \\input{method} after", files)).toBe(
      "before METHOD BODY after",
    );
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run tests/context/tex-clean.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/context/tex-clean.ts`:

```typescript
// Pure LaTeX-source helpers: comment stripping, main-file selection,
// \input inlining. No I/O.

export interface TexFile {
  path: string;
  text: string;
}

// Drop %-to-end-of-line comments; a backslash escapes the next char, so
// `\%` is a literal percent and not a comment start.
function stripLineComment(line: string): string {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === "%") return line.slice(0, i);
    i += 1;
  }
  return line;
}

export function stripTexComments(text: string): string {
  return text.split("\n").map(stripLineComment).join("\n");
}

// The main .tex file: prefer one with \begin{document} (and \documentclass);
// fall back to any .tex.
export function findMainTex(files: TexFile[]): TexFile | null {
  const tex = files.filter((f) => f.path.toLowerCase().endsWith(".tex"));
  if (!tex.length) return null;
  const withDoc = tex.filter((f) => f.text.includes("\\begin{document}"));
  return (
    withDoc.find((f) => f.text.includes("\\documentclass")) ??
    withDoc[0] ??
    tex[0]
  );
}

// Recursively replace \input{f} / \include{f} with the referenced file's
// content. Depth-capped against pathological cycles.
export function inlineInputs(
  text: string,
  files: TexFile[],
  depth = 0,
): string {
  if (depth > 12) return text;
  return text.replace(
    /\\(?:input|include)\{([^}]+)\}/g,
    (whole, name: string) => {
      const target = name.trim();
      const f = files.find(
        (x) =>
          x.path === target ||
          x.path === `${target}.tex` ||
          x.path.endsWith(`/${target}`) ||
          x.path.endsWith(`/${target}.tex`),
      );
      return f ? inlineInputs(f.text, files, depth + 1) : whole;
    },
  );
}
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run tests/context/tex-clean.test.ts` — Expected: PASS. Then `npm run build` — clean.

- [ ] **Step 5: Commit.**
```bash
git add src/context/tex-clean.ts tests/context/tex-clean.test.ts
git commit -m "feat: add latex source cleanup helpers"
```

---

### Task 5: `arxiv-archive.ts` — gunzip + untar

**Files:**
- Create: `src/context/arxiv-archive.ts`
- Test: `tests/context/arxiv-archive.test.ts`

`DecompressionStream` is a global in vitest's Node runtime, so `gunzip` is unit-testable.

- [ ] **Step 1: Write the failing test.** Create `tests/context/arxiv-archive.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { gunzip, untar, extractArchive } from "../../src/context/arxiv-archive";

// Build a minimal one-file tar in memory.
function makeTar(name: string, body: string): Uint8Array {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode(name), 0);
  header.set(enc.encode("0000644"), 100); // mode
  header.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124); // size (octal)
  header[156] = "0".charCodeAt(0); // type flag: regular file
  header.set(enc.encode("ustar\0"), 257); // magic
  // checksum: sum of header bytes with the checksum field treated as spaces
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  const data = enc.encode(body);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length + 1024);
  out.set(header, 0);
  out.set(padded, 512);
  return out;
}

describe("untar", () => {
  it("extracts a regular file", () => {
    const files = untar(makeTar("main.tex", "HELLO"));
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("main.tex");
    expect(new TextDecoder().decode(files[0].bytes)).toBe("HELLO");
  });
});

describe("gunzip + extractArchive", () => {
  it("round-trips through a gzip compression stream", async () => {
    const original = new TextEncoder().encode("compress me ".repeat(20));
    const cs = new Blob([original]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = new Uint8Array(await new Response(cs).arrayBuffer());
    expect(gz[0]).toBe(0x1f);
    const back = await gunzip(gz);
    expect(new TextDecoder().decode(back)).toBe("compress me ".repeat(20));
  });

  it("extractArchive treats a bare .tex payload as main.tex", async () => {
    const files = await extractArchive(new TextEncoder().encode("\\documentclass{x}"));
    expect(files[0].path).toBe("main.tex");
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run tests/context/arxiv-archive.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/context/arxiv-archive.ts`:

```typescript
// Decompress + unpack an arXiv e-print payload. Pure (no network, no disk):
// input is a byte buffer, output is a list of {path, bytes}.

export interface ArchiveFile {
  path: string;
  bytes: Uint8Array;
}

// Inflate a gzip buffer via the platform DecompressionStream.
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// Parse the POSIX tar format: 512-byte header blocks, file data padded to
// 512. We keep regular files only (type flag '0' / NUL).
export function untar(buf: Uint8Array): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  const td = new TextDecoder();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const name = td.decode(header.subarray(0, 100)).replace(/\0.*$/s, "").trim();
    const sizeOctal = td.decode(header.subarray(124, 136)).replace(/[^0-7]/g, "");
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeFlag = String.fromCharCode(header[156]);
    off += 512;
    if (name && (typeFlag === "0" || typeFlag === "\0")) {
      files.push({ path: name, bytes: buf.subarray(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

// Detect gzip / tar / PDF / bare-file and produce the file list.
export async function extractArchive(bytes: Uint8Array): Promise<ArchiveFile[]> {
  let data = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) data = await gunzip(bytes);
  // %PDF — the submission has no LaTeX source
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return [];
  }
  const isTar =
    data.length >= 512 &&
    new TextDecoder().decode(data.subarray(257, 262)) === "ustar";
  if (isTar) return untar(data);
  // A single-file arXiv source: a bare .tex.
  return [{ path: "main.tex", bytes: data }];
}
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run tests/context/arxiv-archive.test.ts` — Expected: PASS. Then `npm run build` — clean.

- [ ] **Step 5: Commit.**
```bash
git add src/context/arxiv-archive.ts tests/context/arxiv-archive.test.ts
git commit -m "feat: add arxiv e-print gzip + tar extraction"
```

---

### Task 6: `arxiv-store.ts` — per-item source cache

**Files:**
- Create: `src/context/arxiv-store.ts`
- Test: `tests/context/arxiv-store.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/context/arxiv-store.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import {
  arxivFolderPath,
  writeArxivSource,
  hasArxivSource,
  readArxivMeta,
  type ArxivMeta,
} from "../../src/context/arxiv-store";

let fs: Map<string, string | Uint8Array>;

beforeEach(() => {
  fs = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/prof" } },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      makeDirectory: async () => undefined,
      writeUTF8: async (p: string, d: string) => void fs.set(p, d),
      write: async (p: string, d: Uint8Array) => void fs.set(p, d),
      readUTF8: async (p: string) => {
        if (!fs.has(p)) throw new Error("no entry");
        return fs.get(p) as string;
      },
      exists: async (p: string) => fs.has(p),
    },
  });
});

const meta: ArxivMeta = {
  itemKey: "ABCD1234",
  arxivId: "2504.16054",
  fetchedAt: "2026-05-23T00:00:00.000Z",
  mainTexRelPath: "main.tex",
  status: "ok",
};

describe("arxiv-store", () => {
  it("builds a per-item folder path", () => {
    expect(arxivFolderPath("ABCD1234")).toBe("/data/zotero-ai-sidebar/arxiv/ABCD1234");
  });

  it("writes source files + meta and round-trips meta", async () => {
    await writeArxivSource(
      "ABCD1234",
      [{ path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{x}") }],
      meta,
    );
    expect(await readArxivMeta("ABCD1234")).toEqual(meta);
  });

  it("hasArxivSource is true after a write, false otherwise", async () => {
    expect(await hasArxivSource("NONE0000")).toBe(false);
    await writeArxivSource("ABCD1234", [], meta);
    expect(await hasArxivSource("ABCD1234")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run tests/context/arxiv-store.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/context/arxiv-store.ts`:

```typescript
// Per-item arXiv source cache: arxiv/<itemKey>/source/* + meta.json.

import type { ArchiveFile } from "./arxiv-archive";

export interface ArxivMeta {
  itemKey: string;
  arxivId: string;
  fetchedAt: string;
  mainTexRelPath: string;
  status: "ok" | "no-source";
}

interface IOUtilsLike {
  makeDirectory(path: string, options?: { ignoreExisting?: boolean }): Promise<void>;
  writeUTF8(path: string, data: string): Promise<unknown>;
  write(path: string, data: Uint8Array): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

function dataRoot(): string {
  const Z = (globalThis as { Zotero?: { DataDirectory?: { dir?: string; path?: string }; Profile: { dir: string } } }).Zotero!;
  return Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
}

function io(): IOUtilsLike {
  return (globalThis as unknown as { IOUtils: IOUtilsLike }).IOUtils;
}

export function arxivFolderPath(itemKey: string): string {
  return `${dataRoot()}/zotero-ai-sidebar/arxiv/${itemKey}`;
}

function metaPath(itemKey: string): string {
  return `${arxivFolderPath(itemKey)}/meta.json`;
}

// Sanitize an archive-relative path so it cannot escape the source folder.
function safeRel(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) return null;
  return clean;
}

export async function writeArxivSource(
  itemKey: string,
  files: ArchiveFile[],
  meta: ArxivMeta,
): Promise<void> {
  const folder = arxivFolderPath(itemKey);
  const IO = io();
  await IO.makeDirectory(`${folder}/source`, { ignoreExisting: true });
  for (const file of files) {
    const rel = safeRel(file.path);
    if (!rel) continue;
    const full = `${folder}/source/${rel}`;
    const slash = full.lastIndexOf("/");
    if (slash > 0) await IO.makeDirectory(full.slice(0, slash), { ignoreExisting: true });
    await IO.write(full, file.bytes);
  }
  await IO.writeUTF8(metaPath(itemKey), JSON.stringify(meta, null, 2));
}

export async function hasArxivSource(itemKey: string): Promise<boolean> {
  try {
    return await io().exists(metaPath(itemKey));
  } catch {
    return false;
  }
}

export async function readArxivMeta(itemKey: string): Promise<ArxivMeta | null> {
  try {
    const parsed: unknown = JSON.parse(await io().readUTF8(metaPath(itemKey)));
    return parsed && typeof parsed === "object" ? (parsed as ArxivMeta) : null;
  } catch {
    return null;
  }
}

// The cleaned main-tex content for chat context, or null if not cached / no source.
export async function readArxivMainText(itemKey: string): Promise<string | null> {
  const meta = await readArxivMeta(itemKey);
  if (!meta || meta.status !== "ok") return null;
  try {
    return await io().readUTF8(
      `${arxivFolderPath(itemKey)}/source/${meta.mainTexRelPath}`,
    );
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run tests/context/arxiv-store.test.ts` — Expected: PASS. Then `npm run build` — clean.

- [ ] **Step 5: Commit.**
```bash
git add src/context/arxiv-store.ts tests/context/arxiv-store.test.ts
git commit -m "feat: add per-item arxiv source cache store"
```

---

### Task 7: `arxiv-source.ts` — fetch + extract orchestration

**Files:**
- Create: `src/context/arxiv-source.ts`

Integration glue (network); no unit test — verified by Task 10.

- [ ] **Step 1: Implement.** Create `src/context/arxiv-source.ts`:

```typescript
// Orchestrates: resolve id -> fetch e-print -> extract -> select+clean
// main.tex -> store. All failures resolve to false (caller falls back to PDF).

import { DEFAULT_CONTEXT_POLICY } from "./policy";
import { resolveArxivId, type ArxivIdFields } from "./arxiv-id";
import { extractArchive } from "./arxiv-archive";
import { findMainTex, inlineInputs, stripTexComments, type TexFile } from "./tex-clean";
import {
  writeArxivSource,
  hasArxivSource,
  type ArxivMeta,
} from "./arxiv-store";

export interface EnsureArxivArgs {
  itemKey: string;
  fields: ArxivIdFields;
  onProgress?: (msg: string) => void;
}

// Returns true when a usable arXiv source cache exists for the item after
// this call (already cached, or freshly downloaded). Never throws.
export async function ensureArxivSource(args: EnsureArxivArgs): Promise<boolean> {
  try {
    if (await hasArxivSource(args.itemKey)) return true;
    const arxivId = resolveArxivId(args.fields);
    if (!arxivId) return false;

    args.onProgress?.("下载 arXiv 源码…");
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULT_CONTEXT_POLICY.arxivFetchTimeoutMs,
    );
    let bytes: Uint8Array;
    try {
      const resp = await fetch(`https://export.arxiv.org/e-print/${arxivId}`, {
        headers: { "User-Agent": "zotero-ai-sidebar (academic use)" },
        signal: controller.signal,
      });
      if (!resp.ok) return false;
      bytes = new Uint8Array(await resp.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
    if (bytes.length > DEFAULT_CONTEXT_POLICY.maxArxivSourceBytes) return false;

    const files = await extractArchive(bytes);
    const texFiles: TexFile[] = files
      .filter((f) => /\.(tex|cls|sty|bbl)$/i.test(f.path))
      .map((f) => ({ path: f.path, text: new TextDecoder().decode(f.bytes) }));
    const main = findMainTex(texFiles);

    if (!main) {
      // No LaTeX source (e.g. PDF-only submission). Record it so we do not
      // re-download every analysis.
      await writeArxivSource(args.itemKey, [], {
        itemKey: args.itemKey,
        arxivId,
        fetchedAt: new Date().toISOString(),
        mainTexRelPath: "",
        status: "no-source",
      });
      return false;
    }

    const cleaned = stripTexComments(inlineInputs(main.text, texFiles));
    const meta: ArxivMeta = {
      itemKey: args.itemKey,
      arxivId,
      fetchedAt: new Date().toISOString(),
      mainTexRelPath: "main.tex",
      status: "ok",
    };
    // Store the raw archive files plus the cleaned main.tex (overwriting the
    // raw main entry) so readArxivMainText returns chat-ready text directly.
    const toStore = files.filter((f) => f.path !== main.path);
    toStore.push({ path: "main.tex", bytes: new TextEncoder().encode(cleaned) });
    await writeArxivSource(args.itemKey, toStore, meta);
    args.onProgress?.("arXiv 源码就绪");
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify the build.** `npm run build` — Expected: `tsc --noEmit` clean. If the Task 1 spike found `fetch` unusable, replace the `fetch(...)` block with `Zotero.HTTP.request("GET", url, { responseType: "arraybuffer" })` and adapt.

- [ ] **Step 3: Commit.**
```bash
git add src/context/arxiv-source.ts
git commit -m "feat: add arxiv source fetch + extract orchestration"
```

---

### Task 8: `zotero-source.ts` — prefer the arXiv source as full text

**Files:**
- Modify: `src/context/zotero-source.ts`

- [ ] **Step 1: Read `src/context/zotero-source.ts`** — find `getFullText(itemID)` in the `zoteroContextSource` object (it currently reads the PDF fulltext cache).

- [ ] **Step 2: Implement.** At the start of `getFullText`'s body, before the existing PDF logic, add an arXiv-source check. Add the import at the top of the file:

```typescript
import { readArxivMainText } from "./arxiv-store";
```

And the resolution itself needs the item key. Inside `getFullText(itemID)`, before reading the PDF cache:

```typescript
    const Z = getZ();
    const parent = await Z.Items.getAsync(itemID);
    const itemKey = parent && typeof parent.key === "string" ? parent.key : null;
    if (itemKey) {
      const arxivText = await readArxivMainText(itemKey);
      if (arxivText) return arxivText;
    }
```

(`getZ()` is the existing Zotero accessor in the file; reuse it. If the file's `ZoteroItem` interface lacks `key`, add `key?: string` to it.)

- [ ] **Step 3: Verify.** `npm run build` — clean. Run `npm test` — Expected: no regressions (existing `zotero-source` consumers' tests still pass; `getFullText` only gains a guarded early return).

- [ ] **Step 4: Commit.**
```bash
git add src/context/zotero-source.ts
git commit -m "feat: use cached arxiv source as full text when available"
```

---

### Task 9: `sidebar.ts` — trigger the download and show the badge

**Files:**
- Modify: `src/modules/sidebar.ts`
- Modify: `addon/content/sidebar.css`

- [ ] **Step 1: INVESTIGATE.** In `src/modules/sidebar.ts` find: (a) the analysis/send entry point where a chat turn begins and the current item is known; (b) how the current item's metadata fields (`extra`, `url`, `DOI`, `archiveID`) can be read — via `getZoteroItem(itemID)` then `item.getField("extra")` etc.; (c) where the header row that shows the item title + `Item ID` is rendered.

- [ ] **Step 2: Trigger the download.** At the analysis entry point, before context is built, call (and `await`) a new helper:

```typescript
// TEMPORARY scaffolding note: this runs once per item; the result is cached.
async function ensureArxivSourceForItem(itemID: number): Promise<boolean> {
  const item = getZoteroItem(itemID);
  if (!item) return false;
  return ensureArxivSource({
    itemKey: item.key,
    fields: {
      extra: item.getField?.("extra") || undefined,
      url: item.getField?.("url") || undefined,
      doi: item.getField?.("DOI") || undefined,
      archiveID: item.getField?.("archiveID") || undefined,
    },
  });
}
```
Import `ensureArxivSource` from `../context/arxiv-source`. Await it at analysis start; its boolean result drives the badge (Step 3). On `false`, analysis proceeds unchanged (PDF flow).

- [ ] **Step 3: Render the badge.** In the header-row rendering, when `ensureArxivSourceForItem` returned `true` for the active item, append a small static chip element next to the `Item ID` text:

```typescript
const arxivBadge = doc.createElement("span");
arxivBadge.className = "arxiv-source-badge";
arxivBadge.textContent = "LaTeX 源";
arxivBadge.title = "正在使用 arXiv LaTeX 源码分析(公式精确)";
// append to the same row element that holds the "Item ID" label
```

- [ ] **Step 4: CSS.** In `addon/content/sidebar.css` add:

```css
.arxiv-source-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #e8f3ee;
  color: #2f6f4f;
  font-size: 11px;
  font-weight: 700;
}
```

- [ ] **Step 5: Verify.** `npm run build` — clean.

- [ ] **Step 6: Commit.**
```bash
git add src/modules/sidebar.ts addon/content/sidebar.css
git commit -m "feat: auto-fetch arxiv source on analysis and badge the header"
```

---

### Task 10: Manual end-to-end verification

A procedure, not TDD.

- [ ] **Step 1: Install.**
```bash
npm run build
cp .scaffold/build/zotero-ai-sidebar.xpi /home/qwer/.zotero/zotero/24q8duho.default/extensions/zotero-ai-sidebar@local.xpi
```
Restart Zotero.

- [ ] **Step 2: Run.** Open the π0.5 item (arXiv 2504.16054), open the AI sidebar, start an analysis. Confirm: a brief "下载 arXiv 源码…" progress, then the header shows the **`LaTeX 源`** badge.

- [ ] **Step 3: Verify the cache.** Check `~/Zotero/zotero-ai-sidebar/arxiv/<itemKey>/`: `source/main.tex` exists and contains real LaTeX (`\begin{align}` with `\mathbb{E}_{\mathcal{D},\tau,\omega}`); `meta.json` has `status: "ok"`. Confirm no `.tar`/`.gz` file was left anywhere.

- [ ] **Step 4: Verify the analysis.** Ask the model about Equation (1) / the loss. It should answer from exact LaTeX — no `f l θ` garble.

- [ ] **Step 5: Fallback check.** On a non-arXiv item, confirm no badge, no download, analysis works as before.

- [ ] **Step 6: Record the outcome** and report to the user.

---

## Self-Review

- **Spec coverage:** §4 flow → Tasks 7+8+9; §5 storage → Task 6; §7 id resolution → Task 3; §8 download/extract → Tasks 1+5+7; §9 main.tex select+clean → Task 4 (+ Task 7 wiring); §10 context integration → Task 8; §11 badge → Task 9; §12 fallback → every task's failure-path returns false/null; §13 caching → `hasArxivSource` short-circuit in Task 7; §14 testing → Tasks 3–6 unit tests + Task 10 manual. §15 Phase 2 (figures) correctly absent.
- **Placeholder scan:** no TBD/TODO; every code step has complete code. Task 9 names existing sidebar helpers to be located in Step 1 (flagged inline) — investigation, not a placeholder.
- **Type consistency:** `ArchiveFile {path,bytes}` (Task 5) consumed by `writeArxivSource` (Task 6) and `extractArchive` (Task 7); `TexFile {path,text}` (Task 4) used in Task 7; `ArxivMeta` (Task 6) built in Task 7; `ArxivIdFields` (Task 3) used by `ensureArxivSource` (Task 7) and the sidebar (Task 9); `resolveArxivId`/`findMainTex`/`stripTexComments`/`inlineInputs`/`gunzip`/`untar`/`extractArchive`/`ensureArxivSource`/`readArxivMainText` names are consistent across tasks.
