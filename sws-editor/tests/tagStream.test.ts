/** I valori dei tag arrivano allo store una volta per fotogramma (piano
 *  2026-11-09-viewer-leggero, §5).
 *
 *  Fino al 09-11-2026 ogni voce di ogni messaggio era una scrittura nello
 *  store: una copia della mappa e un giro di tutti i selettori per voce. Sul
 *  WP630, con la pagina in ritardo, i messaggi si mettevano in coda. Qui si
 *  passa dal socket vero del modulo, con un `ReconnectingWs` finto sotto. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Il socket finto tiene gli ascoltatori come `ReconnectingWs`, e i messaggi
// del server si mandano a mano. Come `ReconnectingWs`, `send` col socket non
// aperto non manda niente; `nuovo()` fa quello che fa `socketCondiviso` quando
// cambia il token: un socket nuovo, che si sta ancora collegando.
const finto = vi.hoisted(() => {
  type Ascoltatore = (ev: unknown) => void;
  const crea = (readyState: number) => {
    const ascoltatori = new Map<string, Set<Ascoltatore>>();
    const s = {
      readyState,
      mandati: [] as unknown[],
      on(tipo: string, h: Ascoltatore) {
        if (!ascoltatori.has(tipo)) ascoltatori.set(tipo, new Set());
        ascoltatori.get(tipo)!.add(h);
      },
      off(tipo: string, h: Ascoltatore) { ascoltatori.get(tipo)?.delete(h); },
      send(data: string) {
        if (s.readyState !== 1) return false;
        s.mandati.push(JSON.parse(data));
        return true;
      },
      emetti(tipo: string, ev: unknown = {}) {
        for (const h of [...(ascoltatori.get(tipo) ?? [])]) h(ev);
      },
    };
    return s;
  };
  const f = {
    stream: crea(1), // WebSocket.OPEN
    nuovo(readyState = 0) { f.stream = crea(readyState); return f.stream; },
    manda(msg: unknown) { f.stream.emetti("message", { data: JSON.stringify(msg) }); },
  };
  return f;
});

vi.mock("@/ws/singletonWs", () => ({
  socketCondiviso: () => ({
    prendi: () => finto.stream,
    corrente: () => finto.stream,
    chiudi: () => {},
  }),
}));

import { useAppStore } from "@/store";
import { sendSubscribe, useTagStream } from "@/ws/tagStream";
import { azzeraRitmo, impostaFps, impostaPianificatore, RISERVA_MS, svuotaOra } from "@/ws/coalescenza";

const voce = (id: string, value: number, ts = 1_000, quality = "Good") => ({ id, value, quality, ts });

/** Monta il flusso e manda lo snapshot iniziale, come fa il server a ogni apertura. */
function monta() {
  renderHook(() => useTagStream());
  finto.manda({ type: "snapshot", seq: 0, tags: [] });
}

/** Conta gli avvisi dello store da qui in poi. */
function contaNotifiche() {
  const notifiche = vi.fn();
  const via = useAppStore.subscribe(notifiche);
  return { notifiche, via };
}

