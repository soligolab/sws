/** Le parti vive di un simbolo (02-11-2026): stanno fra i tag principali, in
 *  «Collegamenti», e il tag di stato fa da predefinito alla leva. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import manifesto from "../public/symbols/lib/manifest.json";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { Collegamenti, conLevaDalloStato } from "../src/editor/proprieta/Collegamenti";
import type { SynopticObject } from "../src/types";

beforeEach(() => impostaLibreriaPerTest(manifesto as unknown as ManifestLib));
afterEach(() => impostaLibreriaPerTest(null));

const levetta = (o: Partial<SynopticObject> = {}) =>
  ({ id: "s", type: "symbol", x: 0, y: 0, width: 60, height: 60, symbol_id: "lib:controls/toggle-switch", ...o }) as SynopticObject;

describe("il tag di stato fa da predefinito alla leva", () => {
  it("una leva senza tag prende quello dello stato", () => {
    const p = conLevaDalloStato(levetta(), { state_tag: "luce.cucina" });
    expect(p.symbol_parts?.lever?.tag).toBe("luce.cucina");
  });

  it("cambiando lo stato, la leva che lo seguiva lo segue ancora", () => {
    const o = levetta({ state_tag: "a", symbol_parts: { lever: { tag: "a" } } });
    expect(conLevaDalloStato(o, { state_tag: "b" }).symbol_parts?.lever?.tag).toBe("b");
  });

  it("un tag scelto apposta per la leva resta suo", () => {
    const o = levetta({ state_tag: "a", symbol_parts: { lever: { tag: "comando.leva" } } });
    expect(conLevaDalloStato(o, { state_tag: "b" }).symbol_parts).toBeUndefined();
  });

  it("un selettore a tre posizioni non si tocca: lì il tag è un indice", () => {
    const o = levetta({ symbol_id: "lib:controls/selector-3" });
    expect(conLevaDalloStato(o, { state_tag: "x" }).symbol_parts).toBeUndefined();
  });
});

describe("le parti in Collegamenti", () => {
  it("ci sono, con l'avviso per quelle senza tag", () => {
    render(<Collegamenti obj={levetta({ symbol_id: "lib:building/wall-switch" })} onChange={() => {}} stileCampo={{}} />);
    expect(screen.getByTestId("parti-del-simbolo")).toBeTruthy();
    expect(screen.getByText(i18n.t("props.parteLeva"))).toBeTruthy();
    expect(screen.getByTestId("parti-senza-tag").textContent).toBe(i18n.t("props.partiSenzaTag", { count: 2 }));
  });

  it("scrivere lo stato scrive anche la leva", () => {
    let ultimo: Partial<SynopticObject> = {};
    render(<Collegamenti obj={levetta()} onChange={(p) => { ultimo = p; }} stileCampo={{}} />);
    const stato = document.querySelector('[data-slot="state_tag"] input') as HTMLInputElement;
    fireEvent.change(stato, { target: { value: "luce.cucina" } });
    expect(ultimo.state_tag).toBe("luce.cucina");
    expect(ultimo.symbol_parts?.lever?.tag).toBe("luce.cucina");
  });
});

/** The animated pieces of a project symbol (19-11-2026, plan
 *  docs/plans/2026-11-19-animazioni-dei-simboli.md): a row each, a tag or a
 *  fixed value. A single rotor or level stays with the symbol's own slots. */
describe("the animated pieces in Collegamenti", () => {
  const pieces = {
    // A library id: the test library is the simplest place for a symbol with every piece.
    id: "lib:test/pezzi", file: "test/pezzi.svg", family: "project", kind: "project", label: "Pezzi",
    viewBox: [120, 100], body: "body-pump", materials: [],
    parts: [
      { id: "fan", kind: "rotor", cx: 24, cy: 24, symmetry: 90 },
      { id: "tank", kind: "level", x: 44, y: 8, w: 32, h: 12 },
      { id: "gate", kind: "slide", dx: 0, dy: -16 },
      { id: "motor", kind: "vibrate" },
      { id: "glow", kind: "pulse" },
      { id: "beacon", kind: "signal", color: "#64748b", entries: [{ value: 1, color: "#22c55e" }, { value_min: 2, value_max: 9, blink: true }] },
    ],
  };
  const withPieces = (extra: object[] = []) => impostaLibreriaPerTest({
    ...(manifesto as unknown as ManifestLib),
    symbols: [...(manifesto as unknown as ManifestLib).symbols, { ...pieces, parts: [...pieces.parts, ...extra] } as never],
  });
  const obj = (o: Partial<SynopticObject> = {}) => levetta({ symbol_id: "lib:test/pezzi", ...o });
  const rows = () => [...document.querySelectorAll("[data-parte]")].map((e) => e.getAttribute("data-parte"));

  it("a row for every piece; a single rotor and a single level follow the symbol's slots", () => {
    withPieces();
    render(<Collegamenti obj={obj()} onChange={() => {}} stileCampo={{}} />);
    expect(rows()).toEqual(["gate", "motor", "glow", "beacon"]);
  });

  it("with two rotors, each has its row, and says it follows the symbol when empty", () => {
    withPieces([{ id: "fan2", kind: "rotor", cx: 80, cy: 24, symmetry: 60 }]);
    render(<Collegamenti obj={obj()} onChange={() => {}} stileCampo={{}} />);
    expect(rows()).toEqual(["fan", "gate", "motor", "glow", "beacon", "fan2"]);
    expect(screen.getAllByText(i18n.t("props.parteSegueSimbolo"))).toHaveLength(2);
  });

  it("Tag or fixed value: switching writes the value and drops the tag", () => {
    withPieces();
    let last: Partial<SynopticObject> = {};
    const { rerender } = render(<Collegamenti obj={obj({ symbol_parts: { motor: { tag: "m" } } })}
      onChange={(p) => { last = p; }} stileCampo={{}} />);
    fireEvent.click(screen.getByTestId("parte-motor-value"));
    expect(last.symbol_parts?.motor).toEqual({ value: true });
    rerender(<Collegamenti obj={obj({ symbol_parts: { motor: { value: true } } })} onChange={(p) => { last = p; }} stileCampo={{}} />);
    fireEvent.click(screen.getByTestId("parte-motor-fisso"));
    expect(last.symbol_parts?.motor).toEqual({ value: false });
    fireEvent.click(screen.getByTestId("parte-motor-tag"));
    expect(last.symbol_parts).toBeUndefined();
  });

  it("a signal's fixed value: a number when it reads as one", () => {
    withPieces();
    let last: Partial<SynopticObject> = {};
    render(<Collegamenti obj={obj({ symbol_parts: { beacon: { value: "" } } })} onChange={(p) => { last = p; }} stileCampo={{}} />);
    fireEvent.change(screen.getByTestId("parte-beacon-fisso"), { target: { value: "5" } });
    expect(last.symbol_parts?.beacon).toEqual({ value: 5 });
    fireEvent.change(screen.getByTestId("parte-beacon-fisso"), { target: { value: "on" } });
    expect(last.symbol_parts?.beacon).toEqual({ value: "on" });
  });
});
