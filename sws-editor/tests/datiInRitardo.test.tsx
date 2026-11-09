/** «Dati in ritardo» sul viewer web (piano 2026-11-09-viewer-leggero, §5-bis).
 *
 *  Sul WP630 i valori a schermo erano vecchi fino a 29 s e niente lo diceva.
 *  Il maintainer ha deciso il 09-11-2026: oltre 5 s compare in alto la fascia
 *  «Dati in ritardo di N s» e gli oggetti prendono lo stile «non aggiornato»
 *  dello stale; sparisce da sola. Qui si passa dal viewer vero: il socket del
 *  modulo (finto sotto), la coalescenza, `RuntimeView` e `SvgCanvas`. */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Il socket finto tiene gli ascoltatori come `ReconnectingWs`; i messaggi e gli
// eventi del server si mandano a mano.
const finto = vi.hoisted(() => {
  type Ascoltatore = (ev: unknown) => void;
  const ascoltatori = new Map<string, Set<Ascoltatore>>();
  const stream = {
    readyState: 1, // WebSocket.OPEN
    on(tipo: string, h: Ascoltatore) {
      if (!ascoltatori.has(tipo)) ascoltatori.set(tipo, new Set());
      ascoltatori.get(tipo)!.add(h);
    },
    off(tipo: string, h: Ascoltatore) { ascoltatori.get(tipo)?.delete(h); },
    send: () => true,
  };
  const emetti = (tipo: string, ev: unknown = {}) => {
    for (const h of [...(ascoltatori.get(tipo) ?? [])]) h(ev);
  };
  return {
    stream,
    manda(msg: unknown) { emetti("message", { data: JSON.stringify(msg) }); },
    apri() { stream.readyState = 1; emetti("open"); },
    chiudi() { stream.readyState = 3; emetti("close"); },
  };
});

vi.mock("@/ws/singletonWs", () => ({
  socketCondiviso: () => ({
    prendi: () => finto.stream,
    corrente: () => finto.stream,
    chiudi: () => {},
  }),
}));

// L'avviso di aggiornamento dentro `RuntimeView` chiede al runtime: qui non
// c'è, e non deve comparire niente.
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  const no = () => Promise.reject(new Error("nessun runtime nel test"));
  return { ...vero, api: { ...vero.api, getSystemStatus: no, statoAggiornamento: no } };
});

import "../src/i18n/index";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { svuotaOra } from "@/ws/coalescenza";
import { testoSistemaCon } from "@/i18n/testiSistema";
import type { SynopticObject } from "@/types";

const T0 = 1_800_000_000_000;
const LINGUA = "it";
const fascia = (n: number) => testoSistemaCon("dati_in_ritardo", LINGUA, { n: String(n) });

const OGGETTI = [
  { id: "r1", type: "rect", x: 10, y: 10, width: 40, height: 20, tag: "a" },
  { id: "r2", type: "rect", x: 60, y: 10, width: 40, height: 20, tag: "b" },
] as unknown as SynopticObject[];

/** I gruppi di pagina con lo stile «non aggiornato» dello stale. */
const grigi = (c: HTMLElement) =>
  [...c.querySelectorAll("g")].filter((g) => g.style.filter.includes("grayscale") && g.style.opacity === "0.55");

/** Un delta del server: `ts` è l'ora del server quando il valore è stato scritto. */
function delta(ts: number, valore = 1) {
  finto.manda({ type: "delta", seq: 1, changed: [{ id: "a", value: valore, quality: "Good", ts }, { id: "b", value: valore, quality: "Good", ts }] });
}

/** Il fotogramma: la pagina applica quello che è arrivato. */
function fotogramma() {
  act(() => svuotaOra());
}

/** Il tempo che passa, coi timer della pagina. Muove insieme `Date.now()` e
 *  `performance.now()`; `vi.setSystemTime` muove solo il primo, ed è un salto
 *  dell'orologio del browser. */
