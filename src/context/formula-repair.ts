import type { ContextPolicy } from "./policy";
import { DEFAULT_CONTEXT_POLICY } from "./policy";
import { getSharedPdfLocator } from "./pdf-locator";
import { transcribeFigures } from "./transcribe";
import { writeRepairedPaper, type PaperBuildMeta } from "./paper-markdown-store";
import type { ModelPreset } from "../settings/types";

export interface GarbledFormulaRun {
  start: number;
  end: number;
  text: string;
  score: number;
  lines: number;
  reasons: string[];
}

interface LineInfo {
  text: string;
  start: number;
  end: number;
  compactLength: number;
  short: boolean;
  mathLike: boolean;
}

// Detects places where a PDF text cache likely flattened a displayed formula
// into vertical glyph fragments (`f l` on one line, `theta` on the next).
// This is intentionally mechanical: it does not infer user intent or attempt
// to reconstruct LaTeX. Later repair stages can use these ranges to crop the
// original PDF image and ask a vision-capable parser for transcription.
export function detectGarbledFormulaRuns(
  text: string,
  policy: ContextPolicy = DEFAULT_CONTEXT_POLICY,
): GarbledFormulaRun[] {
  const lines = splitLinesWithOffsets(text, policy);
  const runs: GarbledFormulaRun[] = [];
  let pending: LineInfo[] = [];

  const flush = () => {
    const run = buildRun(pending, policy);
    if (run) runs.push(run);
    pending = [];
  };

  for (const line of lines) {
    if (!line.text.trim()) {
      flush();
      continue;
    }
    if (line.mathLike) {
      pending.push(line);
    } else {
      flush();
    }
  }
  flush();

  return mergeAdjacentRuns(runs, text);
}

function buildRun(
  lines: LineInfo[],
  policy: ContextPolicy,
): GarbledFormulaRun | null {
  if (lines.length < policy.garbledFormulaMinRunLines) return null;

  const shortLines = lines.filter((line) => line.short).length;
  const mathGlyphLines = lines.filter((line) => hasMathGlyph(line.text)).length;
  const shortFraction = shortLines / lines.length;
  const mathLineFraction = mathGlyphLines / lines.length;

  const reasons: string[] = [];
  if (mathLineFraction >= policy.garbledFormulaMinMathLineFraction) {
    reasons.push(`math-glyph-lines=${mathGlyphLines}/${lines.length}`);
  }
  if (shortFraction >= policy.garbledFormulaMinShortLineFraction) {
    reasons.push(`short-lines=${shortLines}/${lines.length}`);
  }
  if (!reasons.length) return null;

  const start = lines[0].start;
  const end = lines[lines.length - 1].end;
  const score = Number(
    Math.min(1, 0.55 * mathLineFraction + 0.45 * shortFraction).toFixed(3),
  );
  return {
    start,
    end,
    text: lines.map((line) => line.text).join("\n"),
    score,
    lines: lines.length,
    reasons,
  };
}

function splitLinesWithOffsets(
  text: string,
  policy: ContextPolicy,
): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    if (index < text.length && text[index] !== "\n") continue;
    const raw = text.slice(start, index);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push(lineInfo(line, start, start + line.length, policy));
    start = index + 1;
  }
  return lines;
}

function lineInfo(
  text: string,
  start: number,
  end: number,
  policy: ContextPolicy,
): LineInfo {
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, "");
  const compactLength = compact.length;
  const short =
    compactLength > 0 && compactLength <= policy.garbledFormulaShortLineChars;
  return {
    text,
    start,
    end,
    compactLength,
    short,
    mathLike: isMathLikeFragment(trimmed, compact, short, policy),
  };
}

