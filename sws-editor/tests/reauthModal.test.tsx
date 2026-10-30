/** Il modale «Sessione scaduta» (30-10-2026): password o PIN, e chi rientra
 *  nel progetto che ha aperto lui lo ritrova. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, type LoginOk } from "../src/api/client";
import { ReAuthModal } from "../src/components/ReAuthModal";
import { useAppStore } from "../src/store";

afterEach(() => { vi.restoreAllMocks(); });
beforeEach(() => {
  useAppStore.setState({ authUser: "anna@sws.it", reAuthNeeded: true, noActiveProject: false });
});

const OK: LoginOk = { token: "t2", username: "anna@sws.it", role: "Admin", expires_at_ms: 1, must_change_password: false };

function stato(pin: boolean) {
  vi.spyOn(api, "identitaStato").mockResolvedValue({ gestita: true, pin });
}

describe("il modale «Sessione scaduta»", () => {
  it("offre il PIN solo dove la posta c'è", async () => {
    stato(false);
    render(<ReAuthModal />);
    await screen.findByText(i18n.t("accesso.ricordami"));
    expect(screen.queryByText(i18n.t("accesso.conPin"))).toBeNull();
  });

  it("col PIN entra la stessa persona, e il server sa che sta rientrando", async () => {
    stato(true);
    vi.spyOn(api, "chiediPin").mockResolvedValue(undefined);
    const accedi = vi.spyOn(api, "accediConPin").mockResolvedValue({ ...OK, progetto_aperto: true });
    const { container } = render(<ReAuthModal />);
    fireEvent.click(await screen.findByText(i18n.t("accesso.conPin")));
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("anna@sws.it");
    fireEvent.click(screen.getByText(i18n.t("accesso.mandaPin")));
    const pin = await waitFor(() => {
      const el = container.querySelector('input[autocomplete="one-time-code"]');
      if (!el) throw new Error("il campo del PIN non c'è ancora");
      return el as HTMLInputElement;
    });
    fireEvent.change(pin, { target: { value: "abcd-efgh" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(accedi).toHaveBeenCalledWith("anna@sws.it", "abcd-efgh", false, true));
    await waitFor(() => expect(useAppStore.getState().reAuthNeeded).toBe(false));
    expect(useAppStore.getState().noActiveProject).toBe(false);
  });

  it("se il server ha chiuso il progetto si torna all'elenco", async () => {
    stato(false);
    const login = vi.spyOn(api, "login").mockResolvedValue({ ...OK, progetto_aperto: false });
    const { container } = render(<ReAuthModal />);
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "password-lunga" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(login).toHaveBeenCalledWith("anna@sws.it", "password-lunga", false, true));
    await waitFor(() => expect(useAppStore.getState().noActiveProject).toBe(true));
  });
});
