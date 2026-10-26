/** La console distingue un pannello spento in ordine da uno perso (ramo 7
 *  dei residui, 26-10-2026): il gateway porta `spento_ms` quando il pannello
 *  ha annunciato lo spegnimento e non è più tornato. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { pannelliAmministrazione, amministrazioneRisorse } = vi.hoisted(() => ({
  pannelliAmministrazione: vi.fn(),
  amministrazioneRisorse: vi.fn().mockResolvedValue({ aziende: [] }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, pannelliAmministrazione, amministrazioneRisorse } };
});

import { Pannelli } from "../src/console/Pannelli";

describe("Console → Pannelli: tre stati", () => {
  it("collegato, spento annunciato e perso hanno tre pallini diversi", async () => {
    pannelliAmministrazione.mockResolvedValue({
      abbinati: [],
      dichiarati: [
        { nome: "vivo", azienda: "-", collegato: true },
        { nome: "spento", azienda: "-", collegato: false, spento_ms: 1_700_000_000_000 },
        { nome: "perso", azienda: "-", collegato: false },
      ],
      in_attesa: 0,
    });
    render(<Pannelli />);
    await waitFor(() => expect(screen.getAllByTestId("pallino")).toHaveLength(3));
    const [vivo, spento, perso] = screen.getAllByTestId("pallino");
    const colori = [vivo, spento, perso].map((p) => p.style.background);
    expect(new Set(colori).size).toBe(3);
    expect(spento.title).toMatch(/spento|shut down/i);
    expect(perso.title).not.toMatch(/spento \(|shut down/i);
  });
});
