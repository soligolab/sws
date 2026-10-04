/** «Dal catalogo…» a schermo (04-10-2026): si cerca, si sceglie un modello,
 *  si aggiunge. Tipo e variabile si salvano subito (prima il tipo), il
 *  dispositivo va nella bozza del bus e la sua card si apre. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const VOCE = {
  id: "pixsys/atr244", marca: "Pixsys", modello: "ATR244", famiglia: "Regolatori ATR", versione: 1, origine: "prodotto",
  descrizione: { it: "Regolatore PID 48x48 mm", en: "PID controller 48x48 mm" }, immagine: "atr244.jpg",
  modbus: { ordine: "cdab", timeout_ms: 1000, seriale: { baud_rate: 9600, parity: "N", data_bits: 8, stop_bits: 1 } },
  registri: [
    { nome: "pv1", indirizzo: 1000, formato: "i16", scala: 0.1, accesso: "r", gruppo: "processo" },
    { nome: "indirizzo_slave", indirizzo: 2, accesso: "rw", gruppo: "configurazione", predefinito: false },
  ],
};
const { catalogoDispositivi, voceCatalogo, updateTypes, updateTags, chiamate } = vi.hoisted(() => {
  const chiamate: string[] = [];
  return {
    chiamate,
    catalogoDispositivi: vi.fn(),
    voceCatalogo: vi.fn(),
    updateTypes: vi.fn().mockImplementation(async () => { chiamate.push("types"); }),
    updateTags: vi.fn().mockImplementation(async () => { chiamate.push("tags"); }),
  };
});
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: { ...actual.api, catalogoDispositivi, voceCatalogo, updateTypes, updateTags, statoSorgenti: vi.fn().mockResolvedValue({}) },
  };
});

import { ProtocolsTab } from "../src/config/schede/ProtocolsTab";
import { useAppStore } from "../src/store";

describe("Dal catalogo", () => {
  beforeEach(() => {
    chiamate.length = 0;
    catalogoDispositivi.mockResolvedValue({
      voci: [
        { id: VOCE.id, marca: "Pixsys", modello: "ATR244", famiglia: "Regolatori ATR", descrizione: VOCE.descrizione, immagine: "atr244.jpg", origine: "prodotto" },
        { id: "pixsys/str551", marca: "Pixsys", modello: "STR551", famiglia: "Indicatori STR", origine: "utente" },
      ],
      errori: [{ file: "pixsys/rotto.json (Utente)", errore: "expected value" }],
    });
    voceCatalogo.mockResolvedValue(VOCE);
    useAppStore.setState({
      project: {
        meta: { name: "p", version: "0.1.0" }, tags: [], types: [], alarms: [], functions: [],
        sources: [{ kind: "modbus_rtu", id: "linea", device: "/dev/ttyS1", baud_rate: 9600, parity: "N", data_bits: 8, stop_bits: 1,
                    poll_interval_ms: 1000, devices: [{ unit_id: 1, registers: [] }] }],
      } as never,
      configTab: "protocols", configFocus: "linea", elenchiConfig: {},
    });
  });

  it("cerca, sceglie, aggiunge: tipo poi variabile, dispositivo nella bozza", async () => {
    render(<ProtocolsTab />);
    fireEvent.click(screen.getByTestId("modbus-dev-catalog-linea"));
    await waitFor(() => expect(screen.getByTestId("catalog-item-pixsys/atr244")).toBeTruthy());
    expect(screen.getByText(/rotto\.json/)).toBeTruthy(); // un file rotto si dice
    fireEvent.change(screen.getByTestId("catalogo-cerca"), { target: { value: "str" } });
    expect(screen.queryByTestId("catalog-item-pixsys/atr244")).toBeNull();
    fireEvent.change(screen.getByTestId("catalogo-cerca"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("catalog-item-pixsys/atr244"));

    await waitFor(() => expect(screen.getByTestId("catalogo-nome")).toBeTruthy());
    expect((screen.getByTestId("catalogo-unit") as HTMLInputElement).value).toBe("2"); // l'1 è occupato
    expect((screen.getByTestId("catalogo-nome") as HTMLInputElement).value).toBe("atr244_2");
    expect((screen.getByTestId("catalogo-gruppo-configurazione") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("catalogo-anteprima").textContent).toContain("pixsys_atr244");

    fireEvent.click(screen.getByTestId("catalogo-aggiungi"));
    await waitFor(() => expect(useAppStore.getState().configFocus).toBe("linea/2"));
    expect(chiamate).toEqual(["types", "tags"]);
    expect(updateTags.mock.calls[0][0]).toEqual([expect.objectContaining({ id: "atr244_2", type_ref: "pixsys_atr244" })]);
    const voci = useAppStore.getState().elenchiConfig.protocols!;
    expect(voci[0].figli?.map((f) => f.id)).toEqual(["linea/1", "linea/2"]);
    expect(voci[0].modificato).toBe(true); // la bozza dei Protocolli aspetta il Salva
    expect(screen.getByTestId("modbus-dev-card-linea-2")).toBeTruthy();
  });

  it("un unit id già usato o un nome che c'è non si aggiungono", async () => {
    useAppStore.setState({ project: { ...useAppStore.getState().project!, tags: [{ id: "atr244_2", description: "", data_type: "f32" }] } as never });
    render(<ProtocolsTab />);
    fireEvent.click(screen.getByTestId("modbus-dev-catalog-linea"));
    await waitFor(() => screen.getByTestId("catalog-item-pixsys/atr244"));
    fireEvent.click(screen.getByTestId("catalog-item-pixsys/atr244"));
    await waitFor(() => screen.getByTestId("catalogo-nome"));
    expect((screen.getByTestId("catalogo-nome") as HTMLInputElement).value).toBe("atr244_2_2");
    fireEvent.change(screen.getByTestId("catalogo-unit"), { target: { value: "1" } });
    expect((screen.getByTestId("catalogo-aggiungi") as HTMLButtonElement).disabled).toBe(true);
  });
});
