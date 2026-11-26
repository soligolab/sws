/** Un pannello installato da archivio non riceve aggiornamenti (02-11-2026):
 *  il messaggio diceva un percorso di menù che nell'IDE non c'era più. Ora c'è
 *  un bottone che porta a Installazione, e nel cloud Installazione mostra i
 *  comandi da dare sul pannello invece del modulo SSH. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type StatoAggiornamento } from "../src/api/client";
import { AggiornamentoRuntime } from "../src/boot/AggiornamentoRuntime";
import { InstallTab } from "../src/config/schede/InstallTab";
import { useAppStore } from "../src/store";

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("aggiornamento di un pannello installato da archivio", () => {
  it("il bottone porta a Installazione", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.23.7", immagine: "localhost/sws-runtime:2.23.7-arm64", canale: "archivio", disponibile: null, errore: null,
    } as StatoAggiornamento);
    useAppStore.getState().setConfigTab("runtime");
    render(<AggiornamentoRuntime />);
    fireEvent.click(await screen.findByTestId("apri-installazione"));
    expect(useAppStore.getState().configTab).toBe("install");
  });

  // 26-11-2026, collaudo sul PLX800: a 2.27.0 panel with a fixed version said
  // «reinstall», with the channel menu just below that does the same.
  it("a panel that knows the channel route points to the channel menu, not to Install", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.27.0", immagine: "ghcr.io/soligolab/sws-runtime:2.27.0-arm64", canale: "fissata", disponibile: null, errore: null,
      cambio_canale: true,
    } as StatoAggiornamento);
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(i18n.t("aggiornamento.manualeCanale", { versione: "2.27.0", canale: i18n.t("aggiornamento.canale.fissata") }))).toBeTruthy();
    expect(screen.queryByTestId("apri-installazione")).toBeNull();
  });

  it("nel cloud Installazione dà i comandi per il pannello, non il modulo SSH", () => {
    window.history.replaceState(null, "", "/p/-/prova/");
    render(<InstallTab />);
    expect(screen.getByTestId("installa-dal-cloud").textContent).toBe(i18n.t("cfg.installDalCloud"));
    expect(screen.queryByText(/SSH host|Host SSH/i)).toBeNull();
  });
});

/** 10-11-2026: tornando nella scheda durante l'istantanea dei dati, l'IDE
 *  diceva «disponibile» col pulsante, e un secondo clic partiva in parallelo. */
describe("un aggiornamento già in corso sul pannello", () => {
  it("niente pulsante né «disponibile», solo la riga dell'attesa", async () => {
    vi.spyOn(api, "remoteStatoAggiornamento").mockResolvedValue({
      versione: "2.26.0-rc.9", immagine: "ghcr.io/soligolab/sws-runtime:rc-arm64", canale: "prova",
      disponibile: "2.26.0-rc.10", errore: null, in_corso: true,
    } as StatoAggiornamento);
    render(<AggiornamentoRuntime />);
    expect(await screen.findByText(i18n.t("aggiornamento.inCorsoSulPannello"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("aggiornamento.pulsante", { a: "2.26.0-rc.10" }))).toBeNull();
  });
});
