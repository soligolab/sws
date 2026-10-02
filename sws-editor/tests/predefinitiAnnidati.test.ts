/** I predefiniti arrivano anche dentro le griglie.
 *
 *  Il 02-10-2026, su un progetto di collaudo con tutti e 38 i tipi: dei 240
 *  campi che `riempiPredefiniti` avrebbe dovuto scrivere, 234 c'erano e sei
 *  no — e tutti e sei stavano **dentro le celle di una griglia** (un led senza
 *  `on_color`, un rect senza `fill`, un testo senza `font_size`, una lampada
 *  senza colore). Il riempimento percorreva i soli oggetti di primo livello
 *  della pagina.
 *
 *  Conta perché un valore che il file non dice i due motori lo indovinano
 *  ciascuno a modo suo — il `data_log` scuro sul web e bianco sul pannello —
 *  ed è esattamente il difetto che la tabella dei predefiniti esiste per
 *  chiudere. Una griglia non è un caso raro: è il contenitore con cui si
 *  compongono i sinottici.
 */
import { describe, expect, it } from "vitest";
import { riempiPredefinitiOggetti } from "../src/predefinitiCampi";
import type { SynopticObject } from "../src/types";

const nudo = (id: string, type: string): SynopticObject =>
  ({ id, type, x: 0, y: 0, width: 40, height: 40 }) as SynopticObject;

describe("riempiPredefiniti scende nei contenitori", () => {
  it("riempie il figlio di una cella di griglia", () => {
    const griglia = {
      ...nudo("g", "grid"),
      grid_cells: [{ row: 0, col: 0, child: nudo("g_led", "led") }],
    } as SynopticObject;
    const [out] = riempiPredefinitiOggetti([griglia]);
    const figlio = out.grid_cells![0].child!;
    expect(figlio.on_color, "un led in una cella deve avere il suo colore acceso").toBe("#22c55e");
    expect(figlio.off_color).toBe("#374151");
  });

  it("riempie anche il figlio di una sotto-cella, che annida a sua volta", () => {
    const griglia = {
      ...nudo("g", "grid"),
      grid_cells: [{ row: 0, col: 0, sub: { a: { child: nudo("s_text", "text") } } }],
    } as SynopticObject;
    const [out] = riempiPredefinitiOggetti([griglia]);
    expect(out.grid_cells![0].sub!.a!.child!.font_size).toBe(14);
  });

  it("senza niente da riempire torna lo stesso oggetto, non una copia", () => {
    // È così che il sorvegliante «progetto cambiato» non scatta a vuoto.
    const pieno = {
      ...nudo("g", "grid"),
      grid_cells: [{ row: 0, col: 0, child: { ...nudo("g_led", "led"), on_color: "#22c55e", off_color: "#374151" } }],
      grid_border_color: "#334155",
    } as SynopticObject;
    const objs = [pieno];
    expect(riempiPredefinitiOggetti(objs)).toBe(objs);
  });
});
