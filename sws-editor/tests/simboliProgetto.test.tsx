/** I simboli disegnati nel progetto (`prj:`) sul web: lo strato del progetto
 *  sopra la libreria li rende uguali a quelli di libreria — strati, bocche dei
 *  tubi, etichette (piano docs/archive/2026-11-03-assistente-genera-simboli-e-sinottici.md, F2). */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { bocchePer } from "../src/canvas/tubazioni";
import {
  etichettaSimbolo, impostaLibreriaPerTest, impostaSimboliProgetto, isLib, trovaSimboloLib,
} from "../src/symbols/lib/libreria";
import type { ManifestLib, SimboloLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
const file = Object.fromEntries(manifesto.symbols.map((s) => [s.file, readFileSync(resolve(LIB, s.file), "utf8")]));

// Un simbolo del progetto finto: il disegno della pompa sotto un altro nome, con
// la voce che il runtime scriverebbe per un `prj:`.
const pompa = manifesto.symbols.find((s) => s.id === "lib:process/centrifugal-pump")!;
const voce: SimboloLib = {
  ...pompa, id: "prj:pompa-di-prova", file: "prj/pompa-di-prova.svg", family: "project", kind: "project",
  label: "Pompa di prova", labels: { it: "Pompa di prova", en: "Test pump" }, replaces: undefined,
};

beforeEach(() => {
  act(() => {
    impostaLibreriaPerTest(manifesto, file);
    impostaSimboliProgetto([{ voce, svg: file["process/centrifugal-pump.svg"] }]);
  });
});

const oggetto = (extra: Partial<SynopticObject> = {}) =>
  ({ id: "g1", type: "symbol", x: 0, y: 0, width: 80, height: 80, symbol_id: "prj:pompa-di-prova", ...extra }) as SynopticObject;

describe("lo strato del progetto", () => {
  it("un prj: si trova come un lib:, e conta come disegno a strati", () => {
    expect(trovaSimboloLib("prj:pompa-di-prova")?.label).toBe("Pompa di prova");
    expect(isLib("prj:pompa-di-prova")).toBe(true);
    expect(trovaSimboloLib("prj:non-esiste")).toBeUndefined();
  });

  it("le bocche dei tubi vengono dalla sua voce", () => {
    expect(bocchePer(oggetto())?.porte.map((p) => p.id)).toEqual(pompa.ports!.map((p) => p.id));
  });

  it("sul canvas si disegna a strati, rotore compreso", () => {
    const o = oggetto();
    const { container } = render(
      <svg><SvgObject obj={o} objects={[o]} tagValues={{}} selected={false} isEditMode={false} customSymbols={[]} faceplates={[]} /></svg>,
    );
    expect(container.querySelector('[id$="-body"]')).not.toBeNull();
    expect(container.querySelector('[data-strato="rotor"]')).not.toBeNull();
  });

  it("l'etichetta viene dalla voce, nella lingua di chi guarda", () => {
    const t = (k: string) => `tradotto:${k}`;
    expect(etichettaSimbolo(voce, t, "en")).toBe("Test pump");
    expect(etichettaSimbolo(voce, t, "it-IT")).toBe("Pompa di prova");
    expect(etichettaSimbolo(pompa, t, "en")).toBe(`tradotto:${pompa.label}`);
  });

  it("un progetto nuovo toglie i simboli del vecchio", () => {
    act(() => impostaSimboliProgetto([]));
    expect(trovaSimboloLib("prj:pompa-di-prova")).toBeUndefined();
  });
});
