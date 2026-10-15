/** Il simbolo che comanda (14-10-2026, piano
 *  docs/plans/2026-10-14-strumenti-simboli-comandi.md, ramo 2): con
 *  `command_tag` (o assegnazioni) il clic scrive come un bottone, su
 *  `command_tag` e non su `tag` (che sul simbolo è la qualità). Senza, resta un
 *  disegno. */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto)); });

const simbolo = (extra: Partial<SynopticObject>) =>
  ({ id: "s1", type: "symbol", x: 0, y: 0, width: 80, height: 80, symbol_id: manifesto.symbols[0].id,
     tag: "qualita", state_tag: "marcia", ...extra }) as SynopticObject;

function disegna(obj: SynopticObject, valori: Record<string, unknown> = {}) {
  const scritte: [string, unknown][] = [];
  const tagValues = Object.fromEntries(Object.entries(valori).map(([k, value]) => [k, { value }]));
  const r = render(
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={tagValues as never} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} onWriteTag={(id: string, v: unknown) => scritte.push([id, v])} />
    </svg>,
  );
  return { ...r, scritte, area: r.container.querySelector('[data-testid="simbolo-comando-s1"]') };
}

describe("simbolo che comanda", () => {
  it("senza comando non è un pulsante e non scrive", () => {
    const { area, container, scritte } = disegna(simbolo({}));
    expect(area).toBeNull();
    for (const r of container.querySelectorAll("rect")) fireEvent.click(r);
    expect(scritte).toEqual([]);
  });

  it("commuta il suo command_tag, non tag né state_tag", () => {
    const { area, scritte } = disegna(simbolo({ command_tag: "start", button_mode: "toggle" }), { start: true });
    fireEvent.click(area!);
    expect(scritte).toEqual([["start", false]]);
  });

  it("momentaneo: pressione e rilascio", () => {
    const { area, scritte } = disegna(simbolo({ command_tag: "start", button_mode: "momentary" }));
    fireEvent.mouseDown(area!);
    fireEvent.mouseUp(area!);
    fireEvent.click(area!);
    expect(scritte).toEqual([["start", true], ["start", false]]);
  });

  it("le assegnazioni bastano a farlo comandare", () => {
    const { area, scritte } = disegna(simbolo({ assegnazioni: [{ tag: "modo", valore: 2 }] }));
    fireEvent.click(area!);
    expect(scritte).toEqual([["modo", 2]]);
  });
});