function aspetta(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

function monta() {
  const r = render(<RuntimeView />);
  // La connessione si apre e il server manda lo snapshot, come a ogni apertura.
  act(() => finto.apri());
  finto.manda({ type: "snapshot", seq: 0, tags: [] });
  fotogramma();
  return r;
}

describe("la fascia «Dati in ritardo» del viewer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    finto.stream.readyState = 1;
    useAppStore.setState({
      authToken: "prova", remoteConnected: false, tagValues: {}, projectLang: LINGUA,
      project: { tags: [], types: [] } as never,
      pages: [{ id: "p1", name: "Pagina", width: 400, height: 200, objects: OGGETTI }] as never,
      currentPageId: "p1",
    });
  });
  afterEach(() => {
    // Una connessione nuova azzera la misura per il test dopo.
    act(() => finto.apri());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("valori applicati 8 s dopo la loro scrittura: fascia con «8 s» e oggetti grigi", () => {
    const { container } = monta();
    delta(T0);
    fotogramma();
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    expect(grigi(container)).toHaveLength(0);

    // La pagina resta indietro: quello che applica adesso è stato scritto 8 s fa.
    aspetta(10_000);
    delta(T0 + 2_000, 2);
    fotogramma();
    expect(screen.getByTestId("dati-in-ritardo").textContent).toBe(fascia(8));
    expect(grigi(container)).toHaveLength(OGGETTI.length);

    // Torna al passo: la fascia sparisce da sola, e il grigio con lei.
    aspetta(1_000);
    delta(T0 + 11_000, 3);
    fotogramma();
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    expect(grigi(container)).toHaveLength(0);
  });

  it("l'orologio del browser avanti di 60 s non accende niente, un ritardo vero sì", () => {
    monta();
    // Ogni valore arriva subito, ma il server è 60 s indietro.
    for (let s = 0; s < 5; s++) {
      if (s > 0) aspetta(1_000);
      delta(T0 + s * 1000 - 60_000, s);
      fotogramma();
      expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    }
    // Sopra lo scarto, 8 s di ritardo vero: quelli si vedono.
    aspetta(16_000);
    delta(T0 + 12_000 - 60_000, 9);
    fotogramma();
    expect(screen.getByTestId("dati-in-ritardo").textContent).toBe(fascia(8));
  });

  it("socket chiuso da 6 s: fascia e oggetti grigi; riaperto, sparisce", () => {
    const { container } = monta();
    delta(T0);
    fotogramma();
    act(() => finto.chiudi());
    aspetta(5_000);
    // A 5 s esatti non c'è ancora: «più di 5 s».
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    aspetta(1_000);
    expect(screen.getByTestId("dati-in-ritardo").textContent).toBe(fascia(6));
    expect(grigi(container)).toHaveLength(OGGETTI.length);
    // I secondi contano da soli, senza messaggi.
    aspetta(3_000);
    expect(screen.getByTestId("dati-in-ritardo").textContent).toBe(fascia(9));

    act(() => finto.apri());
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    expect(grigi(container)).toHaveLength(0);
  });

  it("un impianto fermo non è in ritardo: col socket vivo e nessun messaggio, niente fascia", () => {
    monta();
    delta(T0);
    fotogramma();
    aspetta(60_000);
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
  });

  it("lo snapshot porta anche tag fermi da ore, e non dà un'età", () => {
    monta();
    delta(T0);
    fotogramma();
    // Un cambio di pagina sulla stessa connessione: subscribe, e lo snapshot
    // dei tag della pagina nuova, uno dei quali scritto un'ora fa.
    aspetta(1_000);
    finto.manda({ type: "snapshot", seq: 0, tags: [{ id: "a", value: 1, quality: "Good", ts: T0 - 3_600_000 }] });
    fotogramma();
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
  });

  it("un salto indietro dell'orologio con un valore in volo non lascia la fascia accesa", () => {
    // Il WP630: runtime e viewer sullo stesso orologio, che NTP porta indietro
    // di 20 s mentre un delta scritto prima del salto è ancora in volo.
    monta();
    delta(T0);
    fotogramma();
    aspetta(1_000);
    vi.setSystemTime(Date.now() - 20_000);
    delta(T0 + 900, 2);
    fotogramma();
    // Poi dieci secondi di valori freschi, col nuovo orologio.
    for (let s = 0; s < 10; s++) {
      aspetta(1_000);
      delta(Date.now() - 30, 3 + s);
      fotogramma();
      // Prima: «Dati in ritardo di 20 s», fino alla riconnessione.
      expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    }
  });

  it("l'orologio del browser che salta avanti di 30 s non lascia la fascia accesa", () => {
    // Un browser remoto: il suo orologio salta, quello del server no.
    monta();
    delta(T0);
    fotogramma();
    aspetta(1_000);
    vi.setSystemTime(Date.now() + 30_000);
    for (let s = 0; s < 5; s++) {
      aspetta(1_000);
      delta(Date.now() - 30_000 - 30, 2 + s);
      fotogramma();
      expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
    }
    // Lo scarto nuovo è stimato: un ritardo vero si vede ancora.
    aspetta(1_000);
    delta(Date.now() - 30_000 - 8_000, 9);
    fotogramma();
    expect(screen.getByTestId("dati-in-ritardo").textContent).toBe(fascia(8));
  });

  it("dopo un ritardo, se l'impianto si ferma la fascia non resta accesa per sempre", () => {
    monta();
    delta(T0);
    fotogramma();
    aspetta(10_000);
    delta(T0 + 2_000, 2);
    fotogramma();
    expect(screen.getByTestId("dati-in-ritardo")).toBeTruthy();
    // Più niente da 6 s: i valori a schermo sono gli ultimi che il server ha.
    aspetta(6_000);
    expect(screen.queryByTestId("dati-in-ritardo")).toBeNull();
  });
});

describe("lo stile «non aggiornato» su tutta la pagina", () => {
  it("a runtime vale per ogni oggetto", () => {
    const { container } = render(<SvgCanvas objects={OGGETTI} nonAggiornato />);
    expect(grigi(container)).toHaveLength(OGGETTI.length);
  });

  it("in modifica no: è un segnale per l'operatore", () => {
    const { container } = render(<SvgCanvas objects={OGGETTI} nonAggiornato onMove={() => {}} />);
    expect(grigi(container)).toHaveLength(0);
  });
});
