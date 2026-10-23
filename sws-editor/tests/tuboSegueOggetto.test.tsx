/** Il tubo si calcola sulle posizioni **risolte dai binding** dei suoi capi.
 *
 *  Piano: docs/plans/2026-10-21-tubo-che-segue-gli-oggetti.md, Fase 1.
 *
 *  Il difetto non era «il tubo non segue quando l'oggetto si muove»: era che il
 *  tubo nasceva staccato **già al primo fotogramma**. Ogni oggetto viene
 *  disegnato da `resolveObject` alla posizione che dicono i suoi binding,
 *  mentre `percorsoTubo` riceveva la lista grezza della pagina. Con un
 *  `bindings.x` su una pompa, il tubo partiva dalla mandata di dove la pompa
 *  *non* era, e nessun tag doveva nemmeno cambiare perché si vedesse.
 *
 *  Gemello del test Rust `il_capo_agganciato_segue_i_binding_delloggetto`
 *  (`lvgl_render.rs`), con la stessa pompa e gli stessi numeri. */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const manifesto = JSON.parse(
  readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8"),
) as ManifestLib;

beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto)); });

const ogg = (o: Partial<SynopticObject>) => o as SynopticObject;

/** La pompa del test Rust: mandata `n-top` a (150, 200) da ferma. */
const pompa = (extra: Partial<SynopticObject> = {}) => ogg({
  id: "p", type: "symbol", symbol_id: "lib:process/centrifugal-pump",
  x: 100, y: 200, width: 80, height: 80, ...extra,
});

const tubo = ogg({
  id: "t", type: "pipe", from_obj_id: "p", from_port: "n-top",
  points: [{ x: 0, y: 0 }, { x: 900, y: 600 }],
});

function percorsoDisegnato(objects: SynopticObject[], tagValues: Record<string, unknown> = {}) {
  const { container } = render(
    <svg>
      <SvgObject obj={tubo} objects={objects} tagValues={tagValues as never} selected={false}
        isEditMode={false} customSymbols={[]} faceplates={[]} />
    </svg>,
  );
  const d = [...container.querySelectorAll("path")]
    .map((p) => p.getAttribute("d") ?? "")
    .find((s) => s.startsWith("M "));
  return d ?? "";
}

describe("il tubo segue i binding dell'oggetto a cui è agganciato", () => {
  it("senza binding parte dalla mandata scritta nel file", () => {
    expect(percorsoDisegnato([pompa(), tubo])).toBe("M 150 200 L 900 600");
  });

  it("col tag vivo parte dalla mandata di dove la pompa è davvero", () => {
    const p = pompa({ bindings: { x: "carrello.x" } as never });
    // 500 di `x` + 50 di scostamento della bocca = 550.
    expect(percorsoDisegnato([p, tubo], { "carrello.x": { value: 500 } }))
      .toBe("M 550 200 L 900 600");
  });

  it("col tag assente resta la geometria del file, non un buco", () => {
    const p = pompa({ bindings: { x: "carrello.x" } as never });
    expect(percorsoDisegnato([p, tubo], {})).toBe("M 150 200 L 900 600");
  });
});
