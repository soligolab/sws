/** La guardia delle dipendenze (piano «viewer leggero», 09-11-2026, passo 4).
 *
 *  Il filtro di pagina chiede al server solo i tag di `dipendenzeOggetto`, e il
 *  ridisegno mirato ridisegna un oggetto solo quando cambia uno di quelli. Un
 *  tag che l'oggetto legge e non dichiara arriva col primo snapshot e poi resta
 *  fermo, senza nessun avviso. Qui si monta ogni oggetto dei template con una
 *  mappa dei valori che risponde a ogni chiave (così ogni ramo legge) e annota
 *  le letture: ognuna deve stare nelle dipendenze dichiarate. Scorrere tutta la
 *  mappa è un errore, a meno che l'oggetto non dichiari `tutti`.
 *
 *  Gli oggetti vengono da `tests/fixtures/oggettiTemplate.json`, che
 *  `scripts/check_fixture_template.sh` tiene uguale ai template. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Nessun runtime: ogni chiamata resta in attesa, e lo storico non arriva mai.
// Le letture dei valori avvengono nel disegno, non nelle risposte.
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  return { ...vero, api };
});

import "../src/i18n/index";
import manifesto from "../public/symbols/lib/manifest.json";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { SvgObject } from "@/canvas/SvgCanvas";
import { dipendenzeOggetto } from "@/runtime-view/collectTagIds";
import type { FaceplateDef, SynopticObject, TagState } from "@/types";

interface Fixture {
  faceplate_di_sistema: FaceplateDef[];
  template: Record<string, {
    pagine: { file: string; oggetti: SynopticObject[] }[];
    cornici: { file: string; oggetti: SynopticObject[] }[];
    faceplates: FaceplateDef[];
  }>;
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/oggettiTemplate.json"), "utf8"),
) as Fixture;

/** Una mappa dei valori che ha tutto: ogni chiave un valore buono (1, che è un
 *  numero, è vero e fa da indice), sempre lo stesso oggetto per la stessa
 *  chiave, come nello store. Annota chi legge cosa, e chi la scorre. */
function mappaSpia() {
  const letti = new Set<string>();
  let scorsa = false;
  const valori = new Map<string, TagState>();
  const mappa = new Proxy({} as Record<string, TagState>, {
    get(_t, k) {
      if (typeof k !== "string") return undefined;
      letti.add(k);
      let v = valori.get(k);
      if (!v) {
        v = { value: 1, quality: "Good", timestamp_ms: Date.now() };
        valori.set(k, v);
      }
      return v;
    },
    has(_t, k) {
      if (typeof k === "string") letti.add(k);
      return true;
    },
    ownKeys() {
      scorsa = true;
      return [];
    },
  });
  return { mappa, letti, scorsa: () => scorsa };
}

/** Le letture viste da tutte le spie: se fossero zero la guardia passerebbe
 *  senza aver guardato niente. */
let lettureViste = 0;

/** Monta un oggetto e dice cosa ha letto fuori dalle sue dipendenze. */
function controlla(
  obj: SynopticObject,
  objects: SynopticObject[],
  faceplates: FaceplateDef[],
  isEditMode: boolean,
): string | null {
  const dip = dipendenzeOggetto(obj, faceplates, objects);
  const spia = mappaSpia();
  let r: ReturnType<typeof render> | undefined;
  act(() => {
    r = render(
      <svg>
        <SvgObject obj={obj} objects={objects} tagValues={spia.mappa} selected={false}
          isEditMode={isEditMode} customSymbols={[]} faceplates={faceplates} />
      </svg>,
    );
  });
  act(() => r?.unmount());
  lettureViste += spia.letti.size;
  if (dip.tutti) return null;
  const fuori = [...spia.letti].filter((id) => !dip.ids.has(id));
  if (!fuori.length && !spia.scorsa()) return null;
  return `${obj.id} (${obj.type}${isEditMode ? ", edit" : ""}): `
    + (fuori.length ? `legge ${fuori.join(", ")} senza dichiararlo` : "")
    + (spia.scorsa() ? `${fuori.length ? "; " : ""}scorre tutta la mappa senza dichiarare «tutti»` : "");
}

