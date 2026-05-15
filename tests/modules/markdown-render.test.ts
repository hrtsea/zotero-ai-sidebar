import { describe, expect, it } from "vitest";
import { renderMarkdownInto } from "../../src/modules/markdown-render";

function render(markdown: string): HTMLElement {
  const root = document.createElement("div");
  renderMarkdownInto(root, markdown);
  return root;
}

describe("renderMarkdownInto", () => {
  it("keeps indented list items nested under their parent item", () => {
    const root = render([
      "- Category: system paper",
      "- Context: related to VLAs; references:",
      "  - Black 2024 — pi0 flow VLA",
      "  - Pertsch 2025 — FAST tokenization",
      "- Correctness: check ablations",
    ].join("\n"));

    const top = root.querySelector(":scope > ul")!;
    expect(top).not.toBeNull();
    expect(top.children).toHaveLength(3);
    expect(top.children[1].childNodes[0]?.textContent).toBe(
      "Context: related to VLAs; references:",
    );

    const nested = top.children[1].querySelector(":scope > ul")!;
    expect(nested).not.toBeNull();
    expect(Array.from(nested.children).map((li) => li.textContent)).toEqual([
      "Black 2024 — pi0 flow VLA",
      "Pertsch 2025 — FAST tokenization",
    ]);
    expect(top.children[2].textContent).toBe("Correctness: check ablations");
  });
});
