/** Lo slider web, fase 1 della revisione (30-10-2026, piano
 *  docs/plans/2026-10-30-revisione-slider.md): dopo la scrittura il cursore
 *  resta dov'è col bordo tratteggiato finché il tag non risponde o per 3 s;
 *  una conferma annullata non lascia niente in attesa; un valore non numerico
 *  si scrive «—». */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import type { SynopticObject, TagState } from "../src/types";

const slider = (extra: Partial<SynopticObject> = {}) =>
  ({ id: "s1", type: "slider", x: 0, y: 0, width: 200, height: 50, tag: "t", min: 0, max: 1, step: 0.05, ...extra }) as SynopticObject;

const valore = (v: unknown) => ({ t: { value: v, quality: "Good", timestamp_ms: 1 } as unknown as TagState });

function disegna(obj: SynopticObject, tagValues: Record<string, TagState>, onWriteTag = vi.fn()) {
  const r = render(
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={tagValues} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} onWriteTag={onWriteTag} />
    </svg>,
  );
  const rifai = (tv: Record<string, TagState>) => r.rerender(
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={tv} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} onWriteTag={onWriteTag} />
    </svg>,
  );
  const input = r.container.querySelector('input[type="range"]') as HTMLInputElement;
  const trascina = (v: number) => {
    fireEvent.change(input, { target: { value: String(v) } });
    fireEvent.mouseUp(input);
  };
  return { ...r, rifai, input, trascina, onWriteTag };
}

describe("lo slider web dopo la scrittura", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("resta dove l'ha lasciato, tratteggiato, finché il tag non risponde", () => {
    const d = disegna(slider(), valore(0.35));
    d.trascina(0.8);
    expect(d.onWriteTag).toHaveBeenCalledWith("t", 0.8);
    expect(d.input.value).toBe("0.8");
    expect(d.container.querySelector("[data-slider-in-attesa]")).not.toBeNull();
    d.rifai(valore(0.8));
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.input.value).toBe("0.8");
  });

  it("se il tag non risponde, dopo 3 s torna al valore del tag", () => {
    vi.useFakeTimers();
    const d = disegna(slider(), valore(0.35));
    d.trascina(0.8);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.input.value).toBe("0.35");
  });

  it("una conferma annullata non scrive e non lascia niente in attesa", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const d = disegna(slider({ require_confirm: true }), valore(0.35));
    d.trascina(0.8);
    expect(d.onWriteTag).not.toHaveBeenCalled();
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.input.value).toBe("0.35");
  });

  it("un valore non numerico si scrive «—», non NaN", () => {
    const d = disegna(slider(), valore("guasto"));
    expect(d.container.textContent).toContain("—");
    expect(d.container.textContent).not.toContain("NaN");
  });
});
