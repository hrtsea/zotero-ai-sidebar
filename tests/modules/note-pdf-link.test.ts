import { describe, expect, it } from "vitest";
import {
  pdfQuoteDataFromNoteHref,
  pdfQuoteFromNoteHref,
  pdfQuoteFromNoteLink,
} from "../../src/modules/note-pdf-link";

describe("note-pdf-link quote payloads", () => {
  it("keeps legacy plain quote links working", () => {
    const href = "#zaiQuote=" + encodeURIComponent("This is a quote");
    expect(pdfQuoteFromNoteHref(href)).toBe("This is a quote");
  });

  it("parses quote payloads with source item metadata", () => {
    const legacyHref = "#zaiQuote=" + encodeURIComponent("Legacy quote");
    const href =
      "#zaiQuote=" +
      encodeURIComponent(
        JSON.stringify({
          quote: "This is a quote",
          sourceItemID: 42,
          preferredAttachmentID: 7,
        }),
      );
    const link = document.createElement("a");
    link.setAttribute("data-zai-pdf-quote", "Legacy quote");
    link.href = href;

    expect(pdfQuoteFromNoteHref(legacyHref)).toBe("Legacy quote");
    expect(pdfQuoteFromNoteHref(href)).toBe("This is a quote");
    expect(pdfQuoteDataFromNoteHref(href)).toEqual({
      quote: "This is a quote",
      sourceItemID: 42,
      preferredAttachmentID: 7,
    });
    expect(pdfQuoteFromNoteLink(link)).toBe("This is a quote");
  });
});
