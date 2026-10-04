/** I pallini di stato con l'IDE connesso a un pannello (04-10-2026): lo stato
 *  è quello del pannello, non del runtime dell'IDE sul PC. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { statoSorgenti, remoteStatoSorgenti } = vi.hoisted(() => ({ statoSorgenti: vi.fn(), remoteStatoSorgenti: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoSorgenti, remoteStatoSorgenti } };
});

import { useStatoSorgenti } from "../src/config/sorgenti/statoSorgenti";
import { useAppStore } from "../src/store";

function Mostra() {
  const s = useStatoSorgenti();
  return <span data-testid="stato">{s.linea?.stato ?? "assente"}</span>;
}

describe("useStatoSorgenti", () => {
  beforeEach(() => {
    statoSorgenti.mockReset().mockResolvedValue({ linea: { stato: "non_risponde", da_ms: 0 } });
    remoteStatoSorgenti.mockReset().mockResolvedValue({ linea: { stato: "ok", da_ms: 0 } });
  });

  it("connesso a un pannello: lo stato del pannello", async () => {
    useAppStore.setState({ remoteConnected: true });
    const { unmount } = render(<Mostra />);
    await waitFor(() => expect(screen.getByTestId("stato").textContent).toBe("ok"));
    expect(statoSorgenti).not.toHaveBeenCalled();
    unmount();
  });

  it("pannello con un runtime che non ha la rotta: nessuno stato, non quello del PC", async () => {
    useAppStore.setState({ remoteConnected: true });
    remoteStatoSorgenti.mockRejectedValue(new Error("404"));
    const { unmount } = render(<Mostra />);
    await waitFor(() => expect(remoteStatoSorgenti).toHaveBeenCalled());
    expect(screen.getByTestId("stato").textContent).toBe("assente");
    unmount();
  });

  it("senza pannello: lo stato di questo runtime", async () => {
    useAppStore.setState({ remoteConnected: false });
    const { unmount } = render(<Mostra />);
    await waitFor(() => expect(screen.getByTestId("stato").textContent).toBe("non_risponde"));
    unmount();
  });
});
