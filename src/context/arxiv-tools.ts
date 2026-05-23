// Helpers and side-channel utilities for the model-driven arXiv section /
// figure tools. The tool literals themselves are registered alongside the
// other Zotero tools in `agent-tools.ts`; this file holds the per-item
// resolution + the TOC-front-block builder so both can be reused without
// growing the already-large agent-tools file further.

import type { ToolFactoryOptions } from "./agent-tools";
import type { MessageImage } from "../providers/types";
import {
  hasArxivSource,
  readArxivMainText,
  readArxivFigure,
  readArxivBibliographyFiles,
  type ArxivTextFile,
} from "./arxiv-store";
import {
  parseSections,
  buildToc,
  formatTocBlock,
  type TexSection,
} from "./tex-sections";

interface ZoteroItemShape {
  key?: string;
}
interface ZoteroGlobalShape {
  Items?: { get?: (id: number) => ZoteroItemShape | null };
}

// The Zotero parent-item key for the current tool session's item. Returns
// null when no item is selected, the item does not exist, or it has no
// key. Zotero items always carry an 8-char key, but the typing is
// defensive — `Items.get` may not exist in odd runtimes.
export function currentItemKey(options: ToolFactoryOptions): string | null {
  if (options.itemID == null) return null;
  const Z = (globalThis as unknown as { Zotero?: ZoteroGlobalShape }).Zotero;
  const item = Z?.Items?.get?.(options.itemID);
  return typeof item?.key === "string" ? item.key : null;
}

export interface LoadedArxivSections {
  itemKey: string;
  sections: TexSection[];
}

// Load the parsed sections of the current item's cached arXiv source.
// Returns null when no arXiv source is cached for the item (caller falls
// back cleanly — e.g. by refusing the tool call with an explanation).
export async function loadArxivSections(
  options: ToolFactoryOptions,
): Promise<LoadedArxivSections | null> {
  const itemKey = currentItemKey(options);
  if (!itemKey) return null;
  if (!(await hasArxivSource(itemKey))) return null;
  const text = await readArxivMainText(itemKey);
  if (!text) return null;
  return { itemKey, sections: parseSections(text) };
}

export async function loadArxivBibliography(
  options: ToolFactoryOptions,
): Promise<{ itemKey: string; files: ArxivTextFile[] } | null> {
  const itemKey = currentItemKey(options);
  if (!itemKey) return null;
  if (!(await hasArxivSource(itemKey))) return null;
  const files = await readArxivBibliographyFiles(itemKey);
  return { itemKey, files };
}

// Build the compact TOC front-block for an item, or null when no arXiv
// source is cached. This is what `resolvePinnedFullText` returns in place
// of the full LaTeX source when an arXiv cache exists, so each turn's
// static prefix stays small (~1 KB) AND byte-stable across turns (good
// for the prompt cache). The model fetches actual section bodies via the
// `arxiv_get_section` tool on demand.
export async function buildArxivTocFrontBlock(
  itemID: number | null,
): Promise<string | null> {
  if (itemID == null) return null;
  // Inline the key lookup — buildArxivTocFrontBlock is called from the
  // sidebar (outside a ToolFactoryOptions context).
  const Z = (globalThis as unknown as { Zotero?: ZoteroGlobalShape }).Zotero;
  const item = Z?.Items?.get?.(itemID);
  const itemKey = typeof item?.key === "string" ? item.key : null;
  if (!itemKey) return null;
  if (!(await hasArxivSource(itemKey))) return null;
  const text = await readArxivMainText(itemKey);
  if (!text) return null;
  const toc = buildToc(parseSections(text));
  return formatTocBlock(toc);
}

// Encode a binary buffer as base64 in chunks. `btoa` is a runtime global
// in both Zotero (Gecko) and Node 16+, so the encoder works on the plugin
// and in vitest. Chunking prevents call-stack blow-ups on multi-MB images
// from `String.fromCharCode.apply(null, …)`.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as number[],
    );
  }
  return (globalThis as { btoa: (s: string) => string }).btoa(binary);
}

// Load a cached figure for the current item and shape it as a MessageImage
// ready for the multimodal follow-up turn the provider adapter emits.
// Returns null when no arXiv source is cached, no matching raster figure
// was found, or the figure is vector (.pdf/.eps) — see `matchFigureFile`.
export async function loadArxivFigureAsImage(
  options: ToolFactoryOptions,
  name: string,
): Promise<{ image: MessageImage; path: string } | null> {
  const itemKey = currentItemKey(options);
  if (!itemKey) return null;
  const figure = await readArxivFigure(itemKey, name);
  if (!figure) return null;
  const dataUrl = `data:${figure.mediaType};base64,${bytesToBase64(figure.bytes)}`;
  const id = figure.path.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return {
    path: figure.path,
    image: {
      id,
      name: figure.path,
      marker: `[arxiv:${figure.path}]`,
      mediaType: figure.mediaType,
      dataUrl,
      size: figure.bytes.length,
    },
  };
}
