/** Il lucchetto col ruolo che serve (regola R7 dei template, 04-11-2026): sul
 *  comando che chi guarda non può usare, nella pagina e dentro un faceplate;
 *  mai a chi può, mai in modifica. */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import "../src/i18n/index";
import { SvgCanvas, SvgObject } from "../src/canvas/SvgCanvas";
import { useAppStore } from "../src/store";
import type { FaceplateDef, SynopticObject } from "../src/types";

const PROGETTO = {
  tags: [{ id: "luce", write_min_role: "Viewer" }, { id: "pompa" }, { id: "garage", write_min_role: "Supervisor" }],
  types: [],
};
const bottone = (tag: string, extra: Partial<SynopticObject> = {}) =>
  ({ id: `b_${tag}`, type: "button", x: 100, y: 100, width: 120, height: 40, tag, label: "x", ...extra }) as SynopticObject;

const lucchetti = (c: HTMLElement) => [...c.querySelectorAll("[data-lucchetto]")].map((e) => e.getAttribute("data-lucchetto"));

beforeEach(() => {
  act(() => useAppStore.setState({ project: PROGETTO as never, authRole: null }));
});

describe("il lucchetto sui comandi", () => {
  it("all'anonimo: sui comandi da Operator e da Supervisor, non sulla luce aperta", () => {
    const { container } = render(<SvgCanvas objects={[bottone("luce"), bottone("pompa"), bottone("garage")]} />);
    expect(lucchetti(container).sort()).toEqual(["Operator", "Supervisor"]);
  });

  it("all'Operator resta solo quello del garage", () => {
    act(() => useAppStore.setState({ authRole: "Operator" }));
    const { container } = render(<SvgCanvas objects={[bottone("luce"), bottone("pompa"), bottone("garage")]} />);
    expect(lucchetti(container)).toEqual(["Supervisor"]);
  });

  it("in modifica non c'è: si progetta, non si esercita un ruolo", () => {
    const { container } = render(<SvgCanvas objects={[bottone("pompa")]} onMove={() => {}} />);
    expect(lucchetti(container)).toEqual([]);
  });

  it("dentro un faceplate, sul figlio che comanda", () => {
    const fp = { id: "luce_fp", label: "Luce", params: ["p"],
      objects: [{ id: "cmd", type: "button", x: 0, y: 0, width: 80, height: 30, tag: "{p}", label: "x" }] } as unknown as FaceplateDef;
    const ist = { id: "i1", type: "faceplate", x: 10, y: 10, width: 80, height: 30, faceplate_id: "luce_fp",
      faceplate_params: { p: "garage" } } as SynopticObject;
    const { container } = render(
      <svg>
        <SvgObject obj={ist} objects={[ist]} tagValues={{}} selected={false} isEditMode={false}
          customSymbols={[]} faceplates={[fp]} />
      </svg>,
    );
    expect(lucchetti(container)).toEqual(["Supervisor"]);
  });
});
