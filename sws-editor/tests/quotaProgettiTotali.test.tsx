/** La quota «quanti progetti in tutto», in console.
 *
 *  Nasce con l'azienda personale del 28-10-2026: tre progetti a testa. È
 *  un'altra domanda rispetto a «quanti aperti insieme», che conta i container
 *  accesi, e la console deve farle vedere **tutte e due** — chi esaurisce il
 *  numero totale non capisce perché non può creare un progetto se gli si
 *  mostrano solo i container.
 *
 *  Si guardano gli attributi, non il testo tradotto: nel catalogo di prova
 *  `t()` torna la chiave. */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { amministrazioneRisorse, progettiAperti } = vi.hoisted(() => ({
  amministrazioneRisorse: vi.fn(),
  progettiAperti: vi.fn().mockResolvedValue({ progetti: [] }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, amministrazioneRisorse, progettiAperti } };
});

import { Risorse } from "../src/console/Risorse";

const azienda = (extra: Record<string, unknown>) => ({
  id: 1, nome: "mario@tizio.it", implicita: false,
  progetti_byte: 0, storico_byte: 0, max_byte: null,
  max_progetti_aperti: null, ...extra,
});

describe("Console → Risorse: i progetti in tutto", () => {
  it("mostra la frazione quando c'è un tetto, e dice che l'azienda è personale", async () => {
    amministrazioneRisorse.mockResolvedValue({
      aziende: [azienda({ max_progetti_totali: 3, progetti: 2, personale: true })],
      macchina: null,
    });
    render(<Risorse />);
    await waitFor(() => expect(screen.getByTestId("progetti-totali-1")).toBeTruthy());
    expect(screen.getByTestId("progetti-totali-1").textContent).toContain("2 / 3");
    expect(screen.getByTestId("personale-1")).toBeTruthy();
  });

  it("senza tetto non occupa spazio: una riga «— / —» non dice niente", async () => {
    amministrazioneRisorse.mockResolvedValue({
      aziende: [azienda({ max_progetti_totali: null, progetti: 7 })],
      macchina: null,
    });
    render(<Risorse />);
    await waitFor(() => expect(screen.queryByTestId("personale-1")).toBeNull());
    expect(screen.queryByTestId("progetti-totali-1")).toBeNull();
  });

  it("un'azienda che non è personale non porta il segno", async () => {
    amministrazioneRisorse.mockResolvedValue({
      aziende: [azienda({ max_progetti_totali: 10, progetti: 0, personale: false })],
      macchina: null,
    });
    render(<Risorse />);
    await waitFor(() => expect(screen.getByTestId("progetti-totali-1")).toBeTruthy());
    expect(screen.queryByTestId("personale-1")).toBeNull();
    expect(screen.getByTestId("progetti-totali-1").textContent).toContain("0 / 10");
  });
});
