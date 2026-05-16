import { splitSentences } from "../translate/sentence-splitter";

const DEFAULT_PDF_QUOTE_MIN_CHARS = 32;
const PDF_QUOTE_LONG_CHARS = 80;

// Minimum fuzzy-match confidence before a "查看原文" click jumps the reader.
// A long passage can absorb noise — dropped inline citations like
// "(Author et al., 2024)", flattened math symbols — and still pinpoint the
// right place unambiguously, so its bar is lower. A short quote cannot: at
// 32 chars a 0.7 score is only ~22 matching characters, easily coincidental,
// so short quotes stay strict.
export function pdfQuoteConfidenceFloor(quoteLength: number): number {
  return quoteLength >= PDF_QUOTE_LONG_CHARS ? 0.7 : 0.85;
}

export function pdfQuoteLocateCandidates(
  rawText: string,
  minChars = DEFAULT_PDF_QUOTE_MIN_CHARS,
): string[] {
  const compact = stripOuterQuoteMarks(compactPdfQuoteText(rawText));
  const sentences = splitSentences(compact)
    .map((span) => stripOuterQuoteMarks(compactPdfQuoteText(span.text)))
    .filter((text) => text.length >= minChars);
  const candidates = [
    compact,
    compactPdfQuoteText(rawText),
    ...sentences,
    ...ellipsisFragments(compact, minChars),
  ].filter((text) => text.length >= minChars);
  return [...new Set(candidates)];
}

// Models elide text mid-quote with "..." / "…". The elided gap defeats both
// exact and fuzzy matching against the PDF, but each non-elided fragment is
// usually still verbatim — so expose the substantial fragments (longest
// first, since a longer fragment locates less ambiguously) as extra
// candidates. Returns nothing when the quote has no ellipsis.
function ellipsisFragments(compact: string, minChars: number): string[] {
  if (!/\.{3,}|…/.test(compact)) return [];
  return compact
    .split(/\s*(?:\.{3,}|…)\s*/)
    .map((part) => stripOuterQuoteMarks(part.trim()))
    .filter((part) => part.length >= minChars)
    .sort((a, b) => b.length - a.length);
}

export function firstPdfQuoteLocateCandidate(
  rawText: string,
  minChars = DEFAULT_PDF_QUOTE_MIN_CHARS,
): string {
  return pdfQuoteLocateCandidates(rawText, minChars)[0] ?? "";
}

export function pdfQuoteBlocks(
  root: HTMLElement,
  minChars = DEFAULT_PDF_QUOTE_MIN_CHARS,
): HTMLElement[] {
  return (Array.from(root.querySelectorAll("blockquote")) as HTMLElement[])
    .filter((block) => {
      if (block.closest("a")) return false;
      const quote = firstPdfQuoteLocateCandidate(
        pdfQuoteBlockLocateText(block),
        minChars,
      );
      return !!quote && quote.length >= minChars;
    });
}

export function pdfQuoteBlockLocateText(block: HTMLElement): string {
  const lines: string[] = [];
  const buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("").replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
    buffer.length = 0;
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buffer.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.tagName.toLowerCase() === "br") {
      flush();
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      if (child) walk(child);
    }
  };
  for (const child of Array.from(block.childNodes)) {
    if (child) walk(child);
  }
  flush();
  if (!lines.length) return (block.textContent ?? "").trim();
  const kept: string[] = [];
  for (const line of lines) {
    if (/^(译|翻译|译文|中文译文|译注|注释|说明|解读)\s*[:：]/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

export function pdfQuoteLinkKey(quote: string): string {
  return quote.replace(/\s+/g, " ").trim().toLowerCase();
}

function compactPdfQuoteText(value: string): string {
  return value
    .replace(/^原文[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOuterQuoteMarks(value: string): string {
  let text = value.trim();
  const pairs: Array<[string, string]> = [
    ["“", "”"],
    ["‘", "’"],
    ['"', '"'],
    ["'", "'"],
  ];
  let changed = true;
  while (changed && text.length > 1) {
    changed = false;
    for (const [left, right] of pairs) {
      if (text.startsWith(left) && text.endsWith(right)) {
        text = text.slice(left.length, text.length - right.length).trim();
        changed = true;
      }
    }
  }
  return text;
}
