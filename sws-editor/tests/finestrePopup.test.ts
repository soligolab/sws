/** P1 — finestre popup generiche (17-10-2026, piano docs/plans/2026-10-17-finestre-popup.md). */
import { describe, it, expect } from "vitest";
import { pagineNavigabili, paginePerNavigazione } from "../src/boot/tipi";
import { oggettiFinestra, titoloFinestra } from "../src/finestre/finestra";
import { corniceDellaPagina } from "../src/cornici/modello";
import { findOrphanPageIds } from "../src/pageLayout";
import type { SynopticPage } from "../src/types";

const pompa: SynopticPage = {
  id: "pompa", name: "Dettaglio pompa", width: 400, height: 240,
  finestra: { modale: false, titolo: "Pompa {nome}" },
  finestra_parametri: [{ name: "tag", type: "tag", default: "pompa1.stato" }, { name: "nome", default: "1" }],
  objects: [{ id: "t", type: "text", x: 10, y: 20, tag: "{tag}", text: "Stato {nome}" }],
};
const home: SynopticPage = {
  id: "home", name: "Home", objects: [
    { id: "b1", type: "button", x: 0, y: 0, button_action: { type: "open_popup", page: "pompa", params: { tag: "pompa2.stato", nome: "2" } } },
  ],
};

describe("finestre popup", () => {
  it("una pagina-finestra non è navigabile, ma resta fra le pagine dell'editor", () => {
    expect(pagineNavigabili([home, pompa]).map((p) => p.id)).toEqual(["home"]);
    expect(paginePerNavigazione([home, pompa]).map((p) => p.id)).toEqual(["home", "pompa"]);
  });

  it("i parametri del bottone, poi i default della pagina", () => {
    expect(oggettiFinestra(pompa, { tag: "pompa2.stato", nome: "2" })[0]).toMatchObject({ tag: "pompa2.stato", text: "Stato 2" });
    expect(oggettiFinestra(pompa, {})[0]).toMatchObject({ tag: "pompa1.stato", text: "Stato 1" });
    expect(titoloFinestra(pompa, { nome: "2" })).toBe("Pompa 2");
    expect(titoloFinestra({ ...pompa, finestra: { modale: true } }, {})).toBe("Dettaglio pompa");
  });

  it("una pagina-finestra non ha cornice e non è mai orfana", () => {
    expect(corniceDellaPagina(pompa, "base")).toBe(null);
    expect([...findOrphanPageIds([home, pompa], "home")]).toEqual([]);
    expect([...findOrphanPageIds([{ ...home, objects: [] }, pompa], "home")]).toEqual([]);
  });
});
