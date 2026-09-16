import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LinguaContenutiProvider } from "../src/i18n/linguaContenuti";
import { SvgObject } from "../src/canvas/SvgCanvas";
import type { LanguageTable, SynopticObject } from "../src/types";

/** I token `{{chiave}}` si risolvono anche dentro griglie e faceplate.
 *
 *  Il guasto: fino al 15-09-2026 la localizzazione stava sull'**array di primo
 *  livello** della pagina (`RuntimeView`/`EditorShell` chiamavano
 *  `localizeObjects` e passavano oggetti già risolti). I figli di una `grid` e
 *  quelli di un `faceplate` non nascono da quell'array — nascono dentro
 *  `SvgObject` — quindi restavano grezzi. Sul pannello LVGL gli stessi token si
 *  risolvevano, perché lì la localizzazione è sempre stata nell'imbuto unico.
 *
 *  Effetto: la **stessa** griglia tradotta sul pannello e piena di
 *  `{{chiave}}` nel browser. Questi test montano l'oggetto contenitore vero,
 *  non il figlio: è il punto in cui i pezzi si incontrano, ed è l'unico posto
 *  che nessuno guardava.
 */

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/risoluzione-token.json"), "utf8"),
) as { tabella: LanguageTable };
const tabella = fixture.tabella;

function disegna(obj: SynopticObject, lang = "en") {
  return render(
    <LinguaContenutiProvider value={{ lang, table: tabella }}>
      <svg>
        <SvgObject
          obj={obj}
          objects={[obj]}
          tagValues={{}}
          selected={false}
          isEditMode={false}
          customSymbols={[]}
          faceplates={[]}
        />
      </svg>
    </LinguaContenutiProvider>,
  );
}

const testo = (id: string, text: string): SynopticObject =>
  ({ id, type: "text", x: 0, y: 0, width: 100, height: 20, text }) as SynopticObject;

describe("la lingua dei contenuti arriva a ogni oggetto, non solo a quelli in cima", () => {
  it("un oggetto di primo livello si traduce", () => {
    disegna(testo("t1", "{{ciao}}"));
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("il figlio di una cella di griglia si traduce", () => {
    // È il caso che falliva: la griglia disegna i propri figli da sé, e il
    // figlio non è mai passato dall'array di primo livello della pagina.
    const griglia = {
      id: "g1", type: "grid", x: 0, y: 0, width: 300, height: 200,
      grid_rows: 1, grid_cols: 1,
      grid_cells: [{ row: 0, col: 0, child: testo("figlio", "{{ciao}}") }],
    } as unknown as SynopticObject;
    disegna(griglia);
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("senza Provider non si traduce, e non si rompe niente", () => {
    // Il default del contesto è inerte di proposito: un test che monta un
    // oggetto singolo non deve essere costretto a conoscere le lingue.
    render(
      <svg>
        <SvgObject
          obj={testo("t2", "{{ciao}}")} objects={[]} tagValues={{}}
          selected={false} isEditMode={false} customSymbols={[]} faceplates={[]}
        />
      </svg>,
    );
    expect(screen.getByText("{{ciao}}")).toBeTruthy();
  });
});