/** Tutti gli oggetti di un gruppo, a runtime e in edit. */
function controllaTutti(oggetti: SynopticObject[], faceplates: FaceplateDef[], dove: string): string[] {
  const errori: string[] = [];
  for (const isEditMode of [false, true]) {
    for (const obj of oggetti) {
      const e = controlla(obj, oggetti, faceplates, isEditMode);
      if (e) errori.push(`${dove}: ${e}`);
    }
  }
  return errori;
}

beforeAll(() => {
  impostaLibreriaPerTest(manifesto as unknown as ManifestLib);
  // jsdom non ha `ResizeObserver` né il disegno su canvas: qualche widget li
  // chiede al montaggio.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  impostaLibreriaPerTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ogni oggetto dei template legge solo i tag che dichiara", () => {
  for (const [nome, t] of Object.entries(fixture.template)) {
    it(nome, () => {
      const faceplates = [...t.faceplates, ...fixture.faceplate_di_sistema];
      const prima = lettureViste;
      const errori = [
        ...t.pagine.flatMap((p) => controllaTutti(p.oggetti, faceplates, p.file)),
        ...t.cornici.flatMap((c) => controllaTutti(c.oggetti, faceplates, `cornici/${c.file}`)),
      ];
      expect(errori).toEqual([]);
      expect(lettureViste - prima).toBeGreaterThan(10);
    });
  }

  it("la fixture ha i 39 tipi dei gemelli", () => {
    const tipi = new Set<string>();
    const visita = (o: SynopticObject) => {
      tipi.add(o.type);
      for (const c of o.grid_cells ?? []) if (c.child) visita(c.child);
    };
    for (const p of fixture.template["demo-items-web"].pagine) p.oggetti.forEach(visita);
    expect(tipi.size).toBeGreaterThanOrEqual(39);
  });
});

// Quello che i template oggi non hanno, e che ha già lasciato fermi dei valori.
describe("i casi che i template non coprono", () => {
  const pompa: FaceplateDef = {
    id: "pompa_prova", label: "Pompa", params: [{ name: "p", default: "pompa1" }],
    objects: [
      { id: "stato", type: "rect", x: 0, y: 0, width: 20, height: 20, state_tag: "{p}.marcia" },
      { id: "valore", type: "text", x: 0, y: 30, width: 80, height: 20, tag: "{p}.velocita" },
    ],
  };
  const istanza = (o: Partial<SynopticObject> = {}) =>
    ({ id: "i", type: "faceplate", x: 0, y: 0, width: 100, height: 60, faceplate_id: "pompa_prova", ...o }) as SynopticObject;

  it("un faceplate col parametro predefinito", () => {
    expect(controllaTutti([istanza()], [pompa], "prova")).toEqual([]);
  });

  it("un faceplate con un figlio sovrascritto su un altro tag", () => {
    const o = istanza({ faceplate_overrides: { valore: { tag: "contatore.giri" } } });
    expect(controllaTutti([o], [pompa], "prova")).toEqual([]);
  });

  it("un tubo agganciato a un oggetto in moto e legato", () => {
    const oggetti = [
      {
        id: "carrello", type: "rect", x: 0, y: 0, width: 40, height: 20,
        bindings: { y: "carrello.quota", x: { expr: "{carrello.x} + 1" } },
        motion_tag: "carrello.posizione", motion_path: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      },
      { id: "vasca", type: "rect", x: 300, y: 0, width: 40, height: 40 },
      { id: "tubo", type: "pipe", x: 0, y: 0, from_obj_id: "carrello", to_obj_id: "vasca", pipe_flow_tag: "tubo.flusso" },
    ] as SynopticObject[];
    expect(controllaTutti(oggetti, [], "prova")).toEqual([]);
  });
});
