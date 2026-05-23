import { describe, expect, it, vi } from "vitest";
import {
  parseTranscriptionResponse,
  transcribeFigures,
} from "../../src/context/transcribe";

const streamChunks = vi.fn();

vi.mock("../../src/providers/factory", () => ({
  getProvider: () => ({
    // eslint-disable-next-line require-yield
    async *stream() {
      for (const chunk of streamChunks()) {
        yield chunk;
      }
    },
  }),
}));

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

describe("transcribeFigures", () => {
  it("resolves to an id→transcription map from the streamed model output", async () => {
    streamChunks.mockReturnValue([
      { type: "text_delta", text: '{"eq-p6-1":"x^2"}' },
    ]);
    const map = await transcribeFigures(
      [{ id: "eq-p6-1", pngDataUrl: "data:image/png;base64,AAA" }],
      {} as any,
      new AbortController().signal,
    );
    expect(map.get("eq-p6-1")).toBe("x^2");
  });

  it("resolves to an empty map when the stream yields an error chunk", async () => {
    streamChunks.mockReturnValue([{ type: "error", message: "boom" }]);
    const map = await transcribeFigures(
      [{ id: "eq-p6-1", pngDataUrl: "data:image/png;base64,AAA" }],
      {} as any,
      new AbortController().signal,
    );
    expect(map.size).toBe(0);
  });
});
