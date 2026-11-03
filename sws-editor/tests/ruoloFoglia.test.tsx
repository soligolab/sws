/** Il ruolo di scrittura di una foglia (03-11-2026, `pompa1.comando` nel
 *  template OpenPLC): sta nel membro del tipo. In Tag la riga della foglia lo
 *  dice, e il clic apre il tipo su quel membro con le impostazioni avanzate. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";
import { TagsTab } from "../src/config/schede/TagsTab";
import { TipiTab } from "../src/config/schede/TipiTab";

const progetto = {
  meta: { name: "impianto", version: "0.1.0" },
  tags: [{ id: "pompa1", type_ref: "pompa" }, { id: "linea", type_ref: "linea" }],
  types: [
    { id: "pompa", members: [
      { name: "comando", data_type: "bool", write_min_role: "Viewer" },
      { name: "portata", data_type: "i16" },
    ] },
    { id: "linea", members: [{ name: "p", type_ref: "pompa" }] },
  ],
  sources: [], alarms: [], functions: [],
} as never;

beforeEach(() => {
  useAppStore.setState({ project: progetto, tagValues: {}, configTab: "tags", configFocus: null, authRole: "Admin" });
});

describe("il ruolo di scrittura nelle foglie", () => {
  it("si legge nella riga, e il clic apre il tipo su quel membro", () => {
    render(<TagsTab scheda="tags" />);
    fireEvent.click(screen.getByTestId("espandi-pompa1"));
    expect(screen.getByTestId("ruolo-pompa1.comando").textContent).toBe(i18n.t("cfg.tagFogliaScrive", { ruolo: "Viewer" }));
    expect(screen.getByTestId("ruolo-pompa1.portata").textContent).toBe(i18n.t("cfg.tagFogliaScrivePredefinito"));
    fireEvent.click(screen.getByTestId("ruolo-pompa1.comando"));
    expect(useAppStore.getState().configTab).toBe("types");
    expect(useAppStore.getState().configFocus).toBe("pompa#comando");
  });

  it("in una struttura annidata apre il tipo che contiene il membro, non quello della radice", () => {
    render(<TagsTab scheda="tags" />);
    fireEvent.click(screen.getByTestId("espandi-linea"));
    fireEvent.click(screen.getByTestId("ruolo-linea.p.comando"));
    expect(useAppStore.getState().configFocus).toBe("pompa#comando");
  });

  it("Tipi, aperto su `tipo#membro`, mostra le impostazioni avanzate di quel membro", () => {
    useAppStore.setState({ configTab: "types", configFocus: "pompa#comando" });
    render(<TipiTab incorporata />);
    const ruolo = screen.getByText(i18n.t("tipiTab.ruoloScrittura"));
    expect((ruolo.parentElement?.querySelector("select") as HTMLSelectElement).value).toBe("Viewer");
  });
});
