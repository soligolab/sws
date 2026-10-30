/** Le planimetrie nell'IDE (29-10-2026, ramo 1): una nuova dal ramo del
 *  pannello sinistro, l'editor che la carica e la disegna, una modifica dalle
 *  proprietà, e il salvataggio — anche dal Salva generale. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { planimetrie, planimetria, salvaPlanimetria } = vi.hoisted(() => ({
  planimetrie: vi.fn(),
  planimetria: vi.fn(),
  salvaPlanimetria: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, planimetrie, planimetria, salvaPlanimetria } };
});

import { CorpoPlanimetrie } from "../src/editor/LeftPanel";
import { PlanimetriaEditor } from "../src/planimetrie/PlanimetriaEditor";
import { useAppStore } from "../src/store";

const CASA = {
  id: "casa", nome: "Casa", unita_px_m: 50,
  muri: [{ id: "m1", punti: [[0, 0], [10, 0]], spessore: 0.2, altezza: 2.7 }],
  aperture: [
    { id: "p1", muro: "m1", t: 0.5, larghezza: 0.9, altezza: 2.1, tipo: "porta" },
    // Un'apertura di un muro che non c'è più: il salvataggio la toglie.
    { id: "p2", muro: "sparito", t: 0.5, larghezza: 0.9, altezza: 2.1, tipo: "porta" },
  ],
  aree: [], blocchi: [],
};

describe("Planimetrie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ planimetriaAperta: null, pendingSections: {}, project: { meta: { name: "p", version: "1" } } } as never);
  });

  it("una nuova prende l'id dal nome e si apre", async () => {
    planimetrie.mockResolvedValue([{ id: "garage", nome: "Garage" }]);
    vi.spyOn(window, "prompt").mockReturnValue("Casa — piano terra");
    render(<CorpoPlanimetrie />);
    await screen.findByTestId("planimetria-garage");
    fireEvent.click(screen.getByTestId("nuova-planimetria"));
    await waitFor(() => expect(salvaPlanimetria).toHaveBeenCalled());
    expect(salvaPlanimetria.mock.calls[0][0]).toMatchObject({ id: "casa-piano-terra", nome: "Casa — piano terra", muri: [] });
    expect(useAppStore.getState().planimetriaAperta).toBe("casa-piano-terra");
  });

  it("l'editor la disegna, una modifica la sporca, salvare toglie gli orfani", async () => {
    planimetria.mockResolvedValue(CASA);
    render(<PlanimetriaEditor id="casa" />);
    const pianta = await screen.findByTestId("pianta");
    expect(pianta.querySelectorAll("polyline").length).toBeGreaterThan(0);
    expect(screen.getByTestId("planimetria-salva")).toHaveProperty("disabled", true);

    // Senza niente di scelto le proprietà sono quelle della pianta.
    const nome = screen.getByDisplayValue("Casa");
    fireEvent.change(nome, { target: { value: "Casa nuova" } });
    expect(screen.getByTestId("planimetria-salva")).toHaveProperty("disabled", false);
    // Sporca: il Salva generale la trova.
    const daSalvare = useAppStore.getState().pendingSections["planimetria:casa"];
    expect(daSalvare).toBeTruthy();
    await daSalvare!();
    const salvata = salvaPlanimetria.mock.calls.at(-1)![0];
    expect(salvata.nome).toBe("Casa nuova");
    expect(salvata.aperture.map((a: { id: string }) => a.id)).toEqual(["p1"]);
  });
});
