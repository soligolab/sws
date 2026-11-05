/** Il pannello destro senza selezione (05-11-2026, maintainer: «il menù a destra
 *  per le voci di PAGES è un menù unico e ingarbugliato, non si capisce cosa è
 *  relativo alla pagina e cosa generale per il progetto»): una voce per gruppo
 *  della pagina, e le impostazioni del progetto nella loro finestra. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n";
import { useAppStore } from "../src/store";
import { api } from "../src/api/client";
import { GRUPPI_PAGINA, PageProps, PannelloDestro, apriImpostazioniProgetto } from "../src/editor/EditorShell";
import { salvaLayout } from "../src/formatoProgettoAzioni";
import { PREFISSO_MEMORIA } from "../src/editor/stilePannelli";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { svuotaCoda } from "../src/finestraAvviso/finestraAvviso";
import type { PageLayoutConfig, SynopticPage } from "../src/types";

const pagina = { id: "p1", name: "Home", objects: [], width: 1280, height: 800, background: "#0f172a" } as unknown as SynopticPage;

function Pannello({ id = "p1", cornice = false, piede }: { id?: string; cornice?: boolean; piede?: React.ReactNode }) {
  return (
    <PannelloDestro larghezza={300} onRidimensiona={() => {}} titolo="Proprietà" tipo="" gruppiVisibili={GRUPPI_PAGINA}
      aSezioni chiaveOggetto={`pagina:${id}`} bloccato={false} piede={piede}>
      <PageProps name="Home" background="#0f172a" width={1280} height={800} sizeMode="fixed" offPageCount={0}
        pageId={id} cornice={cornice} onChange={() => {}} />
    </PannelloDestro>
  );
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom senza storage */ }
  useAppStore.setState({ disposizioneIde: "vscode" });
});
afterEach(async () => {
  await act(async () => { svuotaCoda(); });
  cleanup();
  useAppStore.setState({ disposizioneIde: "classica" });
  vi.restoreAllMocks();
});

describe("i rami della pagina", () => {
  it("la barra ha le voci della pagina che hanno qualcosa: Pagina e Sfondo", () => {
    render(<Pannello />);
    const voci = screen.getAllByRole("tab").map((b) => b.getAttribute("data-testid"));
    expect(voci).toEqual(["attivita-pagina", "attivita-sfondo"]);
  });

  it("una voce alla volta: Sfondo mostra i colori e non la misura", () => {
    render(<Pannello />);
    expect(screen.getByTestId("sezione-misura")).toBeTruthy();
    expect(screen.queryByTestId("sezione-sfondoColori")).toBeNull();
    fireEvent.click(screen.getByTestId("attivita-sfondo"));
    expect(screen.getByTestId("sezione-sfondoColori")).toBeTruthy();
    expect(screen.queryByTestId("sezione-misura")).toBeNull();
  });

  it("nella pagina non c'è più niente del progetto", () => {
    render(<Pannello />);
    fireEvent.click(screen.getByTestId("attivita-pagina"));
    expect(screen.queryByTestId("apri-scala-risoluzione")).toBeNull();
    expect(screen.queryByText(/Sizing mode|Dimensionamento/)).toBeNull();
  });
});