describe("i valori dei tag nello store, una volta per fotogramma", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    finto.nuovo(1);
    useAppStore.setState({ authToken: "prova", remoteConnected: false, tagValues: {} });
  });
  afterEach(() => {
    svuotaOra();
    impostaPianificatore();
    azzeraRitmo();
    impostaFps(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("tre delta da 10 voci nello stesso giro fanno una notifica sola, non trenta", () => {
    monta();
    const { notifiche, via } = contaNotifiche();
    for (let d = 0; d < 3; d++) {
      finto.manda({
        type: "delta",
        seq: d + 1,
        changed: Array.from({ length: 10 }, (_, i) => voce(`t${i}`, d * 10 + i)),
      });
    }
    vi.advanceTimersByTime(RISERVA_MS);
    via();
    expect(notifiche).toHaveBeenCalledTimes(1);
    // Per ogni tag vince l'ultima voce.
    expect(useAppStore.getState().tagValues.t3.value).toBe(23);
  });

  it("la stessa tripla arrivata due volte lascia la mappa com'è, senza notifiche", () => {
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 5)] });
    vi.advanceTimersByTime(RISERVA_MS);
    const prima = useAppStore.getState().tagValues;
    const { notifiche, via } = contaNotifiche();

    finto.manda({ type: "delta", seq: 2, changed: [voce("a", 5)] });
    vi.advanceTimersByTime(RISERVA_MS);
    via();
    expect(notifiche).not.toHaveBeenCalled();
    expect(useAppStore.getState().tagValues).toBe(prima);
  });

  it("stesso valore e stessa qualità con un timestamp nuovo si scrive: serve allo stale", () => {
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 5, 1_000)] });
    vi.advanceTimersByTime(RISERVA_MS);
    finto.manda({ type: "delta", seq: 2, changed: [voce("a", 5, 2_000)] });
    vi.advanceTimersByTime(RISERVA_MS);
    expect(useAppStore.getState().tagValues.a.timestamp_ms).toBe(2_000);
    finto.manda({ type: "delta", seq: 3, changed: [voce("a", 5, 2_000, "Bad")] });
    vi.advanceTimersByTime(RISERVA_MS);
    expect(useAppStore.getState().tagValues.a.quality).toBe("Bad");
  });

  it("uno snapshot da 500 voci fa una scrittura sola, e le altre voci restano", () => {
    useAppStore.setState({ tagValues: { altro: { value: 1, quality: "Good", timestamp_ms: 1 } } });
    monta();
    const { notifiche, via } = contaNotifiche();
    finto.manda({ type: "snapshot", seq: 1, tags: Array.from({ length: 500 }, (_, i) => voce(`s${i}`, i)) });
    vi.advanceTimersByTime(RISERVA_MS);
    via();
    expect(notifiche).toHaveBeenCalledTimes(1);
    const valori = useAppStore.getState().tagValues;
    expect(Object.keys(valori)).toHaveLength(501);
    expect(valori.altro.value).toBe(1);
    expect(valori.s499.value).toBe(499);
  });

  it("un ack con errore avvisa subito, senza aspettare il fotogramma", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    monta();
    const fallite = vi.fn();
    window.addEventListener("sws:write-failed", fallite);
    try {
      finto.manda({ type: "ack", tag: "a", ok: false, error: "rifiutata" });
      expect(fallite).toHaveBeenCalledTimes(1);
      expect((fallite.mock.calls[0][0] as CustomEvent).detail).toEqual({ tag: "a", error: "rifiutata" });
    } finally {
      window.removeEventListener("sws:write-failed", fallite);
    }
  });

  it("al più pannello.fps giri al secondo: un delta troppo vicino al giro di prima aspetta", () => {
    impostaFps(10);
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 1)] });
    vi.advanceTimersByTime(17); // il primo fotogramma
    expect(useAppStore.getState().tagValues.a?.value).toBe(1);
    finto.manda({ type: "delta", seq: 2, changed: [voce("a", 2)] });
    // 10 al secondo: il giro dopo non prima di 100 ms dal precedente.
    vi.advanceTimersByTime(60);
    expect(useAppStore.getState().tagValues.a?.value).toBe(1);
    vi.advanceTimersByTime(40 + RISERVA_MS);
    expect(useAppStore.getState().tagValues.a?.value).toBe(2);
  });

  it("al primo fotogramma i valori ci sono", () => {
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 7)] });
    vi.advanceTimersByTime(17);
    expect(useAppStore.getState().tagValues.a?.value).toBe(7);
  });

  it("senza fotogrammi, come in una scheda nascosta, i valori arrivano entro 100 ms", () => {
    // Un fotogramma chiesto e mai concesso.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 7)] });
    vi.advanceTimersByTime(RISERVA_MS);
    expect(useAppStore.getState().tagValues.a?.value).toBe(7);
  });

  it("molti messaggi chiedono un giro solo, e niente arriva prima del giro", () => {
    const giri: (() => void)[] = [];
    impostaPianificatore((cb) => { giri.push(cb); return () => {}; });
    monta();
    for (let d = 1; d <= 5; d++) finto.manda({ type: "delta", seq: d, changed: [voce("a", d)] });
    expect(giri).toHaveLength(1);
    expect(useAppStore.getState().tagValues.a).toBeUndefined();
    giri[0]();
    expect(useAppStore.getState().tagValues.a.value).toBe(5);
  });

  it("dopo uno snapshot non segnala un falso «seq gap»; un buco vero sì", () => {
    const avvisi = vi.spyOn(console, "warn").mockImplementation(() => {});
    monta();
    finto.manda({ type: "delta", seq: 1, changed: [voce("a", 1)] });
    finto.manda({ type: "delta", seq: 2, changed: [voce("a", 2)] });
    // Un subscribe nuovo: lo snapshot ha il suo contatore, i delta il loro.
    finto.manda({ type: "snapshot", seq: 1, tags: [voce("a", 2)] });
    finto.manda({ type: "delta", seq: 3, changed: [voce("a", 3)] });
    expect(avvisi).not.toHaveBeenCalled();
    finto.manda({ type: "delta", seq: 5, changed: [voce("a", 5)] });
    expect(avvisi).toHaveBeenCalledTimes(1);
  });
});

