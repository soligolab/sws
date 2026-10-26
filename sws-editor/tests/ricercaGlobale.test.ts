import { describe, expect, it } from "vitest";
import { cercaOvunque, inFila, nomeOggetto, MAX_PER_GRUPPO, ORDINE } from "@/editor/ricercaGlobale";
import { PALETTE_GROUPS } from "@/editor/LeftPanel";
import type { ContestoRicerca } from "@/editor/ricercaGlobale";
import type { SynopticObject, SynopticPage, TagDef } from "@/types";

/** La ricerca globale (26-10-2026). Il motore è puro: qui si prova senza
 *  disegnare, come già si fa per `filtraStrumenti` — che infatti questo
 *  modulo riusa invece di avere una seconda regola per gli strumenti. */

/** Una `t` che non traduce: restituisce la chiave, con i parametri in coda.
 *  Basta a provare *cosa* viene trovato, che è quello che conta qui. */
const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}(${Object.values(o).join(",")})` : k;

const pagina = (id: string, name: string, objects: Partial<SynopticObject>[] = []): SynopticPage =>
  ({ id, name, objects: objects as SynopticObject[] }) as SynopticPage;

const TAGS = [
  { id: "pompa1", data_type: "f64", description: "mandata principale" },
  { id: "motore1", type_ref: "motore" },
  { id: "garage.luce", data_type: "bool" },
] as unknown as TagDef[];

const PAGINE = [
  pagina("p1", "Home", [
    { id: "o1", type: "gauge", tag: "pompa1" },
    { id: "o2", type: "button", label: "Avvia pompa" },
  ]),
  pagina("p2", "Sandokan", [{ id: "o3", type: "slider", tag: "garage.luce" }]),
];

const ctx = (extra: Partial<ContestoRicerca> = {}): ContestoRicerca => ({
  pages: PAGINE, tags: TAGS, gruppiPalette: [], simboli: [],
  schede: [{ id: "tags" }, { id: "alarms" }], elementi: [], t, ...extra,
});

const categorie = (q: string, c = ctx()) => cercaOvunque(q, c).map((g) => g.categoria);
const nomi = (q: string, cat: string, c = ctx()) =>
  cercaOvunque(q, c).find((g) => g.categoria === cat)?.voci.map((v) => v.nome) ?? [];

describe("la ricerca globale attraversa i mondi", () => {
  it("una stringa vuota non cerca niente, e l'albero resta dov'è", () => {
    expect(cercaOvunque("", ctx())).toEqual([]);
    expect(cercaOvunque("   ", ctx())).toEqual([]);
  });

  it("«pompa» trova la variabile, l'oggetto e la pagina che la citano", () => {
    expect(nomi("pompa", "variabili")).toEqual(["pompa1"]);
    // L'oggetto senza etichetta si riconosce dal tag; quello con etichetta
    // dalla sua etichetta.
    expect(nomi("pompa", "oggetti")).toContain("Avvia pompa");
    expect(nomi("pompa", "oggetti").length).toBe(2);
  });

  it("cerca **dentro** il nome, non solo all'inizio", () => {
    // In `garage.luce` la parte che uno ricorda sta spesso in mezzo.
    expect(nomi("luce", "variabili")).toEqual(["garage.luce"]);
  });

  it("non distingue maiuscole e minuscole", () => {
    expect(nomi("POMPA", "variabili")).toEqual(["pompa1"]);
    expect(nomi("sandokan", "pagine")).toEqual(["Sandokan"]);
  });

  it("trova anche nella descrizione di una variabile", () => {
    expect(nomi("mandata", "variabili")).toEqual(["pompa1"]);
  });

  it("i gruppi escono nell'ordine dichiarato, non in quello in cui si trovano", () => {
    const c = categorie("a");
    expect(c).toEqual(ORDINE.filter((x) => c.includes(x)));
  });

  it("un gruppo senza risultati non compare affatto", () => {
    expect(categorie("sandokan")).toEqual(["pagine"]);
  });

  it("niente di niente dà zero gruppi, non un gruppo vuoto", () => {
    expect(cercaOvunque("zqxjk", ctx())).toEqual([]);
  });
});

describe("le impostazioni e i loro elementi", () => {
  it("trova la scheda per il suo nome tradotto", () => {
    expect(nomi("config.tabs.alarms", "impostazioni")).toContain("config.tabs.alarms");
  });

  it("trova un allarme per nome, e dice in che scheda vive", () => {
    const c = ctx({ elementi: [{ scheda: "alarms", id: "a1", nome: "pompa in blocco" }] });
    const g = cercaOvunque("blocco", c).find((x) => x.categoria === "impostazioni");
    expect(g?.voci[0].nome).toBe("pompa in blocco");
    expect(g?.voci[0].dove).toBe("config.tabs.alarms");
    expect(g?.voci[0].esito).toEqual({ tipo: "impostazione", scheda: "alarms", elemento: "a1" });
  });

  it("un elemento senza nome si cerca per id, che c'è sempre", () => {
    const c = ctx({ elementi: [{ scheda: "protocols", id: "mqtt-casa" }] });
    expect(nomi("mqtt", "impostazioni", c)).toEqual(["mqtt-casa"]);
  });
});

describe("gli strumenti li cerca la stessa funzione della palette", () => {
  it("un tipo della palette compare fra i risultati", () => {
    const c = ctx({ gruppiPalette: PALETTE_GROUPS });
    // `t` non traduce, quindi il nome è la chiave: si cerca quella.
    expect(nomi("editor.palette.item.gauge", "strumenti", c).length).toBe(1);
  });
});

describe("quanto se ne mostra, e in che ordine si cammina", () => {
  it("un gruppo si ferma al tetto ma dice quanti ce n'erano", () => {
    const molte = Array.from({ length: MAX_PER_GRUPPO + 5 },
      (_, i) => ({ id: `v${i}_cosa`, data_type: "f64" })) as unknown as TagDef[];
    const g = cercaOvunque("cosa", ctx({ tags: molte }))[0];
    expect(g.voci.length).toBe(MAX_PER_GRUPPO);
    expect(g.totale).toBe(MAX_PER_GRUPPO + 5);
  });

  it("le voci in fila sono quelle mostrate, nell'ordine dei gruppi", () => {
    const g = cercaOvunque("pompa", ctx());
    expect(inFila(g).length).toBe(g.reduce((n, x) => n + x.voci.length, 0));
    expect(inFila(g)[0].categoria).toBe("variabili");
  });

  it("ogni chiave è unica: due oggetti omonimi su pagine diverse non collidono", () => {
    const pagine = [pagina("p1", "A", [{ id: "x", type: "gauge" }]),
                    pagina("p2", "B", [{ id: "x", type: "gauge" }])];
    const chiavi = inFila(cercaOvunque("gauge", ctx({ pages: pagine }))).map((v) => v.chiave);
    expect(new Set(chiavi).size).toBe(chiavi.length);
  });
});

describe("come si chiama un oggetto nei risultati", () => {
  it("l'etichetta vince su tutto", () => {
    expect(nomeOggetto({ id: "o", type: "button", label: "Avvia" } as never, t)).toBe("Avvia");
  });

  it("senza etichetta, il tipo e il tag che mostra", () => {
    expect(nomeOggetto({ id: "o", type: "gauge", tag: "p1" } as never, t))
      .toBe("editor.palette.item.gauge · p1");
  });

  it("**senza nemmeno un tag resta l'id**, che da solo non direbbe niente", () => {
    // `mvav2aagbjio9` in un elenco è rumore: almeno il tipo lo qualifica.
    expect(nomeOggetto({ id: "mvav2aagbjio9", type: "pipe" } as never, t))
      .toBe("editor.palette.item.pipe mvav2aagbjio9");
  });
});
