import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

// `vi.mock` è sollevato in cima al file, quindi non può leggere variabili
// dichiarate qui sopra: `vi.hoisted` è il modo di crearle prima di lui.
const { statoAggiornamento, avviaAggiornamento } = vi.hoisted(() => ({
  statoAggiornamento: vi.fn(),
  avviaAggiornamento: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, statoAggiornamento, avviaAggiornamento } };
});

import i18n from "../src/i18n";
import { AvvisoAggiornamento } from "../src/runtime-view/AvvisoAggiornamento";
import { useAppStore } from "../src/store";

/** L'avviso di versione nuova sullo schermo del pannello (decisioni 41 e 44).
 *  Le regole di comparsa sono la parte che si sbaglia in silenzio: un avviso
 *  che non compare non lo segnala nessuno. */
const NUOVA = {
  versione: "2.12.0-rc.2", immagine: "ghcr.io/x:rc-arm64", canale: "prova" as const,
  disponibile: "2.12.0-rc.3", errore: null,
  novita: [{ versione: "2.12.0-rc.3", testo: "cose nuove", compatibilita: "i progetti vanno riaperti" }],
};

describe("avviso di aggiornamento sul pannello", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom senza storage */ }
    statoAggiornamento.mockReset().mockResolvedValue(NUOVA);
    avviaAggiornamento.mockClear();
    useAppStore.setState({ progettoHaUtenti: false });
  });

  it("senza utenti e con una versione nuova, compare", async () => {
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // Gli avvisi di compatibilità si vedono senza doverli aprire.
    expect(screen.getByText(/progetti vanno riaperti/)).toBeTruthy();
  });

  /** Con utenti definiti l'aggiornamento è dell'Admin, dall'IDE: sullo
   *  schermo non compare niente — e non si chiede nemmeno al registry. */
  it("con utenti definiti non compare, e non interroga il registry", async () => {
    useAppStore.setState({ progettoHaUtenti: true });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("senza una versione nuova non compare", async () => {
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: null, novita: [] });
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«Più tardi» chiude ma non ricorda", async () => {
    const { unmount } = render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(i18n.t("aggiornamentoPannello.piuTardi")));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("«Ignora questa versione» ricorda, ma solo quella versione", async () => {
    const { unmount } = render(<AvvisoAggiornamento />);
    fireEvent.click(await screen.findByText(i18n.t("aggiornamentoPannello.ignora")));
    unmount();
    render(<AvvisoAggiornamento />);
    await waitFor(() => expect(statoAggiornamento).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();

    // Ma se ne esce una ancora più nuova, l'avviso torna.
    statoAggiornamento.mockResolvedValue({ ...NUOVA, disponibile: "2.12.0-rc.4" });
    render(<AvvisoAggiornamento />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
