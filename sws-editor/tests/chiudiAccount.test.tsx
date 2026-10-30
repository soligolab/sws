/** Chiudere l'account da sé (30-10-2026): la password va al server, e solo a
 *  chiusura riuscita si esce. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { ChiudiAccount } from "../src/components/accesso/ChiudiAccount";

afterEach(() => { vi.restoreAllMocks(); });

describe("chiudi l'account", () => {
  it("con la password giusta chiude ed esce", async () => {
    const chiudi = vi.spyOn(api, "chiudiAccount").mockResolvedValue(undefined);
    const onChiuso = vi.fn();
    const { container } = render(<ChiudiAccount onAnnulla={vi.fn()} onChiuso={onChiuso} />);
    const conferma = screen.getByText(i18n.t("accesso.chiudiConferma"), { selector: "button" }) as HTMLButtonElement;
    expect(conferma.disabled).toBe(true);
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "password-lunga" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(onChiuso).toHaveBeenCalled());
    expect(chiudi).toHaveBeenCalledWith("password-lunga");
  });

  it("se il server rifiuta resta aperta e dice perché", async () => {
    vi.spyOn(api, "chiudiAccount").mockRejectedValue(new Error("la password non è corretta"));
    const onChiuso = vi.fn();
    const { container } = render(<ChiudiAccount onAnnulla={vi.fn()} onChiuso={onChiuso} />);
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "sbagliata" } });
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText(/la password non è corretta/);
    expect(onChiuso).not.toHaveBeenCalled();
  });
});
