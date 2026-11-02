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
