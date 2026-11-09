/** I piccoli costi del ridisegno (piano «viewer leggero», 09-11-2026, passo 5e).
 *
 *  Col ridisegno mirato un oggetto si ridisegna solo quando cambia un suo tag,
 *  ma quando succede deve costare poco. Tre cose si rifacevano da capo a ogni
 *  disegno: tutto il canvas di un trend (array di tracce nuovi a ogni render),
 *  la sanificazione dello svg di un simbolo custom, e la mappa delle
 *  descrizioni dei tag in un progetto senza tipi (il default `[]` nuovo non
 *  era mai quello della cache). */
import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Nessun runtime: lo storico del trend non arriva mai.
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  return { ...vero, api };
});

// La sanificazione vera, contata.
vi.mock("@/symbols/customSvg", async () => {
  const vero = await vi.importActual<typeof import("@/symbols/customSvg")>("@/symbols/customSvg");
  return { ...vero, sanitizeSvg: vi.fn(vero.sanitizeSvg) };
});

import "../src/i18n/index";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { LinguaContenutiProvider } from "@/i18n/linguaContenuti";
import { sanitizeSvg } from "@/symbols/customSvg";
import { descrizioniDeiTag } from "@/tag/forma";
import type { CustomSymbol, LanguageTable, SynopticObject, TagDef, TagState } from "@/types";

const T0 = 1_700_000_000_000;
const v = (value: TagState["value"]): TagState => ({ value, quality: "Good", timestamp_ms: T0 });

/** Ogni passata di disegno del trend chiede il contesto del canvas. Qui non
 *  c'è (jsdom), e la passata si ferma subito: si conta solo che parta. */
const contesto = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("un oggetto che si ridisegna costa poco", () => {
  it("il trend non rifà il disegno del canvas quando il suo tag cambia valore", () => {
    // Un'etichetta da tradurre: `localizeObject` rifà le tracce a ogni render
    // anche se sono uguali, ed è il caso peggiore.
    const tabella: LanguageTable = { default: "it", langs: ["it"], entries: [{ key: "t1", values: { it: "Portata" } }] };
    // Lo stesso valore del contesto a ogni giro, come lo tiene `RuntimeView`.
    const lingua = { lang: "it", table: tabella };
    const oggetti = [{
      id: "tr", type: "trend", x: 0, y: 0, width: 300, height: 160,
      trend_tags: [{ tag: "a", label: "{{t1}}" }, { tag: "b" }],
    }] as SynopticObject[];
    const disegna = (valori: Record<string, TagState>) => (
      <LinguaContenutiProvider value={lingua}>
        <SvgCanvas objects={oggetti} tagValues={valori} />
      </LinguaContenutiProvider>
    );
    const { rerender } = render(disegna({ a: v(1), b: v(2) }));
    contesto.mockClear();
    rerender(disegna({ a: v(5), b: v(2) }));
    expect(contesto).not.toHaveBeenCalled();
  });

  it("lo svg di un simbolo custom si sanifica una volta, non a ogni cambio di stato", () => {
    const simboli = [{
      id: "valvola", label: "Valvola", url: "", attribution: { author: "", source: "", license: "" },
      svg: '<svg viewBox="0 0 100 100"><rect id="corpo" width="100" height="100"/></svg>', colorable_ids: ["corpo"],
    }] as CustomSymbol[];
    const oggetti = [{ id: "s", type: "symbol", x: 0, y: 0, width: 60, height: 60, symbol_id: "custom:valvola", state_tag: "m" }] as SynopticObject[];
    const { rerender, container } = render(<SvgCanvas objects={oggetti} tagValues={{ m: v(false) }} customSymbols={simboli} />);
    const spento = container.innerHTML;
    vi.mocked(sanitizeSvg).mockClear();
    rerender(<SvgCanvas objects={oggetti} tagValues={{ m: v(true) }} customSymbols={simboli} />);
    // Il simbolo si è ridisegnato (il colore dello stato è cambiato), lo svg
    // non si è sanificato di nuovo.
    expect(container.innerHTML).not.toBe(spento);
    expect(vi.mocked(sanitizeSvg)).not.toHaveBeenCalled();
  });

  it("le descrizioni dei tag di un progetto senza tipi sono la stessa mappa", () => {
    const tags = [{ id: "a", unit: "kW" }] as unknown as TagDef[];
    expect(descrizioniDeiTag(tags)).toBe(descrizioniDeiTag(tags));
  });
});
