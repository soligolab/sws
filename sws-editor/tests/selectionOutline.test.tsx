/** One perimeter for a selected object (maintainer, 20-11-2026): the yellow
 *  selection sits on the object's true edge and replaces the grey edit
 *  outline. A clock 2 px past the page border went unnoticed between the two,
 *  3 px apart. */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import "../src/i18n/index";
import { SvgCanvas } from "../src/canvas/SvgCanvas";
import { useAppStore } from "../src/store";
import type { SynopticObject } from "../src/types";

beforeEach(() => {
  act(() => useAppStore.setState({ project: { tags: [], types: [] } as never, authRole: null }));
});

const CLOCK = { id: "orologio", type: "clock", x: 402, y: 0, width: 200, height: 28 } as SynopticObject;
const RECT = { id: "r", type: "rect", x: 20, y: 40, width: 100, height: 50 } as SynopticObject;

/** The grey dashed outline every object has in edit mode. */
const greyOutlines = (c: HTMLElement) =>
  [...c.querySelectorAll("rect")].filter((r) => r.getAttribute("stroke") === "#475569"
    && r.getAttribute("stroke-dasharray") === "4 3");

describe("the selection outline", () => {
  it("is on the true edge, and the grey outline goes away", () => {
    const { container } = render(
      <SvgCanvas objects={[CLOCK, RECT]} onMove={() => {}} selectedIds={["orologio"]}
                 pageWidth={600} pageHeight={1024} />,
    );
    const sel = container.querySelector("[data-selection-outline]")!;
    expect([sel.getAttribute("x"), sel.getAttribute("y"), sel.getAttribute("width"), sel.getAttribute("height")])
      .toEqual(["402", "0", "200", "28"]);
    // Only the rectangle that is not selected keeps its grey outline.
    expect(greyOutlines(container)).toHaveLength(1);
  });

  it("without a selection every object has its grey outline", () => {
    const { container } = render(
      <SvgCanvas objects={[CLOCK, RECT]} onMove={() => {}} pageWidth={600} pageHeight={1024} />,
    );
    expect(container.querySelector("[data-selection-outline]")).toBeNull();
    expect(greyOutlines(container)).toHaveLength(2);
  });
});
