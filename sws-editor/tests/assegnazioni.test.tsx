/** Il bottone che assegna (11-10-2026, piano docs/plans/2026-10-11-colore-e-assegnazioni.md):
 *  al clic scrive ogni variabile del suo elenco, una conferma sola; l'editor
 *  propone il campo giusto per il tipo della variabile. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { EditorAssegnazioni, valoreIniziale } from "../src/editor/EditorAssegnazioni";
import { normalizzaColore } from "../src/tag/tipiScalari";
import { useAppStore } from "../src/store";
import type { SynopticObject } from "../src/types";

function bottone(extra: Partial<SynopticObject>): SynopticObject {
  return { id: "b1", type: "button", x: 0, y: 0, width: 100, height: 30, label: "Rosso", tag: "proprio", ...extra } as SynopticObject;
}

function disegna(obj: SynopticObject, onWriteTag: (id: string, v: unknown) => void) {
  return render(
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={{}} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} onWriteTag={onWriteTag} />
    </svg>,
  );
}

describe("bottone con assegnazioni", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scrive tutte le variabili, in ordine, e non la sua", () => {
    const scritte: [string, unknown][] = [];
    const { container } = disegna(
      bottone({ assegnazioni: [{ tag: "sfondo", valore: "#7f1d1d" }, { tag: "modo", valore: 2 }] }),
      (id, v) => scritte.push([id, v]),
    );
    fireEvent.click(container.querySelector("g")!);
    expect(scritte).toEqual([["sfondo", "#7f1d1d"], ["modo", 2]]);
  });

  it("con la conferma, una domanda sola per tutto il clic", () => {
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(true);
    const scritte: string[] = [];
    const { container } = disegna(
      bottone({ require_confirm: true, assegnazioni: [{ tag: "a", valore: 1 }, { tag: "b", valore: 2 }] }),
      (id) => scritte.push(id),
    );
    fireEvent.click(container.querySelector("g")!);
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(scritte).toEqual(["a", "b"]);
  });

  it("senza assegnazioni resta il comportamento di prima", () => {
    const scritte: [string, unknown][] = [];
    const { container } = disegna(bottone({ write_value: 5 }), (id, v) => scritte.push([id, v]));
    fireEvent.click(container.querySelector("g")!);
    expect(scritte).toEqual([["proprio", 5]]);
  });
});

describe("EditorAssegnazioni", () => {
  beforeEach(() => {
    useAppStore.setState({
      project: { tags: [
        { id: "sfondo", data_type: "color" },
        { id: "acceso", data_type: "bool" },
        { id: "modo", data_type: "u8" },
      ] },
    } as never);
  });

  it("il valore segue il tipo: selettore di colore, vero/falso, numero", () => {
    render(<EditorAssegnazioni onChange={() => {}} value={[
      { tag: "sfondo", valore: "#7f1d1d" },
      { tag: "acceso", valore: true },
      { tag: "modo", valore: 2 },
    ]} />);
    const r = screen.getByTestId("editor-assegnazioni");
    expect(r.querySelector('input[type="color"]')).not.toBeNull();
    expect(r.querySelector("select")).not.toBeNull();
    expect(r.querySelector('input[type="number"]')).not.toBeNull();
  });

  it("aggiungere e togliere righe; vuoto torna a undefined", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EditorAssegnazioni onChange={onChange} value={undefined} />);
    fireEvent.click(screen.getByText(/\+/));
    expect(onChange).toHaveBeenLastCalledWith([{ tag: "", valore: "" }]);
    rerender(<EditorAssegnazioni onChange={onChange} value={[{ tag: "sfondo", valore: "#000000" }]} />);
    fireEvent.click(screen.getByText("✕"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("valori iniziali e colori come il runtime", () => {
    expect(valoreIniziale("colore")).toBe("#000000");
    expect(valoreIniziale("bool")).toBe(true);
    expect(normalizzaColore("#ABC")).toBe("#aabbcc");
    expect(normalizzaColore("rosso")).toBeUndefined();
  });
});

import { sfondoPagina } from "../src/theme";
import { buildTagUsage } from "../src/search/tagUsage";
import { collectTagIds } from "../src/runtime-view/collectTagIds";

describe("sfondo della pagina da variabile", () => {
  const pagina = { background: "#101010", background_dark: "#000000", background_tag: "sfondo" };

  it("vince il colore della variabile, se è un colore", () => {
    expect(sfondoPagina(pagina, "light", { sfondo: { value: "#7f1d1d" } })).toBe("#7f1d1d");
    expect(sfondoPagina(pagina, "dark", { sfondo: { value: "#7f1d1d" } })).toBe("#7f1d1d");
  });

  it("variabile assente o non colore: lo sfondo fisso del tema", () => {
    expect(sfondoPagina(pagina, "light", {})).toBe("#101010");
    expect(sfondoPagina(pagina, "dark", { sfondo: { value: "rosso" } })).toBe("#000000");
    expect(sfondoPagina({ background: "#101010" }, "light", { sfondo: { value: "#7f1d1d" } })).toBe("#101010");
  });

  it("sfondo e assegnazioni contano come usi della variabile", () => {
    const usi = buildTagUsage({
      pages: [{ id: "p1", name: "P1", background_tag: "sfondo", objects: [
        { id: "b1", type: "button", x: 0, y: 0, assegnazioni: [{ tag: "modo", valore: 1 }] },
      ] }] as never,
      faceplates: [], alarms: [], tags: [], globalScripts: [],
    });
    expect(usi.has("sfondo")).toBe(true);
    expect(usi.has("modo")).toBe(true);
    expect(collectTagIds([{ id: "b", type: "button", x: 0, y: 0, assegnazioni: [{ tag: "x", valore: 1 }] } as never])).toContain("x");
  });
});
