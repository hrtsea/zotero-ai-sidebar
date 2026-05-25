import { describe, expect, it } from "vitest";
import {
  annotateNumberedFigures,
  findFigure,
  parseFigures,
  plainFigureCaption,
} from "../../src/context/tex-figures";

describe("parseFigures", () => {
  it("indexes figure environments with captions, labels, and graphics", () => {
    const text = [
      "\\section{Method}",
      "\\begin{figure}[t]",
      "\\includegraphics[width=1.0\\linewidth]{figures/occupancy.pdf}",
      "\\caption{The **occupancy trade-off** between 2D grids \\& 3D points.}",
      "\\label{fig:occupancy}",
      "\\end{figure}",
      "\\begin{figure*}",
      "\\includegraphics{figures/str.png}",
      "\\caption{STR overview.}",
      "\\end{figure*}",
    ].join("\n");

    const figures = parseFigures(text);

    expect(figures).toHaveLength(2);
    expect(figures[0]).toMatchObject({
      number: 1,
      label: "fig:occupancy",
      graphics: ["figures/occupancy.pdf"],
    });
    expect(plainFigureCaption(figures[0])).toBe(
      "The occupancy trade-off between 2D grids & 3D points.",
    );
    expect(findFigure(figures, { number: 2 })?.graphics).toEqual([
      "figures/str.png",
    ]);
    expect(findFigure(figures, { name: "occupancy" })?.number).toBe(1);
  });

  it("adds visible figure-number markers before figure environments", () => {
    const text = [
      "\\begin{figure}",
      "\\includegraphics{figures/a.png}",
      "\\caption{A}",
      "\\end{figure}",
    ].join("\n");

    const out = annotateNumberedFigures(text);

    expect(out).toContain("[Figure (1) graphics=figures/a.png]");
    expect(out.indexOf("[Figure (1)")).toBeLessThan(
      out.indexOf("\\begin{figure}"),
    );
  });
});
