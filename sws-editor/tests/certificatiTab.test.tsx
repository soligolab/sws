import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import i18n from "../src/i18n";

const { certificati, dimenticaImpronta, getTlsStatus, remoteGetTlsStatus } = vi.hoisted(() => ({
  certificati: vi.fn(),
  dimenticaImpronta: vi.fn().mockResolvedValue(undefined),
  getTlsStatus: vi.fn().mockResolvedValue({ enabled: true }),
  remoteGetTlsStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, certificati, dimenticaImpronta, getTlsStatus, remoteGetTlsStatus } };
});

import { CertificatiTab, impronteBreve } from "../src/config/schede/CertificatiTab";
import { useAppStore } from "../src/store";
import type { InventarioCertificati } from "../src/api/client";

/** La vista dei certificati (decisioni 3 e 8 del piano dei certificati): una
 *  colonna per lato, e ogni colonna parla **col suo** lato — con un pannello
 *  collegato, un «Dimentica» nella colonna locale non deve finire sul pannello. */
const vuoto = { disponibile: true, righe: [] };
function inventario(chiave: string): InventarioCertificati {
  return {
    tls: null,
    dispositivi: { disponibile: true, righe: [{ chiave, impronta: "sha256:" + "ab".repeat(32), visto_il_ms: 1 }] },
    mqtt: vuoto,
    viewer_lvgl: { disponibile: false, righe: [] },
    opcua_client: [],
    opcua_server: null,
    ssh: { known_hosts: [], chiave_progetto: null },
  };
}

describe("Sicurezza → Certificati", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    certificati.mockImplementation((remoto: boolean) => Promise.resolve(inventario(remoto ? "remoto:7444" : "locale:8444")));
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("senza pannello collegato c'è una colonna sola", async () => {
    useAppStore.setState({ remoteConnected: false });
    render(<CertificatiTab />);
    await screen.findByText("locale:8444");
    expect(screen.getByTestId("colonna-istanza")).toBeTruthy();
    expect(screen.queryByTestId("colonna-dispositivo")).toBeNull();
    expect(certificati).toHaveBeenCalledWith(false);
    // Quadlet 6: l'archivio del viewer non si vede, e la riga lo dice.
    expect(screen.getByText(i18n.t("certificati.viewerAssente"))).toBeTruthy();
  });

  it("col pannello collegato le colonne sono due, e «Dimentica» va al suo lato", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://pannello:7444" });
    render(<CertificatiTab />);
    await screen.findByText("remoto:7444");
    await screen.findByText("locale:8444");
    const [locale, remoto] = screen.getAllByText(i18n.t("certificati.dimentica"));
    fireEvent.click(remoto);
    await waitFor(() => expect(dimenticaImpronta).toHaveBeenCalledWith(true, "dispositivi", "remoto:7444"));
    fireEvent.click(locale);
    await waitFor(() => expect(dimenticaImpronta).toHaveBeenCalledWith(false, "dispositivi", "locale:8444"));
  });

  it("l'impronta si abbrevia a quattro gruppi", () => {
    expect(impronteBreve("sha256:0123456789abcdef0123")).toBe("0123 4567 89ab cdef …");
  });
});
