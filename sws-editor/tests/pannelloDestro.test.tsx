import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAppStore } from "../src/store";
import i18n from "../src/i18n";
import { GRUPPI_PROPRIETA, ObjectProps, PannelloDestro, barraGruppiVisibile, figlioProprietaAttivo, gruppiPerTipo, gruppoAffine, ramoEffettivo } from "../src/editor/EditorShell";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import { PREFISSO_MEMORIA } from "../src/editor/stilePannelli";
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
  .filter((r) => within(r).getAllByRole("button", { hidden: true })[0].getAttribute("aria-expanded") === "true")
  .map((r) => r.dataset.testid!.replace("ramo-proprieta-", ""));
const intestazione = (g: string) => within(screen.getByTestId(`ramo-proprieta-${g}`)).getAllByRole("button")[0];

describe("il pannello destro a un livello", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

  it("c'è un ramo per gruppo, e il ramo del tipo c'è anche sulle forme", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    const rami = screen.getAllByTestId(/^ramo-proprieta-/).map((e) => e.dataset.testid);
    expect(rami).toEqual(gruppiPerTipo("rect").map((g) => `ramo-proprieta-${g.id}`));
    expect(rami).toContain("ramo-proprieta-funzione");
  });

  it("dentro un ramo non c'è niente da aprire: le sezioni sono sottotitoli", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("aspetto"));
    // Nessun pulsante apri/chiudi fuori dalle intestazioni dei rami.
    const apribili = screen.queryAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null && !b.closest("[data-testid^='ramo-proprieta-']"));
    expect(apribili).toHaveLength(0);
    expect(screen.getByTestId("sezione-transform")).toBeTruthy();
    expect(screen.getByTestId("sezione-layer")).toBeTruthy();
  });

  it("nome e X Y W H stanno nella striscia fissa, fuori dai rami e sempre in vista", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    for (const g of ["funzione", "aspetto", "comportamento"]) {
      fireEvent.click(intestazione(g));
      const striscia = screen.getByTestId("striscia-oggetto");
      expect(striscia.closest("[data-testid^='ramo-proprieta-']")).toBeNull();
      for (const etichetta of [i18n.t("props.name"), "X", "Y", "W", "H"]) {
        expect(within(striscia).getByText(etichetta, { exact: true }), `${g}: ${etichetta}`).toBeTruthy();
      }
    }
  });

  it("all'inizio è aperto il ramo del tipo, uno solo", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    expect(ramiAperti()).toEqual(["funzione"]);
  });

  it("un ramo alla volta: aprendone un altro il primo si chiude", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    fireEvent.click(intestazione("comportamento"));
    expect(ramiAperti()).toEqual(["comportamento"]);
  });

  it("un ramo appuntato resta aperto insieme a quello scelto", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    fireEvent.click(screen.getByTestId("pin-ramo-funzione"));
    fireEvent.click(intestazione("aspetto"));
    expect(ramiAperti().sort()).toEqual(["aspetto", "funzione"]);
  });

  it("cambiando oggetto resta aperto l'ultimo ramo usato", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("comportamento"));
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(ramiAperti()).toEqual(["comportamento"]);
  });

  it("i rami ricordati prima del 01-11-2026 ricadono su quelli di oggi", () => {
    for (const [vecchio, nuovo] of [["tipo", "funzione"], ["dati", "funzione"], ["interazione", "comportamento"]]) {
      localStorage.clear();
      localStorage.setItem(PREFISSO_MEMORIA + "destra.ramo", vecchio);
      localStorage.setItem(PREFISSO_MEMORIA + "destra.ramiAppuntati", JSON.stringify([vecchio]));
      const { unmount } = render(<Guscio obj={oggetto("a", "button")} />);
      expect(ramiAperti(), vecchio).toEqual([nuovo]);
      expect(screen.getByTestId(`pin-ramo-${nuovo}`).getAttribute("aria-pressed"), vecchio).toBe("true");
      unmount();
    }
  });

  it("chiudere il ramo aperto vale per quell'oggetto: il prossimo riapre il ramo ricordato", () => {
    const { rerender } = render(<Guscio obj={oggetto("a", "rect")} />);
    fireEvent.click(intestazione("aspetto"));
    fireEvent.click(intestazione("aspetto"));
    expect(ramiAperti()).toEqual([]);
    rerender(<Guscio obj={oggetto("b", "gauge")} />);
    expect(ramiAperti()).toEqual(["aspetto"]);
  });

  it("il tag del bottone sta nel ramo della funzione, accanto a modalità e valore", () => {
    render(<Guscio obj={oggetto("a", "button")} />);
    const tipo = screen.getAllByTestId(/^sezione-/).map((e) => e.dataset.testid);
    // Dal 01-11-2026: in testa i tag, poi il testo, poi il comando — niente «Parametri».
    expect(tipo).toEqual(["sezione-collegamenti", "sezione-testo", "sezione-comando", "sezione-security"]);
    expect(screen.getAllByText(i18n.t("props.slot.comando")).length).toBeGreaterThan(0);
    expect(screen.getByText(i18n.t("props.buttonMode"))).toBeTruthy();
  });

  it("su una pagina di boot niente dato, qualità, binding né accesso", () => {
    render(<Guscio obj={oggetto("a", "text")} boot />);
    expect(ramiAperti()).toEqual(["funzione"]);
    expect(screen.getByTestId("sezione-testo")).toBeTruthy();
    for (const k of ["dato", "quality", "bindings", "security"]) expect(screen.queryByTestId(`sezione-${k}`), k).toBeNull();
  });

  it("il pulsante «Elimina oggetto» c'è, una volta sola, nella striscia", () => {
    render(<Guscio obj={oggetto("a", "rect")} />);
    const elimina = screen.getAllByRole("button", { name: new RegExp(i18n.t("props.deleteObject")) });
    expect(elimina).toHaveLength(1);
    expect(within(screen.getByTestId("striscia-oggetto")).getByTestId("elimina-oggetto")).toBe(elimina[0]);
  });
});

