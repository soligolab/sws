/** Le attese del login e dell'aggiornamento (piano 2026-11-09-viewer-leggero,
 *  §5-bis; decisione del maintainer del 09-11-2026, «Avviso 10 s, stop 60 s»).
 *
 *  Sul WP630 in affanno il login restava su «Accesso…» per minuti e sembrava
 *  bloccato; e dopo il login chiesto da «Aggiorna ora» non si capiva se
 *  l'aggiornamento stesse partendo. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { login, identitaStato, statoAggiornamento, avviaAggiornamento, getSystemStatus } = vi.hoisted(() => ({
  login: vi.fn(),
  identitaStato: vi.fn(),
  statoAggiornamento: vi.fn(),
  avviaAggiornamento: vi.fn(),
  getSystemStatus: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...vero, api: { ...vero.api, login, identitaStato, statoAggiornamento, avviaAggiornamento, getSystemStatus } };
});

import i18n from "i18next";
import "../src/i18n/index";
import { LoginScreen } from "@/components/LoginScreen";
import { AvvisoAggiornamento } from "@/runtime-view/AvvisoAggiornamento";
import { testoSistema } from "@/i18n/testiSistema";
import { useAppStore } from "@/store";

/** La lingua dei contenuti che `useLinguaContenuti` dà a progetto assente. */
const L = "en";
const NUOVA = {
  versione: "2.26.0-rc.9", immagine: "ghcr.io/x:rc-arm64", canale: "prova" as const,
  disponibile: "2.26.0-rc.10", errore: null, novita: [],
};
const ADMIN = { token: "token-admin", username: "admin", role: "Admin" };

/** Una promessa che si risolve a mano. */
function sospesa<T>() {
  let risolvi!: (v: T) => void;
  const p = new Promise<T>((r) => { risolvi = r; });
  return { p, risolvi };
}

/** Un login che non risponde mai: come `fetch`, si ferma solo se lo si annulla. */
function senzaRisposta(_u: string, _p: string, _r?: boolean, _ra?: boolean, segnale?: AbortSignal) {
  return new Promise((_, rifiuta) => {
    segnale?.addEventListener("abort", () => rifiuta(new DOMException("Aborted", "AbortError")));
  });
}

const pulsanteAccesso = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const campoPassword = () => document.querySelector('input[type="password"]') as HTMLInputElement | null;

beforeEach(() => {
  login.mockReset();
  identitaStato.mockReset().mockResolvedValue({ gestita: false });
  statoAggiornamento.mockReset().mockResolvedValue(NUOVA);
  avviaAggiornamento.mockReset();
  getSystemStatus.mockReset().mockResolvedValue({ auth_required: false, uptime_s: 100 });
  useAppStore.getState().clearAuth?.();
});

