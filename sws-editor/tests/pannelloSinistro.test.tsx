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
import { useAppStore } from "../src/store";
import { eModificato } from "../src/config/fogliaConfig";

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
  return render(<LeftPanel />);
}

/** I pulsanti della barra, nell'ordine in cui stanno sullo schermo. */
function icone() {
  return screen.getAllByRole("tab");
}

describe("pannello sinistro — albero delle pagine fisso, una vista per volta sotto", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    // Dal 24-09-2026 il pannello guarda ruolo e modalità: l'albero delle pagine
    // c'è per chi può modificare, la vista ⚙ per chi può configurare.
    useAppStore.setState({ authRole: "Admin", appMode: "edit", configTab: "tags" });
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
    expect(screen.queryByText(titolo("sectionConfig"))).toBeNull();
  });

  it("la barra ha una voce per vista (senza «Pagine»), e una sola risulta scelta", () => {
    monta();
    const scelte = icone().filter((b) => b.getAttribute("aria-selected") === "true");
    expect(icone()).toHaveLength(5); // palette, struttura, tag, funzioni, ⚙
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
    fireEvent.click(icone()[4]); // ⚙ Configurazione
    expect(localStorage.getItem(CHIAVE)).toBe("config");
    unmount();
    monta();
    expect(screen.getByText(titolo("sectionConfig"))).toBeTruthy();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
  });

  it("una vista memorizzata che non esiste più (anche «pagine», ora fissa) non lascia il pannello vuoto", () => {
    // Il caso si presenta togliendo o rinominando una vista: chi aveva
    // memorizzata quella vecchia deve ritrovarsi sulla palette, non sul nulla.
    // «sorgenti» è sparita il 24-09-2026, sostituita dal ramo Progetto di ⚙.
    for (const vecchia of ["cronologia", "pagine", "sorgenti"]) {
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

describe("pannello sinistro — la vista ⚙ della Configurazione (24-09-2026)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({ authRole: "Admin", appMode: "edit", configTab: "tags" });
  });

  it("una foglia porta in Configurazione, sulla sua scheda", () => {
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("foglia-config-faceplates"));
    expect(useAppStore.getState().appMode).toBe("config");
    expect(useAppStore.getState().configTab).toBe("faceplates");
  });

  it("«Tipi» è una foglia sua, sotto Progetto accanto a Variabili", () => {
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("foglia-config-types"));
    expect(useAppStore.getState().configTab).toBe("types");
  });

  it("in Configurazione la barra mostra solo ⚙, e la vista scelta prima resta memorizzata", () => {
    localStorage.setItem(CHIAVE, "struttura");
    useAppStore.setState({ appMode: "config" });
    monta();
    expect(icone()).toHaveLength(1);
    expect(screen.getByText(titolo("sectionConfig"))).toBeTruthy();
    expect(localStorage.getItem(CHIAVE)).toBe("struttura");
  });

  it("un non-admin non vede le foglie da admin", () => {
    useAppStore.setState({ authRole: "Supervisor" });
    monta();
    fireEvent.click(icone()[icone().length - 1]);
    expect(screen.getByTestId("foglia-config-tags")).toBeTruthy();
    expect(screen.queryByTestId("foglia-config-users")).toBeNull();
    expect(screen.queryByTestId("foglia-config-runtime")).toBeNull();
  });

  it("chi non può configurare non ha la vista ⚙", () => {
    useAppStore.setState({ authRole: "Operator" });
    monta();
    expect(screen.queryByText("⚙")).toBeNull();
  });
});

