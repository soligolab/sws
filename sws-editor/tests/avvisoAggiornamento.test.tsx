import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

// `vi.mock` è sollevato in cima al file, quindi non può leggere variabili
// dichiarate qui sopra: `vi.hoisted` è il modo di crearle prima di lui.
const { statoAggiornamento, avviaAggiornamento, getSystemStatus, aggiornaQuadlet, confermaAggiornamento } = vi.hoisted(() => ({
  statoAggiornamento: vi.fn(),
  avviaAggiornamento: vi.fn().mockResolvedValue({}),
  aggiornaQuadlet: vi.fn().mockResolvedValue({}),
  confermaAggiornamento: vi.fn().mockResolvedValue({}),
  // Il viewer chiede da sé se il progetto ha utenti: il test simula la
  // risposta del runtime, non inietta il valore nello store (è così che il
  // difetto del 28-09 era rimasto invisibile).
  getSystemStatus: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoAggiornamento, avviaAggiornamento, getSystemStatus, aggiornaQuadlet, confermaAggiornamento } };
});

// Le parole non vengono più da i18next: dal 29-09-2026 stanno nella tabella
// del testo di sistema, in cinque lingue e nella lingua dei **contenuti**.
// Il test le prende dalla stessa tabella del componente — non le riscrive a
// mano, o verificherebbe la propria copia.
import { testoSistema, testoSistemaCon } from "../src/i18n/testiSistema";
/** La lingua dei contenuti che `useLinguaContenuti` dà a progetto assente. */
const L = "en";
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
    fireEvent.click(await screen.findByText(testoSistema("agg_piu_tardi", L)));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("«Ignora questa versione» ricorda, ma solo quella versione", async () => {
    const { unmount } = render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(testoSistema("agg_ignora", L)));
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
    fireEvent.click(screen.getByText(testoSistema("esito_chiudi", L)));
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
    const riquadro = (await screen.findByRole("dialog")).textContent ?? "";
    // Il titolo dice cosa è successo, la riga sotto con quali versioni: prima
    // stavano insieme, e si leggevano come l'annuncio di un aggiornamento.
    expect(riquadro).toContain(testoSistema("esito_titolo_ko", L));
    expect(riquadro).toContain(testoSistemaCon("esito_spiega", L, { da: "2.12.0-rc.8", a: "2.12.0-rc.9" }));
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

  // ── Il quadlet che viaggia (02-10-2026) ────────────────────────────────────
  const QUADLET_VECCHIO = { installata: 0, attesa: 1, da_aggiornare: true, si_puo_aggiornare: true, motivo: null, ultimo_esito: null };

  it("senza utenti e con la configurazione del servizio vecchia, la offre e la aggiorna", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 100, quadlet: QUADLET_VECCHIO });
    aggiornaQuadlet.mockClear();
    render(<AvvisoAggiornamento />);
    expect(await screen.findByText(new RegExp(testoSistema("quadlet_titolo", L)))).toBeTruthy();
    expect(screen.getByText(testoSistemaCon("quadlet_spiega", L, { da: "0", a: "1" }))).toBeTruthy();
    fireEvent.click(screen.getByText(testoSistema("agg_aggiorna", L)));
    await waitFor(() => expect(aggiornaQuadlet).toHaveBeenCalledTimes(1));
  });

  it("con utenti, o se il pannello non sa aggiornarla da sé, non la offre", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    getSystemStatus.mockResolvedValue({ auth_required: true, uptime_s: 100, quadlet: QUADLET_VECCHIO });
    const { unmount } = render(<AvvisoAggiornamento />);
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 100, quadlet: { ...QUADLET_VECCHIO, si_puo_aggiornare: false } });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByText(new RegExp(testoSistema("quadlet_titolo", L)))).toBeNull();
  });

  // ── Dopo un aggiornamento: confermare, rimandare, tornare (03-10-2026) ──────
  const DOMANDA = { da: "2.12.0-rc.17", a: "2.12.0-rc.18", istantanea: true, istantanea_quando_ms: 1, recuperabili_byte: 5e8 };
  const CONFERMA = { domanda: DOMANDA, pulizia_al_prossimo_avvio: false, ultima_pulizia: null, ultimo_ritorno: null, in_corso: null };
  const daA = { da: DOMANDA.da, a: DOMANDA.a };

  it("senza utenti propone le quattro scelte, e «Conferma e pulisci» risponde e chiude", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 300, conferma_aggiornamento: CONFERMA });
    confermaAggiornamento.mockClear();
    render(<AvvisoAggiornamento />);
    expect(await screen.findByText(testoSistema("conf_titolo", L))).toBeTruthy();
    expect(screen.getByText(testoSistemaCon("conf_spiega", L, daA))).toBeTruthy();
    // C'è l'istantanea: lo si dice, perché tornando si perde quanto scritto dopo.
    expect(screen.getByText(testoSistema("conf_dati", L))).toBeTruthy();
    for (const k of ["agg_piu_tardi", "conf_dopo_riavvio", "conf_pulisci"] as const) expect(screen.getByText(testoSistema(k, L))).toBeTruthy();
    fireEvent.click(screen.getByText(testoSistema("conf_pulisci", L)));
    await waitFor(() => expect(confermaAggiornamento).toHaveBeenCalledWith("pulisci"));
    await waitFor(() => expect(screen.queryByText(testoSistema("conf_titolo", L))).toBeNull());
  });

  it("«Torna» chiede conferma prima di partire, e si può annullare", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    getSystemStatus.mockResolvedValue({ auth_required: false, uptime_s: 300, conferma_aggiornamento: CONFERMA });
    confermaAggiornamento.mockClear();
    render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(testoSistemaCon("conf_ritorna", L, daA)));
    // Il primo clic non torna: chiede se davvero.
    expect(confermaAggiornamento).not.toHaveBeenCalled();
    expect(screen.getByText(testoSistemaCon("conf_ritorna_sicuro", L, daA))).toBeTruthy();
    fireEvent.click(screen.getByText(testoSistema("conf_annulla", L)));
    expect(screen.queryByText(testoSistemaCon("conf_ritorna_sicuro", L, daA))).toBeNull();
    fireEvent.click(screen.getByText(testoSistemaCon("conf_ritorna", L, daA)));
    fireEvent.click(screen.getByText(testoSistemaCon("conf_ritorna", L, daA)));
    await waitFor(() => expect(confermaAggiornamento).toHaveBeenCalledWith("ritorna"));
  });

  it("con utenti la domanda non compare sul pannello (si risponde dall'IDE)", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    getSystemStatus.mockResolvedValue({ auth_required: true, uptime_s: 300, conferma_aggiornamento: CONFERMA });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalled());
    expect(screen.queryByText(testoSistema("conf_titolo", L))).toBeNull();
  });
});
