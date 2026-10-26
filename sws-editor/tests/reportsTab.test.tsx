/** Configurazione → Report (P3, 26-10-2026). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { reports, generaReport, saveReports } = vi.hoisted(() => ({
  reports: vi.fn(),
  generaReport: vi.fn().mockResolvedValue([{ nome: "giorno-20261026-0600.pdf", dimensione: 2048, quando_ms: 0 }]),
  saveReports: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, reports, generaReport, saveReports } };
});

import { ReportsTab } from "../src/config/schede/ReportsTab";
import { useAppStore } from "../src/store";

const giorno = { id: "giorno", periodo: "giorno" as const, tags: ["temp"] };

describe("i report programmati nell'IDE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reports.mockResolvedValue([{ ...giorno, programmati: false, file: [{ nome: "giorno-20261025-0600.pdf", dimensione: 4096, quando_ms: 0 }] }]);
    useAppStore.setState({
      project: { meta: { name: "p", version: "1" }, tags: [{ id: "temp", data_type: "f32" }], sources: [], alarms: [], functions: [], reports: [giorno] } as never,
      remoteConnected: true, remoteUrl: "https://sws.soligo.net/dev/tc620",
    });
  });

  it("con un pannello collegato mostra i suoi file e «Genera ora» parla con lui", async () => {
    render(<ReportsTab />);
    expect(await screen.findByText("giorno-20261025-0600.pdf")).toBeTruthy();
    expect(reports).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("report-genera"));
    await waitFor(() => expect(generaReport).toHaveBeenCalledWith(true, "giorno"));
  });

  it("una modifica non salvata spegne «Genera ora», e un report nuovo ha il suo id", async () => {
    render(<ReportsTab />);
    fireEvent.click(screen.getByTestId("report-nuovo"));
    expect(await screen.findByTestId("report-report_2")).toBeTruthy();
    expect((screen.getByTestId("report-genera") as HTMLButtonElement).disabled).toBe(true);
  });
});
