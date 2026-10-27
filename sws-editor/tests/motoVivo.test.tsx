import { describe, expect, it } from "vitest";
import {
  ancoreInMoto, durataDellaRincorsa, eInMoto, firmaDelMoto, scostamentoMoto, DURATA_MOTO_MS,
} from "@/canvas/motoVivo";
import type { SynopticObject } from "@/types";

/** Fase 3 del piano dei tubi: il tubo segue un oggetto che si muove su un
 *  percorso. Qui si prova la parte che non ha bisogno di un browser — chi
 *  rincorrere, per quanto, e quando ripartire. La lettura della posizione
 *  vera è stata misurata in un Chromium vero il 26-10-2026 (vedi il commento
 *  in testa a `motoVivo.ts`): `getCTM()` relativo al padre dà lo scostamento
 *  esatto anche sotto zoom e panoramica. */

const o = (p: Partial<SynopticObject>) => ({ id: "x", type: "symbol", x: 0, y: 0, ...p }) as SynopticObject;

const POMPA = o({ id: "pompa", motion_tag: "v", motion_path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] as never });
const FERMO = o({ id: "fermo" });
const TUBO = o({ id: "t", type: "pipe", from_obj_id: "pompa", to_obj_id: "fermo" });

describe("chi deve rincorrere chi", () => {
  it("un oggetto si muove solo con tag **e** percorso di almeno due punti", () => {
    expect(eInMoto(POMPA)).toBe(true);
    expect(eInMoto(FERMO)).toBe(false);
    expect(eInMoto(o({ motion_tag: "v" }))).toBe(false);
    // Un punto solo non è un percorso: sposterebbe l'oggetto una volta e basta.
    expect(eInMoto(o({ motion_tag: "v", motion_path: [{ x: 0, y: 0 }] as never }))).toBe(false);
    expect(eInMoto(undefined)).toBe(false);
  });

  it("il tubo guarda **solo** le sue ancore, non tutta la pagina", () => {
    const altra = o({ id: "altra", motion_tag: "w", motion_path: [{ x: 0, y: 0 }, { x: 9, y: 9 }] as never });
    expect(ancoreInMoto(TUBO, [POMPA, FERMO, altra]).map((x) => x.id)).toEqual(["pompa"]);
  });

  it("un tubo senza agganci non rincorre niente, e non costa niente", () => {
    expect(ancoreInMoto(o({ id: "t2", type: "pipe" }), [POMPA])).toEqual([]);
    expect(durataDellaRincorsa([])).toBe(0);
  });

  it("l'ancora ferma non fa partire nessuna rincorsa", () => {
    expect(ancoreInMoto(o({ id: "t3", type: "pipe", from_obj_id: "fermo" }), [FERMO])).toEqual([]);
  });
});

describe("quando ripartire e per quanto", () => {
  it("la firma cambia **solo** quando cambia il valore che muove", () => {
    const a = firmaDelMoto([POMPA], { v: { value: 10 } });
    expect(firmaDelMoto([POMPA], { v: { value: 10 } })).toBe(a);
    expect(firmaDelMoto([POMPA], { v: { value: 11 } })).not.toBe(a);
    // Un tag che non muove quest'ancora non la riguarda.
    expect(firmaDelMoto([POMPA], { v: { value: 10 }, altro: { value: 99 } })).toBe(a);
  });

  it("un valore non ancora arrivato non è un errore: è una firma come un'altra", () => {
    expect(firmaDelMoto([POMPA], {})).toBe("pompa=");
  });

  it("la rincorsa dura la transizione più lunga, con una coda per l'ultimo fotogramma", () => {
    expect(durataDellaRincorsa([POMPA])).toBeGreaterThan(DURATA_MOTO_MS);
    const lento = o({ ...POMPA, id: "lento", transition_duration_ms: 2000 });
    expect(durataDellaRincorsa([POMPA, lento])).toBeGreaterThan(2000);
  });
});

describe("leggere la posizione vera", () => {
  it("senza un browser che sappia fare matrici non inventa niente", () => {
    // In jsdom `getCTM` non esiste: si resta alla posizione del modello, che
    // è esattamente il comportamento di prima della Fase 3.
    expect(scostamentoMoto("pompa")).toBeNull();
    expect(scostamentoMoto(undefined)).toBeNull();
  });
});

describe("nello stesso fotogramma", () => {
  /** Il difetto del 26-10-2026 sul TC620: il tubo ridisegnato **dopo** la
   *  pittura, un fotogramma indietro alla pompa. Il ridisegno deve essere già
   *  avvenuto quando la callback di `requestAnimationFrame` ritorna — nessun
   *  `act`, nessuna attesa: se qualcuno torna a un `setState` semplice, React
   *  lo rimanda e questo conteggio resta fermo. */
  it("la callback del fotogramma ridisegna il tubo prima di tornare", async () => {
    const { render } = await import("@testing-library/react");
    const { useSegueIlMoto } = await import("@/canvas/motoVivo");
    const fotogrammi: FrameRequestCallback[] = [];
    const prima = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { fotogrammi.push(cb); return fotogrammi.length; }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      let disegni = 0;
      function Tubo() {
        disegni++;
        useSegueIlMoto([POMPA], { v: { value: 1 } });
        return null;
      }
      render(<Tubo />);
      expect(fotogrammi.length).toBe(1);
      const dopoIlPrimo = disegni;
      fotogrammi[0](performance.now());
      expect(disegni, "il tubo deve ridisegnarsi dentro il fotogramma").toBe(dopoIlPrimo + 1);
    } finally {
      globalThis.requestAnimationFrame = prima.raf;
      globalThis.cancelAnimationFrame = prima.caf;
    }
  });
});
