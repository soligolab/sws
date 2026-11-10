/** Il campo del trigger cron dice il fuso e le prossime esecuzioni (10-11-2026):
 *  le calcola il runtime, quello del dispositivo connesso se c'è. */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { cronProssime, remoteCronProssime } = vi.hoisted(() => ({
  cronProssime: vi.fn(),
  remoteCronProssime: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, cronProssime, remoteCronProssime } };
});

import { ProssimeCron } from "../src/logica/ProssimeCron";
import { useAppStore } from "../src/store";

const ROMA = {
  fuso: "Europe/Rome",
  scostamento: "+02:00",
  prossime: [
    { locale: "2026-10-25 07:00", utc: "2026-10-25 06:00", scostamento: "+01:00" },
    { locale: "2026-10-26 07:00", utc: "2026-10-26 06:00", scostamento: "+01:00" },
    { locale: "2026-10-27 07:00", utc: "2026-10-27 06:00", scostamento: "+01:00" },
  ],
  avvisi: [],
  pannello: true,
};

describe("le prossime esecuzioni del cron", () => {
  beforeEach(async () => {
    cronProssime.mockReset();
    remoteCronProssime.mockReset();
    await i18n.changeLanguage("it");
  });

  it("col dispositivo connesso chiede a lui, e mostra fuso e tre esecuzioni", async () => {
    useAppStore.setState({ remoteConnected: true });
    remoteCronProssime.mockResolvedValue(ROMA);
    render(<ProssimeCron espressione="0 7 * * *" />);
    const fuso = await screen.findByTestId("cron-fuso");
    expect(remoteCronProssime).toHaveBeenCalledWith("0 7 * * *");
    expect(cronProssime).not.toHaveBeenCalled();
    expect(fuso.textContent).toBe("Ora del pannello: Europe/Rome, UTC+02:00.");
    const prossime = screen.getAllByTestId("cron-prossima").map((e) => e.textContent);
    // Dopo il cambio d'ora lo scostamento non è quello di adesso: si dice.
    expect(prossime).toEqual(["25/10 07:00 (UTC+01:00)", " · 26/10 07:00 (UTC+01:00)", " · 27/10 07:00 (UTC+01:00)"]);
  });

  it("senza dispositivo, una macchina che non è un pannello lo dice", async () => {
    useAppStore.setState({ remoteConnected: false });
    cronProssime.mockResolvedValue({ ...ROMA, fuso: null, scostamento: "+01:00", pannello: false });
    render(<ProssimeCron espressione="0 7 * * *" />);
    const fuso = await screen.findByTestId("cron-fuso");
    expect(remoteCronProssime).not.toHaveBeenCalled();
    expect(fuso.textContent).toContain("Ora di questa macchina: UTC+01:00.");
    expect(screen.getAllByTestId("cron-prossima")[0].textContent).toBe("25/10 07:00");
  });

  it("un'espressione non valida mostra il perché, senza ripiegare sulla macchina locale", async () => {
    useAppStore.setState({ remoteConnected: true });
    remoteCronProssime.mockRejectedValue(
      new Error("API /api/remote/cron/prossime?espressione=70: 400 Bad Request — minuto: il campo «minuto» contiene `70`"),
    );
    render(<ProssimeCron espressione="70 7 * * *" />);
    const errore = await screen.findByTestId("cron-errore");
    expect(errore.textContent).toBe("minuto: il campo «minuto» contiene `70`");
    expect(cronProssime).not.toHaveBeenCalled();
  });

  it("un dispositivo che non conosce la rotta: risponde questa macchina, e lo si dice", async () => {
    useAppStore.setState({ remoteConnected: true });
    remoteCronProssime.mockRejectedValue(new Error("Il dispositivo ha risposto 404 Not Found: "));
    cronProssime.mockResolvedValue({ ...ROMA, pannello: false });
    render(<ProssimeCron espressione="0 7 * * *" />);
    await waitFor(() => expect(cronProssime).toHaveBeenCalledWith("0 7 * * *"));
    expect((await screen.findByTestId("cron-prossime")).textContent).toContain("precedente alla 2.26");
  });
});
