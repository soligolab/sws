/** Istanza → Prestazioni (26-10-2026, piano «dove se ne va il tempo»): una
 *  colonna per lato, ognuna legge il suo; il viewer si mostra in fasi «per
 *  fotogramma», e un viewer che non ha risposto lo dice invece di tacere. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { prestazioni } = vi.hoisted(() => ({ prestazioni: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, prestazioni } };
});

import { PrestazioniTab, p95 } from "../src/config/schede/PrestazioniTab";
import { useAppStore } from "../src/store";
import type { Prestazioni, VocePrestazioni } from "../src/api/client";

const voce = (nome: string, n: number, somma_ms: number, max_ms: number, secchi: number[]): VocePrestazioni =>
  ({ nome, n, somma_ms, max_ms, secchi });

const CON_VIEWER: Prestazioni = {
  runtime: { intervallo_s: 2, voci: [voce("sorgente.plc1", 20, 100, 9, [0, 0, 10, 10, 0, 0, 0, 0])] },
  viewer: {
    intervallo_s: 2,
    voci: [
      voce("giro", 100, 1200, 30, [0, 0, 0, 0, 90, 10, 0, 0]),
      voce("display", 100, 800, 12, [0, 0, 0, 60, 40, 0, 0, 0]),
      voce("canvas.tubo.corpo", 50, 200, 9, [0, 0, 10, 40, 0, 0, 0, 0]),
    ],
  },
  viewer_eta_s: 1,
};

describe("Istanza → Prestazioni", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prestazioni.mockImplementation((remoto: boolean) =>
      Promise.resolve(remoto ? CON_VIEWER : { ...CON_VIEWER, viewer: null, viewer_eta_s: null }));
  });

  it("senza pannello una colonna sola, che dice che il viewer non ha risposto", async () => {
    useAppStore.setState({ remoteConnected: false } as never);
    render(<PrestazioniTab />);
    await waitFor(() => expect(prestazioni).toHaveBeenCalledWith(false));
    expect(screen.queryByTestId("colonna-remota")).toBeNull();
    expect(await screen.findByText(/viewer LVGL ha risposto|LVGL viewer has answered/)).toBeTruthy();
    expect(await screen.findByTestId("lavoro-sorgente.plc1")).toBeTruthy();
  });

  it("col pannello due colonne, e il viewer in fasi per fotogramma", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://pannello:7444" } as never);
    render(<PrestazioniTab />);
    await waitFor(() => expect(prestazioni).toHaveBeenCalledWith(true));
    expect(prestazioni).toHaveBeenCalledWith(false);
    // 100 fotogrammi in 2 s: 50 al secondo; il giro medio 12 ms.
    expect((await screen.findByTestId("fps")).textContent).toMatch(/50.*12/);
    // Il corpo del tubo: 200 ms su 100 fotogrammi = 2 ms per fotogramma.
    expect((await screen.findByTestId("fase-canvas.tubo.corpo")).textContent).toMatch(/2\.0 ms/);
    expect(screen.queryByTestId("fase-giro"), "il giro sta nella riga in alto, non fra le fasi").toBeNull();
  });

  it("il 95° percentile per eccesso, come in sws-core", () => {
    expect(p95(voce("x", 100, 0, 40, [0, 95, 0, 0, 0, 0, 5, 0]))).toBe(2);
    expect(p95(voce("x", 1, 90, 90, [0, 0, 0, 0, 0, 0, 0, 1]))).toBe(90);
    expect(p95(voce("x", 0, 0, 0, []))).toBe(0);
  });
});
