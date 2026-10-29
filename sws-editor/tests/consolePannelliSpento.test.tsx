/** La console distingue un pannello spento in ordine da uno perso (ramo 7
 *  dei residui, 26-10-2026): il gateway porta `spento_ms` quando il pannello
 *  ha annunciato lo spegnimento e non è più tornato. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { pannelliAmministrazione, amministrazioneRisorse, schermoPannello } = vi.hoisted(() => ({
  pannelliAmministrazione: vi.fn(),
  amministrazioneRisorse: vi.fn().mockResolvedValue({ aziende: [] }),
  schermoPannello: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, pannelliAmministrazione, amministrazioneRisorse, schermoPannello } };
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

/** Lo schermo remoto si spegne per pannello (29-10-2026); il link per aprirlo
 *  c'è solo quando lo schermo è acceso e il pannello è collegato. */
describe("Console → Pannelli: schermo remoto", () => {
  const riga = { azienda: "-", stato: "attivo", abbinato_ms: 1, ultimo_ms: 1 };
  it("l'interruttore spegne e il link compare solo dove serve", async () => {
    pannelliAmministrazione.mockResolvedValue({
      abbinati: [
        { ...riga, nome: "acceso", hw: "h1", collegato: true },
        { ...riga, nome: "spento", hw: "h2", collegato: true, schermo_spento: true },
        { ...riga, nome: "lontano", hw: "h3", collegato: false },
      ],
      dichiarati: [],
      in_attesa: 0,
    });
    render(<Pannelli />);
    const acceso = await screen.findByTestId("schermo-acceso-acceso");
    expect((acceso as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("schermo-acceso-spento") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("schermo-apri-acceso")).toBeTruthy();
    expect(screen.queryByTestId("schermo-apri-spento")).toBeNull();
    expect(screen.queryByTestId("schermo-apri-lontano")).toBeNull();
    fireEvent.click(acceso);
    await waitFor(() => expect(schermoPannello).toHaveBeenCalledWith("acceso", false));
  });
});
