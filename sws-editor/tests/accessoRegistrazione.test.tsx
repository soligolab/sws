/** Le strade per entrare (30-10-2026, ramo C di
 *  docs/plans/2026-10-26-aprire-sws-soligo-net.md): password con «ricordami»,
 *  PIN per posta, registrazione con il codice di conferma. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api, DaConfermareError, type LoginOk } from "../src/api/client";
import { LoginScreen } from "../src/components/LoginScreen";

afterEach(() => { vi.restoreAllMocks(); });

const OK: LoginOk = { token: "t", username: "mario@tizio.it", role: "Admin", expires_at_ms: null, must_change_password: false };

function stato(extra: { pin?: boolean; registrazione?: boolean } = {}) {
  vi.spyOn(api, "identitaStato").mockResolvedValue({ gestita: true, gateway: true, ...extra });
}

const campo = (container: HTMLElement, sel: string) => container.querySelector(sel) as HTMLInputElement;

describe("la schermata d'accesso", () => {
  it("senza posta né registrazione resta quella di sempre", async () => {
    stato();
    render(<LoginScreen />);
    await screen.findByText(i18n.t("accesso.ricordami"));
    expect(screen.queryByText(i18n.t("accesso.conPin"))).toBeNull();
    expect(screen.queryByText(i18n.t("accesso.creaAccount"))).toBeNull();
  });

  it("«ricordami» arriva al server", async () => {
    stato();
    const login = vi.spyOn(api, "login").mockResolvedValue(OK);
    const { container } = render(<LoginScreen />);
    fireEvent.click(await screen.findByLabelText(i18n.t("accesso.ricordami")));
    fireEvent.change(campo(container, 'input[autocomplete="email"]'), { target: { value: "mario@tizio.it" } });
    fireEvent.change(campo(container, 'input[autocomplete="current-password"]'), { target: { value: "password-lunga" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(login).toHaveBeenCalledWith("mario@tizio.it", "password-lunga", true));
  });

  it("il PIN: prima l'indirizzo, poi il codice", async () => {
    stato({ pin: true });
    const chiedi = vi.spyOn(api, "chiediPin").mockResolvedValue(undefined);
    const accedi = vi.spyOn(api, "accediConPin").mockResolvedValue(OK);
    const { container } = render(<LoginScreen />);
    fireEvent.click(await screen.findByText(i18n.t("accesso.conPin")));
    fireEvent.change(campo(container, 'input[type="email"]'), { target: { value: "mario@tizio.it" } });
    fireEvent.click(screen.getByText(i18n.t("accesso.mandaPin")));
    await waitFor(() => expect(chiedi).toHaveBeenCalledWith("mario@tizio.it", i18n.language));
    const pin = await waitFor(() => campo(container, 'input[autocomplete="one-time-code"]'));
    fireEvent.change(pin, { target: { value: "abcd efgh" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(accedi).toHaveBeenCalledWith("mario@tizio.it", "abcd efgh", false, false));
  });

  it("la registrazione vuole le due caselle e la password ripetuta", async () => {
    stato({ registrazione: true });
    const registrati = vi.spyOn(api, "registrati").mockResolvedValue(undefined);
    const { container } = render(<LoginScreen />);
    fireEvent.click(await screen.findByText(i18n.t("accesso.creaAccount")));
    fireEvent.change(campo(container, 'input[type="email"]'), { target: { value: "mario@tizio.it" } });
    const [p1, p2] = container.querySelectorAll('input[autocomplete="new-password"]');
    fireEvent.change(p1, { target: { value: "password-lunga" } });
    fireEvent.change(p2, { target: { value: "password-lunga" } });
    const invia = screen.getByText(i18n.t("accesso.registrati")) as HTMLButtonElement;
    const [condizioni, clausole] = container.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(condizioni);
    expect(invia.disabled).toBe(true);
    fireEvent.click(clausole);
    expect(invia.disabled).toBe(false);
    fireEvent.click(invia);
    await waitFor(() => expect(registrati).toHaveBeenCalledWith("mario@tizio.it", "password-lunga", true, true, i18n.language));
    await screen.findByText(i18n.t("accesso.confermaIndirizzo"));
  });

  it("password giusta ma indirizzo da confermare: si chiede il codice", async () => {
    stato({ registrazione: true });
    vi.spyOn(api, "login").mockRejectedValue(new DaConfermareError());
    const conferma = vi.spyOn(api, "confermaRegistrazione").mockResolvedValue(OK);
    const { container } = render(<LoginScreen />);
    await screen.findByText(i18n.t("accesso.creaAccount"));
    fireEvent.change(campo(container, 'input[autocomplete="email"]'), { target: { value: "mario@tizio.it" } });
    fireEvent.change(campo(container, 'input[autocomplete="current-password"]'), { target: { value: "password-lunga" } });
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText(i18n.t("accesso.confermaIndirizzo"));
    fireEvent.change(campo(container, 'input[autocomplete="one-time-code"]'), { target: { value: "ABCD-EFGH" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(conferma).toHaveBeenCalledWith("mario@tizio.it", "ABCD-EFGH"));
  });
});
