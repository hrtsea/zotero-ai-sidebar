import { describe, expect, it } from "vitest";
import {
  annotateNumberedEquations,
  equationDisplayMath,
  findEquation,
  parseEquations,
} from "../../src/context/tex-equations";

describe("parseEquations", () => {
  it("indexes numbered equation environments in source order", () => {
    const text = [
      "\\section{Method}",
      "\\begin{equation}",
      "  a = b",
      "  \\label{eq:first}",
      "\\end{equation}",
      "\\paragraph{Mixed-pose training.}",
      "The probability follows a schedule:",
      "\\begin{equation}",
      "  p_{\\text{pred}}(e) = p_{\\text{start}} + (p_{\\text{end}} - p_{\\text{start}})",
      "  \\label{eq:mix_schedule}",
      "\\end{equation}",
    ].join("\n");

    const equations = parseEquations(text);

    expect(equations).toHaveLength(2);
    expect(equations[1]).toMatchObject({
      number: 2,
      label: "eq:mix_schedule",
      env: "equation",
    });
    expect(findEquation(equations, { number: 2 })?.label).toBe(
      "eq:mix_schedule",
    );
    expect(findEquation(equations, { label: "eq:first" })?.number).toBe(1);
  });

  it("skips starred environments and unnumbered align rows", () => {
    const text = [
      "\\begin{equation*}x = y\\end{equation*}",
      "\\begin{align}",
      "a &= b \\notag \\\\",
      "c &= d \\label{eq:second}",
      "\\end{align}",
    ].join("\n");

    const equations = parseEquations(text);

    expect(equations).toHaveLength(1);
    expect(equations[0]).toMatchObject({
      number: 1,
      label: "eq:second",
      env: "align",
    });
    expect(equations[0].rowTex).toContain("c &= d");
  });

  it("adds visible equation-number markers before numbered environments", () => {
    const text = [
      "\\begin{equation}",
      "a = b",
      "\\label{eq:first}",
      "\\end{equation}",
      "\\begin{equation}",
      "c = d",
      "\\end{equation}",
    ].join("\n");

    const out = annotateNumberedEquations(text);

    expect(out).toContain("[Equation (1) label=eq:first]");
    expect(out).toContain("[Equation (2)]");
    expect(out.indexOf("[Equation (1)")).toBeLessThan(
      out.indexOf("\\begin{equation}"),
    );
  });

  it("extracts chat-renderable display math without source-only labels", () => {
    const equations = parseEquations(
      [
        "\\begin{equation}",
        "x = y,",
        "\\label{eq:x}",
        "\\end{equation}",
        "\\begin{align}",
        "a &= b \\label{eq:a}",
        "\\end{align}",
      ].join("\n"),
    );

    expect(equationDisplayMath(equations[0])).toBe("x = y,");
    expect(equationDisplayMath(equations[1])).toContain("\\begin{aligned}");
    expect(equationDisplayMath(equations[1])).toContain("a &= b");
    expect(equationDisplayMath(equations[1])).not.toContain("\\label");
  });
});