/** «Filtra proprietà» (01-11-2026, fase 4 del piano 2026-11-01-pannello-
 *  proprieta-per-frequenza): un testo apre tutti i rami e lascia solo ciò
 *  che corrisponde. */
describe("il filtro delle proprietà", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });
  const visibile = (el: HTMLElement | null) => !!el && el.style.display !== "none" && !el.closest("[style*='display: none']");

  it("apre tutti i rami e lascia le sole sezioni che corrispondono", () => {
    render(<Guscio obj={oggetto("a", "slider")} />);
    expect(ramiAperti()).toEqual(["funzione"]);
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: i18n.t("props.orientation") } });
    expect(ramiAperti().sort()).toEqual(["aspetto", "comportamento", "funzione"]);
    expect(visibile(screen.getByTestId("sezione-stile"))).toBe(true);
    expect(visibile(screen.getByTestId("sezione-scala"))).toBe(false);
    expect(visibile(screen.getByText(i18n.t("props.orientation")))).toBe(true);
    expect(visibile(screen.getByText(i18n.t("props.sliderTrackThickness")))).toBe(false);
  });

  it("Esc svuota, e torna tutto com'era", () => {
    render(<Guscio obj={oggetto("a", "slider")} />);
    const campo = screen.getByTestId("filtro-proprieta");
    fireEvent.change(campo, { target: { value: "zzz-niente" } });
    expect(screen.getAllByTestId(/^sezione-/).every((e) => !visibile(e))).toBe(true);
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(ramiAperti()).toEqual(["funzione"]);
    expect(screen.getAllByTestId(/^sezione-/).every((e) => visibile(e))).toBe(true);
  });

  it("chi cerca «tag» trova Collegamenti, e i rami senza risultati non mostrano il nome", () => {
    render(<Guscio obj={oggetto("a", "slider", )} />);
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: "tag" } });
    expect(visibile(screen.getByTestId("sezione-collegamenti"))).toBe(true);
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: i18n.t("props.orientation") } });
    expect(visibile(screen.getByTestId("ramo-proprieta-aspetto"))).toBe(true);
    expect(visibile(screen.getByTestId("ramo-proprieta-comportamento"))).toBe(false);
  });

  it("passando da un filtro all'altro le righe tornano come erano", () => {
    render(<Guscio obj={oggetto("a", "slider", )} />);
    const riga = screen.getAllByTestId("collegamenti")[0].querySelector<HTMLElement>("[data-row]")!;
    const prima = riga.style.display;
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: "zzz" } });
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: "tag" } });
    expect(riga.style.display).toBe(prima);
  });

  it("un titolo di sezione che corrisponde la tiene intera", () => {
    render(<Guscio obj={oggetto("a", "slider")} />);
    fireEvent.change(screen.getByTestId("filtro-proprieta"), { target: { value: i18n.t("props.sezioneScala") } });
    expect(visibile(screen.getByTestId("sezione-scala"))).toBe(true);
    expect(visibile(screen.getByText(i18n.t("props.unit")))).toBe(true);
  });
});

