/** Lo slider web, fase 1 della revisione (30-10-2026, piano
 *  docs/plans/2026-10-30-revisione-slider.md): dopo la scrittura il cursore
 *  resta dov'è col bordo tratteggiato finché il tag non risponde o per 3 s;
 *  una conferma annullata non lascia niente in attesa; un valore non numerico
 *  si scrive «—». */
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import type { SynopticObject, TagState } from "../src/types";

// jsdom non ha `PointerEvent`: un ripiego su `MouseEvent`, che porta
// coordinate e pulsante, con `pointerId` e `pointerType` in più.
if (typeof window.PointerEvent === "undefined" || !("clientX" in new window.PointerEvent("pointerdown", { clientX: 1 }))) {
  class PointerEventFinto extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventFinto;
}

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
  const slider = r.container.querySelector('[role="slider"]') as SVGGElement;
  // Dalla fase 2 lo slider è SVG: il «trascinamento» del test è la tastiera,
  // che percorre la stessa strada (bozza, poi scrittura al rilascio del tasto).
  const trascina = (v: number) => {
    fireEvent.keyDown(slider, { key: "Home" });
    const passi = Math.round(v / (obj.step ?? 1));
    for (let i = 0; i < passi; i++) fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
  };
  const valore = () => slider.getAttribute("aria-valuenow");
  return { ...r, rifai, slider, valore, trascina, onWriteTag };
}

describe("lo slider web dopo la scrittura", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("resta dove l'ha lasciato, tratteggiato, finché il tag non risponde", () => {
    const d = disegna(slider(), valore(0.35));
    d.trascina(0.8);
    expect(d.onWriteTag).toHaveBeenCalledWith("t", 0.8);
    expect(d.valore()).toBe("0.8");
    expect(d.container.querySelector("[data-slider-in-attesa]")).not.toBeNull();
    d.rifai(valore(0.8));
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.valore()).toBe("0.8");
  });

  it("se il tag non risponde, dopo 3 s torna al valore del tag", () => {
    vi.useFakeTimers();
    const d = disegna(slider(), valore(0.35));
    d.trascina(0.8);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.valore()).toBe("0.35");
  });

  it("una conferma annullata non scrive e non lascia niente in attesa", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const d = disegna(slider({ require_confirm: true }), valore(0.35));
    d.trascina(0.8);
    expect(d.onWriteTag).not.toHaveBeenCalled();
    expect(d.container.querySelector("[data-slider-in-attesa]")).toBeNull();
    expect(d.valore()).toBe("0.35");
  });

  it("un valore non numerico si scrive «—», non NaN", () => {
    const d = disegna(slider(), valore("guasto"));
    expect(d.container.textContent).toContain("—");
    expect(d.container.textContent).not.toContain("NaN");
  });
});

describe("lo slider SVG (fase 2)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("col puntatore: scrive al rilascio il valore sotto il dito", () => {
    const d = disegna(slider({ min: 0, max: 100, step: 1 }), valore(10));
    const area = d.container.querySelector('[data-slider-area]') as SVGRectElement;
    fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 150, clientY: 25 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 25 });
    expect(d.onWriteTag).not.toHaveBeenCalled();
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 100, clientY: 25 });
    expect(d.onWriteTag).toHaveBeenCalledTimes(1);
    expect(d.onWriteTag).toHaveBeenCalledWith("t", 50);
  });

  it("senza scrittura al rilascio scrive mentre si muove, e un annullo non scrive", () => {
    const d = disegna(slider({ min: 0, max: 100, step: 1, write_on_release: false }), valore(10));
    const area = d.container.querySelector('[data-slider-area]') as SVGRectElement;
    fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 50, clientY: 25 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 25 });
    expect(d.onWriteTag.mock.calls.map((c) => c[1])).toEqual([25, 50]);
    const e = disegna(slider({ min: 0, max: 100, step: 1 }), valore(10));
    const a2 = e.container.querySelector('[data-slider-area]') as SVGRectElement;
    fireEvent.pointerDown(a2, { pointerId: 2, button: 0, clientX: 50, clientY: 25 });
    fireEvent.pointerCancel(a2, { pointerId: 2 });
    expect(e.onWriteTag).not.toHaveBeenCalled();
  });

  it("in sola lettura non si prende né col dito né con la tastiera", () => {
    const d = disegna(slider({ read_only: true }), valore(0.35));
    expect(d.slider.getAttribute("tabindex")).toBeNull();
    expect(d.container.querySelector('[data-slider-area]')).toBeNull();
    fireEvent.keyDown(d.slider, { key: "End" });
    fireEvent.keyUp(d.slider, { key: "End" });
    expect(d.onWriteTag).not.toHaveBeenCalled();
  });

  it("la traccia ha il colore dell'indicatore al 20 %, salvo un colore scritto", () => {
    const a = disegna(slider({ fill: "#22c55e" }), valore(0.5));
    const traccia = a.container.querySelector('[data-slider] > rect:not([data-slider-indicatore])') as SVGRectElement;
    expect([traccia.getAttribute("fill"), traccia.getAttribute("fill-opacity")]).toEqual(["#22c55e", "0.2"]);
    const b = disegna(slider({ slider_track_color: "#334155" }), valore(0.5));
    const t2 = b.container.querySelector('[data-slider] > rect:not([data-slider-indicatore])') as SVGRectElement;
    expect([t2.getAttribute("fill"), t2.getAttribute("fill-opacity")]).toEqual(["#334155", "1"]);
  });
});

describe("bipolare e valore misurato (fase 5)", () => {
  it("il riempimento parte dall'origine, con la linea", () => {
    const d = disegna(slider({ min: -50, max: 50, step: 1, slider_origin: 0 }), valore(-25));
    const ind = d.container.querySelector("[data-slider-indicatore]") as SVGRectElement;
    // 200 px di traccia: da −25 (x 50) all'origine (x 100).
    expect([Number(ind.getAttribute("x")), Number(ind.getAttribute("width"))]).toEqual([50, 50]);
    expect(d.container.querySelector("[data-slider-origine]")).not.toBeNull();
  });

  it("il PV: il segno sulla traccia e accanto al valore", () => {
    const obj = slider({ min: 0, max: 100, step: 1, unit: "%", slider_pv_tag: "pv" });
    const tv = { ...valore(62), pv: { value: 58, quality: "Good", timestamp_ms: 1 } as unknown as TagState };
    const d = disegna(obj, tv);
    expect(d.container.querySelector("[data-slider-pv]")).not.toBeNull();
    expect(d.container.textContent).toContain("62 % · PV 58 %");
  });
});

describe("la molla (fase 6)", () => {
  it("mentre si tiene scrive al massimo ogni 200 ms, al rilascio scrive il riposo", async () => {
    const d = disegna(slider({ min: -50, max: 50, step: 1, slider_origin: 0, slider_rest_value: 0 }), valore(0));
    const area = d.container.querySelector("[data-slider-area]") as SVGRectElement;
    fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 150, clientY: 25 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 160, clientY: 25 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 170, clientY: 25 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 170, clientY: 25 });
    // Il primo punto subito; i due movimenti entro 200 ms no; il riposo al rilascio.
    expect(d.onWriteTag.mock.calls.map((c) => c[1])).toEqual([25, 0]);
    await waitFor(() => expect(d.valore()).toBe("0"));
  });
});
