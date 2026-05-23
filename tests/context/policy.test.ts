import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_POLICY } from "../../src/context/policy";

describe("DEFAULT_CONTEXT_POLICY phase-1 limits", () => {
  it("defines render/figure/transcribe limits", () => {
    expect(DEFAULT_CONTEXT_POLICY.formulaRenderScale).toBeGreaterThan(1);
    expect(DEFAULT_CONTEXT_POLICY.formulaRenderMaxEdgePx).toBeGreaterThan(100);
    expect(DEFAULT_CONTEXT_POLICY.formulaCropPaddingPt).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONTEXT_POLICY.maxFiguresPerPaper).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_POLICY.transcribeBatchSize).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_POLICY.paperBuildTimeoutMs).toBeGreaterThan(1000);
  });
});

describe("DEFAULT_CONTEXT_POLICY arxiv limits", () => {
  it("defines arxiv fetch limits", () => {
    expect(DEFAULT_CONTEXT_POLICY.maxArxivSourceBytes).toBeGreaterThan(1_000_000);
    expect(DEFAULT_CONTEXT_POLICY.arxivFetchTimeoutMs).toBeGreaterThan(1000);
  });
});
