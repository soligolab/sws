import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { getTlsStatus, remoteGetTlsStatus, sceltaTls } = vi.hoisted(() => ({
  getTlsStatus: vi.fn(),
  remoteGetTlsStatus: vi.fn(),
  sceltaTls: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getTlsStatus, remoteGetTlsStatus, sceltaTls } };
});

import { TlsSection } from "../src/config/schede/SystemTab";
import { useAppStore } from "../src/store";

/** C4, pezzo 3 (25-10-2026): il pannello che ha il certificato del dispositivo
 *  e gira in chiaro propone l'HTTPS con quello, col comando da lanciare; «No»
 *  lo ricorda **sul lato giusto** — con un pannello collegato, sul pannello. */
const proposta = { enabled: false, proposta: { comando: "/data/user/sws/config/certificato-dispositivo.sh" } };

describe("la proposta dell'HTTPS col certificato del dispositivo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ authRole: "Admin", remoteConnected: false });
  });

  it("compare col comando, e «No» la toglie e lo dice al runtime locale", async () => {
    getTlsStatus.mockResolvedValue(proposta);
    render(<TlsSection remoto={false} />);
    expect(await screen.findByText(proposta.proposta.comando)).toBeTruthy();
    fireEvent.click(screen.getByTestId("proposta-tls-no"));
    await waitFor(() => expect(sceltaTls).toHaveBeenCalledWith(false, "no"));
    await waitFor(() => expect(screen.queryByTestId("proposta-tls")).toBeNull());
  });

  it("nella colonna del pannello parla col pannello", async () => {
    remoteGetTlsStatus.mockResolvedValue(proposta);
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://sws.soligo.net/dev/tc620" });
    render(<TlsSection remoto />);
    fireEvent.click(await screen.findByTestId("proposta-tls-no"));
    await waitFor(() => expect(sceltaTls).toHaveBeenCalledWith(true, "no"));
  });

  it("senza proposta non c'è niente da proporre", async () => {
    getTlsStatus.mockResolvedValue({ enabled: false });
    render(<TlsSection remoto={false} />);
    await waitFor(() => expect(getTlsStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("proposta-tls")).toBeNull();
  });
});
