/** «Applica a tutte le pagine» (05-11-2026, richiesta del maintainer): il
 *  formato del progetto sopra quello delle pagine spuntate. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "../src/i18n";
import { useAppStore } from "../src/store";
import { apriImpostazioniProgetto } from "../src/editor/EditorShell";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { svuotaCoda } from "../src/finestraAvviso/finestraAvviso";
import { patchSovrascrittura, type GenerePagina } from "../src/formatoProgetto";
import type { PageLayoutConfig, SynopticPage } from "../src/types";

const layout = { size_mode: "fixed", default_width: 2560, default_height: 1080, default_background: "#4aeb1e", default_background_dark: "#386600" } as PageLayoutConfig;
const pg = (id: string, extra: Partial<SynopticPage> = {}) =>
  ({ id, name: id, objects: [], width: 1280, height: 800, background: "#000000", background_dark: "#111111", ...extra }) as SynopticPage;
const con = (p: SynopticPage, genere: GenerePagina) => ({ pagina: p, genere });

describe("patchSovrascrittura", () => {
  it("una pagina normale prende misura e sfondi anche se aveva i suoi", () => {
    expect(patchSovrascrittura([con(pg("a"), "pagina")], layout, { misura: true, sfondi: true })).toEqual([
      { id: "a", patch: { width: 2560, height: 1080, background: "#4aeb1e", background_dark: "#386600" } },
    ]);
  });

  it("una cornice e un faceplate prendono la misura e non gli sfondi; il boot il solo sfondo chiaro", () => {
    const r = patchSovrascrittura([con(pg("c"), "cornice"), con(pg("f"), "faceplate"), con(pg("b"), "boot")], layout, { misura: true, sfondi: true });
    expect(r).toEqual([
      { id: "c", patch: { width: 2560, height: 1080 } },
      { id: "f", patch: { width: 2560, height: 1080 } },
      { id: "b", patch: { width: 2560, height: 1080, background: "#4aeb1e" } },
    ]);
  });

  it("solo gli sfondi, o solo la misura; e uno scuro vuoto nel progetto toglie quello della pagina", () => {
    expect(patchSovrascrittura([con(pg("a"), "pagina")], layout, { misura: false, sfondi: true })[0].patch)
      .toEqual({ background: "#4aeb1e", background_dark: "#386600" });
    expect(patchSovrascrittura([con(pg("a"), "pagina")], { ...layout, default_background_dark: undefined }, { misura: false, sfondi: true })[0].patch)
      .toEqual({ background: "#4aeb1e", background_dark: undefined });
    expect(patchSovrascrittura([con(pg("a"), "pagina")], layout, { misura: true, sfondi: false })[0].patch)
      .toEqual({ width: 2560, height: 1080 });
  });

  it("con il dimensionamento non fisso la misura tocca il solo boot", () => {
    const r = patchSovrascrittura([con(pg("a"), "pagina"), con(pg("b"), "boot")], { ...layout, size_mode: "fluid" }, { misura: true, sfondi: false });
    expect(r).toEqual([{ id: "b", patch: { width: 2560, height: 1080 } }]);
  });

  it("una pagina già uguale al formato non cambia", () => {
    expect(patchSovrascrittura([con(pg("a", { width: 2560, height: 1080, background: "#4aeb1e", background_dark: "#386600" }), "pagina")], layout, { misura: true, sfondi: true })).toEqual([]);
  });
});

describe("l'elenco nella finestra delle impostazioni", () => {
  beforeEach(() => {
    useAppStore.setState({
      project: { meta: { name: "prova" }, page_layout: layout, target: { kind: "web" } } as never,
      pages: [pg("home"), pg("pompa", { finestra: { larghezza: 600 } as never, width: 600, height: 400 }), pg("fp", { kind: "faceplate" } as never)],
      authRole: "Admin",
    });
  });
  afterEach(async () => { await act(async () => { svuotaCoda(); }); cleanup(); });

  it("già compilato: la pagina sì, la finestra e il faceplate no; applica e torna il conto", async () => {
    render(<FinestraAvviso />);
    await act(async () => { void apriImpostazioniProgetto("Impostazioni progetto"); });
    await act(async () => { fireEvent.click(screen.getByTestId("applica-a-tutte")); });
    expect((screen.getByTestId("applica-pagina-home") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("applica-pagina-pompa") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("applica-pagina-fp") as HTMLInputElement).checked).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("applica-conferma")); });
    const pagine = useAppStore.getState().pages;
    expect(pagine.find((p) => p.id === "home")).toMatchObject({ width: 2560, height: 1080, background: "#4aeb1e" });
    expect(pagine.find((p) => p.id === "pompa")).toMatchObject({ width: 600, height: 400 });
    // Si torna alla finestra delle impostazioni, col conto accanto ai bottoni.
    expect(screen.getByTestId("impostazioni-progetto")).toBeTruthy();
    expect(screen.getByTestId("impostazioni-progetto").textContent).toMatch(/\b1 pages updated/);
  });
});
