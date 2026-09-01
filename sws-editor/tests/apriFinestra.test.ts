// L'helper della finestra staccata, e il difetto che non deve ripetere.
//
// In jsdom `window.open` lancia «Not implemented» e restituisce `undefined`
// (`jsdom/lib/jsdom/browser/Window.js`), quindi va stubbata in ogni test: senza
// stub non si proverebbe niente, e con uno stub sbagliato si proverebbe il
// contrario di quello che serve.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apriFinestra, sorvegliaChiusura } from "@/apriFinestra";

describe("apriFinestra", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open");
    // `location.assign` non è spiabile direttamente in jsdom: si sostituisce
    // l'oggetto. Serve per provare che NON venga chiamata.
    assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("apre una finestra vera e restituisce l'handle", () => {
    const finta = { closed: false, focus: vi.fn() } as unknown as Window;
    openSpy.mockReturnValue(finta);

    const esito = apriFinestra("/index-log.html", "sws-log", { larghezza: 500, altezza: 400 });

    expect(esito.win).toBe(finta);
    expect(esito.bloccata).toBe(false);
    expect(esito.riusata).toBe(false);
    const [url, nome, caratteristiche] = openSpy.mock.calls[0] as [string, string, string];
    expect(url).toBe("/index-log.html");
    expect(nome).toBe("sws-log");
    expect(caratteristiche).toContain("popup=yes");
    expect(caratteristiche).toContain("width=500");
    // Niente noopener: con quello perderemmo handle e rilevamento del blocco.
    expect(caratteristiche).not.toContain("noopener");
  });

  it("popup bloccato: lo dice, e NON naviga via dalla pagina corrente", () => {
    openSpy.mockReturnValue(null);

    const esito = apriFinestra("/index-log.html", "sws-log");

    expect(esito.bloccata).toBe(true);
    expect(esito.win).toBeNull();
    // Il verso rotto: è esattamente ciò che fa `RuntimeView.tsx:302-305`, e per
    // un pannello dell'editor porterebbe via il progetto non salvato.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("`undefined` di jsdom vale come bloccata, non come riuscita", () => {
    openSpy.mockReturnValue(undefined as unknown as Window);
    expect(apriFinestra("/x", "n").bloccata).toBe(true);
  });

  it("se `window.open` lancia, è bloccata e non si propaga", () => {
    openSpy.mockImplementation(() => { throw new Error("Not implemented"); });
    expect(() => apriFinestra("/x", "n")).not.toThrow();
    expect(apriFinestra("/x", "n").bloccata).toBe(true);
  });

  it("riusa una finestra viva: focus, e nessuna ri-navigazione", () => {
    const viva = { closed: false, focus: vi.fn() } as unknown as Window;

    const esito = apriFinestra("/index-log.html", "sws-log", { handle: viva });

    expect(esito.riusata).toBe(true);
    expect(viva.focus).toHaveBeenCalledTimes(1);
    // Il verso rotto che conta: senza il ramo di riuso si riaprirebbe lo stesso
    // URL, il documento si ricaricherebbe e — per la chat — la conversazione
    // morirebbe, perché vive nel socket lato server.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("ma un handle chiuso non si riusa: si riapre", () => {
    const morta = { closed: true, focus: vi.fn() } as unknown as Window;
    openSpy.mockReturnValue({ closed: false, focus: vi.fn() } as unknown as Window);

    const esito = apriFinestra("/index-log.html", "sws-log", { handle: morta });

    expect(esito.riusata).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(morta.focus).not.toHaveBeenCalled();
  });
});

describe("sorvegliaChiusura", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("avvisa una volta sola quando la finestra si chiude", () => {
    const win = { closed: false } as unknown as Window;
    const quando = vi.fn();
    sorvegliaChiusura(win, quando);

    vi.advanceTimersByTime(3000);
    expect(quando).not.toHaveBeenCalled();

    (win as { closed: boolean }).closed = true;
    vi.advanceTimersByTime(1000);
    expect(quando).toHaveBeenCalledTimes(1);

    // Il verso rotto: senza `clearInterval` dopo lo scatto, la callback
    // continuerebbe a essere chiamata a ogni secondo.
    vi.advanceTimersByTime(5000);
    expect(quando).toHaveBeenCalledTimes(1);
  });

  it("il cancellatore ferma la sorveglianza", () => {
    const win = { closed: false } as unknown as Window;
    const quando = vi.fn();
    const ferma = sorvegliaChiusura(win, quando);
    ferma();

    (win as { closed: boolean }).closed = true;
    vi.advanceTimersByTime(5000);
    expect(quando).not.toHaveBeenCalled();
  });
});