describe("ramoEffettivo", () => {
  const rami = ["funzione", "aspetto", "comportamento"];
  it("lo scelto, se c'è", () => expect(ramoEffettivo("comportamento", rami, "rect")).toBe("comportamento"));
  it("altrimenti il ramo della funzione", () => expect(ramoEffettivo("sparito", rami, "rect")).toBe("funzione"));
  it("mai nessuno quando qualcosa c'è, salvo chiusura esplicita", () => {
    expect(ramoEffettivo(null, rami, "rect")).toBe("funzione");
    expect(ramoEffettivo("aspetto", rami, "rect", true)).toBeNull();
  });
  it("il primo che c'è se manca anche il ramo del tipo", () => expect(ramoEffettivo(null, ["aspetto"], "rect")).toBe("aspetto"));
});

describe("i rami dicono cosa contengono", () => {
  it("il ramo del tipo c'è per ogni tipo della palette (26-09-2026)", () => {
    const tipi = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as string));
    expect(tipi.length).toBeGreaterThan(30);
    for (const tipo of tipi) expect(gruppiPerTipo(tipo).map((g) => g.id), tipo).toContain("funzione");
  });

  it("gli altri due rami valgono per ogni tipo", () => {
    for (const tipo of ["rect", "text", "trend", "grid", "pipe"]) {
      const ids = gruppiPerTipo(tipo).map((g) => g.id);
      for (const atteso of ["aspetto", "comportamento"]) {
        expect(ids, `${tipo} senza ${atteso}`).toContain(atteso);
      }
    }
  });

  it("il ramo del tipo è il primo, ed è l'affine di ogni tipo", () => {
    expect(GRUPPI_PROPRIETA.map((g) => g.id)).toEqual(["funzione", "aspetto", "comportamento"]);
    for (const t of ["text", "button", "rect", "line"]) expect(gruppoAffine(t), t).toBe("funzione");
  });
});

/** La disposizione «Stile VS Code» (31-10-2026, piano
 *  docs/archive/2026-10-31-ide-stile-vscode.md): i rami sono le icone della
 *  barra sul bordo destro, la colonna ne mostra uno, niente 📌. */
describe("pannello destro — stile VS Code", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({ disposizioneIde: "vscode" });
  });
  afterEach(() => useAppStore.setState({ disposizioneIde: "classica" }));

  it("una icona per ramo, nessun 📌, e un ramo solo nella colonna", () => {
    render(<Guscio obj={oggetto("g1", "gauge")} />);
    const voci = screen.getAllByRole("tab").map((b) => b.getAttribute("data-testid"));
    expect(voci).toEqual(gruppiPerTipo("gauge", false).map((g) => `attivita-${g.id}`));
    expect(screen.queryAllByTestId(/^pin-ramo-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^ramo-proprieta-/)).toHaveLength(0);
    fireEvent.click(screen.getByTestId("attivita-comportamento"));
    expect(screen.getByTestId("attivita-comportamento").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab").filter((b) => b.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("un clic sull'icona attiva chiude la colonna e lascia la barra; un altro la riapre", () => {
    render(<Guscio obj={oggetto("g1", "gauge")} />);
    fireEvent.click(screen.getByTestId("attivita-aspetto"));
    fireEvent.click(screen.getByTestId("attivita-aspetto"));
    expect(screen.queryAllByTestId(/^sezione-/)).toHaveLength(0);
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("attivita-aspetto"));
    expect(screen.queryAllByTestId(/^sezione-/).length).toBeGreaterThan(0);
  });

  it("senza rami (la pagina) la barra ha una voce sola", () => {
    render(
      <PannelloDestro larghezza={280} onRidimensiona={() => {}} titolo="x" tipo="" gruppiVisibili={[]} aSezioni={false}
        chiaveOggetto="" bloccato={false} voceSingola="pagina">
        <div data-testid="proprieta-pagina" />
      </PannelloDestro>,
    );
    expect(screen.getAllByRole("tab").map((b) => b.getAttribute("data-testid"))).toEqual(["attivita-pagina"]);
    expect(screen.getByTestId("proprieta-pagina")).toBeTruthy();
  });
});
