import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import i18n from "../src/i18n";
import { GRUPPI_PROPRIETA, ObjectProps, PannelloDestro, barraGruppiVisibile, figlioProprietaAttivo, gruppiPerTipo, gruppoAffine, sezioneAffine, sezioneEffettiva } from "../src/editor/EditorShell";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import type { GruppoProprieta } from "../src/editor/EditorShell";
import type { SynopticObject } from "../src/types";

/** La barra dei gruppi del pannello destro (T-56, seguito dell'11-09-2026).
 *
 *  Due cose separate, provate separatamente: **quando** la barra si vede — una
 *  decisione con quattro casi, che nel pannello sarebbe sepolta in una catena
 *  di rami — e **come si comporta** la barra stessa, che è lo stesso
 *  componente usato a sinistra.
 */

describe("quando si vede la barra dei gruppi", () => {
  const rect = { id: "r1", type: "rect" };
  const grid = { id: "g1", type: "grid" };
  const nessuna = {};

  it("con un oggetto solo selezionato, sì", () => {
    expect(barraGruppiVisibile(rect, false, nessuna)).toBe(true);
  });

  it("senza selezione, no: il pannello mostra le proprietà di pagina", () => {
    expect(barraGruppiVisibile(null, false, nessuna)).toBe(false);
  });

  it("con più oggetti, no: le proprietà comuni non hanno le sezioni canoniche", () => {
    expect(barraGruppiVisibile(rect, true, nessuna)).toBe(false);
  });

  it("su una griglia senza celle selezionate, sì: è un oggetto come gli altri", () => {
    expect(barraGruppiVisibile(grid, false, nessuna)).toBe(true);
    // E le celle di un'ALTRA griglia non contano.
    expect(barraGruppiVisibile(grid, false, { cella: "g2" })).toBe(true);
  });

  it("con una cella, un intervallo o una sotto-cella di QUESTA griglia, no", () => {
    // Lì il pannello mostra l'editor della cella: la barra non avrebbe niente
    // da governare, e una barra che non fa niente è peggio di una assente.
    expect(barraGruppiVisibile(grid, false, { cella: "g1" })).toBe(false);
    expect(barraGruppiVisibile(grid, false, { intervallo: "g1" })).toBe(false);
    expect(barraGruppiVisibile(grid, false, { sottoCella: "g1" })).toBe(false);
  });

  it("col FIGLIO di una cella o sotto-cella selezionato, sì anche se cella/sottoCella restano valorizzate", () => {
    // Bug trovato il 13-09-2026: selezionare il figlio non cancella
    // `cella`/`sottoCella` (restano quelle della cella che lo contiene), e
    // senza `figlio` la barra si nascondeva lo stesso, pur mostrando
    // `ObjectProps` del figlio — le sezioni fuori dal gruppo già scelto
    // sparivano senza un modo per tornarci.
    expect(barraGruppiVisibile(grid, false, { cella: "g1", figlio: "g1" })).toBe(true);
    expect(barraGruppiVisibile(grid, false, { sottoCella: "g1", figlio: "g1" })).toBe(true);
    // Il figlio di un'ALTRA griglia non conta.
    expect(barraGruppiVisibile(grid, false, { cella: "g1", figlio: "g2" })).toBe(false);
  });
});

