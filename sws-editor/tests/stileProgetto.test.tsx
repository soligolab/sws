/** Lo stile dei simboli del progetto (Fase 4 del piano
 *  docs/plans/2026-10-14-motore-simboli-lib.md): arriva al disegno, la scheda
 *  salva solo le scelte vere, e l'oggetto può sovrascriverlo. */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { GruppoAttivo, ObjectProps } from "../src/editor/EditorShell";
import { StileSimboliTab } from "../src/config/schede/StileSimboliTab";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import { impostaStileProgetto } from "../src/symbols/stileProgetto";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
const file = Object.fromEntries(manifesto.symbols.map((s) => [s.file, readFileSync(resolve(LIB, s.file), "utf8")]));
beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto, file)); });
afterEach(() => { act(() => impostaStileProgetto(undefined)); vi.restoreAllMocks(); });

const pompa = (extra: Partial<SynopticObject> = {}) =>
  ({ id: "p", type: "symbol", x: 0, y: 0, width: 80, height: 80, symbol_id: "lib:process/centrifugal-pump", ...extra }) as SynopticObject;
const disegna = (obj: SynopticObject) => render(
  <svg><SvgObject obj={obj} objects={[obj]} tagValues={{}} selected={false} isEditMode={false} customSymbols={[]} faceplates={[]} /></svg>,
);

describe("lo stile del progetto sul disegno", () => {
  it("volume e tinta del progetto arrivano agli strati", () => {
    act(() => impostaStileProgetto({ volume: 0, materials: { steel: "#b08a60" } }));
    const { container } = disegna(pompa());
    expect([...container.querySelectorAll("[data-shade]")].every((e) => e.getAttribute("opacity") === "0")).toBe(true);
    expect(container.querySelector('[data-mat="steel"]')!.getAttribute("fill")).toBe("#b08a60");
  });

  it("l'oggetto vince sul progetto", () => {
    act(() => impostaStileProgetto({ volume: 0 }));
    const { container } = disegna(pompa({ symbol_volume: 100, symbol_body_color: "#aa5500" }));
    expect(container.querySelector("[data-shade]")!.getAttribute("opacity")).toBe("1");
    expect(container.querySelector('[id$="-body"]')!.getAttribute("fill")).toBe("#aa5500");
  });

  it("il colore di stato del progetto vale quando l'oggetto non ne ha uno", () => {
    act(() => impostaStileProgetto({ state_on_color: "#3b82f6" }));
    const obj = pompa({ state_tag: "m" });
    const { container } = render(
      <svg><SvgObject obj={obj} objects={[obj]} tagValues={{ m: { value: true } } as never} selected={false} isEditMode={false} customSymbols={[]} faceplates={[]} /></svg>,
    );
    expect(container.querySelector('[id$="-body"]')!.getAttribute("fill")).toBe("#3b82f6");
  });
});

describe("la scheda Stile", () => {
  it("salva solo le scelte vere e aggiorna il progetto", async () => {
    const salva = vi.spyOn(api, "updateSymbolStyle").mockResolvedValue(undefined);
    act(() => useAppStore.getState().setProject({ name: "p", tags: [], symbol_style: undefined } as never));
    render(<StileSimboliTab />);
    fireEvent.change(screen.getByLabelText(/^Volume/), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Seconds per rotor turn"), { target: { value: "" } });
    await act(async () => { await useAppStore.getState().saveAll?.(); });
    await waitFor(() => expect(salva).toHaveBeenCalledWith({ volume: 30 }));
    expect(useAppStore.getState().project?.symbol_style).toEqual({ volume: 30 });
  });
});

describe("pannello proprietà", () => {
  const pannello = (obj: SynopticObject) => {
    render(<GruppoAttivo.Provider value="tipo"><ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} /></GruppoAttivo.Provider>);
    for (let g = 0; g < 8; g++) { const c = screen.queryAllByRole("button", { expanded: false }); if (!c.length) break; c.forEach((b) => fireEvent.click(b)); }
  };
  it("un simbolo di libreria ha lo stile dell'oggetto; il serbatoio anche il contenuto", () => {
    pannello(pompa({ symbol_id: "lib:process/vertical-tank" }));
    expect(screen.getByText("Style of this symbol")).toBeTruthy();
    expect(screen.getByText("Content colour")).toBeTruthy();
  });
  it("un builtin sostituito dalla libreria (alias) ha lo stile del disegno nuovo", () => {
    pannello(pompa({ symbol_id: "pump" }));
    expect(screen.getByText("Style of this symbol")).toBeTruthy();
  });
  it("un simbolo custom del progetto no", () => {
    pannello(pompa({ symbol_id: "custom:valvola-cliente" }));
    expect(screen.queryByText("Style of this symbol")).toBeNull();
  });
});
