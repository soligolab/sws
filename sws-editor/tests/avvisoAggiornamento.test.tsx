import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

// `vi.mock` è sollevato in cima al file, quindi non può leggere variabili
// dichiarate qui sopra: `vi.hoisted` è il modo di crearle prima di lui.
const { statoAggiornamento, avviaAggiornamento, getSystemStatus } = vi.hoisted(() => ({
  statoAggiornamento: vi.fn(),
  avviaAggiornamento: vi.fn().mockResolvedValue({}),
  // Il viewer chiede da sé se il progetto ha utenti: il test simula la
  // risposta del runtime, non inietta il valore nello store (è così che il
  // difetto del 28-09 era rimasto invisibile).
  getSystemStatus: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoAggiornamento, avviaAggiornamento, getSystemStatus } };
});

import i18n from "../src/i18n";
import { AvvisoAggiornamento, CONTROLLO_RIAVVIO_MS, ripartito } from "../src/runtime-view/AvvisoAggiornamento";

/** L'avviso di versione nuova sullo schermo del pannello (decisioni 41 e 44).
 *  Le regole di comparsa sono la parte che si sbaglia in silenzio: un avviso
 *  che non compare non lo segnala nessuno. */
const NUOVA = {
  versione: "2.12.0-rc.2", immagine: "ghcr.io/x:rc-arm64", canale: "prova" as const,
  disponibile: "2.12.0-rc.3", errore: null,
  novita: [{ versione: "2.12.0-rc.3", testo: "cose nuove", compatibilita: "i progetti vanno riaperti" }],
};

describe("avviso di aggiornamento sul pannello", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    statoAggiornamento.mockReset().mockResolvedValue(NUOVA);
    avviaAggiornamento.mockClear();
    getSystemStatus.mockReset().mockResolvedValue({ auth_required: false, uptime_s: 100 });
  });

  it("senza utenti e con una versione nuova, compare", async () => {
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // Gli avvisi di compatibilità si vedono senza doverli aprire.
    expect(screen.getByText(/progetti vanno riaperti/)).toBeTruthy();
  });

  /** Con utenti definiti l'aggiornamento è dell'Admin, dall'IDE: sullo
   *  schermo non compare niente — e non si chiede nemmeno al registry. */
  it("con utenti definiti non compare, e non interroga il registry", async () => {
    getSystemStatus.mockResolvedValue({ auth_required: true, uptime_s: 100 });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("senza una versione nuova non compare", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«Più tardi» chiude ma non ricorda", async () => {
    const { unmount } = render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(i18n.t("aggiornamentoPannello.piuTardi")));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("«Ignora questa versione» ricorda, ma solo quella versione", async () => {
    const { unmount } = render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(i18n.t("aggiornamentoPannello.ignora")));
    unmount();
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();

    // Ma se ne esce una ancora più nuova, l'avviso torna.
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: "2.12.0-rc.4" });
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("un riavvio si riconosce dall'uptime che torna indietro", () => {
    expect(ripartito(null, 5)).toBe(false);
    expect(ripartito(100, 160)).toBe(false);
    expect(ripartito(4498, 12)).toBe(true);
  });

  /** Il caso del TC620 del 28-09: il viewer era carico da ore, il runtime è
   *  ripartito con una versione nuova nel canale, e la pagina non si ricarica. */
  it("quando il runtime riparte, ricontrolla e l'avviso compare senza ricaricare la pagina", async () => {
    vi.useFakeTimers();
    try {
      statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
      getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 4498 });
      render(<AvvisoAggiornamento />);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      // Il runtime riparte (uptime da capo) e ora nel canale c'è una versione nuova.
      getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 12 });
      statoAggiornamento.mockResolvedValue(NUOVA);
      await vi.advanceTimersByTimeAsync(CONTROLLO_RIAVVIO_MS);
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Fase 3 (decisioni 52-54): dopo un aggiornamento, anche del pilota
   *  automatico, il pannello dice com'è andata. */
  it("dopo un aggiornamento riuscito dice da dove a dove, e chiuso non ricompare", async () => {
    statoAggiornamento.mockResolvedValue({
      ...NUOVA, versione: "2.12.0-rc.9", disponibile: null, novita: [],
      evento: { id: 7, da: "2.12.0-rc.8", a: "2.12.0-rc.9", esito: "riuscito" },
      novita_installata: { versione: "2.12.0-rc.9", testo: "- breve", testo_en: "- short" },
    });
    const { unmount } = render(<AvvisoAggiornamento />);
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toContain("2.12.0-rc.8");
    expect(d.textContent).toContain("2.12.0-rc.9");
    fireEvent.click(screen.getByText(i18n.t("esitoPannello.chiudi")));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("un aggiornamento non riuscito lo dice, anche se la versione è quella di prima", async () => {
    statoAggiornamento.mockResolvedValue({
      ...NUOVA, disponibile: null, novita: [],
      evento: { id: 8, da: "2.12.0-rc.8", a: "2.12.0-rc.9", esito: "non_riuscito" },
    });
    render(<AvvisoAggiornamento />);
    expect((await screen.findByRole("dialog")).textContent).toContain(i18n.t("esitoPannello.nonRiuscito", { a: "2.12.0-rc.9" }));
  });

  /** L'esito «riuscito» arriva un paio di minuti dopo il ricaricamento della pagina. */
  it("mentre un aggiornamento è in corso, richiede finché l'esito arriva", async () => {
    vi.useFakeTimers();
    try {
      statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [], in_corso: true });
      render(<AvvisoAggiornamento />);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      statoAggiornamento.mockResolvedValue({
        ...NUOVA, disponibile: null, novita: [],
        evento: { id: 9, da: "2.12.0-rc.8", a: "2.12.0-rc.9", esito: "riuscito" },
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
