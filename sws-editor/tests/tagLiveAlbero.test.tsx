import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api,
    getProject: vi.fn().mockResolvedValue(null),
    listRecipes: vi.fn().mockResolvedValue([]),
    listUsers: vi.fn().mockResolvedValue([]),
    buildStato: vi.fn().mockResolvedValue({ repo: false }) } };
});

import { AlberoTagLive, prefixOf } from "../src/editor/AlberoTagLive";
import { TagsTab } from "../src/config/schede/TagsTab";
import { useAppStore } from "../src/store";

/** Le variabili live sotto «Progetto › Variabili» (25-09-2026). Il giro che
 *  questi test tengono in piedi è quello che il maintainer ha provato per
 *  primo: clic nell'albero → la scheda si apre sulla variabile giusta. */
const PROGETTO = {
  meta: { name: "p", version: "1" },
  tags: [
    // Un id piatto **con un punto dentro**: è il caso che si era rotto,
    // perché sembrava il percorso di una foglia.
    { id: "host.Temeprature1", data_type: "f64" },
    { id: "radio_option", data_type: "i16" },
  ],
} as never;

describe("albero delle variabili live", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    // jsdom non ha scrollIntoView, che la scheda usa per portare in vista la
    // riga scelta.
    Element.prototype.scrollIntoView = vi.fn();
    useAppStore.setState({
      project: PROGETTO, pages: [], faceplates: [],
      configTab: "tags", configFocus: null, appMode: "edit", authRole: "Admin",
    });
  });

  it("il clic su una variabile porta il focus sulla scheda", () => {
    render(<AlberoTagLive />);
    fireEvent.click(screen.getByText("host.Temeprature1"));
    expect(useAppStore.getState().configTab).toBe("tags");
    expect(useAppStore.getState().configFocus).toBe("host.Temeprature1");
  });

  it("groups by the part before the dot, the rest under «Others» (24-11-2026)", () => {
    render(<AlberoTagLive />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "prefix" } });
    // The group «host» holds host.Temeprature1; radio_option has no dot.
    expect(screen.getByText("host (1)")).toBeTruthy();
    expect(screen.getByText(/^(Altri|Other) \(1\)$/)).toBeTruthy();
    expect(prefixOf("window.kitchen_left")).toBe("window");
    expect(prefixOf("plain")).toBeNull();
    expect(prefixOf(".odd")).toBeNull();
  });

  it("chi non può aprire la scheda non cambia niente cliccando", () => {
    render(<AlberoTagLive puoAprire={false} />);
    fireEvent.click(screen.getByText("radio_option"));
    expect(useAppStore.getState().configFocus).toBeNull();
  });

  it("la scheda evidenzia la riga scelta, punto nell'id compreso", () => {
    useAppStore.setState({ configFocus: "host.Temeprature1", appMode: "config" });
    render(<TagsTab scheda="tags" />);
    const riga = screen.getByDisplayValue("host.Temeprature1").closest("tr")!;
    expect(riga.getAttribute("style") ?? "").toContain("outline");
    // E l'altra no: l'evidenziazione è una sola.
    const altra = screen.getByDisplayValue("radio_option").closest("tr")!;
    expect(altra.getAttribute("style") ?? "").not.toContain("outline");
  });
});
