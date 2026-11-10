// La chat quando cambiano token e utente (10-11-2026).
//
// Il difetto: con la chat aperta prima dell'accesso, il pannello restava in
// ascolto sul socket aperto col token vecchio e mostrava «…» per sempre al
// posto del modello. `aiStream()` rifaceva il socket alla chiamata dopo, ma
// come istanza nuova e senza ascoltatori.
//
// E la regola che ne è venuta: lo stesso utente che rinnova o rientra ritrova
// la conversazione (stesso `?conv=`); l'uscita o un utente diverso ne aprono
// una nuova, e la chat si svuota. Qui con lo store vero (`setAuth`,
// `clearAuth`), il `ReconnectingWs` vero e un WebSocket finto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FintoWs {
  static tutti: FintoWs[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  chiuso = false;
  private ascolto = new Map<string, Set<(ev: unknown) => void>>();
  constructor(public url: string) { FintoWs.tutti.push(this); }
  addEventListener(t: string, h: (ev: unknown) => void) {
    if (!this.ascolto.has(t)) this.ascolto.set(t, new Set());
    this.ascolto.get(t)!.add(h);
  }
  removeEventListener(t: string, h: (ev: unknown) => void) { this.ascolto.get(t)?.delete(h); }
  close() { this.chiuso = true; }
  send() {}
  apri() { this.readyState = 1; this.ascolto.get("open")?.forEach((h) => h({})); }
  ricevi(m: unknown) { this.ascolto.get("message")?.forEach((h) => h({ data: JSON.stringify(m) })); }
  chiudi(code = 1006) {
    this.readyState = 3;
    this.ascolto.get("close")?.forEach((h) => h({ code, reason: "" }));
  }
}

vi.mock("@/ws/wsUrl", async () => {
  const { getAuthToken } = await import("@/api/client");
  return { buildWsUrl: () => `wss://ide.example/ws/ai?token=${getAuthToken() ?? ""}` };
});

const { useAppStore } = await import("@/store");
const { ascolta, cambioDiAccesso, chiudiAiStream, idConversazione, suConversazioneNuova } =
  await import("../src/ws/aiStream");

const ultimo = () => FintoWs.tutti[FintoWs.tutti.length - 1];
const accedi = (token: string, utente = "anna") => useAppStore.getState().setAuth(token, utente, "Admin");
const esci = () => useAppStore.getState().clearAuth();

beforeEach(() => {
  vi.useFakeTimers();
  esci();
  FintoWs.tutti = [];
  vi.stubGlobal("WebSocket", FintoWs as unknown as typeof WebSocket);
});
afterEach(() => { chiudiAiStream(); esci(); vi.useRealTimers(); });

describe("la chat quando cambia il token", () => {
  it("all'accesso rifà il socket col token nuovo, stesso id, e chi ascoltava riceve il «pronto»", () => {
    const ricevuti: string[] = [];
    const smetti = ascolta((m) => { if (m.t === "pronto") ricevuti.push(m.modello); });
    const primo = ultimo();
    expect(primo.url).toContain("token=&");
    const conv = idConversazione();

    accedi("nuovo");
    const secondo = ultimo();
    expect(secondo).not.toBe(primo);
    expect(primo.chiuso).toBe(true);
    expect(secondo.url).toContain("token=nuovo");
    expect(secondo.url).toContain(`conv=${encodeURIComponent(conv)}`);

    secondo.apri();
    secondo.ricevi({ t: "pronto", modello: "claude-x", attivo: true, ripresa: true });
    expect(ricevuti).toEqual(["claude-x"]);
    smetti();
  });

  it("lo stesso token riscritto non tocca il socket", () => {
    accedi("a");
    const smetti = ascolta(() => {});
    const n = FintoWs.tutti.length;
    accedi("a");
    expect(FintoWs.tutti.length).toBe(n);
    smetti();
  });

  it("riapre anche un socket che si era arreso senza token", () => {
    const ricevuti: string[] = [];
    const smetti = ascolta((m) => { if (m.t === "pronto") ricevuti.push(m.modello); });
    // Sei fallimenti di fila: il socket smette di ritentare.
    for (let i = 0; i < 8; i++) { ultimo().chiudi(); vi.advanceTimersByTime(60_000); }
    const arresi = FintoWs.tutti.length;
    vi.advanceTimersByTime(120_000);
    expect(FintoWs.tutti.length).toBe(arresi);

    accedi("dopo-l-accesso");
    expect(FintoWs.tutti.length).toBe(arresi + 1);
    ultimo().apri();
    ultimo().ricevi({ t: "pronto", modello: "claude-y", attivo: true });
    expect(ricevuti).toEqual(["claude-y"]);
    smetti();
  });

  it("chi si mette in ascolto dopo il «pronto» lo riceve, come ripresa", () => {
    accedi("t1");
    const smetti = ascolta(() => {});
    ultimo().apri();
    ultimo().ricevi({ t: "pronto", modello: "claude-z", attivo: false, motivo: "nessuna chiave" });
    smetti();

    const tardi: { modello: string; ripresa?: boolean }[] = [];
    const smetti2 = ascolta((m) => { if (m.t === "pronto") tardi.push({ modello: m.modello, ripresa: m.ripresa }); });
    expect(tardi).toEqual([{ modello: "claude-z", ripresa: true }]);
    smetti2();
  });
});

describe("la chat quando cambia l'utente", () => {
  it("lo stesso utente che rinnova la sessione ritrova la conversazione", () => {
    accedi("t1", "anna");
    const smetti = ascolta(() => {});
    const conv = idConversazione();
    let svuotata = 0;
    const smetti2 = suConversazioneNuova(() => { svuotata += 1; });

    accedi("t2", "anna");
    expect(idConversazione()).toBe(conv);
    expect(ultimo().url).toContain("token=t2");
    expect(ultimo().url).toContain(`conv=${encodeURIComponent(conv)}`);
    expect(svuotata).toBe(0);
    smetti(); smetti2();
  });

  it("un utente diverso, o l'uscita, apre una conversazione nuova e svuota la chat", () => {
    accedi("t1", "anna");
    const smetti = ascolta(() => {});
    const diAnna = idConversazione();
    let svuotata = 0;
    const smetti2 = suConversazioneNuova(() => { svuotata += 1; });

    accedi("t9", "bruno");
    expect(idConversazione()).not.toBe(diAnna);
    expect(ultimo().url).toContain(`conv=${encodeURIComponent(idConversazione())}`);
    expect(svuotata).toBe(1);

    const diBruno = idConversazione();
    esci();
    expect(idConversazione()).not.toBe(diBruno);
    expect(svuotata).toBe(2);
    smetti(); smetti2();
  });

  it("la regola, da sola", () => {
    const a = (token: string | null, utente: string | null) => ({ token, utente });
    expect(cambioDiAccesso(a("t", "anna"), a("t", "anna"))).toBe("niente");
    expect(cambioDiAccesso(a("t", "anna"), a("u", "anna"))).toBe("ricollega");
    expect(cambioDiAccesso(a(null, null), a("u", "anna"))).toBe("ricollega");
    expect(cambioDiAccesso(a("t", "anna"), a("u", "bruno"))).toBe("nuova");
    expect(cambioDiAccesso(a("t", "anna"), a(null, null))).toBe("nuova");
  });
});
