/** Il ridisegno mirato (piano «viewer leggero», 09-11-2026, passo 5).
 *
 *  Prima ogni messaggio dei tag ridisegnava tutta la pagina: sulla pagina
 *  iniziale di Montagna un valore nuovo di `s.rete_scambio` rifaceva tutti i 39
 *  oggetti per cambiarne uno, e nel viewer anche la barra delle pagine. Ora
 *  `SvgObject` è memo e confronta solo i tag che l'oggetto legge
 *  (`dipendenzeOggetto`), e la mappa dei valori la prende solo la parte della
 *  vista che la disegna. Si conta `localizeObject`, che ogni oggetto chiama una
 *  volta per disegno, e `localizePageName`, che la barra chiama per ogni pagina.
 *
 *  Gli oggetti vengono da `tests/fixtures/oggettiTemplate.json`, che
 *  `scripts/check_fixture_template.sh` tiene uguale ai template. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nessun runtime: ogni chiamata resta in attesa. Le mini tendenze chiedono lo
// storico al montaggio, e qui non arriva mai.
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  return { ...vero, api };
});

// Le due funzioni contate: si chiamano quelle vere, e si annota chi le chiama.
vi.mock("@/i18n/projectI18n", async () => {
  const vero = await vi.importActual<typeof import("@/i18n/projectI18n")>("@/i18n/projectI18n");
  return { ...vero, localizeObject: vi.fn(vero.localizeObject), localizePageName: vi.fn(vero.localizePageName) };
});

// Il socket dei tag del viewer: aperto e muto. I valori arrivano allo store
// direttamente, come li applica `coalescenza.ts`.
vi.mock("@/ws/singletonWs", () => {
  const stream = { readyState: 1, on() {}, off() {}, send: () => true };
  return { socketCondiviso: () => ({ prendi: () => stream, corrente: () => stream, chiudi: () => {} }) };
});

// Il lucchetto per ruolo: si conta quante volte la pagina lo ricalcola.
vi.mock("@/auth/permessoScrittura", async () => {
  const vero = await vi.importActual<typeof import("@/auth/permessoScrittura")>("@/auth/permessoScrittura");
  return { ...vero, ruoloCheServe: vi.fn(vero.ruoloCheServe) };
});

import "../src/i18n/index";
import manifesto from "../public/symbols/lib/manifest.json";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { ruoloCheServe } from "@/auth/permessoScrittura";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { localizeObject, localizePageName } from "@/i18n/projectI18n";
import { collectTagIds } from "@/runtime-view/collectTagIds";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { useAppStore } from "@/store";
import { sendSubscribe } from "@/ws/tagStream";
import type { FaceplateDef, SynopticObject, SynopticPage, TagState } from "@/types";

interface Fixture {
  template: Record<string, { pagine: { file: string; oggetti: SynopticObject[] }[] }>;
}
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/oggettiTemplate.json"), "utf8"),
) as Fixture;

/** La pagina iniziale di Montagna (`home_page_id: p_impianto_opus`). */
const OGGETTI = fixture.template["montagna-rinnovabile"].pagine
  .find((p) => p.file === "Impianto — Opus 5.5.yaml")!.oggetti;

const TAG_PAGINA = collectTagIds(OGGETTI);
const T0 = 1_700_000_000_000;

/** Tutti i tag della pagina con un valore, ognuno col suo oggetto. */
function mappaIniziale(): Record<string, TagState> {
  return Object.fromEntries(TAG_PAGINA.map((id) => [id, { value: 1, quality: "Good", timestamp_ms: T0 } as TagState]));
}

/** Gli oggetti ridisegnati dall'ultima pulizia, uno per nome. */
function ridisegnati(): string[] {
  return [...new Set(vi.mocked(localizeObject).mock.calls.map(([o]) => o.id))].sort();
}

