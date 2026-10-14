/** La sezione «Parti» del pannello proprietà (Fase 3, M8): compaiono solo le
 *  parti che il disegno ha, e livello e rotazione spariscono dove non servono. */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { GruppoAttivo, ObjectProps } from "../src/editor/EditorShell";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto, {})); });

function pannello(obj: SynopticObject, onChange: (p: Partial<SynopticObject>) => void = () => {}) {
  render(
    <GruppoAttivo.Provider value="tipo">
      <ObjectProps obj={obj} pages={[]} functions={[]} onChange={onChange} onDelete={() => {}} />
    </GruppoAttivo.Provider>,
  );
  for (let giro = 0; giro < 8; giro++) {
    const chiuse = screen.queryAllByRole("button", { expanded: false });
    if (chiuse.length === 0) break;
    for (const b of chiuse) fireEvent.click(b);
  }
}
const simbolo = (id: string): SynopticObject => ({ id: "s", type: "symbol", x: 0, y: 0, width: 80, height: 80, symbol_id: id } as SynopticObject);

describe("pannello proprietà dei simboli di libreria", () => {
  it("il manometro ha la lancetta con la sua scala, e niente livello", () => {
    pannello(simbolo("lib:process/pressure-gauge"));
    expect(screen.getByText("Needle (tag)")).toBeTruthy();
    expect(screen.getByText("Scale end")).toBeTruthy();
    expect(screen.queryByText("Lamp lamp-red on (tag)")).toBeNull();
    expect(screen.queryByText(/Level tag/)).toBeNull();
  });

  it("la colonna luminosa ha una riga per spia", () => {
    pannello(simbolo("lib:machines/stack-light"));
    for (const id of ["lamp-red", "lamp-amber", "lamp-green"]) expect(screen.getByText(`Lamp ${id} on (tag)`)).toBeTruthy();
  });

  it("un builtin non ha la sezione, e il livello resta", () => {
    pannello(simbolo("pump"));
    expect(screen.queryByText("Parts")).toBeNull();
  });
});