describe("il figlio che il pannello sta davvero mostrando", () => {
  const bottone: SynopticObject = { id: "gp_btn", type: "button", x: 0, y: 0 } as SynopticObject;
  const etichetta: SynopticObject = { id: "gp_led", type: "led", x: 0, y: 0 } as SynopticObject;
  const griglia: SynopticObject = {
    id: "g1", type: "grid", x: 0, y: 0,
    grid_cells: [
      { row: 0, col: 0, child: bottone },
      { row: 1, col: 1, sub: { orientation: "cols", ratio: 0.5, a: { child: etichetta }, b: {} } },
    ],
  } as SynopticObject;

  it("null senza una griglia selezionata", () => {
    expect(figlioProprietaAttivo(null, null, null)).toBeNull();
    expect(figlioProprietaAttivo(bottone, null, null)).toBeNull();
  });

  it("null con solo la cella selezionata (nessun figlio ancora scelto)", () => {
    expect(figlioProprietaAttivo(griglia, null, null)).toBeNull();
  });

  it("il figlio della cella, quando `selectedCellChild` combacia", () => {
    const f = figlioProprietaAttivo(griglia, { objectId: "g1", row: 0, col: 0 }, null);
    expect(f?.id).toBe("gp_btn");
  });

  it("il figlio della sotto-cella, quando `selectedSubCell` combacia", () => {
    const f = figlioProprietaAttivo(griglia, null, { objectId: "g1", row: 1, col: 1, path: ["a"] });
    expect(f?.id).toBe("gp_led");
  });

  it("null su una sotto-cella senza figlio (slot 'b', vuoto)", () => {
    expect(figlioProprietaAttivo(griglia, null, { objectId: "g1", row: 1, col: 1, path: ["b"] })).toBeNull();
  });

  it("null se l'id della griglia non combacia (un'altra griglia)", () => {
    expect(figlioProprietaAttivo(griglia, { objectId: "altra", row: 0, col: 0 }, null)).toBeNull();
  });
});

/** R4 (25-09-2026): il pannello destro è **una colonna sola**. I gruppi sono
 *  rami, dentro ci sono le sezioni; ne sta aperta una per volta, più quelle
 *  appuntate. Si provano con `ObjectProps` vero dentro `PannelloDestro`: il
 *  difetto dell'11-09 (un `Provider` dimenticato) insegna che il cablaggio va
 *  provato col componente vero, non con una spia. */
function Guscio({ obj }: { obj: SynopticObject }) {
  return (
    <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x"
      tipo={obj.type} gruppiVisibili={gruppiPerTipo(obj.type)} aSezioni
      chiaveOggetto={obj.id} bloccato={false}>
      <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
    </PannelloDestro>
  );
}
const oggetto = (id: string, type: string) => ({ id, type, x: 0, y: 0, width: 100, height: 40 }) as SynopticObject;
const sezioniAperte = () => screen.queryAllByRole("button", { expanded: true })
  .filter((b) => !b.closest("[data-testid^='ramo-proprieta-']"))
  .map((b) => (b.textContent ?? "").replace("📌", "").trim());
const titoloSezione = (k: string) => i18n.t(k);
/** Il pulsante di una sezione, non quello del ramo omonimo (il ramo «Testo»
 *  e la sezione «Testo» hanno lo stesso titolo). */
const sezione = (re: RegExp) => screen.getAllByRole("button", { name: re })
  .find((b) => !b.closest("[data-testid^='ramo-proprieta-']"))!;

describe("il pannello destro a una colonna", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

  it("i gruppi sono rami, e c'è un ramo per gruppo del tipo", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    const rami = screen.getAllByTestId(/^ramo-proprieta-/).map((e) => e.dataset.testid);
    expect(rami).toEqual(gruppiPerTipo("rect").map((g) => `ramo-proprieta-${g.id}`));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("una sola sezione aperta: aprendone un'altra, la prima si chiude", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    expect(sezioniAperte()).toHaveLength(1);
    fireEvent.click(sezione(new RegExp(titoloSezione("props.transform"))));
    expect(sezioniAperte()).toHaveLength(1);
    expect(sezioniAperte()[0]).toContain(titoloSezione("props.transform"));
  });

  it("una sezione appuntata resta aperta insieme a quella scelta", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(screen.getByTestId("pin-aspetto"));
    fireEvent.click(sezione(new RegExp(titoloSezione("props.transform"))));
    expect(sezioniAperte()).toHaveLength(2);
  });

  it("cambiando oggetto la sezione resta quella, se il tipo nuovo ce l'ha", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(sezione(new RegExp(titoloSezione("props.transform"))));
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(sezioniAperte()).toHaveLength(1);
    expect(sezioniAperte()[0]).toContain(titoloSezione("props.transform"));
  });

  it("se il tipo nuovo non ce l'ha si apre l'affine, e tornando si ritrova la scelta", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "text")} />);
    fireEvent.click(sezione(new RegExp("^" + titoloSezione("props.sectionText"))));
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(sezioniAperte()[0]).toContain(titoloSezione("props.sectionParameters"));
    rerender(<Guscio obj={oggetto("c", "text")} />);
    expect(sezioniAperte()[0]).toContain(titoloSezione("props.sectionText"));
  });

  it("il pulsante «Elimina oggetto» c'è, una volta sola, anche nella colonna", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    expect(screen.getAllByRole("button", { name: new RegExp(i18n.t("props.deleteObject")) })).toHaveLength(1);
  });

  it("un ramo chiuso nasconde le sue sezioni", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    const ramo = within(screen.getByTestId("ramo-proprieta-aspetto")).getByRole("button");
    fireEvent.click(ramo);
    expect(screen.queryByRole("button", { name: new RegExp(titoloSezione("props.transform")) })).toBeNull();
  });
});

