import { describe, expect, it } from "vitest";
import { collectTagIds, dipendenzeOggetto, tagDellaVista } from "./collectTagIds";
import type { FaceplateDef, SynopticObject } from "@/types";

// Copertura mirata sulla F5.3x/T-70 (xy_series multi-coppia): il resto della
// funzione (F0.1, celle grid, faceplate, bindings/espressioni) non ha un
// test dedicato preesistente — non allargato qui, fuori scope.

describe("collectTagIds — xy_series", () => {
  it("raccoglie tag e y_tag di ogni coppia, non solo la prima", () => {
    const obj: SynopticObject = {
      id: "xy", type: "xy_plot", x: 0, y: 0,
      xy_series: [
        { tag: "misura.x", y_tag: "misura.y" },
        { tag: "target.x", y_tag: "target.y", dash: "dashed" },
      ],
    };
    const ids = collectTagIds([obj]);
    expect(ids).toEqual(
      expect.arrayContaining(["misura.x", "misura.y", "target.x", "target.y"]),
    );
    expect(ids).toHaveLength(4);
  });

  it("il formato legacy (una coppia) resta coperto da y_tag in TAG_FIELDS", () => {
    const obj: SynopticObject = { id: "xy", type: "xy_plot", x: 0, y: 0, tag: "a.x", y_tag: "a.y" };
    const ids = collectTagIds([obj]);
    expect(ids).toEqual(expect.arrayContaining(["a.x", "a.y"]));
  });
});

// Il filtro di pagina e i figli di faceplate e popup (piano «viewer leggero»,
// 09-11-2026, passo 4). Un tag che manca qui il figlio lo legge lo stesso: ha
// il primo snapshot e poi resta fermo, senza avvisi.

const pompa: FaceplateDef = {
  id: "pompa",
  label: "Pompa",
  params: [{ name: "p", default: "pompa1" }, "zona"],
  objects: [
    { id: "marcia", type: "rect", x: 0, y: 0, state_tag: "{p}.marcia" },
    { id: "velocita", type: "text", x: 0, y: 20, tag: "{p}.velocita" },
  ],
};

const istanza = (o: Partial<SynopticObject> = {}): SynopticObject =>
  ({ id: "i", type: "faceplate", x: 0, y: 0, faceplate_id: "pompa", ...o }) as SynopticObject;

describe("collectTagIds — i figli dei faceplate come li disegna il canvas", () => {
  it("un'istanza che usa il valore predefinito raccoglie default.x, non {p}.x", () => {
    const ids = collectTagIds([istanza()], [pompa]);
    expect(ids).toEqual(expect.arrayContaining(["pompa1.marcia", "pompa1.velocita"]));
    expect(ids.some((id) => id.includes("{"))).toBe(false);
  });

  it("il valore dell'istanza vince sul predefinito", () => {
    const ids = collectTagIds([istanza({ faceplate_params: { p: "pompa7" } })], [pompa]);
    expect(ids).toEqual(expect.arrayContaining(["pompa7.marcia", "pompa7.velocita"]));
    expect(ids).not.toContain("pompa1.marcia");
  });

  it("un override con un altro tag viene raccolto, e il tag che sostituisce no", () => {
    const ids = collectTagIds([
      istanza({ faceplate_overrides: { velocita: { tag: "contatore.giri" } } }),
    ], [pompa]);
    expect(ids).toContain("contatore.giri");
    expect(ids).not.toContain("pompa1.velocita");
  });

  it("vale anche per un faceplate dentro un faceplate", () => {
    const quadro: FaceplateDef = {
      id: "quadro", label: "Quadro", params: [],
      objects: [{ id: "dentro", type: "faceplate", x: 0, y: 0, faceplate_id: "pompa" } as SynopticObject],
    };
    const ids = collectTagIds([{ id: "q", type: "faceplate", x: 0, y: 0, faceplate_id: "quadro" } as SynopticObject], [quadro, pompa]);
    expect(ids).toEqual(expect.arrayContaining(["pompa1.marcia", "pompa1.velocita"]));
  });

  it("un bottone open_faceplate fa raccogliere i figli del popup, coi parametri del bottone", () => {
    const bottone = {
      id: "b", type: "button", x: 0, y: 0, label: "Apri",
      button_action: { type: "open_faceplate", faceplate_id: "pompa", params: { p: "pompa3" } },
    } as SynopticObject;
    const ids = collectTagIds([bottone], [pompa]);
    expect(ids).toEqual(expect.arrayContaining(["pompa3.marcia", "pompa3.velocita"]));
    // Il bottone non disegna il popup: fra le sue dipendenze i figli non ci sono.
    expect(dipendenzeOggetto(bottone, [pompa]).ids.has("pompa3.marcia")).toBe(false);
  });
});

