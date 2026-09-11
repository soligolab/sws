import { describe, it, expect } from "vitest";
import {
  aggiungiInCoda, cosaCancella, dividiSegmento, eliminaWaypoint,
  percorsoDaSalvare, puntiMovimento, tracciatoVisibile,
} from "../src/canvas/percorsoMovimento";
import { cancellaWaypointScelto } from "../src/editor/EditorShell";
import { useAppStore } from "../src/store";

/** Le decisioni del percorso di movimento (T-53).
 *
 *  Prima dell'11-09-2026 il `motion_path` non aveva **nessun** test: né lato
 *  editor né lato canvas. Portarlo sul disegno significa che d'ora in poi lo
 *  toccano un trascinamento, un tasto e due comandi invece di una tabella di
 *  numeri, quindi le regole di dove finisce un punto e di che cosa cancella
 *  Canc smettono di essere ovvie guardando il codice.
 */

describe("puntiMovimento — leggere ciò che c'è davvero nei progetti", () => {
  it("la forma che scrive l'editor", () => {
    expect(puntiMovimento([{ x: 10, y: 20 }, { x: 30, y: 40 }]))
      .toEqual([{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  });

  it("la forma a coppie, che il viewer LVGL accetta e i progetti vecchi hanno", () => {
    // `punti_movimento` in lvgl_render.rs accetta [[x,y]] «perché è quello che
    // si trova nei progetti veri». Senza questa lettura le maniglie
    // uscirebbero a NaN proprio sui progetti in cui un percorso esiste.
    expect(puntiMovimento([[10, 20], [30, 40]]))
      .toEqual([{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  });

  it("assente, vuoto o non una lista valgono nessun punto", () => {
    expect(puntiMovimento(undefined)).toEqual([]);
    expect(puntiMovimento([])).toEqual([]);
    expect(puntiMovimento("10,20")).toEqual([]);
    expect(puntiMovimento({ x: 1, y: 2 })).toEqual([]);
  });

  it("un punto a metà si scarta, non si tira a indovinare", () => {
    // Un waypoint con una sola coordinata si trascinerebbe senza sapere dove
    // va: meglio uno in meno che uno che mente.
    expect(puntiMovimento([{ x: 10, y: 20 }, { x: 30 }, { y: 40 }, null, [50]]))
      .toEqual([{ x: 10, y: 20 }]);
    expect(puntiMovimento([{ x: 10, y: Number.NaN }])).toEqual([]);
  });
});

describe("percorsoDaSalvare — vuoto significa assente", () => {
  it("con dei punti restituisce i punti", () => {
    expect(percorsoDaSalvare([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });

  it("senza punti restituisce undefined, non una lista vuota", () => {
    // Un `motion_path: []` in project.yaml è una riga che non dice niente: il
    // runtime lo scarta comunque, servono due punti perché esista un movimento.
    expect(percorsoDaSalvare([])).toBeUndefined();
  });
});

describe("dividiSegmento — il punto nuovo va FRA i due, non in fondo", () => {
  const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it("inserisce dentro il segmento scelto", () => {
    // L'ordine dell'array è l'ordine logico da motion_min a motion_max: uno
    // `splice`, non un `push`, altrimenti il percorso tornerebbe indietro.
    expect(dividiSegmento(p, 0, { x: 50, y: 0 }))
      .toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(dividiSegmento(p, 1, { x: 100, y: 50 }))
      .toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }]);
  });

  it("un segmento che non esiste non sposta niente", () => {
    // Capita se il percorso cambia sotto le mani fra il clic e il comando.
    expect(dividiSegmento(p, 2, { x: 1, y: 1 })).toBe(p);
    expect(dividiSegmento(p, -1, { x: 1, y: 1 })).toBe(p);
    expect(dividiSegmento([], 0, { x: 1, y: 1 })).toEqual([]);
  });
});

describe("aggiungiInCoda", () => {
  it("nasce 50 a destra dell'ultimo, non sopra di lui", () => {
    // Sovrapposto all'ultimo bisognerebbe trascinarlo via alla cieca per
    // scoprire che ce n'erano due.
    expect(aggiungiInCoda([{ x: 10, y: 20 }], { x: 0, y: 0 }))
      .toEqual([{ x: 10, y: 20 }, { x: 60, y: 20 }]);
  });

  it("col percorso vuoto parte dall'oggetto, l'unica posizione nota", () => {
    expect(aggiungiInCoda([], { x: 300, y: 200 })).toEqual([{ x: 350, y: 200 }]);
  });
});

describe("eliminaWaypoint", () => {
  const p = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];

  it("toglie quello scelto e lascia gli altri nell'ordine", () => {
    expect(eliminaWaypoint(p, 1)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 2 }]);
  });

  it("un indice che non esiste lascia tutto com'è", () => {
    expect(eliminaWaypoint(p, 9)).toBe(p);
    expect(eliminaWaypoint(p, -1)).toBe(p);
  });

  it("togliendo l'ultimo resta una lista vuota, che percorsoDaSalvare rende assente", () => {
    expect(percorsoDaSalvare(eliminaWaypoint([{ x: 0, y: 0 }], 0))).toBeUndefined();
  });
});

describe("cosaCancella — la precedenza del tasto Canc", () => {
  it("con un waypoint scelto sull'oggetto selezionato, vince il waypoint", () => {
    // È il guasto da evitare: l'oggetto è selezionato anche lui — è il suo
    // percorso — e l'handler che guarda solo la selezione lo cancellerebbe.
    expect(cosaCancella({ objectId: "a", index: 1 }, ["a"])).toBe("waypoint");
  });

  it("senza waypoint scelto si cancellano gli oggetti, come sempre", () => {
    expect(cosaCancella(null, ["a", "b"])).toBe("oggetti");
  });

  it("un waypoint rimasto in memoria da un'altra selezione non dirotta niente", () => {
    // Scenario: si sceglie un waypoint su A, poi si seleziona B e si preme
    // Canc. Deve sparire B, non un punto di A.
    expect(cosaCancella({ objectId: "a", index: 1 }, ["b"])).toBe("oggetti");
  });

  it("senza selezione non si cancella niente", () => {
    expect(cosaCancella(null, [])).toBeNull();
    expect(cosaCancella({ objectId: "a", index: 0 }, [])).toBeNull();
  });
});

describe("tracciatoVisibile", () => {
  it("basta un punto e l'opzione accesa", () => {
    expect(tracciatoVisibile({ motion_path: [{ x: 1, y: 2 }] }, true)).toBe(true);
  });

  it("non dipende dal tag: la geometria esiste prima della variabile che la percorre", () => {
    // Senza questo non si potrebbe disegnare un percorso prima di aver scelto
    // il tag, che è l'ordine naturale in cui si lavora.
    expect(tracciatoVisibile({ motion_path: [{ x: 1, y: 2 }] }, true)).toBe(true);
  });

  it("spenta l'opzione, o senza punti, non si disegna", () => {
    expect(tracciatoVisibile({ motion_path: [{ x: 1, y: 2 }] }, false)).toBe(false);
    expect(tracciatoVisibile({ motion_path: [] }, true)).toBe(false);
    expect(tracciatoVisibile({}, true)).toBe(false);
    expect(tracciatoVisibile(undefined, true)).toBe(false);
  });
});

// ── il cablaggio, non solo la decisione ──────────────────────────────────────
//
// `cosaCancella` qui sopra prova che cosa **si dovrebbe** cancellare. Questi
// provano che succeda davvero: che il punto sparisca dallo store e che la
// scelta si sciolga. Sono due cose diverse, e l'11-09-2026 un difetto è passato
// proprio nello spazio fra le due — il `Provider` dei gruppi del pannello
// destro, dichiarato e mai fornito, con i test che provavano le due metà
// separate e nessuno il punto in cui si incontrano.
describe("Canc su un waypoint scelto — quello che succede davvero allo store", () => {
  const oggetto = (motion_path?: { x: number; y: number }[]) => ({
    id: "o1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, motion_path,
  });
  const prepara = (motion_path?: { x: number; y: number }[]) => {
    useAppStore.setState({
      pages: [{ id: "p1", name: "P", objects: [oggetto(motion_path)] }],
      currentPageId: "p1",
      selectedObjectId: "o1",
      selectedObjectIds: ["o1"],
      waypointScelto: null,
      segmentoScelto: null,
      past: [], future: [],
    });
  };
  const percorso = () =>
    useAppStore.getState().pages[0].objects[0].motion_path;

  it("toglie il punto scelto e scioglie la scelta", () => {
    prepara([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]);
    useAppStore.getState().setWaypointScelto({ objectId: "o1", index: 1 });
    expect(cancellaWaypointScelto()).toBe(true);
    expect(percorso()).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }]);
    expect(useAppStore.getState().waypointScelto).toBeNull();
  });

  it("senza waypoint scelto non tocca niente e lascia fare a chi cancella gli oggetti", () => {
    prepara([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(cancellaWaypointScelto()).toBe(false);
    expect(percorso()).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it("togliendo l'ultimo punto il percorso sparisce, non resta una lista vuota", () => {
    prepara([{ x: 5, y: 5 }]);
    useAppStore.getState().setWaypointScelto({ objectId: "o1", index: 0 });
    expect(cancellaWaypointScelto()).toBe(true);
    expect(percorso()).toBeUndefined();
  });

  it("legge anche un percorso in forma a coppie, come nei progetti vecchi", () => {
    // Senza la normalizzazione qui, il `map` scriverebbe NaN e il punto
    // «cancellato» resterebbe, spostato da qualche parte fuori pagina.
    prepara([[0, 0], [10, 10]] as unknown as { x: number; y: number }[]);
    useAppStore.getState().setWaypointScelto({ objectId: "o1", index: 0 });
    expect(cancellaWaypointScelto()).toBe(true);
    expect(percorso()).toEqual([{ x: 10, y: 10 }]);
  });
});
