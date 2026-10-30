/** OpenPLC sul pannello collegato (30-10-2026): il bottone c'è solo quando
 *  serve, e una volta premuto si aspetta l'esito invece di riproporlo. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type StatoOpenplc, type SystemStatus } from "../src/api/client";
import { OpenplcSulPannello } from "../src/boot/OpenplcSulPannello";

afterEach(() => { vi.restoreAllMocks(); });

function pannello(openplc: StatoOpenplc | null) {
  return vi.spyOn(api, "remoteGetSystemStatus").mockResolvedValue({ openplc } as unknown as SystemStatus);
}

describe("OpenPLC sul pannello", () => {
  it("non installato: offre il bottone, e chiede conferma prima di installare", async () => {
    pannello({ risponde: false, si_puo_installare: true, ultimo_esito: null });
    const installa = vi.spyOn(api, "remoteInstallaOpenplc").mockResolvedValue({ avviata: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OpenplcSulPannello />);
    fireEvent.click(await screen.findByText(i18n.t("openplc.installa")));
    await waitFor(() => expect(installa).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(i18n.t("openplc.inCorso"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("openplc.installa"))).toBeNull();
  });

  it("acceso: niente bottone, e dice dove collegarsi", async () => {
    pannello({ risponde: true, si_puo_installare: true, ultimo_esito: { esito: "riuscito", messaggio: "", quando_ms: 1 } });
    render(<OpenplcSulPannello />);
    expect(await screen.findByText(i18n.t("openplc.acceso"))).toBeTruthy();
    expect(screen.getByText(i18n.t("openplc.porte"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("openplc.installa"))).toBeNull();
  });

  it("non riuscito: mostra il motivo e offre di riprovare", async () => {
    pannello({ risponde: false, si_puo_installare: true, ultimo_esito: { esito: "non_riuscito", messaggio: "spazio insufficiente", quando_ms: 1 } });
    render(<OpenplcSulPannello />);
    expect(await screen.findByText(i18n.t("openplc.nonRiuscito", { motivo: "spazio insufficiente" }))).toBeTruthy();
    expect(screen.getByText(i18n.t("openplc.riprova"))).toBeTruthy();
  });

  it("fuori da un pannello non si mostra", async () => {
    const s = pannello(null);
    const { container } = render(<OpenplcSulPannello />);
    await waitFor(() => expect(s).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="openplc-sul-pannello"]')).toBeNull());
  });
});