// Il filtro di pagina che non si perde (piano «viewer leggero», 09-11-2026,
// passo 4). L'apertura del socket mandava sempre `["*"]`, e la lista della
// pagina partiva solo quando cambiava: scartata se il socket non era aperto,
// sovrascritta a ogni riconnessione. Dopo l'avvio, un login o una
// riconnessione il viewer riceveva tutti i tag.
describe("la sottoscrizione voluta si manda a ogni apertura", () => {
  const sottoscrizioni = (s: { mandati: unknown[] }) =>
    s.mandati.filter((m) => (m as { type: string }).type === "subscribe").map((m) => (m as { tags: string[] }).tags);

  beforeEach(() => {
    useAppStore.setState({ authToken: "prova", remoteConnected: false, tagValues: {} });
  });
  afterEach(() => {
    sendSubscribe(["*"]);
  });

  it("chiesta col socket ancora in CONNECTING, parte all'apertura", () => {
    const s = finto.nuovo(0);
    renderHook(() => useTagStream());
    sendSubscribe(["a", "b"]);
    expect(s.mandati).toEqual([]);
    s.readyState = 1;
    s.emetti("open");
    expect(sottoscrizioni(s)).toEqual([["a", "b"]]);
  });

  it("dopo una riconnessione si rimanda la stessa", () => {
    const s = finto.nuovo(1);
    renderHook(() => useTagStream());
    sendSubscribe(["a", "b"]);
    s.readyState = 3;
    s.emetti("close");
    s.readyState = 1;
    s.emetti("open");
    expect(sottoscrizioni(s).at(-1)).toEqual(["a", "b"]);
  });

  it("dopo un cambio di token il socket nuovo parte con la stessa", () => {
    finto.nuovo(1);
    renderHook(() => useTagStream());
    sendSubscribe(["a", "b"]);
    const nuovo = finto.nuovo(0);
    act(() => { useAppStore.setState({ authToken: "altro" }); });
    nuovo.readyState = 1;
    nuovo.emetti("open");
    expect(sottoscrizioni(nuovo)[0]).toEqual(["a", "b"]);
  });

  it("una lista uguale a quella già voluta non si rimanda: il server risponderebbe con uno snapshot", () => {
    // Un progetto ricaricato uguale rifà le pagine, e la lista con esse.
    const s = finto.nuovo(1);
    renderHook(() => useTagStream());
    sendSubscribe(["a", "b"]);
    sendSubscribe(["a", "b"]);
    expect(sottoscrizioni(s)).toEqual([["*"], ["a", "b"]]);
    sendSubscribe(["a", "c"]);
    expect(sottoscrizioni(s).at(-1)).toEqual(["a", "c"]);
  });

  it("chi non sceglie i tag, come l'IDE, riceve tutto", () => {
    const s = finto.nuovo(0);
    renderHook(() => useTagStream());
    s.readyState = 1;
    s.emetti("open");
    expect(sottoscrizioni(s)).toEqual([["*"]]);
  });
});
