/** La «Configurazione del modulo» nella card del dispositivo (25-10-2026): si
 *  vede per un dispositivo nato dal catalogo, offre solo i parametri da fissare,
 *  e la scelta finisce nel setup del dispositivo (e da lì al runtime). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n";

const { voceCatalogo, statoSorgenti } = vi.hoisted(() => ({
  statoSorgenti: vi.fn().mockResolvedValue({}),
  voceCatalogo: vi.fn().mockResolvedValue({
    id: "pixsys/mcm260x-5ad", marca: "Pixsys", modello: "MCM260X-5AD", origine: "prodotto",
    modbus: { setup_ritardato: { da: 2001, a: 2100, scostamento: 2000 } },
    registri: [
      { nome: "indirizzo_slave", indirizzo: 2, accesso: "rw", gruppo: "configurazione", setup: false },
      { nome: "tipo_sensore_ai1", indirizzo: 2021, accesso: "rw", gruppo: "configurazione",
        valori: { "0": { it: "disabilitato", en: "disabled" }, "12": { it: "PTC1K", en: "PTC1K" } } },
    ],
  }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, voceCatalogo, statoSorgenti } };
});

import { ProtocolsTab } from "../src/config/schede/ProtocolsTab";
import { useAppStore } from "../src/store";

describe("la configurazione del modulo", () => {
  it("offre i parametri del catalogo e la scelta entra nel setup", async () => {
    useAppStore.setState({
      project: { meta: { name: "p", version: "0.1.0" }, tags: [], types: [], alarms: [], functions: [], sources: [{
        kind: "modbus_rtu", id: "linea", device: "/dev/ttyS1", baud_rate: 19200, parity: "N", data_bits: 8, stop_bits: 1, poll_interval_ms: 1000,
        devices: [{ unit_id: 1, modello: "pixsys/mcm260x-5ad@1", registers: [] }],
      }] } as never,
      configTab: "protocols", configFocus: "linea/1", elenchiConfig: {},
    });
    render(<ProtocolsTab />);
    const scelta = await screen.findByTestId("setup-tipo_sensore_ai1");
    expect(voceCatalogo).toHaveBeenCalledWith("pixsys/mcm260x-5ad");
    expect(screen.queryByTestId("setup-indirizzo_slave"), "indirizzo e baud non si fissano dal progetto").toBeNull();
    fireEvent.change(scelta, { target: { value: "12" } });
    await waitFor(() => expect((screen.getByTestId("setup-tipo_sensore_ai1") as HTMLSelectElement).value).toBe("12"));
    expect(useAppStore.getState().elenchiConfig.protocols![0].modificato).toBe(true);
  });
});
