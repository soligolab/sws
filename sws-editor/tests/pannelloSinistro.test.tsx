import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n from "../src/i18n";

// `LeftPanel` chiede il progetto al montaggio: senza mock la chiamata parte
// verso il nulla e il test aspetterebbe un rifiuto che non cambia nulla di ciò
// che qui si verifica.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getProject: vi.fn().mockResolvedValue(null),
    listRecipes: vi.fn().mockResolvedValue([]), listUsers: vi.fn().mockResolvedValue([]) } };
});

import { LeftPanel } from "../src/editor/LeftPanel";
import { useAppStore } from "../src/store";
import { eModificato } from "../src/config/fogliaConfig";

/** Il pannello sinistro è **un albero solo** (25-09-2026): niente colonna di
 *  icone, niente blocco fisso. Pagine, immagini di boot, strumenti, oggetti
 *  della pagina, funzioni, tag e i rami di configurazione, ognuno chiudibile
 *  e ricordato. */
const titolo = (k: string) => i18n.t(`editor.${k}`);

function monta() {
  return render(<LeftPanel />);
}

describe("pannello sinistro — un albero solo", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    useAppStore.setState({ authRole: "Admin", appMode: "edit", configTab: "tags", configFocus: null, elenchiConfig: {}, pendingSections: {}, repoDisponibile: false });
  });

  it("non c'è più la colonna di icone", () => {
    monta();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("tutti i rami stanno nello stesso albero, pagine comprese", () => {
    monta();
    const albero = screen.getByTestId("albero-pannello");
    for (const testo of [titolo("sectionPages"), i18n.t("leftPanel.bootPagesHeading"), i18n.t("leftPanel.strumenti"),
                         i18n.t("config.rami.progetto"), i18n.t("config.rami.istanza")]) {
      expect(albero.textContent).toContain(testo);
    }
    expect(screen.getByTestId("albero-pagine")).toBeTruthy();
  });

  it("le pagine si chiudono come ogni ramo, e lo ricordano", () => {
    const { unmount } = monta();
    expect(screen.getByText(i18n.t("leftPanel.newPage"))).toBeTruthy();
    fireEvent.click(screen.getByText(titolo("sectionPages")));
    expect(screen.queryByText(i18n.t("leftPanel.newPage"))).toBeNull();
    unmount();
    monta();
    expect(screen.queryByText(i18n.t("leftPanel.newPage"))).toBeNull();
  });

  it("l'albero è lo stesso in Configurazione", () => {
    useAppStore.setState({ appMode: "config" });
    monta();
    expect(screen.getByTestId("albero-pagine")).toBeTruthy();
    expect(screen.getByText(i18n.t("leftPanel.strumenti"))).toBeTruthy();
  });

  it("uno strumento cliccato in Configurazione riporta all'editor", () => {
    useAppStore.setState({ appMode: "config" });
    monta();
    fireEvent.click(screen.getAllByTestId(/^strumento-/)[0]);
    expect(useAppStore.getState().appMode).toBe("edit");
  });

  it("una foglia porta in Configurazione, sulla sua scheda", () => {
    monta();
    fireEvent.click(screen.getByTestId("foglia-config-faceplates"));
    expect(useAppStore.getState().appMode).toBe("config");
    expect(useAppStore.getState().configTab).toBe("faceplates");
  });

  it("«Tipi» è una foglia sua", () => {
    monta();
    fireEvent.click(screen.getByTestId("foglia-config-types"));
    expect(useAppStore.getState().configTab).toBe("types");
  });

  /** Il livello in più del 25-09-2026: dentro Istanza, un sotto-ramo «Device»
   *  che tiene insieme Stato, Dispositivi e le schede del runtime. Le foglie
   *  che non stanno in un sotto-ramo (Risorse, Backup) restano dirette e si
   *  disegnano **dopo**. */
  it("le schede del dispositivo stanno in un sotto-ramo, le altre restano dirette", () => {
    monta();
    expect(screen.getByTestId("sottoramo-config-device")).toBeTruthy();
    // Le foglie del sotto-ramo ci sono: Stato, Dispositivi e le tre in cui
    // «Runtime» si è diviso il 25-09-2026.
    for (const id of ["system", "devices", "runtime", "install", "container"]) {
      expect(screen.getByTestId(`foglia-config-${id}`)).toBeTruthy();
    }
    // Risorse e Backup non sono in nessun sotto-ramo.
    expect(screen.getByTestId("foglia-config-resources")).toBeTruthy();
    expect(screen.getByTestId("foglia-config-backups")).toBeTruthy();
  });

  it("chiudendo il sotto-ramo le sue foglie spariscono, le dirette no", () => {
    monta();
    fireEvent.click(screen.getByTestId("sottoramo-config-device"));
    expect(screen.queryByTestId("foglia-config-runtime")).toBeNull();
    expect(screen.getByTestId("foglia-config-resources")).toBeTruthy();
  });

  /** Un sotto-ramo con tutte le foglie nascoste non si disegna: per un
   *  Supervisor «Device» esiste ancora, ma con la sola foglia Stato. */
  it("il sotto-ramo mostra solo le foglie che il ruolo può vedere", () => {
    useAppStore.setState({ authRole: "Supervisor" });
    monta();
    expect(screen.getByTestId("sottoramo-config-device")).toBeTruthy();
    expect(screen.getByTestId("foglia-config-system")).toBeTruthy();
    expect(screen.queryByTestId("foglia-config-devices")).toBeNull();
  });

  /** Q51: gli strumenti di sviluppo esistono solo se il runtime gira da un
   *  checkout del repo. Su un'installazione di un cliente il sotto-ramo non
   *  deve comparire affatto — non basta che la scheda dentro sia vuota. */
  it("il sotto-ramo Sviluppatore non c'è senza il repo", () => {
    monta();
    expect(screen.queryByTestId("sottoramo-config-sviluppatore")).toBeNull();
    expect(screen.queryByTestId("foglia-config-devpackage")).toBeNull();
  });

  it("con il repo il sotto-ramo Sviluppatore compare", () => {
    useAppStore.setState({ repoDisponibile: true });
    monta();
    expect(screen.getByTestId("sottoramo-config-sviluppatore")).toBeTruthy();
    expect(screen.getByTestId("foglia-config-devpackage")).toBeTruthy();
  });

  it("un non-admin non vede le foglie da admin", () => {
    useAppStore.setState({ authRole: "Supervisor" });
    monta();
    expect(screen.getByTestId("foglia-config-tags")).toBeTruthy();
    expect(screen.queryByTestId("foglia-config-users")).toBeNull();
    expect(screen.queryByTestId("foglia-config-runtime")).toBeNull();
  });

  it("chi non può modificare né configurare vede solo i tag", () => {
    useAppStore.setState({ authRole: "Operator" });
    monta();
    expect(screen.queryByTestId("albero-pagine")).toBeNull();
    expect(screen.queryByText(i18n.t("leftPanel.strumenti"))).toBeNull();
    expect(screen.queryByTestId("foglia-config-tags")).toBeNull();
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
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    expect(screen.getByTestId("elemento-config-protocols-plc1")).toBeTruthy();
    expect(screen.getByTestId("elemento-config-protocols-mqtt1")).toBeTruthy();
  });

  it("la bozza pubblicata dalla scheda vince sul progetto", () => {
    useAppStore.getState().pubblicaElencoConfig("protocols", [{ id: "nuova", etichetta: "nuova" }]);
    monta();
    fireEvent.click(screen.getByTestId("expand-config-protocols"));
    expect(screen.getByTestId("elemento-config-protocols-nuova")).toBeTruthy();
    expect(screen.queryByTestId("elemento-config-protocols-plc1")).toBeNull();
  });

  it("un elemento porta alla scheda con quel focus; il primo livello lo toglie", () => {
    monta();
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
    expect(screen.getByTestId("dirty-config-scripts")).toBeTruthy();
    expect(screen.queryByTestId("dirty-config-tags")).toBeNull();
  });

  it("niente modifiche, niente pallini", () => {
    monta();
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
