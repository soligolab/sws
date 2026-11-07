/** F3, dalla revisione: le domande del viewer non lasciano un comando a metà.
 *  L'impulso di un momentaneo critico arriva in ordine, il toggle non scrive
 *  l'opposto di quello che si è confermato, la molla torna sempre a riposo. */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { rispondi, type Richiesta } from "../src/finestraAvviso/finestraAvviso";
import type { SynopticObject, TagState } from "../src/types";

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

const stato = (v: unknown) => ({ t: { value: v, quality: "Good", timestamp_ms: 1 } as unknown as TagState });
const conLaPassword = (q: Richiesta) => (q.tipo === "chiedi" ? "segreta" : true);

function disegna(obj: SynopticObject, tagValues: Record<string, TagState>, onWriteTag = vi.fn()) {
  const fai = (tv: Record<string, TagState>) => (
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={tv} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} onWriteTag={onWriteTag} />
    </svg>
  );
  const r = render(fai(tagValues));
  return { ...r, onWriteTag, rifai: (tv: Record<string, TagState>) => r.rerender(fai(tv)) };
}

let r: ReturnType<typeof rispondi> | null = null;
afterEach(() => { r?.ferma(); r = null; vi.restoreAllMocks(); vi.useRealTimers(); });

describe("le domande del viewer", () => {
  it("un momentaneo critico: password alla pressione, poi pressione e rilascio in ordine, via HTTP", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "verifyPassword").mockResolvedValue(undefined as never);
    const scritte: unknown[] = [];
    vi.spyOn(api, "writeTag").mockImplementation(async (id: string, v: unknown) => { scritte.push([id, v]); return undefined as never; });
    r = rispondi(conLaPassword);
    const obj = { id: "b", type: "button", x: 0, y: 0, width: 100, height: 30, tag: "t", button_mode: "momentary",
      critical: true, write_value: true, release_value: false } as SynopticObject;
    const d = disegna(obj, stato(false));
    const g = d.container.querySelector("g")!;
    await act(async () => { fireEvent.pointerDown(g); });
    await act(async () => { fireEvent.pointerUp(g); });
    expect(scritte).toEqual([["t", true]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(scritte).toEqual([["t", true], ["t", false]]);
    expect(d.onWriteTag).not.toHaveBeenCalled();
  });

  it("un momentaneo col dito: scrive alla pressione, una volta al rilascio, senza domande", async () => {
    // Collaudo del 07-11-2026 sul touch del TC620: coi soli eventi del mouse la
    // pressione lunga non mandava niente.
    const obj = { id: "b", type: "button", x: 0, y: 0, width: 100, height: 30, tag: "t", button_mode: "momentary",
      require_confirm: true, write_value: true, release_value: false } as SynopticObject;
    r = rispondi(() => true);
    const d = disegna(obj, stato(false));
    const g = d.container.querySelector("g")!;
    await act(async () => { fireEvent.pointerDown(g, { pointerType: "touch" }); });
    expect(d.onWriteTag.mock.calls).toEqual([["t", true]]);
    await act(async () => { fireEvent.pointerUp(g, { pointerType: "touch" }); });
    await act(async () => { fireEvent.pointerLeave(g, { pointerType: "touch" }); });
    expect(d.onWriteTag.mock.calls).toEqual([["t", true], ["t", false]]);
    expect(r.chiamate).toHaveLength(0);
  });

  it("un comando critico senza accesso dice che serve l'accesso, invece del 403", async () => {
    // Collaudo del 07-11-2026: il sentinella «no-auth» senza nome è un anonimo
    // su un pannello con utenti, non un pannello senza password.
    useAppStore.setState({ authToken: "no-auth", authUser: null });
    try {
      const scrivi = vi.spyOn(api, "writeTag").mockResolvedValue(undefined as never);
      r = rispondi(() => true);
      const obj = { id: "b", type: "button", x: 0, y: 0, width: 100, height: 30, tag: "t", button_mode: "write",
        critical: true, write_value: true } as SynopticObject;
      const d = disegna(obj, stato(false));
      await act(async () => { fireEvent.click(d.container.querySelector("g")!); });
      expect(scrivi).not.toHaveBeenCalled();
      expect(r.chiamate.map((c) => c.tipo)).toEqual(["avviso"]);
    } finally {
      useAppStore.setState({ authToken: null, authUser: null });
    }
  });

  it("un toggle confermato mentre il tag cambia non scrive l'opposto", async () => {
    const obj = { id: "b", type: "button", x: 0, y: 0, width: 100, height: 30, tag: "t", button_mode: "toggle",
      require_confirm: true } as SynopticObject;
    let d!: ReturnType<typeof disegna>;
    // Mentre la finestra chiede «scrivere true?», qualcun altro mette il tag a true.
    r = rispondi(() => { d.rifai(stato(true)); return true; });
    d = disegna(obj, stato(false));
    await act(async () => { fireEvent.click(d.container.querySelector("g")!); });
    expect(r.chiamate).toHaveLength(1);
    expect(d.onWriteTag).not.toHaveBeenCalled();
  });

  it("uno slider a molla critico rilasciato durante la password torna comunque a riposo", async () => {
    vi.spyOn(api, "verifyPassword").mockResolvedValue(undefined as never);
    const http = vi.spyOn(api, "writeTag").mockResolvedValue(undefined as never);
    let rispondiOra!: () => void;
    r = rispondi((q: Richiesta) => (q.tipo === "chiedi" ? new Promise((ok) => { rispondiOra = () => ok("segreta"); }) : true));
    const obj = { id: "s", type: "slider", x: 0, y: 0, width: 200, height: 50, tag: "t", min: 0, max: 100, step: 1,
      critical: true, slider_rest_value: 0 } as SynopticObject;
    const d = disegna(obj, stato(0));
    const area = d.container.querySelector("[data-slider-area]") as SVGRectElement;
    fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 150, clientY: 25 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 25 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 100, clientY: 25 });
    expect(d.onWriteTag).not.toHaveBeenCalled();
    await act(async () => { rispondiOra(); });
    await act(async () => {});
    expect(http).toHaveBeenCalledTimes(1);
    expect(d.onWriteTag).toHaveBeenCalledWith("t", 0);
  });
});
