import { describe, expect, it } from "vitest";
import {
  canonicalReadingRouteReference,
  readingRouteReferenceKindFromData,
  readingRouteReferenceLabels,
  readingRouteReferenceParts,
  readingRouteReferenceKey,
} from "../../src/modules/reading-route-reference";

describe("reading-route reference helpers", () => {
  it("parses figure and equation labels canonically", () => {
    expect(readingRouteReferenceParts("Fig. 7")).toEqual({
      kind: "figure",
      number: "7",
      locateNumber: "7",
    });
    expect(readingRouteReferenceParts("Figure 10-11")).toEqual({
      kind: "figure",
      number: "10-11",
      locateNumber: "10",
    });
    expect(canonicalReadingRouteReference("Fig. 7")).toBe("Figure 7");
    expect(readingRouteReferenceKey("Fig. 7")).toBe("figure 7");
  });

  it("extracts unique reference labels from markdown", () => {
    expect(
      readingRouteReferenceLabels(
        "See Fig. 7, Figure 7, Table 2, and Equation (3).",
      ),
    ).toEqual(["Figure 7", "Table 2", "Eq. 3"]);
  });

  it("normalizes reference kinds from data attributes", () => {
    expect(readingRouteReferenceKindFromData("figure")).toBe("figure");
    expect(readingRouteReferenceKindFromData("table")).toBe("table");
    expect(readingRouteReferenceKindFromData("unknown")).toBeUndefined();
  });
});