beforeAll(() => {
  impostaLibreriaPerTest(manifesto as unknown as ManifestLib);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterAll(() => {
  impostaLibreriaPerTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("un valore nuovo ridisegna solo chi lo legge", () => {
  it("la pagina iniziale di Montagna ha i suoi 39 oggetti e legge s.rete_scambio", () => {
    expect(OGGETTI).toHaveLength(39);
    expect(TAG_PAGINA).toContain("s.rete_scambio");
  });

  it("a runtime: cambia s.rete_scambio, si ridisegna solo bil_rete", () => {
    const prima = mappaIniziale();
    const { rerender } = render(
      <SvgCanvas objects={OGGETTI} tagValues={prima} pageWidth={1280} pageHeight={800} onWriteTag={() => {}} onScript={() => {}} />,
    );
    vi.mocked(localizeObject).mockClear();
    const dopo = { ...prima, "s.rete_scambio": { value: 42, quality: "Good", timestamp_ms: T0 + 1000 } as TagState };
    act(() => {
      rerender(
        <SvgCanvas objects={OGGETTI} tagValues={dopo} pageWidth={1280} pageHeight={800} onWriteTag={() => {}} onScript={() => {}} />,
      );
    });
    expect(ridisegnati()).toEqual(["bil_rete"]);
  });

  it("in modifica, con le callback scritte in linea come le passa l'editor", () => {
    // Ogni disegno dell'editor crea callback nuove (`EditorShell`): il canvas
    // le deve stabilizzare, o il memo non salta mai niente.
    const canvas = (valori: Record<string, TagState>) => (
      <SvgCanvas objects={OGGETTI} tagValues={valori} pageWidth={1280} pageHeight={800} selectedIds={[]}
        onSelect={(id) => void id} onMove={(id, p) => void [id, p]}
        onSelectCell={(o, r, c) => void [o, r, c]} onSelectCellChild={(o, r, c) => void [o, r, c]}
        onSelectCellRange={(o, r1, c1, r2, c2) => void [o, r1, c1, r2, c2]}
        onSelectSubCell={(o, r, c, p) => void [o, r, c, p]} />
    );
    const prima = mappaIniziale();
    const { rerender } = render(canvas(prima));
    vi.mocked(localizeObject).mockClear();
    act(() => {
      rerender(canvas({ ...prima, "s.rete_scambio": { value: 42, quality: "Good", timestamp_ms: T0 + 1000 } as TagState }));
    });
    expect(ridisegnati()).toEqual(["bil_rete"]);
  });

  it("un valore ritrasmesso uguale, con solo il tempo nuovo, non ridisegna nessuno", () => {
    // Il bus ritrasmette anche le scritture uguali (§4): il tempo conta solo
    // per chi ha lo stale o la colonna «time», e qui non c'è.
    const prima = mappaIniziale();
    const { rerender } = render(<SvgCanvas objects={OGGETTI} tagValues={prima} pageWidth={1280} pageHeight={800} />);
    vi.mocked(localizeObject).mockClear();
    act(() => {
      rerender(<SvgCanvas objects={OGGETTI} tagValues={{ ...prima, "s.rete_scambio": { value: 1, quality: "Good", timestamp_ms: T0 + 1000 } as TagState }}
        pageWidth={1280} pageHeight={800} />);
    });
    expect(ridisegnati()).toEqual([]);
  });
});

describe("nel viewer la mappa dei valori la prende solo la pagina", () => {
  const PAGINE = [
    { id: "p_impianto_opus", name: "Impianto", width: 1280, height: 800, objects: OGGETTI },
    { id: "lago", name: "Lago", width: 1280, height: 800, objects: [] },
  ] as unknown as SynopticPage[];

  beforeEach(() => {
    useAppStore.setState({
      authToken: "prova", remoteConnected: false, tagValues: mappaIniziale(),
      project: { tags: [], types: [] } as never,
      pages: PAGINE, currentPageId: "p_impianto_opus",
    });
  });

  it("un messaggio non ridisegna la barra delle pagine, e della pagina solo bil_rete", () => {
    const { unmount } = render(<RuntimeView />);
    vi.mocked(localizeObject).mockClear();
    vi.mocked(localizePageName).mockClear();
    act(() => {
      useAppStore.getState().applicaValori(new Map([
        ["s.rete_scambio", { value: 42, quality: "Good", timestamp_ms: T0 + 1000 } as TagState],
      ]));
    });
    expect(vi.mocked(localizePageName)).not.toHaveBeenCalled();
    expect(ridisegnati()).toEqual(["bil_rete"]);
    unmount();
    sendSubscribe(["*"]);
  });
});

// I rilievi della revisione del ramo B (09-11-2026): costi che il memo
// lasciava passare, uno per caso. Ogni array di oggetti e di faceplate è
// una costante: una lista nuova a ogni disegno sarebbe un cambio vero.
const val = (value: TagState["value"], timestamp_ms = T0): TagState => ({ value, quality: "Good", timestamp_ms });
const FP: FaceplateDef = {
  id: "fp", label: "Pompa di prova", params: [{ name: "p", default: "pompa" }],
  objects: [
    { id: "fp_t", type: "text", x: 0, y: 0, width: 80, height: 20, tag: "{p}.t" },
    { id: "fp_l", type: "led", x: 0, y: 30, width: 20, height: 20, tag: "{p}.l" },
  ] as SynopticObject[],
};
const FACEPLATES = [FP];
const NESSUNO: string[] = [];
const VALORI: Record<string, TagState> = { "pompa.t": val(1), "pompa.l": val(true), estraneo: val(1), c: val(1) };

describe("lo stale", () => {
  it("un valore uguale col tempo nuovo non ridisegna chi ha stale_after_s: la ⌛ la mette la pagina", () => {
    const oggetti = [{ id: "s", type: "text", x: 0, y: 0, width: 80, height: 20, tag: "a", stale_after_s: 5 }] as SynopticObject[];
    const { rerender } = render(<SvgCanvas objects={oggetti} tagValues={{ a: val(7) }} pageWidth={400} pageHeight={200} />);
    vi.mocked(localizeObject).mockClear();
    act(() => { rerender(<SvgCanvas objects={oggetti} tagValues={{ a: val(7, T0 + 1000) }} pageWidth={400} pageHeight={200} />); });
    expect(ridisegnati()).toEqual([]);
  });
});

describe("in modifica, un passo di trascinamento", () => {
  it("non ridisegna griglie e faceplate senza tubi", () => {
    // Mentre si trascina, `objects` cambia a ogni movimento del mouse: contano
    // solo per chi li legge davvero, cioè un tubo agganciato.
    const oggetti = [
      { id: "fp1", type: "faceplate", x: 0, y: 0, width: 100, height: 60, faceplate_id: "fp", faceplate_params: { p: "pompa" } },
      {
        id: "griglia", type: "grid", x: 0, y: 100, width: 200, height: 100, grid_rows: 1, grid_cols: 1,
        grid_cells: [{ row: 0, col: 0, child: { id: "cella", type: "text", x: 0, y: 0, width: 80, height: 20, tag: "c" } }],
      },
      { id: "mobile", type: "rect", x: 300, y: 0, width: 40, height: 40 },
    ] as unknown as SynopticObject[];
    const canvas = (objs: SynopticObject[]) => (
      <SvgCanvas objects={objs} tagValues={VALORI} faceplates={FACEPLATES} pageWidth={400} pageHeight={300}
        selectedIds={NESSUNO} onSelect={() => {}} onMove={() => {}} />
    );
    const { rerender } = render(canvas(oggetti));
    vi.mocked(localizeObject).mockClear();
    const passo = oggetti.map((o) => (o.id === "mobile" ? { ...o, x: 310 } : o));
    act(() => { rerender(canvas(passo)); });
    expect(ridisegnati()).toEqual(["mobile"]);
  });
});

describe("il popup di un faceplate", () => {
  const oggetti = [
    {
      id: "apri", type: "button", x: 0, y: 0, width: 80, height: 30, label: "Apri",
      button_action: { type: "open_faceplate", faceplate_id: "fp", params: { p: "pompa" } },
    },
    { id: "altro", type: "text", x: 0, y: 50, width: 80, height: 20, tag: "estraneo" },
  ] as SynopticObject[];

  it("aperto, un tag estraneo non ridisegna i suoi figli", () => {
    // Il popup sta nel ciclo della radice, che si ridisegna a ogni messaggio:
    // se rifà i figli a ogni giro, il memo li vede nuovi e li ridisegna tutti.
    const canvas = (valori: Record<string, TagState>) => (
      <SvgCanvas objects={oggetti} tagValues={valori} faceplates={FACEPLATES} pageWidth={400} pageHeight={200} onWriteTag={() => {}} />
    );
    const { rerender, getByText } = render(canvas(VALORI));
    fireEvent.mouseDown(getByText("Apri"));
    expect(getByText("Pompa di prova")).toBeTruthy();
    vi.mocked(localizeObject).mockClear();
    act(() => { rerender(canvas({ ...VALORI, estraneo: val(2) })); });
    expect(ridisegnati()).toEqual(["altro"]);
  });
});

describe("il lucchetto per ruolo", () => {
  it("non si ricalcola per ogni oggetto a ogni messaggio", () => {
    // `ruoloCheServe` cerca le soglie fra i tag del progetto: oggetti × tag a
    // ogni messaggio, senza che niente di suo sia cambiato.
    const prima = mappaIniziale();
    const canvas = (valori: Record<string, TagState>) => (
      <SvgCanvas objects={OGGETTI} tagValues={valori} pageWidth={1280} pageHeight={800} onWriteTag={() => {}} />
    );
    const { rerender } = render(canvas(prima));
    expect(vi.mocked(ruoloCheServe)).toHaveBeenCalled();
    vi.mocked(ruoloCheServe).mockClear();
    act(() => { rerender(canvas({ ...prima, "s.rete_scambio": val(42) })); });
    expect(vi.mocked(ruoloCheServe)).not.toHaveBeenCalled();
  });
});