describe("i difetti trovati dalla revisione del 05-11-2026", () => {
  it("colonna chiusa e poi un'altra pagina: la barra ha ancora le voci, e un clic la riapre", () => {
    const r = render(<Pannello />);
    fireEvent.click(screen.getByTestId("attivita-pagina"));
    expect(screen.queryByTestId("sezione-misura")).toBeNull();
    r.rerender(<Pannello id="p2" />);
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("tab")[0]);
    expect(screen.getByTestId("sezione-misura")).toBeTruthy();
  });

  it("colonna chiusa in memoria al ricaricamento: la barra non è vuota", () => {
    localStorage.setItem(PREFISSO_MEMORIA + "destra.vscodeChiusa", "1");
    render(<Pannello />);
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
  });

  it("un ramo che perde le sue sezioni sparisce dalla barra", () => {
    const r = render(<Pannello />);
    expect(screen.getAllByRole("tab").map((b) => b.dataset.testid)).toContain("attivita-sfondo");
    // Una cornice non ha sfondo: la stessa pagina che diventa cornice perde il ramo.
    r.rerender(<Pannello cornice />);
    expect(screen.getAllByRole("tab").map((b) => b.dataset.testid)).not.toContain("attivita-sfondo");
  });

  it("il ramo scelto sulla pagina ha la sua memoria, e non tocca quello degli oggetti", () => {
    localStorage.setItem(PREFISSO_MEMORIA + "destra.ramo", "aspetto");
    render(<Pannello />);
    fireEvent.click(screen.getByTestId("attivita-sfondo"));
    expect(localStorage.getItem(PREFISSO_MEMORIA + "destra.ramoPagina")).toBe("sfondo");
    expect(localStorage.getItem(PREFISSO_MEMORIA + "destra.ramo")).toBe("aspetto");
  });

  it("il piede sta in fondo alla colonna", () => {
    render(<Pannello piede={<div data-testid="piede" />} />);
    expect((screen.getByTestId("piede").parentElement as HTMLElement).style.order).toBe("10000");
  });

  it("due scritture del page_layout di fila: la seconda parte dal risultato della prima", async () => {
    useAppStore.setState({ project: { meta: { name: "prova" }, page_layout: { size_mode: "fixed" } } as never });
    const scrivi = vi.spyOn(api, "updatePageLayout").mockResolvedValue(undefined as never);
    await Promise.all([
      salvaLayout((b) => ({ size_mode: "fixed", ...b, home_page_id: "p1" })),
      salvaLayout((b) => ({ size_mode: "fixed", ...b, hide_viewer_chrome: true })),
    ]);
    expect(scrivi.mock.calls[1][0]).toMatchObject({ home_page_id: "p1", hide_viewer_chrome: true });
  });
});

describe("la finestra «Impostazioni progetto»", () => {
  const layout: PageLayoutConfig = {
    size_mode: "fixed", default_width: 1280, default_height: 800, cornice_predefinita: "c1", page_tree: undefined,
  } as PageLayoutConfig;

  beforeEach(() => {
    useAppStore.setState({
      project: { meta: { name: "prova" }, page_layout: layout, target: { kind: "web" } } as never,
      pages: [pagina], authRole: "Admin",
    });
  });

  it("si apre dal codice, ogni campo scrive subito il page_layout intero", async () => {
    const scrivi = vi.spyOn(api, "updatePageLayout").mockResolvedValue(undefined as never);
    render(<FinestraAvviso />);
    let fatto!: Promise<null>;
    await act(async () => { fatto = apriImpostazioniProgetto("Impostazioni progetto"); });
    expect(screen.getByTestId("impostazioni-progetto")).toBeTruthy();
    const casella = screen.getByRole("checkbox", { name: /full-screen|tutto schermo/i });
    await act(async () => { fireEvent.click(casella); });
    expect(scrivi).toHaveBeenCalledTimes(1);
    // Il resto del page_layout viaggia con lui: il server lo sostituisce intero.
    expect(scrivi.mock.calls[0][0]).toMatchObject({ hide_viewer_chrome: true, default_width: 1280, cornice_predefinita: "c1" });
    expect(useAppStore.getState().project?.page_layout?.hide_viewer_chrome).toBe(true);
    fireEvent.click(screen.getByTestId("chiudi-impostazioni-progetto"));
    await expect(fatto).resolves.toBeNull();
  });

  it("passare a LVGL chiede conferma nella Finestra di avviso, e Annulla non cambia niente", async () => {
    const target = vi.spyOn(api, "updateProjectTarget").mockResolvedValue(undefined as never);
    render(<FinestraAvviso />);
    await act(async () => { void apriImpostazioniProgetto("Impostazioni progetto"); });
    const motore = screen.getAllByRole("combobox").find((c) => (c as HTMLSelectElement).value === "web") as HTMLSelectElement;
    await act(async () => { fireEvent.change(motore, { target: { value: "lvgl_wayland" } }); });
    // La conferma sta sopra la finestra delle impostazioni, che resta sotto.
    expect(screen.getByTestId("finestra-avviso").getAttribute("data-tipo")).toBe("conferma");
    expect(screen.getByTestId("finestra-avviso-sotto").getAttribute("data-tipo")).toBe("modulo");
    await act(async () => { fireEvent.click(screen.getByTestId("finestra-avviso-annulla")); });
    expect(target).not.toHaveBeenCalled();
    expect(screen.getByTestId("finestra-avviso").getAttribute("data-tipo")).toBe("modulo");
    // E confermando il motore cambia.
    await act(async () => { fireEvent.change(motore, { target: { value: "lvgl_wayland" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("finestra-avviso-ok")); });
    expect(target).toHaveBeenCalledWith(expect.objectContaining({ kind: "lvgl_wayland" }));
  });
});