describe("il login di un pannello lento", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a 10 s dice che il pannello è lento, a 60 s si ferma e si può riprovare", async () => {
    vi.useFakeTimers();
    login.mockImplementation(senzaRisposta);
    render(<LoginScreen />);
    await act(() => vi.advanceTimersByTimeAsync(0)); // «admin» arriva da identitaStato
    fireEvent.change(campoPassword()!, { target: { value: "segreta" } });
    fireEvent.click(pulsanteAccesso());
    expect(pulsanteAccesso().textContent).toBe(i18n.t("auth.loggingIn"));

    // I due tempi sono la decisione del maintainer, scritti qui per esteso.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(pulsanteAccesso().textContent).toBe(i18n.t("login.rispondeLentamente"));
    expect(screen.queryByText(i18n.t("login.nessunaRisposta"))).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(49_000));
    expect(screen.queryByText(i18n.t("login.nessunaRisposta"))).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText(i18n.t("login.nessunaRisposta"))).toBeTruthy();
    expect(pulsanteAccesso().textContent).toBe(i18n.t("auth.login"));
    expect(pulsanteAccesso().disabled).toBe(false);
  });

  it("con le credenziali dell'installazione a essere lento è il server, non un pannello", async () => {
    // L'IDE (8460, il gateway): lì un pannello non c'è.
    vi.useFakeTimers();
    identitaStato.mockResolvedValue({ gestita: true });
    login.mockImplementation(senzaRisposta);
    render(<LoginScreen />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: "a@b.it" } });
    fireEvent.change(campoPassword()!, { target: { value: "segreta" } });
    fireEvent.click(pulsanteAccesso());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(pulsanteAccesso().textContent).toBe(i18n.t("login.serverRispondeLentamente"));
    expect(pulsanteAccesso().textContent).not.toBe(i18n.t("login.rispondeLentamente"));
    await act(() => vi.advanceTimersByTimeAsync(50_000));
    expect(screen.getByText(i18n.t("login.nessunaRisposta"))).toBeTruthy();
  });

  it("il segnale arriva alla richiesta, e l'annullamento non si legge come runtime irraggiungibile", async () => {
    const { api: vera } = await vi.importActual<typeof import("@/api/client")>("@/api/client");
    const fetchFinta = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, rifiuta) => {
      init?.signal?.addEventListener("abort", () => rifiuta(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchFinta);
    try {
      const ctrl = new AbortController();
      const risposta = vera.login("admin", "segreta", false, false, ctrl.signal);
      expect(fetchFinta.mock.calls[0]?.[1]?.signal).toBe(ctrl.signal);
      ctrl.abort();
      await expect(risposta).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("«Aggiornamento in avvio…» dal tocco alla partenza", () => {
  const aggiornaOra = () => screen.getAllByRole("button").find((b) =>
    [testoSistema("agg_aggiorna", L), testoSistema("agg_in_avvio", L), testoSistema("agg_in_corso", L)].includes(b.textContent ?? "")) as HTMLButtonElement;

  it("finché /api/update/apply non risponde dice «in avvio», poi «avviato»", async () => {
    const apply = sospesa<unknown>();
    avviaAggiornamento.mockReturnValue(apply.p);
    render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(testoSistema("agg_aggiorna", L)));
    await waitFor(() => expect(avviaAggiornamento).toHaveBeenCalledTimes(1));
    expect(aggiornaOra().textContent).toBe(testoSistema("agg_in_avvio", L));
    expect(aggiornaOra().disabled).toBe(true);
    await act(async () => { apply.risolvi({}); });
    expect(aggiornaOra().textContent).toBe(testoSistema("agg_in_corso", L));
    expect(aggiornaOra().disabled).toBe(true);
  });

  it("il login chiesto in mezzo dice «Aggiornamento in avvio…», non «Accesso…»", async () => {
    getSystemStatus.mockResolvedValue({ auth_required: true, uptime_s: 100 });
    const accesso = sospesa<typeof ADMIN>();
    login.mockReturnValue(accesso.p);
    const apply = sospesa<unknown>();
    avviaAggiornamento.mockReturnValue(apply.p);
    render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(testoSistema("agg_aggiorna", L)));
    await waitFor(() => expect(campoPassword()).not.toBeNull());
    await waitFor(() => expect(identitaStato).toHaveBeenCalled());
    fireEvent.change(campoPassword()!, { target: { value: "segreta" } });
    fireEvent.click(pulsanteAccesso());
    expect(pulsanteAccesso().textContent).toBe(testoSistema("agg_in_avvio", L));

    // Il login riesce: si chiude, e l'aggiornamento non è ancora partito.
    await act(async () => { accesso.risolvi(ADMIN); });
    await waitFor(() => expect(avviaAggiornamento).toHaveBeenCalledTimes(1));
    expect(campoPassword()).toBeNull();
    expect(aggiornaOra().textContent).toBe(testoSistema("agg_in_avvio", L));
    await act(async () => { apply.risolvi({}); });
    expect(aggiornaOra().textContent).toBe(testoSistema("agg_in_corso", L));
  });

  it("con un aggiornamento già in corso per il runtime, «Aggiorna ora» è spento", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, in_corso: true });
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(aggiornaOra().disabled).toBe(true);
    fireEvent.click(aggiornaOra());
    expect(avviaAggiornamento).not.toHaveBeenCalled();
  });
});
