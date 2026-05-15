type PdfRectTuple = [number, number, number, number];

export type ReadingRouteReferenceKind = "figure" | "table" | "equation";

export type ReadingRouteHighlightTone =
  | "yellow"
  | "red"
  | "blue"
  | "green"
  | "purple"
  | "orange";

export interface ReadingRouteReferenceParts {
  kind: ReadingRouteReferenceKind;
  number: string;
  locateNumber?: string;
}

export interface ReadingRouteLocateResult {
  pageIndex: number;
  pageLabel: string;
  rects: PdfRectTuple[];
  matchedText?: string;
  anchorOffset?: number;
  headOffset?: number;
}

interface ReadingRoutePdfLocator {
  pageCount: number;
  locate(
    text: string,
    options?: { minConfidence?: number; pageIndex?: number },
  ): Promise<ReadingRouteLocateResult | null>;
  getPageContent(pageIndex: number): Promise<{ pageText?: string } | null>;
}

const READING_ROUTE_HIGHLIGHT_STYLES: Record<
  ReadingRouteHighlightTone,
  string
> = {
  yellow:
    "margin:0 2px;padding:1px 4px;background-color:rgba(255,212,0,.36) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
  red:
    "margin:0 2px;padding:1px 4px;background-color:rgba(255,102,102,.28) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
  blue:
    "margin:0 2px;padding:1px 4px;background-color:rgba(46,168,229,.28) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
  green:
    "margin:0 2px;padding:1px 4px;background-color:rgba(95,178,54,.28) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
  purple:
    "margin:0 2px;padding:1px 4px;background-color:rgba(162,138,229,.28) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
  orange:
    "margin:0 2px;padding:1px 4px;background-color:rgba(241,152,55,.32) !important;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone;",
};

export function readingRouteReferenceLabels(markdown: string): string[] {
  const labels = new Map<string, string>();
  const pattern =
    /\b(?:Fig(?:ure)?\.?|Table)\s*\d+[A-Za-z]?\b|\b(?:Eq(?:uation)?\.?|Equation)\s*\(?\d+[A-Za-z]?\)?(?:\s*[-–—]\s*\(?\d+[A-Za-z]?\)?)?/gi;
  for (const match of markdown.matchAll(pattern)) {
    const label = canonicalReadingRouteReference(match[0]);
    if (label) labels.set(readingRouteReferenceKey(label), label);
  }
  return Array.from(labels.values());
}

export async function locateReadingRouteReference(
  locator: ReadingRoutePdfLocator,
  label: string,
): Promise<ReadingRouteLocateResult | null> {
  const parsed = readingRouteReferenceParts(label);
  if (parsed?.kind === "figure" || parsed?.kind === "table") {
    const caption = await locateReadingRouteCaptionReference(locator, parsed);
    if (caption) return caption;
  }
  for (const candidate of readingRouteLocateCandidates(label)) {
    const result = await locator.locate(candidate, { minConfidence: 0.92 });
    if (result) return result;
  }
  return null;
}

export function readingRouteReferenceKindFromData(
  value: string | undefined,
): ReadingRouteReferenceKind | undefined {
  return value === "figure" || value === "table" || value === "equation"
    ? value
    : undefined;
}

export function readingRouteReferenceKey(value: string): string {
  const canonical = canonicalReadingRouteReference(value);
  return canonical.toLowerCase().replace(/\s+/g, " ");
}

export function canonicalReadingRouteReference(value: string): string {
  const parsed = readingRouteReferenceParts(value);
  if (!parsed) return value.trim();
  const label =
    parsed.kind === "figure"
      ? "Figure"
      : parsed.kind === "table"
        ? "Table"
        : "Eq.";
  return `${label} ${parsed.number}`;
}

export function readingRouteReferenceParts(
  value: string,
): ReadingRouteReferenceParts | null {
  const match = value
    .trim()
    .match(
      /^(Fig(?:ure)?\.?|Table|Eq(?:uation)?\.?|Equation)\s*\(?(\d+[A-Za-z]?)\)?(?:\s*[-–—]\s*\(?(\d+[A-Za-z]?)\)?)?$/i,
    );
  if (!match) return null;
  const kind = /^fig/i.test(match[1]!)
    ? "figure"
    : /^table/i.test(match[1]!)
      ? "table"
      : "equation";
  const number = match[3] ? `${match[2]}-${match[3]}` : match[2]!;
  return {
    kind,
    number,
    locateNumber: match[2]!,
  };
}

