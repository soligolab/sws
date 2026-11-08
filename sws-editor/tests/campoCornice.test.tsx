/** Il campo Cornice della finestra «Impostazioni progetto» (piano
 *  dell'impostazione iniziale, 08-11-2026): l'unico posto che sceglie la
 *  cornice predefinita. Prende il posto della proposta nel ramo Cornici. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/cornici/predefinita", () => ({ impostaCornicePredefinita: vi.fn(async () => {}) }));

import i18n from "../src/i18n";
import { impostaCornicePredefinita } from "@/cornici/predefinita";
import { CampoCornice } from "../src/cornici/CampoCornice";
import { pagineCornice, idCornice } from "../src/cornici/modello";
import { useAppStore } from "../src/store";
import { api } from "../src/api/client";

beforeAll(async () => { await i18n.changeLanguage("it"); });
beforeEach(() => {
  vi.mocked(impostaCornicePredefinita).mockClear();
  vi.restoreAllMocks();
  useAppStore.setState({
    pages: [{ id: "p1", name: "Home", width: 800, height: 480, objects: [] }] as never,
    currentPageId: "p1",
    project: { meta: { name: "Casa", version: "1" }, page_layout: { size_mode: "fixed", default_width: 1280, default_height: 800 } } as never,
  });
});

describe("il campo Cornice", () => {
  it("una nuova da modello nasce col formato del progetto, si salva prima di diventare la predefinita, e la pagina aperta resta quella", async () => {
    const ordine: string[] = [];
    vi.spyOn(api, "saveCornice").mockImplementation(async () => { ordine.push("file"); });
    vi.mocked(impostaCornicePredefinita).mockImplementation(async () => { ordine.push("predefinita"); });
    render(<CampoCornice />);
    fireEvent.change(screen.getByTestId("campo-cornice-scelta"), { target: { value: "nuova:testata_piede" } });
    await waitFor(() => expect(ordine).toEqual(["file", "predefinita"]));
    const [cornice] = pagineCornice(useAppStore.getState().pages);
    expect(impostaCornicePredefinita).toHaveBeenCalledWith(idCornice(cornice));
    // Il formato del progetto, non gli 800×480 della pagina aperta.
    expect([cornice.width, cornice.height]).toEqual([1280, 800]);
    expect(useAppStore.getState().currentPageId).toBe("p1");
  });

  it("«Nessuna» toglie la predefinita", async () => {
    render(<CampoCornice />);
    fireEvent.change(screen.getByTestId("campo-cornice-scelta"), { target: { value: "" } });
    await waitFor(() => expect(impostaCornicePredefinita).toHaveBeenCalledWith(undefined));
    expect(pagineCornice(useAppStore.getState().pages)).toHaveLength(0);
  });
});