// Un legame che sceglie il tag (`bindings.tag`): quale tag l'oggetto legge lo
// dice il valore di un altro tag, e prima non si sa. Il memo lo ridisegna
// sempre (`tutti`); il filtro di pagina deve chiedere tutto, o il tag scelto
// arriva col primo snapshot e poi resta fermo.
describe("tagDellaVista — un legame che sceglie il tag fa chiedere tutto", () => {
  const sceglie = { id: "t", type: "text", x: 0, y: 0, tag: "s.a", bindings: { tag: "s.selettore" } } as SynopticObject;
  const fermo = { id: "f", type: "text", x: 0, y: 0, tag: "s.f" } as SynopticObject;

  it("un oggetto della pagina", () => {
    expect(tagDellaVista({ objects: [fermo, sceglie] }, [])).toEqual(["*"]);
  });

  it("un oggetto della finestra aperta", () => {
    expect(tagDellaVista({ objects: [fermo] }, [], { pagina: {}, oggetti: [sceglie] })).toEqual(["*"]);
  });

  it("un figlio del popup che un bottone apre", () => {
    const def: FaceplateDef = { id: "sel", label: "Selettore", params: [], objects: [sceglie] };
    const bottone = {
      id: "b", type: "button", x: 0, y: 0, label: "Apri",
      button_action: { type: "open_faceplate", faceplate_id: "sel", params: {} },
    } as SynopticObject;
    expect(tagDellaVista({ objects: [bottone] }, [def])).toEqual(["*"]);
  });

  it("senza legami che scelgono resta la lista, e collectTagIds resta la lista dei tag scritti", () => {
    expect(tagDellaVista({ objects: [fermo] }, [])).toEqual(["s.f"]);
    // La usano ricerca, findObjects e rinomina: i tag scritti, mai «*».
    expect(collectTagIds([sceglie])).toEqual(expect.arrayContaining(["s.a", "s.selettore"]));
    expect(collectTagIds([sceglie])).not.toContain("*");
  });
});

describe("tagDellaVista", () => {
  it("con una finestra aperta contiene il background_tag della finestra", () => {
    const ids = tagDellaVista(
      { objects: [{ id: "t", type: "text", x: 0, y: 0, tag: "pagina.t" }], background_tag: "pagina.sfondo" },
      [],
      { pagina: { background_tag: "finestra.sfondo" }, oggetti: [{ id: "v", type: "text", x: 0, y: 0, tag: "finestra.v" }] },
    );
    expect(ids).toEqual(expect.arrayContaining(["pagina.t", "pagina.sfondo", "finestra.v", "finestra.sfondo"]));
  });
});

