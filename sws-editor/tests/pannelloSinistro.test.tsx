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

/** I cinque pulsanti della barra, nell'ordine in cui stanno sullo schermo. */
function icone() {
  return screen.getAllByRole("tab");
}

describe("pannello sinistro — albero delle pagine fisso, una vista per volta sotto", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
  });

  it("l'albero delle pagine c'è sempre, in alto, qualunque vista sia scelta", () => {
    monta();
    expect(screen.getByTestId("albero-pagine")).toBeTruthy();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
    for (const i of [0, 1, 2, 3, 4]) {
      fireEvent.click(icone()[i]);
      expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
    }
  });

  it("sotto l'albero si vede una vista sola, e all'avvio è la palette", () => {
    monta();
    expect(screen.getByText(new RegExp("^" + titolo("sectionObjects")))).toBeTruthy();
    expect(screen.queryByText(titolo("sectionPageObjects"))).toBeNull();
    expect(screen.queryByText(titolo("sectionSources"))).toBeNull();
  });

  it("la barra ha una voce per vista (senza «Pagine»), e una sola risulta scelta", () => {
    monta();
    const scelte = icone().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(icone()).toHaveLength(5);
    expect(scelte).toHaveLength(1);
  });

  it("scegliere una vista sostituisce la precedente invece di aggiungersi", () => {
    monta();
    fireEvent.click(icone()[1]); // 🗂 Struttura
    expect(screen.getByText(new RegExp("^" + titolo("sectionPageObjects")))).toBeTruthy();
    expect(screen.queryByText(new RegExp("^" + titolo("sectionObjects")))).toBeNull();
    const scelte = icone().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(scelte).toHaveLength(1);
  });

  it("la scelta sopravvive al ricaricamento", () => {
    const { unmount } = monta();
    fireEvent.click(icone()[3]); // 🔌 Sorgenti
    expect(localStorage.getItem(CHIAVE)).toBe("sorgenti");
    unmount();
    monta();
    expect(screen.getByText(new RegExp("^" + titolo("sectionSources")))).toBeTruthy();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
  });

  it("una vista memorizzata che non esiste più (anche «pagine», ora fissa) non lascia il pannello vuoto", () => {
    // Il caso si presenta togliendo o rinominando una vista: chi aveva
    // memorizzata quella vecchia deve ritrovarsi sulla palette, non sul nulla.
    for (const vecchia of ["cronologia", "pagine"]) {
      localStorage.setItem(CHIAVE, vecchia);
      const { unmount } = monta();
      expect(screen.getByText(new RegExp("^" + titolo("sectionObjects")))).toBeTruthy();
      expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
      unmount();
    }
  });

  it("l'albero si comprime e lo ricorda; ricompare riaprendolo", () => {
    const { unmount } = monta();
    fireEvent.click(screen.getByTitle(i18n.t("editor.treeHide")));
    expect(localStorage.getItem("sws.pannelli.sinistra.alberoCompresso")).toBe("1");
    // Il titolo resta (con il pulsante per riaprire), l'elenco no.
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("leftPanel.newPage"))).toBeNull();
    unmount();
    monta();
    expect(screen.queryByText(i18n.t("leftPanel.newPage"))).toBeNull();
    fireEvent.click(screen.getByTitle(i18n.t("editor.treeShow")));
    expect(screen.getByText(i18n.t("leftPanel.newPage"))).toBeTruthy();
  });
});
