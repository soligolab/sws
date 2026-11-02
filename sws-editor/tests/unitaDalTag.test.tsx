/** L'unità dal catalogo (02-11-2026, l'inverter ZCS): sta nei membri del tipo.
 *  In Tag la struttura si espande e porta al tipo; nel pannello proprietà un
 *  oggetto legato a una foglia mostra l'unità ereditata, e scriverci la cambia. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";
import { TagsTab } from "../src/config/schede/TagsTab";
import { GruppoAttivo, ObjectProps } from "../src/editor/EditorShell";
import type { Project, SynopticObject } from "../src/types";

const progetto = {
  meta: { name: "casa", version: "0.1.0" },
  tags: [{ id: "inverter", description: "ZCS", type_ref: "inv" }],
  types: [{ id: "inv", members: [
    { name: "grid_power", data_type: "i32", unit: "W", decimals: 0, description: "Potenza di rete" },
    { name: "battery_soc", data_type: "u16", unit: "%", range_lo: 0, range_hi: 100 },
  ] }],
  sources: [], alarms: [], functions: [],
} as unknown as Project;

beforeEach(() => {
  useAppStore.setState({ project: progetto, tagValues: {}, configTab: "tags", configFocus: null, authRole: "Admin" });
});

describe("in Tag una variabile strutturata", () => {
  it("si espande e mostra i membri con la loro unità", () => {
    render(<TagsTab />);
    expect(screen.queryByTestId("foglia-inverter.grid_power")).toBeNull();
    fireEvent.click(screen.getByTestId("espandi-inverter"));
    expect(screen.getByTestId("foglia-inverter.grid_power").textContent).toContain("W");
    expect(screen.getByTestId("foglia-inverter.battery_soc").textContent).toContain("0..100");
  });

  it("il dettaglio porta al tipo invece di offrire campi che non fanno niente", () => {
    render(<TagsTab />);
    fireEvent.click(screen.getByTitle(i18n.t("cfg.tagMeta")));
    expect(screen.getByTestId("meta-struttura-inverter")).toBeTruthy();
    expect(screen.queryByPlaceholderText("°C, bar…")).toBeNull();
    fireEvent.click(screen.getByText(i18n.t("cfg.tagApriTipo")));
    expect(useAppStore.getState().configTab).toBe("types");
    expect(useAppStore.getState().configFocus).toBe("inv");
  });
});

describe("nel pannello proprietà, la preconfigurazione dal tag", () => {
  const valore = (o: Partial<SynopticObject>) =>
    ({ id: "v", type: "gauge", x: 0, y: 0, width: 100, height: 100, tag: "inverter.grid_power", ...o }) as SynopticObject;
  const pannello = (o: SynopticObject) => render(
    <GruppoAttivo.Provider value="tutti">
      <ObjectProps obj={o} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
    </GruppoAttivo.Provider>,
  );

  it("il campo unità vuoto mostra l'unità del membro", () => {
    pannello(valore({}));
    const campi = screen.getAllByPlaceholderText("W");
    expect(campi.length).toBeGreaterThan(0);
    expect((campi[0] as HTMLInputElement).value).toBe("");
  });

  it("un'unità scritta sull'oggetto vince", () => {
    pannello(valore({ unit: "kW" }));
    expect(screen.queryByPlaceholderText("W")).toBeNull();
  });
});
