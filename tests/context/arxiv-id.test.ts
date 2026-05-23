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
