import { describe, expect, it } from "vitest";
import {
  pdfQuoteBlockLocateText,
  pdfQuoteBlocks,
  pdfQuoteConfidenceFloor,
  pdfQuoteLinkKey,
  pdfQuoteLocateCandidates,
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

describe("pdf quote locate candidates", () => {
  it("offers each side of an elided '...' quote as a verbatim candidate", () => {
    const candidates = pdfQuoteLocateCandidates(
      "Additionally, that the memory tokens ... are long and hurt the overall efficiency.",
      32,
    );
    // The elided gap defeats matching; each clean side must be its own
    // candidate so the verbatim half can still locate.
    expect(candidates).toContain("Additionally, that the memory tokens");
    expect(candidates).toContain("are long and hurt the overall efficiency.");
  });

  it("splits a '...' with no surrounding spaces", () => {
    const candidates = pdfQuoteLocateCandidates(
      "these coarse spatial memory tokens...are concatenated with object pointer tokens",
      32,
    );
    expect(candidates).toContain("these coarse spatial memory tokens");
    expect(candidates).toContain("are concatenated with object pointer tokens");
  });

  it("leaves a quote with no ellipsis unchanged", () => {
    const text = "Key components of SAM 2 drive its segmentation performance.";
    expect(pdfQuoteLocateCandidates(text, 32)).toContain(text);
  });
});

describe("pdf quote confidence floor", () => {
  it("relaxes the bar for long passages and stays strict for short ones", () => {
    // A long quote can absorb dropped-citation / math noise unambiguously.
    expect(pdfQuoteConfidenceFloor(200)).toBeLessThan(
      pdfQuoteConfidenceFloor(40),
    );
    // Short quotes must be near-exact so a click never lands on coincidence.
    expect(pdfQuoteConfidenceFloor(40)).toBeGreaterThanOrEqual(0.85);
    expect(pdfQuoteConfidenceFloor(200)).toBeGreaterThan(0.5);
  });
});