function isMathLikeFragment(
  trimmed: string,
  compact: string,
  short: boolean,
  policy: ContextPolicy,
): boolean {
  if (!trimmed) return false;
  if (compact.length > policy.garbledFormulaMaxLineChars) return false;
  if (short) return true;
  if (hasMathGlyph(trimmed)) return true;
  if (isBracketOnly(compact)) return true;

  // ASCII-only fragments such as `(x1:M , f l` lost the superscript/subscript
  // placement but still carry dense formula punctuation and no prose words.
  return (
    compact.length <= policy.garbledFormulaAsciiLineMaxChars &&
    formulaPunctuationCount(compact) >=
      policy.garbledFormulaMinFormulaPunctuation &&
    longWordCount(trimmed) === 0
  );
}

function hasMathGlyph(text: string): boolean {
  return /[α-ωΑ-Ω∥∑∫√≤≥≈∞⊗∈∉∂∇∀∃±×÷−]/.test(text);
}

function isBracketOnly(compact: string): boolean {
  return /^[()[\]{}|∥]+$/.test(compact);
}

function formulaPunctuationCount(compact: string): number {
  let count = 0;
  for (const char of compact) {
    if ("_=+-−:,.()[]{}|∥^".includes(char)) count++;
  }
  return count;
}

function longWordCount(text: string): number {
  return text.match(/[A-Za-z]{4,}/g)?.length ?? 0;
}

function mergeAdjacentRuns(
  runs: GarbledFormulaRun[],
  source: string,
): GarbledFormulaRun[] {
  if (runs.length < 2) return runs;
  const merged: GarbledFormulaRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (!previous || source.slice(previous.end, run.start).trim()) {
      merged.push(run);
      continue;
    }
    previous.end = run.end;
    previous.text = source.slice(previous.start, previous.end);
    previous.score = Math.max(previous.score, run.score);
    previous.lines += run.lines;
    previous.reasons = [...new Set([...previous.reasons, ...run.reasons])];
  }
  return merged;
}

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

export interface BuildRepairedPaperArgs {
  itemKey: string;
  fullText: string;
  reader: unknown;
  preset: ModelPreset;
  pdf: { attachmentID: number; byteSize: number; mtimeMs: number };
  pluginVersion: string;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onTrace?: (msg: string) => void;
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(binary)}`;
}

// Detect -> locate -> render -> transcribe -> assemble -> write. Returns the
// cache folder path, or null when there is nothing to repair / build failed.
export async function buildRepairedPaper(
  args: BuildRepairedPaperArgs,
): Promise<string | null> {
  const runs = detectGarbledFormulaRuns(args.fullText);
  args.onTrace?.(`detect: ${runs.length} runs (fullText ${args.fullText.length} chars)`);
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
    args.onTrace?.(`run ${i}: text=${JSON.stringify(run.text.slice(0, 160))}`);
    const located = await locator.locate(run.text);
    args.onTrace?.(
      `run ${i}: locate ${
        located
          ? `page=${located.pageIndex} conf=${located.confidence} rects=${located.rects.length}`
          : "NULL"
      }`,
    );
    if (!located) continue;
    if (located.confidence < DEFAULT_CONTEXT_POLICY.minLocateConfidence) {
      lowConfidence++;
    }
    const png = await locator.renderRegion(
      located.pageIndex,
      located.rects,
      (m) => args.onTrace?.(`run ${i} render: ${m}`),
    );
    args.onTrace?.(`run ${i}: render ${png ? `${png.length}B` : "NULL"}`);
    if (!png) continue;
    const figureName = `eq-p${located.pageIndex + 1}-${i + 1}.png`;
    figures.push({ name: figureName, png });
    transcribeInput.push({
      id: figureName.replace(/\.png$/, ""),
      pngDataUrl: bytesToPngDataUrl(png),
    });
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
  args.onTrace?.(`repairs: ${repairs.length}`);
  if (!repairs.length) return null;

  const latexById = await transcribeFigures(
    transcribeInput,
    args.preset,
    args.signal,
    (m) => args.onTrace?.(`transcribe: ${m}`),
  );
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
