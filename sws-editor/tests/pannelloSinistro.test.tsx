import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n from "../src/i18n";

// `LeftPanel` chiede il progetto al montaggio: senza mock la chiamata parte
// verso il nulla e il test aspetterebbe un rifiuto che non cambia nulla di ciò
// che qui si verifica.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getProject: vi.fn().mockResolvedValue(null) } };
});

import { LeftPanel } from "../src/editor/LeftPanel";

/** Il pannello sinistro mostra **una vista per volta** (T-56 passo 2).
 *
 *  Prima erano sette fisarmoniche in colonna: aprendone più di una il pannello
 *  si allungava e le altre uscivano dallo schermo. Questi test difendono le due
 *  proprietà che rendono utile il cambio — se ne vede una sola, e la scelta
 *  sopravvive — perché entrambe si perdono con una riga distratta e nessuna
 *  delle due fa fallire la compilazione.
 */
const CHIAVE = "sws.pannelli.sinistra.vista";

/** I titoli si chiedono a i18n invece di scriverli: il test gira nella lingua
 *  di default del bundle (inglese), e un domani potrebbe non essere quella. */
const titolo = (k: string) => i18n.t(`editor.${k}`);

function monta() {
  return render(<LeftPanel onAddObject={() => {}} onFunctionsChanged={() => {}} />);
}

/** I sei pulsanti della barra, nell'ordine in cui stanno sullo schermo. */
function icone() {
  return screen.getAllByRole("tab");
}

describe("pannello sinistro — una vista per volta", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
  });

  it("all'avvio mostra Pagine, e solo quella", () => {
    monta();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
    expect(screen.queryByText(titolo("sectionPageObjects"))).toBeNull();
    expect(screen.queryByText(titolo("sectionSources"))).toBeNull();
  });

  it("la barra ha una voce per vista, e una sola risulta scelta", () => {
    monta();
    const scelte = icone().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(icone()).toHaveLength(6);
    expect(scelte).toHaveLength(1);
  });

  it("scegliere una vista sostituisce la precedente invece di aggiungersi", () => {
    monta();
    fireEvent.click(icone()[2]); // 🗂 Struttura
    expect(screen.getByText(new RegExp("^" + titolo("sectionPageObjects")))).toBeTruthy();
    expect(screen.queryByText(titolo("sectionPages"))).toBeNull();
    const scelte = icone().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(scelte).toHaveLength(1);
  });

  it("la scelta sopravvive al ricaricamento", () => {
    const { unmount } = monta();
    fireEvent.click(icone()[4]); // 🔌 Sorgenti
    expect(localStorage.getItem(CHIAVE)).toBe("sorgenti");
    unmount();
    monta();
    expect(screen.getByText(new RegExp("^" + titolo("sectionSources")))).toBeTruthy();
    expect(screen.queryByText(titolo("sectionPages"))).toBeNull();
  });

  it("una vista memorizzata che non esiste più non lascia il pannello vuoto", () => {
    // Il caso si presenta togliendo o rinominando una vista: chi aveva
    // memorizzata quella vecchia deve ritrovarsi su Pagine, non sul nulla.
    localStorage.setItem(CHIAVE, "cronologia");
    monta();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
  });
});
