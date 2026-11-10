/** 10-11-2026, collaudo della rc.11 dal cloud: durante il riavvio del pannello
 *  la sezione «Aggiornamento del runtime», riaperta, mostrava in rosso «Il
 *  dispositivo ha risposto 503 Service Unavailable: il pannello «wp630-ufficio»
 *  non è collegato». Vero, ma per chi guarda è un guasto. Ora l'IDE ricorda che
 *  l'aggiornamento è partito e, finché il pannello non risponde, lo dice in
 *  giallo; passati dieci minuti torna l'errore vero. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type StatoAggiornamento } from "../src/api/client";
import { AggiornamentoRuntime } from "../src/boot/AggiornamentoRuntime";
import { ConfigurazioneServizio } from "../src/boot/ConfigurazioneServizio";
import { useAppStore } from "../src/store";

const CHIAVE = "sws.ide.aggiornamento.partito";
const ERRORE_503 = "Il dispositivo ha risposto 503 Service Unavailable: il pannello «wp630-ufficio» non è collegato";

beforeEach(() => {
  localStorage.removeItem(CHIAVE);
  useAppStore.getState().setRemoteConnected(true, "wp630-ufficio");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(CHIAVE);
  useAppStore.getState().setRemoteConnected(false);
});

describe("il pannello non risponde dopo che l'aggiornamento è partito", () => {
  it("partito da poco: «si sta riavviando», non l'errore del gateway", async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ ts: Date.now() - 60_000, url: "wp630-ufficio" }));
    vi.spyOn(api, "remoteStatoAggiornamento").mockRejectedValue(new Error(ERRORE_503));
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(i18n.t("aggiornamento.riavvioInCorso"))).toBeTruthy();
    expect(screen.queryByText(ERRORE_503)).toBeNull();
  });

  it("partito da più di dieci minuti: l'errore vero, in rosso", async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ ts: Date.now() - 11 * 60_000, url: "wp630-ufficio" }));
    vi.spyOn(api, "remoteStatoAggiornamento").mockRejectedValue(new Error(ERRORE_503));
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(ERRORE_503)).toBeTruthy();
    expect(screen.queryByText(i18n.t("aggiornamento.riavvioInCorso"))).toBeNull();
  });

  it("partito per un altro pannello: non vale", async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ ts: Date.now() - 60_000, url: "tc620-garage" }));
    vi.spyOn(api, "remoteStatoAggiornamento").mockRejectedValue(new Error(ERRORE_503));
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(ERRORE_503)).toBeTruthy();
  });

  it("un aggiornamento visto in corso lascia il segno, anche se è partito da un'altra scheda", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.26.0-rc.11", immagine: "ghcr.io/soligolab/sws-runtime:rc-arm64", canale: "prova",
      disponibile: "2.26.0-rc.12", errore: null, in_corso: true,
    } as StatoAggiornamento);
    render(<AggiornamentoRuntime />);
    await screen.findByText(i18n.t("aggiornamento.inCorsoSulPannello"));
    await waitFor(() => {
      const segno = JSON.parse(localStorage.getItem(CHIAVE) ?? "null") as { ts: number; url: string | null } | null;
      expect(segno?.url).toBe("wp630-ufficio");
      expect(Date.now() - (segno?.ts ?? 0)).toBeLessThan(10_000);
    });
  });
});

describe("la configurazione del servizio con un pannello che non risponde", () => {
  it("dice «non raggiungibile», non «non applicabile»", async () => {
    vi.spyOn(api, "remoteGetSystemStatus").mockRejectedValue(new Error(ERRORE_503));
    render(<ConfigurazioneServizio />);
    expect(await screen.findByText(i18n.t("configurazioneServizio.nonRaggiunto"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("configurazioneServizio.nonApplicabile"))).toBeNull();
  });
});