describe("pannello sinistro — le foglie di secondo livello (24-09-2026)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({
      authRole: "Admin", appMode: "edit", configTab: "tags", configFocus: null,
      elenchiConfig: {},
      project: { sources: [{ id: "plc1" }, { id: "mqtt1" }] } as never,
    });
  });

  it("senza la scheda mai aperta, le sorgenti vengono dal progetto", () => {
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    expect(screen.getByTestId("elemento-config-protocols-plc1")).toBeTruthy();
    expect(screen.getByTestId("elemento-config-protocols-mqtt1")).toBeTruthy();
  });

  it("la bozza pubblicata dalla scheda vince sul progetto", () => {
    useAppStore.getState().pubblicaElencoConfig("protocols", [{ id: "nuova", etichetta: "nuova" }]);
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    expect(screen.getByTestId("elemento-config-protocols-nuova")).toBeTruthy();
    expect(screen.queryByTestId("elemento-config-protocols-plc1")).toBeNull();
  });

  it("un elemento porta alla scheda con quel focus; il primo livello lo toglie", () => {
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    fireEvent.click(screen.getByTestId("elemento-config-protocols-mqtt1"));
    expect(useAppStore.getState()).toMatchObject({ appMode: "config", configTab: "protocols", configFocus: "mqtt1" });
    fireEvent.click(screen.getByTestId("foglia-config-protocols"));
    expect(useAppStore.getState().configFocus).toBeNull();
  });

  it("una pubblicazione identica non cambia lo store (niente ridisegni a ogni tasto)", () => {
    const pubblica = useAppStore.getState().pubblicaElencoConfig;
    pubblica("scripts", [{ id: "a", etichetta: "a" }]);
    const prima = useAppStore.getState().elenchiConfig;
    pubblica("scripts", [{ id: "a", etichetta: "a" }]);
    expect(useAppStore.getState().elenchiConfig).toBe(prima);
  });
});

describe("pannello sinistro — i pallini «modificato» (25-09-2026)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({
      authRole: "Admin", appMode: "edit", configTab: "tags", configFocus: null,
      elenchiConfig: {}, pendingSections: {},
      project: { sources: [{ id: "plc1" }, { id: "mqtt1" }] } as never,
    });
  });

  it("un elemento modificato porta il pallino, e con lui la sua scheda e il suo ramo", () => {
    useAppStore.getState().pubblicaElencoConfig("protocols", [
      { id: "plc1", etichetta: "plc1", modificato: true },
      { id: "mqtt1", etichetta: "mqtt1" },
    ]);
    monta();
    fireEvent.click(icone()[4]);
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    expect(screen.getByTestId("dirty-config-protocols-plc1")).toBeTruthy();
    expect(screen.queryByTestId("dirty-config-protocols-mqtt1")).toBeNull();
    expect(screen.getByTestId("dirty-config-protocols")).toBeTruthy();
    expect(screen.getByTestId("dirty-ramo-progetto")).toBeTruthy();
    expect(screen.queryByTestId("dirty-ramo-istanza")).toBeNull();
  });

  it("una scheda senza elementi prende il pallino dalla sua sezione pendente", () => {
    useAppStore.setState({ pendingSections: { global_scripts: async () => {} } });
    monta();
    fireEvent.click(icone()[4]);
    expect(screen.getByTestId("dirty-config-scripts")).toBeTruthy();
    expect(screen.queryByTestId("dirty-config-tags")).toBeNull();
  });

  it("niente modifiche, niente pallini", () => {
    monta();
    fireEvent.click(icone()[4]);
    expect(screen.queryAllByTestId(/^dirty-/)).toHaveLength(0);
  });
});

describe("eModificato", () => {
  const salvato = { id: "a", x: 1 };
  it("lo stesso oggetto non è modificato", () => expect(eModificato([salvato], salvato)).toBe(false));
  it("una copia uguale non è modificata", () => expect(eModificato([salvato], { id: "a", x: 1 })).toBe(false));
  it("un valore diverso sì", () => expect(eModificato([salvato], { id: "a", x: 2 })).toBe(true));
  it("un elemento nuovo, o rinominato, sì", () => expect(eModificato([salvato], { id: "b", x: 1 })).toBe(true));
});

describe("pannello sinistro — pagine e immagini di boot nell'albero ⚙ (25-09-2026)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({ authRole: "Admin", appMode: "config", configTab: "tags", configFocus: null, elenchiConfig: {} });
  });

  it("in Configurazione il blocco fisso sparisce, e pagine e boot sono rami dell'albero", () => {
    monta();
    expect(screen.queryByTestId("albero-pagine")).toBeNull();
    expect(screen.getByText(titolo("sectionPages"))).toBeTruthy();
    expect(screen.getByText(i18n.t("leftPanel.bootPagesHeading"))).toBeTruthy();
    expect(screen.getByText(i18n.t("leftPanel.newPage"))).toBeTruthy();
  });

  it("nell'editor il blocco fisso resta in cima, e ⚙ non ripete le pagine", () => {
    useAppStore.setState({ appMode: "edit" });
    monta();
    fireEvent.click(icone()[4]);
    expect(screen.getByTestId("albero-pagine")).toBeTruthy();
    expect(screen.getAllByText(titolo("sectionPages"))).toHaveLength(1);
  });
});

