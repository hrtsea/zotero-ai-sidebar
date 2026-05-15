import { describe, expect, it } from "vitest";
import {
  pdfQuoteBlockLocateText,
  pdfQuoteBlocks,
  pdfQuoteLinkKey,
} from "../../src/modules/pdf-quote-utils";

describe("pdf quote DOM helpers", () => {
  it("uses only original quote lines before translations", () => {
    const block = document.createElement("blockquote");
    block.innerHTML =
      "Original claim line one.<br>Original claim line two.<br>译：中文翻译。";

    expect(pdfQuoteBlockLocateText(block)).toBe(
      "Original claim line one.\nOriginal claim line two.",
    );
  });

  it("finds quote block candidates and skips links", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <blockquote>This quote is long enough to become a PDF quote target.</blockquote>
      <a><blockquote>This linked quote should be ignored completely.</blockquote></a>
    `;

    expect(pdfQuoteBlocks(root, 32)).toHaveLength(1);
  });

  it("normalizes quote keys for prelocated links", () => {
    expect(pdfQuoteLinkKey("  A\n  Quote   Here ")).toBe("a quote here");
  });
});
