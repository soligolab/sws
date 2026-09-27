import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import i18n from "../src/i18n";
import { GRUPPI_PROPRIETA, ObjectProps, PannelloDestro, barraGruppiVisibile, figlioProprietaAttivo, gruppiPerTipo, gruppoAffine, ramoEffettivo } from "../src/editor/EditorShell";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
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

/** Il pannello destro a **un livello** (26-09-2026, dopo R4 del 25-09): si
 *  aprono i rami — uno scelto più gli appuntati 📌 — e le sezioni dentro un
 *  ramo sono sottotitoli sempre visibili. Si prova con `ObjectProps` vero
 *  dentro `PannelloDestro`: il difetto dell'11-09 (un `Provider` dimenticato)
 *  insegna che il cablaggio va provato col componente vero, non con una spia. */
function Guscio({ obj, boot = false }: { obj: SynopticObject; boot?: boolean }) {
  return (
    <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x"
      tipo={obj.type} gruppiVisibili={gruppiPerTipo(obj.type, boot)} aSezioni
      chiaveOggetto={obj.id} bloccato={false} paginaBoot={boot}>
      <ObjectProps obj={obj} pages={[]} functions={[]} onChange={() => {}} onDelete={() => {}} />
    </PannelloDestro>
  );
}
const oggetto = (id: string, type: string) => ({ id, type, x: 0, y: 0, width: 100, height: 40 }) as SynopticObject;
/** Gli id dei rami aperti, dall'intestazione (aria-expanded). */
const ramiAperti = () => screen.getAllByTestId(/^ramo-proprieta-/)
  .filter((r) => within(r).getAllByRole("button")[0].getAttribute("aria-expanded") === "true")
  .map((r) => r.dataset.testid!.replace("ramo-proprieta-", ""));
const intestazione = (g: string) => within(screen.getByTestId(`ramo-proprieta-${g}`)).getAllByRole("button")[0];

describe("il pannello destro a un livello", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

  it("c'è un ramo per gruppo, e il ramo del tipo c'è anche sulle forme", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    const rami = screen.getAllByTestId(/^ramo-proprieta-/).map((e) => e.dataset.testid);
    expect(rami).toEqual(gruppiPerTipo("rect").map((g) => `ramo-proprieta-${g.id}`));
    expect(rami).toContain("ramo-proprieta-tipo");
  });

  it("dentro un ramo non c'è niente da aprire: le sezioni sono sottotitoli", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("aspetto"));
    // Nessun pulsante apri/chiudi fuori dalle intestazioni dei rami.
    const apribili = screen.queryAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null && !b.closest("[data-testid^='ramo-proprieta-']"));
    expect(apribili).toHaveLength(0);
    expect(screen.getByTestId("sezione-transform")).toBeTruthy();
    expect(screen.getByTestId("sezione-identita")).toBeTruthy();
  });

  it("all'inizio è aperto il ramo del tipo, uno solo", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    expect(ramiAperti()).toEqual(["tipo"]);
  });

  it("un ramo alla volta: aprendone un altro il primo si chiude", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    fireEvent.click(intestazione("dati"));
    expect(ramiAperti()).toEqual(["dati"]);
  });

  it("un ramo appuntato resta aperto insieme a quello scelto", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    fireEvent.click(screen.getByTestId("pin-ramo-tipo"));
    fireEvent.click(intestazione("dati"));
    expect(ramiAperti().sort()).toEqual(["dati", "tipo"]);
  });

  it("cambiando oggetto resta aperto l'ultimo ramo usato", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("interazione"));
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(ramiAperti()).toEqual(["interazione"]);
  });

  it("chiudere il ramo aperto vale per quell'oggetto: il prossimo riapre il ramo ricordato", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("aspetto"));
    fireEvent.click(intestazione("aspetto"));
    expect(ramiAperti()).toEqual([]);
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(ramiAperti()).toEqual(["aspetto"]);
  });

  it("il tag del bottone sta nel ramo del bottone, accanto a modalità e valore", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    const tipo = screen.getAllByTestId(/^sezione-/).map((e) => e.dataset.testid);
    expect(tipo).toContain("sezione-parametri");
    expect(tipo).toContain("sezione-dato");
    expect(screen.getByText(i18n.t("props.tag"))).toBeTruthy();
    expect(screen.getByText(i18n.t("props.buttonMode"))).toBeTruthy();
  });

  it("su una pagina di boot il dato non compare, anche se il ramo del tipo c'è", () => {
    render(<Guscio obj={oggetto("a", "rect")} boot />);
    fireEvent.click(intestazione("tipo"));
    expect(screen.queryByTestId("sezione-dato")).toBeNull();
  });

  it("il pulsante «Elimina oggetto» c'è, una volta sola", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    expect(screen.getAllByRole("button", { name: new RegExp(i18n.t("props.deleteObject")) })).toHaveLength(1);
  });
});

describe("ramoEffettivo", () => {
  const rami = ["tipo", "aspetto", "dati", "interazione"];
  it("lo scelto, se c'è", () => expect(ramoEffettivo("dati", rami, "rect")).toBe("dati"));
  it("altrimenti il ramo del tipo", () => expect(ramoEffettivo("sparito", rami, "rect")).toBe("tipo"));
  it("mai nessuno quando qualcosa c'è, salvo chiusura esplicita", () => {
    expect(ramoEffettivo(null, rami, "rect")).toBe("tipo");
    expect(ramoEffettivo("dati", rami, "rect", true)).toBeNull();
  });
  it("il primo che c'è se manca anche il ramo del tipo", () => expect(ramoEffettivo(null, ["aspetto"], "rect")).toBe("aspetto"));
});

describe("i rami dicono cosa contengono", () => {
  it("il ramo del tipo c'è per ogni tipo della palette (26-09-2026)", () => {
    const tipi = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as string));
    expect(tipi.length).toBeGreaterThan(30);
    for (const tipo of tipi) expect(gruppiPerTipo(tipo).map((g) => g.id), tipo).toContain("tipo");
  });

  it("gli altri tre rami valgono per ogni tipo", () => {
    for (const tipo of ["rect", "text", "trend", "grid", "pipe"]) {
      const ids = gruppiPerTipo(tipo).map((g) => g.id);
      for (const atteso of ["aspetto", "dati", "interazione"]) {
        expect(ids, `${tipo} senza ${atteso}`).toContain(atteso);
      }
    }
  });

  it("il ramo del tipo è il primo, ed è l'affine di ogni tipo", () => {
    expect(GRUPPI_PROPRIETA[0].id).toBe("tipo");
    for (const t of ["text", "button", "rect", "line"]) expect(gruppoAffine(t), t).toBe("tipo");
  });
});
