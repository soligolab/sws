import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { getTlsStatus, remoteGetTlsStatus } = vi.hoisted(() => ({
  getTlsStatus: vi.fn(),
  remoteGetTlsStatus: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getTlsStatus, remoteGetTlsStatus } };
});

import { TlsSection } from "../src/config/schede/SystemTab";
import { useAppStore } from "../src/store";

/** **La proposta dell'HTTPS col certificato del dispositivo non esiste più**
 *  (26-10-2026): chi sviluppa PixsysOS ha detto che la chiave su cui si
 *  reggeva è già un errore e potrebbe sparire. Al suo posto la card non
 *  chiede niente — dice un fatto: il browser del pannello si fida, oppure no.
 *
 *  Il file conserva il nome perché conserva il posto: è il test della card
 *  TLS, e la storia di cosa c'era prima è il motivo per cui questi casi
 *  esistono. Prima si provava che «No» venisse ricordato sul lato giusto; ora
 *  non c'è più nessun «No» da ricordare. */
describe("la card TLS dice se il browser del pannello si fida", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ authRole: "Admin", remoteConnected: false });
  });

  it("col browser che si fida lo dice, e non chiede niente a nessuno", async () => {
    getTlsStatus.mockResolvedValue({ enabled: false, fiducia_browser: true });
    render(<TlsSection />);
    await waitFor(() => expect(screen.getByTestId("fiducia-browser")).toBeTruthy());
    expect(screen.getByTestId("fiducia-browser").textContent).toMatch(/trusts the certificate/i);
    // Niente comando da copiare, niente scelta da fare: la vecchia proposta
    // e' stata ritirata, non sostituita da un'altra.
    expect(screen.queryByTestId("proposta-tls")).toBeNull();
    expect(screen.queryByTestId("proposta-tls-no")).toBeNull();
  });

  it("**dove non si fida lo dice lo stesso**, invece di tacere", async () => {
    // E' il caso che conta: un autofirmato su un dispositivo senza certutil
    // porta l'interstiziale al posto del sinottico, e chi preme «Genera»
    // merita di saperlo prima e non davanti allo schermo del pannello.
    getTlsStatus.mockResolvedValue({ enabled: false, fiducia_browser: false });
    render(<TlsSection />);
    await waitFor(() => expect(screen.getByTestId("fiducia-browser")).toBeTruthy());
    expect(screen.getByTestId("fiducia-browser").textContent).toMatch(/certutil/i);
  });

  it("con un pannello collegato il fatto si legge dal pannello, non da qui", async () => {
    useAppStore.setState({ remoteConnected: true });
    remoteGetTlsStatus.mockResolvedValue({ enabled: true, fiducia_browser: true });
    render(<TlsSection />);
    await waitFor(() => expect(remoteGetTlsStatus).toHaveBeenCalled());
    expect(getTlsStatus).not.toHaveBeenCalled();
  });
});
