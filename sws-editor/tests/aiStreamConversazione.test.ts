// L'id della conversazione nel socket della chat (10-11-2026): lo stesso a ogni
// riconnessione, così il server ritrova storia, spesa e banco; uno nuovo con
// «Svuota la conversazione». Prima il banco viveva quanto il socket e una base
// approvata spariva alla prima riconnessione.
import { afterEach, describe, expect, it, vi } from "vitest";

const istanze: { costruisciUrl: () => string; riaperture: number }[] = [];

vi.mock("@/ws/reconnectingWs", () => ({
  ReconnectingWs: class {
    riaperture = 0;
    constructor(readonly costruisciUrl: () => string) { istanze.push(this); }
    riapri() { this.riaperture += 1; }
    destroy() {}
  },
}));
vi.mock("@/ws/wsUrl", () => ({ buildWsUrl: () => "wss://ide.example/ws/ai?token=abc" }));
vi.mock("@/api/client", () => ({ getAuthToken: () => "tok" }));

import { aiStream, chiudiAiStream, idConversazione, nuovaConversazione, urlConConversazione }
  from "../src/ws/aiStream";

afterEach(() => { chiudiAiStream(); istanze.length = 0; });

describe("id della conversazione nel socket della chat", () => {
  it("aggiunge l'id con ? o & secondo la query già presente", () => {
    expect(urlConConversazione("wss://h/ws/ai", "c-1")).toBe("wss://h/ws/ai?conv=c-1");
    expect(urlConConversazione("wss://h/ws/ai?token=x", "c-1"))
      .toBe("wss://h/ws/ai?token=x&conv=c-1");
  });

  it("ogni riconnessione porta lo stesso id", () => {
    aiStream();
    const ws = istanze[0];
    const primo = ws.costruisciUrl();
    expect(primo).toContain(`conv=${encodeURIComponent(idConversazione())}`);
    expect(ws.costruisciUrl()).toBe(primo);
  });

  it("«Svuota la conversazione» sceglie un id nuovo e riapre il socket", () => {
    aiStream();
    const ws = istanze[0];
    const prima = idConversazione();
    nuovaConversazione();
    expect(idConversazione()).not.toBe(prima);
    expect(ws.riaperture).toBe(1);
    expect(ws.costruisciUrl()).toContain(`conv=${encodeURIComponent(idConversazione())}`);
  });
});
