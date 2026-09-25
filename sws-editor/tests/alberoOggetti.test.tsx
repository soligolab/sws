import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getProject: vi.fn().mockResolvedValue(null),
    listRecipes: vi.fn().mockResolvedValue([]), listUsers: vi.fn().mockResolvedValue([]) } };
});

import i18n from "../src/i18n";
import { LeftPanel } from "../src/editor/LeftPanel";
import { useAppStore } from "../src/store";

/** R3 (25-09-2026): il ramo Oggetti mostra gli oggetti di **tutte** le pagine,
 *  nell'ordine dell'albero delle pagine. Nasce aperta solo la corrente; un
 *  oggetto di un'altra pagina porta a quella pagina; la ricerca filtra l'albero
 *  invece di aprire un elenco a parte. */
const pagina = (id: string, name: string, objects: { id: string; type: string; name?: string; tag?: string }[]) =>
  ({ id, name, width: 800, height: 480, objects, groups: [] });

describe("ramo Oggetti — tutte le pagine", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    localStorage.setItem("sws.pannelli.sinistra.struttura", "1");
    useAppStore.setState({
      authRole: "Admin", appMode: "edit",
      pages: [
        pagina("p1", "Uno", [{ id: "a", type: "rect", name: "caldaia" }]),
        pagina("p2", "Due", [{ id: "b", type: "gauge", name: "pressione" }, { id: "c", type: "led", name: "allarme" }]),
      ] as never,
      currentPageId: "p1",
      project: { page_layout: { page_tree: [{ id: "p2" }, { id: "p1" }] } } as never,
      faceplates: [],
    });
  });

  it("le pagine seguono l'ordine dell'albero, e solo la corrente è aperta", () => {
    render(<LeftPanel />);
    const righe = screen.getAllByTestId(/^objects-page-/).map((e) => e.dataset.testid);
    expect(righe).toEqual(["objects-page-p2", "objects-page-p1"]);
    expect(screen.queryByTestId("object-other-page-b")).toBeNull();
    fireEvent.click(screen.getByTestId("objects-page-p2"));
    expect(screen.getByTestId("object-other-page-b")).toBeTruthy();
  });

  it("un oggetto di un'altra pagina porta a quella pagina e lo seleziona", () => {
    render(<LeftPanel />);
    fireEvent.click(screen.getByTestId("objects-page-p2"));
    fireEvent.click(screen.getByTestId("object-other-page-c"));
    expect(useAppStore.getState().currentPageId).toBe("p2");
    expect(useAppStore.getState().selectedObjectId).toBe("c");
  });

  it("la ricerca filtra l'albero: restano le pagine con risultati, aperte", () => {
    render(<LeftPanel />);
    fireEvent.change(screen.getByPlaceholderText(i18n.t("editor.searchAllPlaceholder")), { target: { value: "pressione" } });
    expect(screen.queryByTestId("objects-page-p1")).toBeNull();
    expect(screen.getByTestId("objects-page-p2")).toBeTruthy();
    expect(screen.getByTestId("object-other-page-b")).toBeTruthy();
    expect(screen.queryByTestId("object-other-page-c")).toBeNull();
  });
});
