/** Il bordo del pannello proprietà (31-10-2026): durante il trascinamento la
 *  larghezza va sull'elemento, e lo stato si aggiorna una volta sola. */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { trascinaBordo } from "../src/editor/bordoPannello";

afterEach(() => vi.useRealTimers());

describe("trascinaBordo", () => {
  it("allarga il contenuto a ogni fotogramma e avvisa una volta sola, al rilascio", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const onFine = vi.fn();
    const { container } = render(
      <aside>
        <div data-maniglia onMouseDown={(e) => trascinaBordo(e, { larghezza: 280, min: 220, max: 600, verso: -1, onFine })} />
        <div data-contenuto style={{ width: 280 }} />
      </aside>,
    );
    const maniglia = container.querySelector("[data-maniglia]")!;
    const contenuto = container.querySelector("[data-contenuto]") as HTMLElement;
    fireEvent.mouseDown(maniglia, { clientX: 500 });
    for (let x = 499; x >= 400; x--) fireEvent.mouseMove(document, { clientX: x });
    expect(onFine).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(contenuto.style.width).toBe("380px");
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(onFine.mock.calls).toEqual([[600]]);
    expect(document.body.style.cursor).toBe("");
  });
});
