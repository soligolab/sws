/** La proposta di una cornice alla prima pagina (piano delle cornici; programma delle
 *  funzioni utente, gruppo 1, 18-10-2026): un modello crea la cornice e la rende la
 *  predefinita del progetto; «No, grazie» la toglie e se lo ricorda. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/cornici/predefinita", () => ({ impostaCornicePredefinita: vi.fn(async () => {}) }));

import i18n from "../src/i18n";
import { impostaCornicePredefinita } from "@/cornici/predefinita";
import { PropostaCornice } from "../src/cornici/PropostaCornice";
import { pagineCornice, idCornice } from "../src/cornici/modello";
import { useAppStore } from "../src/store";

beforeAll(async () => { await i18n.changeLanguage("it"); });
beforeEach(() => {
  localStorage.clear();
  vi.mocked(impostaCornicePredefinita).mockClear();
  useAppStore.setState({
    pages: [{ id: "p1", name: "Home", width: 1280, height: 800, objects: [] }] as never,
    currentPageId: "p1",
  });
});

describe("proposta di una cornice", () => {
  it("un modello crea la cornice e la rende la predefinita", async () => {
    render(<PropostaCornice progetto="Casa" />);
    fireEvent.click(screen.getByTestId("proposta-cornice-testata_piede"));
    const cornici = pagineCornice(useAppStore.getState().pages);
    expect(cornici).toHaveLength(1);
    await waitFor(() => expect(impostaCornicePredefinita).toHaveBeenCalledWith(idCornice(cornici[0])));
  });

  it("«No, grazie» la nasconde e se lo ricorda per quel progetto", () => {
    const { unmount } = render(<PropostaCornice progetto="Casa" />);
    fireEvent.click(screen.getByTestId("proposta-cornice-no"));
    expect(screen.queryByTestId("proposta-cornice")).toBeNull();
    unmount();
    render(<PropostaCornice progetto="Casa" />);
    expect(screen.queryByTestId("proposta-cornice")).toBeNull();
    // Un altro progetto la vede ancora.
    render(<PropostaCornice progetto="Altro" />);
    expect(screen.getByTestId("proposta-cornice")).toBeTruthy();
    expect(pagineCornice(useAppStore.getState().pages)).toHaveLength(0);
  });
});
