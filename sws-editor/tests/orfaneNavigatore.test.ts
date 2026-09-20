import { describe, it, expect } from "vitest";
import { findOrphanPageIds } from "../src/pageLayout";
import type { PageTreeNode, SynopticObject, SynopticPage } from "../src/types";

const pagina = (id: string, objects: SynopticObject[] = []): SynopticPage => ({ id, name: id, objects });
const navigatore = (extra: Partial<SynopticObject>): SynopticObject =>
  ({ id: "n", type: "page_navigator", x: 0, y: 0, width: 100, height: 30, ...extra }) as SynopticObject;

// Un navigatore automatico raggiunge le pagine che mostra: senza contarlo ogni
// pagina che serve risulterebbe «orfana» nel rapporto dei collegamenti.
describe("pagine orfane e navigatore di pagine", () => {
  const albero: PageTreeNode[] = [{ id: "home", children: [{ id: "a" }, { id: "b" }] }, { id: "z" }];

  it("senza navigatori ogni pagina tranne la home è orfana", () => {
    const pagine = [pagina("home"), pagina("a"), pagina("b"), pagina("z")];
    expect([...findOrphanPageIds(pagine, "home", albero)].sort()).toEqual(["a", "b", "z"]);
  });

  it("un navigatore «tutte» raggiunge tutte le pagine", () => {
    const pagine = [pagina("home", [navigatore({ nav_source: "all" })]), pagina("a"), pagina("b"), pagina("z")];
    expect(findOrphanPageIds(pagine, "home", albero).size).toBe(0);
  });

  it("i figli della pagina corrente: dalla home raggiunge a e b, non z", () => {
    const pagine = [pagina("home", [navigatore({ nav_source: "children_of_current" })]), pagina("a"), pagina("b"), pagina("z")];
    expect([...findOrphanPageIds(pagine, "home", albero)]).toEqual(["z"]);
  });

  it("una pagina esclusa dal navigatore resta orfana, finché un altro non la raggiunge", () => {
    const solo = [pagina("home", [navigatore({ nav_source: "all", nav_items: [{ page_id: "b", hidden: true }] })]), pagina("a"), pagina("b"), pagina("z")];
    expect([...findOrphanPageIds(solo, "home", albero)]).toEqual(["b"]);
    const conAltro = [pagina("home", [navigatore({ nav_source: "all", nav_items: [{ page_id: "b", hidden: true }] })]),
      pagina("a", [{ id: "nb", type: "navbutton", x: 0, y: 0, target_page: "b" } as SynopticObject]), pagina("b"), pagina("z")];
    expect(findOrphanPageIds(conAltro, "home", albero).size).toBe(0);
  });
});