export function highlightReadingRouteKeyBullets(root: HTMLElement): void {
  applyReadingRouteSemanticLabelTones(root);
  const headings = Array.from(root.querySelectorAll("h2,h3,h4")) as HTMLElement[];
  for (const heading of headings) {
    const title = heading.textContent?.trim() ?? "";
    const bullets = readingRouteSectionBullets(heading);
    if (!bullets.length) continue;

    if (/A\.\s*一句话定位/.test(title)) {
      for (const li of bullets.slice(0, 3)) {
        const text = li.textContent ?? "";
        if (text.startsWith("一句话定位"))
          applyReadingRouteBulletLabelTone(li, "blue");
      }
      continue;
    }

    if (/B\.\s*Context/.test(title)) {
      for (const li of bullets) {
        const text = li.textContent ?? "";
        if (text.startsWith("直接前作")) {
          applyReadingRouteNestedListTones(li);
        }
      }
      continue;
    }

    if (/C\.\s*本文方案/.test(title)) {
      for (const li of bullets) {
        const text = li.textContent ?? "";
        if (text.startsWith("核心想法"))
          applyReadingRouteBulletLabelTone(li, "green");
        else if (text.startsWith("关键改动"))
          applyReadingRouteBulletLabelTone(li, "green");
        else if (text.startsWith("声称效果"))
          applyReadingRouteBulletLabelTone(li, "purple");
        else if (text.startsWith("第二遍证据锚点"))
          applyReadingRouteBulletLabelTone(li, "orange");
      }
      continue;
    }

    if (/D\.\s*Five Cs/.test(title)) {
      for (const li of bullets) {
        const text = li.textContent ?? "";
        if (text.startsWith("Category"))
          applyReadingRouteBulletLabelTone(li, "blue");
        else if (text.startsWith("Context"))
          applyReadingRouteBulletLabelTone(li, "yellow");
        else if (text.startsWith("Correctness"))
          applyReadingRouteBulletLabelTone(li, "red");
        else if (text.startsWith("Contributions"))
          applyReadingRouteBulletLabelTone(li, "purple");
      }
      continue;
    }

    if (/E\.\s*第一遍决策/.test(title)) {
      for (const li of bullets) {
        const text = li.textContent ?? "";
        if (text.startsWith("决策"))
          applyReadingRouteBulletLabelTone(li, "purple");
        else if (text.startsWith("理由"))
          applyReadingRouteBulletLabelTone(li, "red");
        else if (text.startsWith("下一步"))
          applyReadingRouteBulletLabelTone(li, "orange");
      }
    }
  }
}

function locateReadingRouteCaptionReference(
  locator: ReadingRoutePdfLocator,
  parsed: ReadingRouteReferenceParts,
): Promise<ReadingRouteLocateResult | null> {
  return bestReadingRouteCaptionMatch(locator, parsed).then(async (match) => {
    if (!match) return null;

    for (const snippet of readingRouteCaptionSnippets(
      match.pageText,
      match.index,
    )) {
      const result = await locator.locate(snippet, {
        minConfidence: 0.88,
        pageIndex: match.pageIndex,
      });
      if (result) return result;
    }
    return null;
  });
}

async function bestReadingRouteCaptionMatch(
  locator: ReadingRoutePdfLocator,
  parsed: ReadingRouteReferenceParts,
): Promise<{ pageIndex: number; pageText: string; index: number } | null> {
  let best: { pageIndex: number; pageText: string; index: number; score: number }
    | null = null;
  const pattern = readingRouteCaptionPattern(parsed);
  if (!pattern) return null;
  for (let pageIndex = 0; pageIndex < locator.pageCount; pageIndex++) {
    const page = await locator.getPageContent(pageIndex);
    const pageText = page?.pageText ?? "";
    if (!pageText) continue;
    pattern.lastIndex = 0;
    for (const match of pageText.matchAll(pattern)) {
      const index = match.index ?? 0;
      const score = readingRouteCaptionMatchScore(pageText, index, match[0]);
      if (!best || score > best.score) {
        best = { pageIndex, pageText, index, score };
      }
    }
  }
  return best;
}

function readingRouteCaptionPattern(
  parsed: ReadingRouteReferenceParts,
): RegExp | null {
  const number = escapeRegExp(parsed.locateNumber ?? parsed.number);
  if (parsed.kind === "figure") {
    return new RegExp(`\\b(?:Fig\\.?|Figure)\\s*${number}\\s*[:.]`, "gi");
  }
  if (parsed.kind === "table") {
    return new RegExp(`\\bTable\\s*${number}\\s*[:.]`, "gi");
  }
  return null;
}

function readingRouteCaptionMatchScore(
  pageText: string,
  index: number,
  rawMatch: string,
): number {
  const lineStart = pageText.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const linePrefix = pageText.slice(lineStart, index).trim();
  const next = pageText.slice(index + rawMatch.length, index + rawMatch.length + 80);
  let score = 0;
  if (!linePrefix) score += 8;
  if (rawMatch.trim().endsWith(":")) score += 5;
  if (/^fig/i.test(rawMatch)) score += 2;
  if (/[A-Za-z]{4,}/.test(next)) score += 1;
  return score;
}

function readingRouteCaptionSnippets(pageText: string, index: number): string[] {
  const snippets: string[] = [];
  for (const length of [140, 100, 70, 40]) {
    const snippet = pageText.slice(index, index + length).replace(/\s+/g, " ").trim();
    if (snippet.length >= 12) snippets.push(snippet);
  }
  return uniqueStrings(snippets);
}