describe("dipendenzeOggetto", () => {
  const pompaInMoto = {
    id: "pompa", type: "symbol", x: 0, y: 0,
    bindings: { x: "pompa.x", y: { expr: "{pompa.y} * 2" } },
    motion_tag: "pompa.posizione", motion_path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  } as SynopticObject;
  const tubo = {
    id: "tubo", type: "pipe", x: 0, y: 0, from_obj_id: "pompa", to_obj_id: "vasca", pipe_flow_tag: "tubo.flusso",
  } as SynopticObject;

  it("un tubo raccoglie i legami e il motion_tag delle sue ancore", () => {
    const { ids } = dipendenzeOggetto(tubo, [], [pompaInMoto, tubo]);
    expect([...ids]).toEqual(expect.arrayContaining(["tubo.flusso", "pompa.x", "pompa.y", "pompa.posizione"]));
  });

  it("per un tubo contano gli oggetti della pagina: con altri oggetti il risultato si rifà", () => {
    const pagina = [pompaInMoto, tubo];
    const prima = dipendenzeOggetto(tubo, [], pagina);
    expect(dipendenzeOggetto(tubo, [], pagina)).toBe(prima);
    const ferma = { ...pompaInMoto, bindings: undefined, motion_tag: undefined } as SynopticObject;
    expect([...dipendenzeOggetto(tubo, [], [ferma, tubo]).ids]).toEqual(["tubo.flusso"]);
  });

  it("un legame che riscrive un campo-tag dichiara tutti", () => {
    expect(dipendenzeOggetto({ id: "a", type: "text", x: 0, y: 0, bindings: { tag: "selettore" } } as SynopticObject).tutti).toBe(true);
    expect(dipendenzeOggetto({ id: "b", type: "text", x: 0, y: 0, bindings: { fill: "colore" } } as SynopticObject).tutti).toBe(false);
  });

  it("conTempo solo con la colonna «time» di una tabella: lo stale lo calcola la pagina", () => {
    const tab = (cols: ("label" | "value" | "time")[]) =>
      ({ id: "t", type: "table", x: 0, y: 0, table_rows: [{ tag: "r", label: "R" }], table_columns: cols }) as SynopticObject;
    expect(dipendenzeOggetto(tab(["label", "value", "time"])).conTempo).toBe(true);
    expect(dipendenzeOggetto(tab(["label", "value"])).conTempo).toBe(false);
    // La ⌛ e il grigio dello stale li mette l'involucro di pagina, fuori dal
    // memo: dentro l'oggetto il tempo non si legge, e un valore ritrasmesso
    // uguale non deve ridisegnarlo.
    expect(dipendenzeOggetto({ id: "s", type: "text", x: 0, y: 0, tag: "a", stale_after_s: 5 } as SynopticObject).conTempo).toBe(false);
  });

  it("usaOggetti solo per un tubo agganciato, anche dentro una griglia o un faceplate", () => {
    expect(dipendenzeOggetto(tubo, [], [pompaInMoto, tubo]).usaOggetti).toBe(true);
    expect(dipendenzeOggetto({ id: "libero", type: "pipe", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } as SynopticObject).usaOggetti).toBe(false);
    expect(dipendenzeOggetto(istanza(), [pompa]).usaOggetti).toBe(false);
    const conTubo = { ...pompa, id: "con_tubo", objects: [...pompa.objects, { ...tubo, id: "t_dentro" }] };
    expect(dipendenzeOggetto(istanza({ faceplate_id: "con_tubo" }), [conTubo]).usaOggetti).toBe(true);
    const griglia = { id: "g", type: "grid", x: 0, y: 0, grid_cells: [{ row: 0, col: 0, child: { id: "c", type: "text", x: 0, y: 0, tag: "c" } }] } as SynopticObject;
    expect(dipendenzeOggetto(griglia).usaOggetti).toBe(false);
  });

  it("per un'istanza contano i faceplate: con una definizione nuova il risultato si rifà", () => {
    const i = istanza();
    expect(dipendenzeOggetto(i, [pompa]).ids.has("pompa1.marcia")).toBe(true);
    const altra = { ...pompa, objects: [{ id: "x", type: "text", x: 0, y: 0, tag: "{p}.altro" } as SynopticObject] };
    expect([...dipendenzeOggetto(i, [altra]).ids]).toEqual(["pompa1.altro"]);
  });
});
