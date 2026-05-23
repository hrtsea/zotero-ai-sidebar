import { describe, expect, it } from "vitest";
import {
  assembleRepairedMarkdown,
  detectGarbledFormulaRuns,
} from "../../src/context/formula-repair";

const PI05_GARBLED_LOSS = [
  "Our model is optimized to minimize the combined loss",
  "ED,τ,ω",
  "[",
  "H",
  "(x1:M , f l",
  "θ (ot, l))",
  "+α∥",
  "∥ω − at:t+H − f a",
  "θ (aτ,ω",
  "t:t+H , ot, l)∥",
  "∥",
  "2",
  "]",
  ", (1)",
  "where H(x1:M , y1l:M ) is the cross entropy loss between the text tokens",
].join("\n");

describe("detectGarbledFormulaRuns", () => {
  it("flags the observed pi0.5 PDF-cache formula garble", () => {
    const runs = detectGarbledFormulaRuns(PI05_GARBLED_LOSS);

    expect(runs).toHaveLength(1);
    expect(runs[0].text).toContain("f l\nθ");
    expect(runs[0].text).toContain("∥\n2\n]");
    expect(runs[0].start).toBeGreaterThan(0);
    expect(runs[0].end).toBeLessThan(PI05_GARBLED_LOSS.length);
    expect(runs[0].reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^math-glyph-lines=/),
        expect.stringMatching(/^short-lines=/),
      ]),
    );
  });

  it("does not flag clean prose with an inline formula", () => {
    const text = [
      "The model minimizes a combined loss",
      "where H(x_{1:M}, f^l_\\theta(o_t, l)) is the cross entropy term,",
      "and the action expert predicts a continuous action chunk.",
    ].join("\n");

    expect(detectGarbledFormulaRuns(text)).toEqual([]);
  });

  it("does not flag a clean multi-step derivation", () => {
    const text = [
      "\\hat{y}_t = \\alpha x_t + \\beta",
      "= \\gamma z_t + \\delta",
      "\\leq C_1 z_t + C_2",
      "\\approx \\tilde{y}_t",
      "\\sim p_\\theta(y | x)",
    ].join("\n");

    expect(detectGarbledFormulaRuns(text)).toEqual([]);
  });
});

describe("assembleRepairedMarkdown", () => {
  it("splices run repairs into the source, keeping prose verbatim", () => {
    const source = "Intro line.\nGARBLE\nOutro line.";
    const md = assembleRepairedMarkdown(source, [
      {
        start: source.indexOf("GARBLE"),
        end: source.indexOf("GARBLE") + "GARBLE".length,
        figureName: "eq-p1-1.png",
        latex: "\\alpha",
        pageIndex: 0,
        rects: [[1, 2, 3, 4]],
        confidence: 0.97,
      },
    ]);
    expect(md).toContain("Intro line.");
    expect(md).toContain("Outro line.");
    expect(md).toContain("![formula p.1](figures/eq-p1-1.png)");
    expect(md).toContain("<!-- zai:loc page=0");
    expect(md).toContain("$$\n\\alpha\n$$");
    expect(md).not.toContain("GARBLE");
  });

  it("keeps the garbled text and marks it when a repair has no latex", () => {
    const source = "A\nGARBLE\nB";
    const md = assembleRepairedMarkdown(source, [
      {
        start: 2,
        end: 8,
        figureName: "eq-p1-1.png",
        latex: null,
        pageIndex: 0,
        rects: [[1, 2, 3, 4]],
        confidence: 0.4,
      },
    ]);
    expect(md).toContain("![formula p.1](figures/eq-p1-1.png)");
    expect(md).toContain("zai:unrepaired");
    expect(md).toContain("GARBLE");
  });
});
