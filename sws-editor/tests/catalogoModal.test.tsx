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
const { catalogoDispositivi, voceCatalogo, updateTypes, updateTags, updateSources, chiamate } = vi.hoisted(() => {
  const chiamate: string[] = [];
  return {
    chiamate,
    catalogoDispositivi: vi.fn(),
    voceCatalogo: vi.fn(),
    updateTypes: vi.fn().mockImplementation(async () => { chiamate.push("types"); }),
    updateTags: vi.fn().mockImplementation(async () => { chiamate.push("tags"); }),
    updateSources: vi.fn().mockImplementation(async () => { chiamate.push("sources"); }),
  };
});
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: { ...actual.api, catalogoDispositivi, voceCatalogo, updateTypes, updateTags, updateSources, statoSorgenti: vi.fn().mockResolvedValue({}) },
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

  it("cerca, sceglie, aggiunge: tipo, variabile e dispositivo salvati subito, in quest'ordine", async () => {
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
    expect(screen.getByTestId("catalogo-anteprima").textContent).toContain("pixsys_atr244_processo"); // configurazione non spuntata

    fireEvent.click(screen.getByTestId("catalogo-aggiungi"));
    await waitFor(() => expect(useAppStore.getState().configFocus).toBe("linea/2"));
    expect(chiamate).toEqual(["types", "tags", "sources"]);
    expect(updateTags.mock.calls[0][0]).toEqual([expect.objectContaining({ id: "atr244_2", type_ref: "pixsys_atr244_processo" })]);
    expect(updateTypes.mock.calls[0][0][0].members.map((m: { name: string }) => m.name)).toEqual(["pv1"]);
    const voci = useAppStore.getState().elenchiConfig.protocols!;
    expect(voci[0].figli?.map((f) => f.id)).toEqual(["linea/1", "linea/2"]);
    // Salvato subito: niente bozza che resti indietro (le 127 variabili orfane del collaudo).
    expect(voci[0].modificato).toBe(false);
    expect(updateSources.mock.calls[0][0][0].devices.map((d: { unit_id: number }) => d.unit_id)).toEqual([1, 2]);
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

  it("riprende una variabile esistente dello stesso modello, senza crearne", async () => {
    useAppStore.setState({ project: { ...useAppStore.getState().project!,
      tags: [{ id: "atr_forno", description: "", type_ref: "pixsys_atr244" }],
      types: [{ id: "pixsys_atr244", members: [{ name: "pv1", data_type: "f32" }] }] } as never });
    render(<ProtocolsTab />);
    fireEvent.click(screen.getByTestId("modbus-dev-catalog-linea"));
    await waitFor(() => screen.getByTestId("catalog-item-pixsys/atr244"));
    fireEvent.click(screen.getByTestId("catalog-item-pixsys/atr244"));
    const sel = (await screen.findByTestId("catalogo-esistente")) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "atr_forno" } });
    expect(screen.queryByTestId("catalogo-nome")).toBeNull();
    expect(screen.getByTestId("catalogo-anteprima").textContent).toContain("atr_forno");
    fireEvent.click(screen.getByTestId("catalogo-aggiungi"));
    await waitFor(() => expect(chiamate).toEqual(["sources"])); // né tipo né variabile nuovi
    const regs = updateSources.mock.calls.at(-1)![0][0].devices[1].registers;
    expect(regs.map((r: { tag: string }) => r.tag)).toEqual(["atr_forno.pv1"]); // solo i membri che il tipo ha
  });
});
