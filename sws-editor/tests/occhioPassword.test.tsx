/** L'occhio sui campi password dove la password si scrive davvero (09-11-2026,
 *  piano docs/archive/2026-11-09-occhio-sulle-password.md): il login — lo stesso
 *  componente sta davanti al pannello, per l'aggiornamento — e la password di
 *  un comando critico, chiesta con `chiedi({ password: true })`.
 *
 *  Sul codice senza occhio queste prove sono rosse per «nessun bottone», non
 *  per un import mancante: è la prova che guardano il comportamento. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { LoginScreen } from "../src/components/LoginScreen";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { chiedi, svuotaCoda } from "../src/finestraAvviso/finestraAvviso";

afterEach(async () => {
  await act(async () => { svuotaCoda(); });
  fireEvent.keyUp(window, { key: "Enter" });
  cleanup();
  vi.restoreAllMocks();
});

const occhio = () => screen.getByRole("button", { name: i18n.t("campoPassword.mostra") });

describe("l'occhio nel login", () => {
  it("c'è, parte nascosto, mostra al tocco e Invio entra ancora", async () => {
    vi.spyOn(api, "identitaStato").mockResolvedValue({ gestita: false, gateway: false });
    const login = vi.spyOn(api, "login").mockRejectedValue(new Error("no"));
    const { container } = render(<LoginScreen />);
    const campo = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
    expect(campo.type).toBe("password");
    fireEvent.click(occhio());
    expect(campo.type).toBe("text");
    fireEvent.change(container.querySelector('input[autocomplete="username"]')!, { target: { value: "mario" } });
    fireEvent.change(campo, { target: { value: "segreta" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(login).toHaveBeenCalled();
    // Inviato il modulo, quello che c'era da controllare è partito: se il
    // login resta a schermo (fallito), la password non resta in chiaro.
    expect(campo.type).toBe("password");
  });
});

describe("l'occhio nella password di un comando critico", () => {
  it("chiedi con password: l'occhio mostra, Invio conferma, la volta dopo riparte nascosto", async () => {
    render(<FinestraAvviso />);
    let esito!: Promise<string | null>;
    await act(async () => { esito = chiedi({ testo: "Password", password: true }); });
    const campo = screen.getByTestId("finestra-avviso-campo") as HTMLInputElement;
    expect(campo.type).toBe("password");
    fireEvent.click(occhio());
    expect(campo.type).toBe("text");
    fireEvent.change(campo, { target: { value: "segreta" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await expect(esito).resolves.toBe("segreta");

    await act(async () => { esito = chiedi({ testo: "Password", password: true }); });
    expect((screen.getByTestId("finestra-avviso-campo") as HTMLInputElement).type).toBe("password");
    expect(occhio().title).toBe(i18n.t("campoPassword.mostra"));
  });

  it("chiedi senza password non ha l'occhio", async () => {
    render(<FinestraAvviso />);
    await act(async () => { void chiedi({ testo: "Nome" }); });
    expect((screen.getByTestId("finestra-avviso-campo") as HTMLInputElement).type).toBe("text");
    expect(screen.queryByRole("button", { name: i18n.t("campoPassword.mostra") })).toBeNull();
  });
});