describe("sezioneEffettiva", () => {
  const p = (chiave: string, gruppo: GruppoProprieta) => ({ chiave, gruppo });
  const rect = [p("identita", "aspetto"), p("aspetto", "aspetto"), p("dato", "dati"), p("transform", "aspetto")];
  const gauge = [p("parametri", "tipo"), ...rect];
  it("la scelta, se c'è", () => expect(sezioneEffettiva("transform", rect, "rect")).toBe("transform"));
  it("altrimenti la sezione del tipo", () => {
    expect(sezioneEffettiva("testo", gauge, "gauge")).toBe("parametri");
    expect(sezioneEffettiva("testo", rect, "rect")).toBe("aspetto");
  });
  it("mai nessuna quando qualcosa c'è", () => expect(sezioneEffettiva(null, rect, "rect")).toBe("aspetto"));
});

describe("i rami dicono cosa contengono (25-09-2026)", () => {
  it("il ramo del tipo c'è sui testi e sugli strumenti, non sulle forme", () => {
    expect(gruppiPerTipo("text").map((g) => g.id)).toContain("tipo");
    expect(gruppiPerTipo("gauge").map((g) => g.id)).toContain("tipo");
    for (const forma of ["rect", "ellipse", "line"]) {
      expect(gruppiPerTipo(forma).map((g) => g.id), forma).not.toContain("tipo");
    }
  });

  it("gli altri tre rami valgono per ogni tipo", () => {
    for (const tipo of ["rect", "text", "trend", "grid", "pipe"]) {
      const ids = gruppiPerTipo(tipo).map((g) => g.id);
      for (const atteso of ["aspetto", "dati", "interazione"]) {
        expect(ids, `${tipo} senza ${atteso}`).toContain(atteso);
      }
    }
  });

  it("il ramo del tipo è il primo", () => {
    expect(GRUPPI_PROPRIETA[0].id).toBe("tipo");
  });
});

describe("il gruppo affine di ogni tipo", () => {
  it("testi e strumenti → il ramo del tipo, forme → Posizione e aspetto", () => {
    for (const t of ["text", "button", "pipe", "trend"]) expect(gruppoAffine(t), t).toBe("tipo");
    for (const t of ["rect", "ellipse", "line"]) expect(gruppoAffine(t), t).toBe("aspetto");
  });

  it("la sezione affine: Testo, Parametri, o Aspetto sulle forme", () => {
    expect(sezioneAffine("text")).toBe("testo");
    expect(sezioneAffine("gauge")).toBe("parametri");
    expect(sezioneAffine("rect")).toBe("aspetto");
  });

  it("per ogni tipo della palette è un gruppo che quel tipo mostra davvero", () => {
    const tipi = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as string));
    expect(tipi.length).toBeGreaterThan(30);
    for (const tipo of tipi) {
      const visibili = gruppiPerTipo(tipo).map((g) => g.id);
      expect(visibili, `${tipo}: gruppo affine non fra quelli visibili`).toContain(gruppoAffine(tipo));
    }
  });
});
