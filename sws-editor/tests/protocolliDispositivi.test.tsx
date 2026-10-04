/** Bus e dispositivi Modbus a schermo (04-10-2026): l'albero ha un terzo
 *  livello, il focus su un dispositivo apre la sua card, e lo stato del
 *  runtime colora i pallini. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { statoSorgenti } = vi.hoisted(() => ({
  statoSorgenti: vi.fn().mockResolvedValue({
    linea: { stato: "ok", da_ms: 0, dispositivi: { "1": { stato: "ok", da_ms: 0 }, "3": { stato: "non_risponde", errore: "nessuna risposta in 500 ms", da_ms: 0 } } },
  }),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoSorgenti } };
});

import { ProtocolsTab } from "../src/config/schede/ProtocolsTab";
import { useAppStore } from "../src/store";
import type { ModbusRtuSource } from "../src/types";

const linea: ModbusRtuSource = {
  kind: "modbus_rtu", id: "linea", device: "/dev/ttyS1", baud_rate: 19200, parity: "N", data_bits: 8, stop_bits: 1,
  poll_interval_ms: 1000,
  devices: [
    { unit_id: 1, registers: [{ tag: "t1", address: 0, scale: 1 }] },
    { unit_id: 3, nome: "inverter", modello: "pixsys/atr244@1", registers: [] },
  ],
};

function progetto(sources: unknown[]) {
  useAppStore.setState({
    project: { meta: { name: "p", version: "0.1.0" }, tags: [], types: [], sources, alarms: [], functions: [] } as never,
    configTab: "protocols",
    configFocus: null,
    elenchiConfig: {},
  });
}

describe("Protocolli: bus → dispositivi", () => {
  beforeEach(() => progetto([linea]));

  it("pubblica i dispositivi come figli del bus, per l'albero", () => {
    render(<ProtocolsTab />);
    const voci = useAppStore.getState().elenchiConfig.protocols!;
    expect(voci[0].figli).toEqual([
      { id: "linea/1", etichetta: "unit 1" },
      { id: "linea/3", etichetta: "inverter · 3" },
    ]);
  });

  it("col focus su un dispositivo mostra solo la sua card, con modello e stato", async () => {
    useAppStore.setState({ configFocus: "linea/3" });
    render(<ProtocolsTab />);
    expect(screen.getByTestId("modbus-dev-card-linea-3")).toBeTruthy();
    expect(screen.queryByText("/dev/ttyS1")).toBeNull();
    expect(screen.getByTestId("modello-dispositivo").textContent).toContain("pixsys/atr244@1");
    await waitFor(() => expect(screen.getByTestId("modbus-dev-state-linea-3").getAttribute("data-stato")).toBe("errore"));
    expect(screen.getByTestId("modbus-dev-state-linea-3").getAttribute("title")).toContain("500 ms");
  });

  it("dal bus si aggiunge un dispositivo col primo unit id libero e lo si apre", () => {
    useAppStore.setState({ configFocus: "linea" });
    render(<ProtocolsTab />);
    fireEvent.click(screen.getByTestId("modbus-dev-add-linea"));
    expect(useAppStore.getState().configFocus).toBe("linea/2");
    expect(screen.getByTestId("modbus-dev-card-linea-2")).toBeTruthy();
  });

  it("un progetto di prima si apre senza risultare modificato, e passa ai devices alla prima modifica", () => {
    const vecchio = {
      kind: "modbus_tcp", id: "plc", host: "h", port: 502, unit_id: 4, poll_interval_ms: 1000,
      registers: [{ tag: "a", address: 1, scale: 1 }],
    };
    progetto([vecchio]);
    useAppStore.setState({ configFocus: "plc/4" });
    render(<ProtocolsTab />);
    expect(useAppStore.getState().elenchiConfig.protocols![0].modificato).toBe(false);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "pompa" } });
    const voce = useAppStore.getState().elenchiConfig.protocols![0];
    expect(voce.modificato).toBe(true);
    expect(voce.figli).toEqual([{ id: "plc/4", etichetta: "pompa · 4" }]);
  });
});