function readingRouteLocateCandidates(label: string): string[] {
  const parsed = readingRouteReferenceParts(label);
  if (!parsed) return [label];
  const number = parsed.locateNumber ?? parsed.number;
  if (parsed.kind === "figure") {
    return uniqueStrings([
      `Fig. ${number}:`,
      `Fig ${number}:`,
      `Figure ${number}:`,
      `Fig. ${number}.`,
      `Fig ${number}.`,
      `Figure ${number}.`,
      `Fig. ${number}`,
      `Fig ${number}`,
      `Figure ${number}`,
    ]);
  }
  if (parsed.kind === "table") {
    return uniqueStrings([
      `Table ${number}:`,
      `Table ${number}.`,
      `Table ${number}`,
    ]);
  }
  return uniqueStrings(
    [
      `Equation ${number}`,
      `Equation (${number})`,
      `Eq. ${number}`,
      `Eq. (${number})`,
      `Eq ${number}`,
      `Eq (${number})`,
      `(${number})`,
    ].flatMap((base) => [`${base}:`, `${base}.`, base]),
  );
}

function applyReadingRouteSemanticLabelTones(root: HTMLElement): void {
  const items = Array.from(root.querySelectorAll("li")) as HTMLLIElement[];
  for (const li of items) {
    const text = li.textContent ?? "";
    const tone = readingRouteSemanticTone(text);
    if (!tone) continue;
    applyReadingRouteBulletLabelTone(li, tone);
  }
}

function readingRouteSectionBullets(heading: HTMLElement): HTMLLIElement[] {
  const bullets: HTMLLIElement[] = [];
  const headingLevel = Number(heading.tagName.slice(1));
  for (
    let node = heading.nextElementSibling;
    node;
    node = node.nextElementSibling
  ) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) && Number(tag.slice(1)) <= headingLevel) break;
    if (tag === "ul" || tag === "ol") {
      bullets.push(
        ...(Array.from(node.children).filter(
          (child) => child.tagName.toLowerCase() === "li",
        ) as HTMLLIElement[]),
      );
    }
  }
  return bullets;
}

function applyReadingRouteBulletLabelTone(
  li: HTMLLIElement,
  tone: ReadingRouteHighlightTone,
): void {
  const target = firstInlineTextNode(li);
  if (!target) return;
  if (target.parentElement?.closest(".zai-reading-route-key")) return;
  const text = target.textContent ?? "";
  const match = text.match(/^(\s*[^：:]{1,24}[：:])/);
  if (!match?.[1]) return;
  const doc = li.ownerDocument;
  if (!doc) return;
  const marker = doc.createElement("mark");
  marker.className = "zai-reading-route-key";
  marker.setAttribute("data-zai-reading-route-tone", tone);
  marker.setAttribute("style", READING_ROUTE_HIGHLIGHT_STYLES[tone]);
  marker.textContent = match[1];
  const fragment = doc.createDocumentFragment();
  fragment.append(marker, doc.createTextNode(text.slice(match[1].length)));
  target.parentNode?.replaceChild(fragment, target);
}

function applyReadingRouteNestedListTones(container: HTMLLIElement): void {
  for (const child of Array.from(container.children)) {
    if (child.nodeType !== 1) continue;
    const tag = (child as Element).tagName.toLowerCase();
    if (tag !== "ul" && tag !== "ol") continue;
    for (const li of Array.from((child as Element).children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const tone = readingRouteSemanticTone(li.textContent ?? "");
      if (!tone) continue;
      applyReadingRouteBulletLabelTone(li as HTMLLIElement, tone);
    }
  }
}

function readingRouteSemanticTone(
  text: string,
): ReadingRouteHighlightTone | null {
  const normalized = text.trimStart();
  if (/^(基础|前作)[：:]/.test(normalized)) return "yellow";
  if (/^(限制|批评|风险|问题|缺口)[：:]/.test(normalized)) return "red";
  if (/^(数据|来源)[：:]/.test(normalized)) return "purple";
  if (/^(机制|方法|实现)[：:]/.test(normalized)) return "green";
  if (/^(效果|结果|收益|提升)[：:]/.test(normalized)) return "orange";
  if (/^(关系|作用|关联)[：:]/.test(normalized)) return "blue";
  return null;
}

function firstInlineTextNode(root: HTMLElement): Text | null {
  const doc = root.ownerDocument;
  if (!doc) return null;
  const parentList = root.closest("ul,ol");
  const nodeFilter = doc.defaultView?.NodeFilter;
  const showText = nodeFilter?.SHOW_TEXT ?? 4;
  const filterAccept = nodeFilter?.FILTER_ACCEPT ?? 1;
  const filterReject = nodeFilter?.FILTER_REJECT ?? 2;
  const walker = doc.createTreeWalker(
    root,
    showText,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return filterReject;
        if (parent.closest("ul,ol") !== parentList) {
          return filterReject;
        }
        return node.textContent?.trim() ? filterAccept : filterReject;
      },
    },
  );
  return walker.nextNode() as Text | null;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
