// La resa del socket che si riconnette — difetto misurato sul WP630 il 2026-09-08.
//
// Il relay chiudeva dicendo «non ritento», e il client ritentava lo stesso:
// 0,8s → 2,0s → 4,9s → 9,4s. L'attesa cresceva (quello funzionava) ma non si
// fermava mai. Due cause possibili, e questi test coprono entrambe: il codice
// di chiusura definitivo, e il caso in cui quel codice si perde e arriva 1006.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReconnectingWs } from "@/ws/reconnectingWs";

class FintoWs {
  static ultimo: FintoWs | null = null;
  static aperti = 0;
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
