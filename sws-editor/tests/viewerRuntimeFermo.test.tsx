// Il viewer col runtime fermo (collaudo del 10-11-2026 sul WP630, viewer
// leggero voce 5).
//
// Fermato il runtime per 15 s con la pagina di Montagna a schermo, il pannello
// ha mostrato «No active project». Nessuno aveva ricaricato la pagina: il
// sorvegliante del progetto trattava un errore di rete come «progetto chiuso»,
// e il viewer al montaggio faceva lo stesso con `getProject`. Questi test
// tengono separate le due cose: runtime che non risponde → la pagina resta (o
// «si sta riavviando» e si riprova); 503 → «No active project».
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import { api, NoProjectError, RuntimeUnavailableError } from "../src/api/client";
import { useAppStore } from "../src/store";
import { RIPROVA_RIAVVIO_MS, RuntimeViewer } from "../src/viewer/RuntimeViewer";
import type { ProjectInfo } from "../src/types";

vi.mock("@/runtime-view/RuntimeView", () => ({
  RuntimeView: () => <div data-testid="pagina" />,
}));
vi.mock("@/ws/buildWatcher", () => ({ useBuildWatcher: () => {} }));

const progetto = { meta: { name: "Montagna", version: "1" }, tags: [], sources: [] } as unknown as ProjectInfo;

async function avanza(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("viewer col runtime che non risponde", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ noActiveProject: false, project: null });
    vi.spyOn(api, "whoami").mockResolvedValue({ username: "", role: "Admin" } as never);
    vi.spyOn(api, "listSynoptics").mockResolvedValue([]);
    vi.spyOn(api, "listFaceplates").mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("caricato col runtime fermo: «si sta riavviando», riprova, poi la pagina", async () => {
    vi.spyOn(api, "getProjectFingerprint").mockRejectedValue(new RuntimeUnavailableError());
    const getProject = vi.spyOn(api, "getProject")
      .mockRejectedValueOnce(new RuntimeUnavailableError())
      .mockRejectedValueOnce(new RuntimeUnavailableError())
      .mockResolvedValue(progetto);

    render(<RuntimeViewer />);
    await avanza(0);
    expect(screen.getByTestId("pannello-in-riavvio")).toBeTruthy();
    expect(screen.queryByTestId("nessun-progetto")).toBeNull();

    await avanza(RIPROVA_RIAVVIO_MS);
    expect(getProject).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("pannello-in-riavvio")).toBeTruthy();

    await avanza(RIPROVA_RIAVVIO_MS);
    expect(getProject).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("pannello-in-riavvio")).toBeNull();
    expect(screen.queryByTestId("nessun-progetto")).toBeNull();
    expect(screen.getByTestId("pagina")).toBeTruthy();
  });

  it("un 503 vero è «No active project», e non si riprova da sé", async () => {
    vi.spyOn(api, "getProjectFingerprint").mockRejectedValue(new NoProjectError());
    const getProject = vi.spyOn(api, "getProject").mockRejectedValue(new NoProjectError());

    render(<RuntimeViewer />);
    await avanza(0);
    expect(screen.getByTestId("nessun-progetto")).toBeTruthy();
    expect(screen.queryByTestId("pannello-in-riavvio")).toBeNull();

    await avanza(RIPROVA_RIAVVIO_MS * 3);
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it("col runtime che si ferma a pagina aperta, la pagina resta", async () => {
    const impronta = vi.spyOn(api, "getProjectFingerprint")
      .mockResolvedValue({ sha256: "aaa", computed_at_ms: 0 } as never);
    vi.spyOn(api, "getProject").mockResolvedValue(progetto);

    render(<RuntimeViewer />);
    await avanza(0);
    expect(screen.getByTestId("pagina")).toBeTruthy();

    // Il runtime si ferma per 15 s: cinque giri del sorvegliante senza risposta.
    impronta.mockRejectedValue(new RuntimeUnavailableError());
    await avanza(15_000);
    expect(screen.getByTestId("pagina")).toBeTruthy();
    expect(screen.queryByTestId("nessun-progetto")).toBeNull();

    // Torna, con lo stesso progetto.
    impronta.mockResolvedValue({ sha256: "aaa", computed_at_ms: 0 } as never);
    await avanza(3_000);
    expect(screen.getByTestId("pagina")).toBeTruthy();
    expect(screen.queryByTestId("nessun-progetto")).toBeNull();
  });
});
