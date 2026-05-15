import { describe, expect, it } from "vitest";
import { parseMermaidMindmap } from "../../src/modules/mindmap-render";

describe("parseMermaidMindmap", () => {
  it("returns null for non-mindmap diagrams", () => {
    expect(parseMermaidMindmap("graph TD\n  A-->B")).toBeNull();
    expect(parseMermaidMindmap("flowchart LR\n  A-->B")).toBeNull();
    expect(parseMermaidMindmap("")).toBeNull();
  });

  it("parses root((label)) as root type", () => {
    const result = parseMermaidMindmap("mindmap\n  root((SAMURAI))");
    expect(result).not.toBeNull();
    expect(result!.nodes[0]).toMatchObject({ label: "SAMURAI", type: "root" });
  });

  it("parses (label) as section type", () => {
    const result = parseMermaidMindmap("mindmap\n  root\n    (Section A)");
    expect(result!.nodes[1]).toMatchObject({ label: "Section A", type: "section" });
  });

  it("parses plain text as point type", () => {
    const result = parseMermaidMindmap("mindmap\n  root\n    section\n      detail");
    expect(result!.nodes[2]).toMatchObject({ label: "detail", type: "point" });
  });

  it("builds correct parent→child edges", () => {
    const src = `mindmap
  root((Root))
    Child A
      Grandchild
    Child B`;
    const result = parseMermaidMindmap(src)!;
    expect(result.nodes.map((n) => n.label)).toEqual([
      "Root",
      "Child A",
      "Grandchild",
      "Child B",
    ]);
    // Root→Child A, Child A→Grandchild, Root→Child B
    expect(result.edges).toHaveLength(3);
    expect(result.edges[0]).toMatchObject({ source: result.nodes[0].id, target: result.nodes[1].id });
    expect(result.edges[1]).toMatchObject({ source: result.nodes[1].id, target: result.nodes[2].id });
    expect(result.edges[2]).toMatchObject({ source: result.nodes[0].id, target: result.nodes[3].id });
  });

  it("handles the SAMURAI mindmap structure", () => {
    const src = `mindmap
  root((SAMURAI))
    论文定位
      基于 SAM 2 的视觉目标跟踪方法
      Zero-shot visual tracking
    核心问题
      SAM 2 分割能力强
        但直接用于跟踪不够稳`;
    const result = parseMermaidMindmap(src)!;
    expect(result.nodes[0]).toMatchObject({ label: "SAMURAI", type: "root" });
    // root → 论文定位, root → 核心问题
    const rootId = result.nodes[0].id;
    const rootEdges = result.edges.filter((e) => e.source === rootId);
    expect(rootEdges).toHaveLength(2);
    expect(result.nodes.length).toBe(7);
    expect(result.edges.length).toBe(6);
  });

  it("treats first plain-text node as root when no ((root)) syntax", () => {
    const result = parseMermaidMindmap("mindmap\n  MyRoot\n    Child");
    expect(result!.nodes[0]).toMatchObject({ label: "MyRoot", type: "root" });
    expect(result!.nodes[1]).toMatchObject({ type: "point" });
  });
});
