// La resa del socket che si riconnette — difetto misurato sul WP630 il 2026-09-08.
//
// Il relay chiudeva dicendo «non ritento», e il client ritentava lo stesso:
// 0,8s → 2,0s → 4,9s → 9,4s. L'attesa cresceva (quello funzionava) ma non si
// fermava mai. Due cause possibili, e questi test coprono entrambe: il codice
// di chiusura definitivo, e il caso in cui quel codice si perde e arriva 1006.
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ReconnectingWs } from "@/ws/reconnectingWs";

// I messaggi che il codice sotto test restituisce passano dal catalogo: qui si legge quello italiano.
i18n.changeLanguage("it");

class FintoWs {
  static ultimo: FintoWs | null = null;
  static aperti = 0;
  // Le costanti del WebSocket vero: `riprovaSubito` le legge.
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  constructor(public url: string) { FintoWs.ultimo = this; FintoWs.aperti += 1; }
  addEventListener(t: string, h: (ev: unknown) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(h);
  }
  removeEventListener(t: string, h: (ev: unknown) => void) { this.listeners.get(t)?.delete(h); }
  close() { /* noop */ }
  /** Simula apertura e chiusura immediata: è ciò che fa un relay che fallisce. */
  fallisci(code: number, reason = "") {
    this.listeners.get("open")?.forEach((h) => h({}));
    this.listeners.get("close")?.forEach((h) => h({ code, reason }));
  }
}

describe("ReconnectingWs — quando smettere", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FintoWs.aperti = 0; FintoWs.ultimo = null;
    vi.stubGlobal("WebSocket", FintoWs as unknown as typeof WebSocket);
  });

  it("si arrende subito sul codice definitivo, riportando il motivo", () => {
    const motivi: string[] = [];
    new ReconnectingWs(() => "ws://x/ws/remote/logs", (m) => motivi.push(m));
    FintoWs.ultimo!.fallisci(4404, "il pannello non espone i log da remoto");

    vi.advanceTimersByTime(120_000);
    expect(FintoWs.aperti).toBe(1);          // nessun tentativo dopo il primo
    expect(motivi).toEqual(["il pannello non espone i log da remoto"]);
  });

  it("si arrende anche se il codice si perde e arriva 1006", () => {
    // È il caso che ha morso davvero: il browser vede «chiusa in modo anomalo»
    // e il motivo scritto dal server non arriva.
    const motivi: string[] = [];
    new ReconnectingWs(() => "ws://x/ws/remote/logs", (m) => motivi.push(m));
    for (let i = 0; i < 12; i++) {
      FintoWs.ultimo!.fallisci(1006);
      vi.advanceTimersByTime(60_000);
    }
    expect(FintoWs.aperti).toBeLessThanOrEqual(6);
    expect(motivi).toHaveLength(1);
    expect(motivi[0]).toContain("stabile");
  });

  it("un collegamento che REGGE azzera il conteggio: un riavvio non spegne il flusso", () => {
    new ReconnectingWs(() => "ws://x/ws/remote/tags");
    // Cinque cadute, poi uno che regge: non ci si deve arrendere al sesto.
    for (let i = 0; i < 5; i++) { FintoWs.ultimo!.fallisci(1006); vi.advanceTimersByTime(60_000); }
    const vivo = FintoWs.ultimo!;
    vivo.addEventListener("open", () => {});
    // Apre, resta su oltre la soglia di stabilità, poi cade.
    (vivo as unknown as { listeners: Map<string, Set<(e: unknown) => void>> })
      .listeners.get("open")?.forEach((h) => h({}));
    vi.advanceTimersByTime(10_000);
    (vivo as unknown as { listeners: Map<string, Set<(e: unknown) => void>> })
      .listeners.get("close")?.forEach((h) => h({ code: 1006, reason: "" }));
    const dopoIlBuono = FintoWs.aperti;
    vi.advanceTimersByTime(60_000);
    expect(FintoWs.aperti).toBeGreaterThan(dopoIlBuono);   // ha ripreso a provare
  });
});

// La chat dell'assistente dopo un cambio di chiave o di modello (revisione del
// 04-11-2026): `destroy()` lasciava il pannello ad ascoltare un'istanza morta.
describe("ReconnectingWs — riapri", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FintoWs.aperti = 0; FintoWs.ultimo = null;
    vi.stubGlobal("WebSocket", FintoWs as unknown as typeof WebSocket);
  });

  it("apre subito un socket nuovo con gli stessi ascoltatori, e la chiusura del vecchio non ne apre un terzo", () => {
    const r = new ReconnectingWs(() => "ws://x/ws/ai");
    const ricevuti: unknown[] = [];
    r.on("message", (ev) => ricevuti.push(ev));
    const vecchio = FintoWs.ultimo!;
    r.riapri();
    const nuovo = FintoWs.ultimo!;
    expect(nuovo).not.toBe(vecchio);
    expect(FintoWs.aperti).toBe(2);
    // L'ascoltatore registrato prima è sul socket nuovo.
    (nuovo as unknown as { listeners: Map<string, Set<(e: unknown) => void>> }).listeners
      .get("message")!.forEach((h) => h({ data: "pronto" }));
    expect(ricevuti).toHaveLength(1);
    // Il «close» tardivo del vecchio non programma un altro tentativo.
    vecchio.fallisci(1000);
    vi.advanceTimersByTime(60_000);
    expect(FintoWs.aperti).toBe(2);
  });
});

// Il runtime fermato 15 s sul WP630 (10-11-2026): col runtime già in piedi il
// socket aspettava il suo giro (fino a 30 s), e oltre il minuto si arrendeva
// per sempre. Chi sa che il runtime è tornato lo fa riprovare subito.
describe("ReconnectingWs — riprovaSubito", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FintoWs.aperti = 0; FintoWs.ultimo = null;
    vi.stubGlobal("WebSocket", FintoWs as unknown as typeof WebSocket);
  });

  it("non aspetta il giro dell'attesa", () => {
    const r = new ReconnectingWs(() => "ws://x/ws/tags");
    for (let i = 0; i < 3; i++) {
      FintoWs.ultimo!.fallisci(1006);
      vi.advanceTimersByTime(10_000);
    }
    FintoWs.ultimo!.fallisci(1006);   // il prossimo giro sarebbe fra ~8 s
    FintoWs.ultimo!.readyState = 3;
    const prima = FintoWs.aperti;
    r.riprovaSubito();
    expect(FintoWs.aperti).toBe(prima + 1);
    // Il giro vecchio non apre un secondo socket.
    vi.advanceTimersByTime(20_000);
    expect(FintoWs.aperti).toBe(prima + 1);
  });

  it("riapre un socket che si era arreso", () => {
    const r = new ReconnectingWs(() => "ws://x/ws/tags");
    for (let i = 0; i < 12; i++) {
      FintoWs.ultimo!.fallisci(1006);
      vi.advanceTimersByTime(60_000);
    }
    expect(r.resa).not.toBeNull();
    FintoWs.ultimo!.readyState = 3;
    const prima = FintoWs.aperti;
    r.riprovaSubito();
    expect(FintoWs.aperti).toBe(prima + 1);
    expect(r.resa).toBeNull();
  });

  it("non tocca un socket aperto, né uno chiuso con destroy()", () => {
    const r = new ReconnectingWs(() => "ws://x/ws/tags");
    FintoWs.ultimo!.readyState = 1;
    r.riprovaSubito();
    expect(FintoWs.aperti).toBe(1);
    r.destroy();
    r.riprovaSubito();
    expect(FintoWs.aperti).toBe(1);
  });
});
