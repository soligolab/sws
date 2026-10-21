/** Il menù Strumenti riorganizzato (14-10-2026, piano
 *  docs/archive/2026-10-14-strumenti-simboli-comandi.md, ramo 1): gruppi nuovi
 *  senza perdere tipi, icone SVG nostre, i simboli di libreria come rami, e un
 *  filtro che cerca nei nomi che si vedono. */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getProject: vi.fn().mockResolvedValue(null),
    listRecipes: vi.fn().mockResolvedValue([]), listUsers: vi.fn().mockResolvedValue([]) } };
});

import i18n from "../src/i18n";
import { LeftPanel, PALETTE_GROUPS, famiglieSimboli, filtraStrumenti, paletteForTarget } from "../src/editor/LeftPanel";
import { ICONE_STRUMENTI } from "../src/editor/iconeStrumenti";
import { registraAggiunta } from "../src/editor/azioniEditor";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import { MISURE_ICONE, useAppStore } from "../src/store";
import type { ManifestLib } from "../src/symbols/lib/manifest";

const manifesto = JSON.parse(readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8")) as ManifestLib;
const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o);
const tipi = (gs: { items: { type: string }[] }[]) => gs.flatMap((g) => g.items.map((i) => i.type));

beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto)); });

describe("gerarchia", () => {
  it("39 tipi, nessuno perso né doppio, ognuno con la sua icona", () => {
    const tutti = tipi(PALETTE_GROUPS);
    expect(tutti).toHaveLength(39);
    expect(new Set(tutti).size).toBe(tutti.length);
    expect(Object.keys(ICONE_STRUMENTI).sort()).toEqual([...tutti].sort());
  });

  it("ogni gruppo ha il suo nome in italiano e in inglese", () => {
    for (const g of PALETTE_GROUPS) {
      for (const lng of ["it", "en"]) {
        const k = `editor.palette.group.${g.category}`;
        expect(i18n.getFixedT(lng)(k), `${lng}: ${k}`).not.toBe(k);
      }
    }
  });

  it("sotto i filtri di contesto nessun gruppo resta vuoto", () => {
    for (const [lvgl, boot] of [[false, false], [true, false], [false, true]] as const) {
      for (const g of paletteForTarget(lvgl, boot)) expect(g.items.length, g.category).toBeGreaterThan(0);
    }
  });
});

describe("simboli per famiglia e tipologia", () => {
  it("tutti i simboli del manifesto, nell'ordine, divisi per famiglia ▸ tipologia", () => {
    const f = famiglieSimboli(manifesto.symbols);
    expect(f.map((x) => x.famiglia)).toEqual([...new Set(manifesto.symbols.map((s) => s.family))]);
    expect(f.flatMap((x) => x.tipologie.flatMap((k) => k.simboli))).toHaveLength(manifesto.symbols.length);
    for (const x of f) for (const k of x.tipologie) for (const s of k.simboli) {
      expect(s.family).toBe(x.famiglia);
      expect(s.kind).toBe(k.tipo);
    }
  });
});

describe("filtro", () => {
  beforeEach(async () => { await act(async () => { await i18n.changeLanguage("it"); }); });

  it("vuoto non dà risultati; cerca nei nomi tradotti di strumenti e simboli", () => {
    expect(filtraStrumenti("  ", PALETTE_GROUPS, manifesto.symbols, t)).toEqual([]);
    const r = filtraStrumenti("pompa", PALETTE_GROUPS, manifesto.symbols, t);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.kind === "simbolo")).toBe(true);
    expect(filtraStrumenti("indicatore led", PALETTE_GROUPS, [], t)).toEqual([]);
    expect(filtraStrumenti("allarmi", PALETTE_GROUPS, [], t).map((x) => x.kind === "tipo" && x.type))
      .toEqual(["alarm_viewer", "alarm_banner", "alarm_bell", "alarm_history"]);
  });

  it("segue la lingua dell'interfaccia", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(filtraStrumenti("pump", PALETTE_GROUPS, manifesto.symbols, t).length).toBeGreaterThan(0);
    expect(filtraStrumenti("charts", PALETTE_GROUPS, [], t).length).toBe(5);
  });

  it("rispetta il contesto: senza il tipo simbolo, niente simboli", () => {
    const boot = paletteForTarget(false, true);
    const conSimbolo = tipi(boot).includes("symbol");
    expect(filtraStrumenti("pompa", boot, manifesto.symbols, t).length > 0).toBe(conSimbolo);
  });
});

describe("ramo Strumenti", () => {
  const aggiunte: [string, unknown][] = [];
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    aggiunte.length = 0;
    registraAggiunta((type, pre) => aggiunte.push([type, pre]));
    useAppStore.setState({
      authRole: "Admin", appMode: "edit",
      pages: [{ id: "p1", name: "Uno", width: 800, height: 480, objects: [], groups: [] }] as never,
      currentPageId: "p1", project: {} as never, faceplates: [], customSymbols: [],
    });
  });
  afterEach(() => registraAggiunta(null));

  it("un clic su un simbolo della libreria lo crea già scelto", () => {
    render(<LeftPanel />);
    fireEvent.click(screen.getByText(t("editor.palette.group.simboli")));
    const sim = manifesto.symbols[0];
    fireEvent.click(screen.getByText(t(`symbols.lib.famiglia.${sim.family}`)));
    fireEvent.click(screen.getByText(t(`symbols.lib.tipo.${sim.kind}`)));
    fireEvent.click(screen.getByTestId(`simbolo-${sim.id}`));
    expect(aggiunte).toEqual([["symbol", { symbol_id: sim.id }]]);
  });

  it("il filtro mostra un elenco piatto; Esc lo svuota", () => {
    render(<LeftPanel />);
    const filtro = screen.getByTestId("filtro-strumenti");
    fireEvent.change(filtro, { target: { value: "trend" } });
    fireEvent.click(screen.getByTestId("strumento-trend"));
    expect(aggiunte).toEqual([["trend", undefined]]);
    expect(screen.queryByTestId("strumento-rect")).toBeNull();
    fireEvent.keyDown(filtro, { key: "Escape" });
    expect((filtro as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("strumento-rect")).toBeTruthy();
  });

  it("le icone seguono la misura scelta nelle preferenze", () => {
    expect(MISURE_ICONE).toEqual([16, 20, 24, 28]);
    useAppStore.getState().setMisuraIcone(16);
    render(<LeftPanel />);
    const svg = screen.getByTestId("strumento-rect").querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(localStorage.getItem("sws.ide.misuraIcone")).toBe("16");
  });
});
