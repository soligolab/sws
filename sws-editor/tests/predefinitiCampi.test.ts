import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPI, MOTIVI, fissiDelTipo, regolaCampo, riempiPredefiniti, riempiPredefinitiOggetti } from "../src/predefinitiCampi";
import { oggettoNuovo } from "../src/editor/oggettiNuovi";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import type { SynopticObject } from "../src/types";

/** I predefiniti dei campi non-colore, e il passo che scrive nel file quelli
 *  fissi (colori compresi). I casi stanno in `tests/fixtures/predefiniti-campi.json`
 *  alla radice del repo: il 30-09-2026 un `data_log` era scuro sul web e bianco
 *  sul pannello, perché il file non diceva lo sfondo e ogni motore lo indovinava. */
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/predefiniti-campi.json"), "utf8"),
) as { motivi: string[]; campi: Record<string, Record<string, unknown>> };

const TIPI = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as SynopticObject["type"]));
const obj = (o: Partial<SynopticObject> & { type: SynopticObject["type"] }) =>
  ({ id: "o", x: 0, y: 0, ...o }) as SynopticObject;

describe("predefinitiCampi — la tabella condivisa", () => {
  it("il modulo e la fixture dicono la stessa cosa, voce per voce", () => {
    expect(CAMPI).toEqual(fixture.campi);
    expect(MOTIVI).toEqual(fixture.motivi);
  });

  it("ogni vuoto voluto ha un motivo conosciuto", () => {
    for (const [tipo, campi] of Object.entries(CAMPI)) {
      for (const [campo, r] of Object.entries(campi)) {
        if ("vuoto" in r) expect(MOTIVI, `${tipo}.${campo}`).toContain(r.vuoto);
      }
    }
  });
});

describe("riempiPredefiniti — i valori fissi finiscono nel file", () => {
  it("il data_log del 30-09: lo sfondo scritto, così i due motori leggono lo stesso", () => {
    const d = riempiPredefiniti(obj({ type: "data_log", tag: "t" }));
    const r = d as unknown as Record<string, unknown>;
    expect(r.bg_color).toBe("#0f172a");
    expect(r.window_s).toBe(3600);
    expect(r.datalog_page_size).toBe(25);
    // L'etichetta vuota è voluta: niente segnaposto trasformato in testo.
    expect(r.label).toBeUndefined();
  });

  it("un valore già scritto non si tocca", () => {
    const d = riempiPredefiniti(obj({ type: "data_log", bg_color: "#ff0000", window_s: 60 }));
    expect(d.bg_color).toBe("#ff0000");
    expect(d.window_s).toBe(60);
  });

  it("stesso riferimento se non manca niente (il sorvegliante non scatta a vuoto)", () => {
    const pieno = riempiPredefiniti(obj({ type: "trend" }));
    expect(riempiPredefiniti(pieno)).toBe(pieno);
    const lista = [pieno];
    expect(riempiPredefinitiOggetti(lista)).toBe(lista);
    const testo = obj({ type: "text", font_size: 20 });
    expect(riempiPredefiniti(testo)).toBe(testo);
  });

  it("i vuoti voluti e i colori automatici restano assenti", () => {
    const tr = riempiPredefiniti(obj({ type: "trend" })) as unknown as Record<string, unknown>;
    expect(tr.y_min).toBeUndefined();
    expect(tr.y_max).toBeUndefined();
    const tx = riempiPredefiniti(obj({ type: "text" })) as unknown as Record<string, unknown>;
    expect(tx.color).toBeUndefined();
    // Il bordo del rettangolo è «nessuno»: resta assente, come lo disegna il web.
    const r = riempiPredefiniti(obj({ type: "rect" })) as unknown as Record<string, unknown>;
    expect(r.stroke).toBeUndefined();
    expect(r.fill).toBe("#4a90d9");
  });

  it("le voci `*` dei colori non si scrivono su tipi che non le usano", () => {
    const g = riempiPredefiniti(obj({ type: "gauge" })) as unknown as Record<string, unknown>;
    expect(g.quality_dot_good_color).toBeUndefined();
    expect(g.bg_color).toBeUndefined();
  });

  it("un rettangolo vecchio col colore in bg_color non riceve un fill che lo coprirebbe", () => {
    const r = riempiPredefiniti(obj({ type: "rect", bg_color: "#123456" }));
    expect(r.fill).toBeUndefined();
  });

  it("ogni tipo della palette nasce con tutti i suoi predefiniti fissi", () => {
    for (const tipo of TIPI) {
      const o = oggettoNuovo(tipo, 10, 10) as unknown as Record<string, unknown> | null;
      if (!o) continue;
      for (const [campo, v] of Object.entries(fissiDelTipo(tipo))) {
        expect(o[campo], `${tipo}.${campo}`).toBeDefined();
        // Il valore di creazione può essere diverso dal predefinito (un
        // «Bottone» scritto apposta), ma mai del tipo sbagliato.
        expect(typeof o[campo], `${tipo}.${campo}`).toBe(typeof v);
      }
    }
  });

  it("regolaCampo distingue fisso, vuoto voluto e nessuna regola", () => {
    expect(regolaCampo("trend", "window_s")).toEqual({ valore: 60 });
    expect(regolaCampo("trend", "y_min")).toEqual({ vuoto: "adatta" });
    expect(regolaCampo("trend", "campo_inventato")).toBeUndefined();
  });
});
