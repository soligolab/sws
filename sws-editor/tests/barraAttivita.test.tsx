/** La barra di attività della disposizione «Stile VS Code» (31-10-2026, piano
 *  docs/archive/2026-10-31-ide-stile-vscode.md). */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { BarraAttivita, useAttivita, type VoceAttivita } from "../src/editor/BarraAttivita";
import { COLORI_ATTIVITA, ICONE_ATTIVITA } from "../src/editor/iconeAttivita";
import { relativeLuminance } from "../src/theme";
import { useAppStore } from "../src/store";

const voci: VoceAttivita[] = [
  { id: "pagine", titolo: "Pagine", spiegazione: "Le pagine del progetto" },
  { id: "strumenti", titolo: "Strumenti", spiegazione: "Gli oggetti da mettere in pagina" },
  { id: "oggetti", titolo: "Oggetti", spiegazione: "Gli oggetti della pagina" },
];

function Prova() {
  const a = useAttivita("prova.barra", "pagine");
  return (
    <>
      <BarraAttivita voci={voci} attiva={a.voce} aperta={a.aperta} lato="left" onScegli={a.scegli} etichetta="Barra" />
      {a.aperta && <div data-testid="colonna">{a.voce}</div>}
    </>
  );
}

beforeEach(() => { localStorage.clear(); useAppStore.getState().setMisuraIcone(24); });
afterEach(() => vi.useRealTimers());

describe("BarraAttivita", () => {
  it("un clic cambia colonna, un clic sull'attiva la chiude, un altro la riapre, e si ricorda", () => {
    const { unmount } = render(<Prova />);
    expect(screen.getByTestId("colonna").textContent).toBe("pagine");
    fireEvent.click(screen.getByTestId("attivita-strumenti"));
    expect(screen.getByTestId("colonna").textContent).toBe("strumenti");
    expect(screen.getByTestId("attivita-strumenti").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("attivita-strumenti"));
    expect(screen.queryByTestId("colonna")).toBeNull();
    expect(screen.getByTestId("attivita-strumenti").getAttribute("aria-selected")).toBe("false");
    unmount();
    render(<Prova />);
    expect(screen.queryByTestId("colonna")).toBeNull();
    fireEvent.click(screen.getByTestId("attivita-strumenti"));
    expect(screen.getByTestId("colonna").textContent).toBe("strumenti");
  });

  it("il pop-up: subito col fuoco, dopo un attimo col mouse, via all'uscita", () => {
    vi.useFakeTimers();
    render(<Prova />);
    fireEvent.focus(screen.getByTestId("attivita-oggetti"));
    expect(screen.getByTestId("attivita-popup").textContent).toContain("Gli oggetti della pagina");
    fireEvent.blur(screen.getByTestId("attivita-oggetti"));
    expect(screen.queryByTestId("attivita-popup")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("attivita-pagine"));
    expect(screen.queryByTestId("attivita-popup")).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("attivita-popup").textContent).toContain("Le pagine del progetto");
    fireEvent.mouseLeave(screen.getByTestId("attivita-pagine"));
    expect(screen.queryByTestId("attivita-popup")).toBeNull();
  });

  it("l'icona non prende il puntatore: il clic arriva sempre al bottone", () => {
    // Dal vivo il primo clic andava perso: il mousedown cadeva su un <path>
    // che il ridisegno del pop-up rimetteva, e il browser non genera il click
    // fra due elementi diversi. `fireEvent` non lo riproduce: si prova la causa.
    render(<Prova />);
    for (const svg of document.querySelectorAll('[role="tab"] svg')) {
      expect((svg as SVGElement).style.pointerEvents).toBe("none");
    }
  });

  it("icone e barra seguono la dimensione delle icone delle preferenze", () => {
    const { container, rerender } = render(<Prova />);
    const barra = () => container.querySelector("[data-barra-attivita]") as HTMLElement;
    const icona = () => screen.getByTestId("attivita-pagine").querySelector("svg")!;
    expect(barra().style.width).toBe("48px");
    expect(icona().getAttribute("width")).toBe("24");
    act(() => useAppStore.getState().setMisuraIcone(28));
    rerender(<Prova />);
    expect(barra().style.width).toBe("56px");
    expect(icona().getAttribute("width")).toBe("28");
    expect(screen.getByTestId("attivita-pagine").style.height).toBe("48px");
  });

  it("le frecce spostano il fuoco fra le voci, in giro", () => {
    render(<Prova />);
    const prima = screen.getByTestId("attivita-pagine");
    prima.focus();
    fireEvent.keyDown(prima, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("attivita-oggetti"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(prima);
  });

  it("ogni voce ha un'icona, e i colori reggono 3:1 sulla superficie dei due temi", () => {
    const contrasto = (a: string, b: string) => {
      const [la, lb] = [relativeLuminance(a)!, relativeLuminance(b)!];
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    for (const [voce, [scuro, chiaro]] of Object.entries(COLORI_ATTIVITA)) {
      expect(ICONE_ATTIVITA[voce], voce).toBeTruthy();
      // La barra sta sul fondo (`bg`), il pop-up e le colonne sulla superficie.
      for (const fondo of ["#0f172a", "#1e293b"]) expect(contrasto(scuro, fondo), `${voce} scuro su ${fondo}`).toBeGreaterThanOrEqual(3);
      for (const fondo of ["#f8fafc", "#ffffff"]) expect(contrasto(chiaro, fondo), `${voce} chiaro su ${fondo}`).toBeGreaterThanOrEqual(3);
    }
  });
});
