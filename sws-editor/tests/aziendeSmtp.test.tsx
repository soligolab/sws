/** La posta dell'azienda, in console (10-11-2026).
 *
 *  Il confine si sposta di proposito: stato, marchio e quote restano della
 *  piattaforma, la posta la cambia anche chi amministra l'azienda (decisione
 *  del maintainer). Qui si guarda cosa parte nel PATCH, perché è il server a
 *  rispondere 403 a un campo riservato: un corpo con un campo di troppo è un
 *  salvataggio che non riesce.
 *
 *  Nel catalogo di prova `t()` torna la chiave. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { amministrazioneAziende, amministrazioneMarchi, amministrazioneModificaAzienda, amministrazioneProvaSmtpAzienda } =
  vi.hoisted(() => ({
    amministrazioneAziende: vi.fn(),
    amministrazioneMarchi: vi.fn().mockResolvedValue([]),
    amministrazioneModificaAzienda: vi.fn().mockResolvedValue(undefined),
    amministrazioneProvaSmtpAzienda: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      amministrazioneAziende,
      amministrazioneMarchi,
      amministrazioneModificaAzienda,
      amministrazioneProvaSmtpAzienda,
    },
  };
});

import { Aziende } from "../src/console/Aziende";

const azienda = (extra: Record<string, unknown> = {}) => ({
  id: 7, nome: "Acme", stato: "in_prova", marchio: null, versione_predefinita: null,
  implicita: false, max_progetti_aperti: null, max_progetti_totali: null,
  max_pannelli: null, max_byte: null, creata_ms: 0,
  smtp_host: null, smtp_porta: null, smtp_da: null, smtp_utente: null,
  smtp_password_impostata: false, smtp_starttls: null,
  ...extra,
});

const corpoSalvato = () => amministrazioneModificaAzienda.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  amministrazioneModificaAzienda.mockClear();
  amministrazioneProvaSmtpAzienda.mockClear();
});

describe("Console → Aziende: la posta dell'azienda", () => {
  it("chi amministra l'azienda la può scrivere, lo stato no", async () => {
    amministrazioneAziende.mockResolvedValue([azienda()]);
    const { container } = render(<Aziende piattaforma={false} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    expect((screen.getByTestId("smtp-host") as HTMLInputElement).disabled).toBe(false);
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
  });

  it("al Salva manda la posta e non i campi della piattaforma", async () => {
    amministrazioneAziende.mockResolvedValue([azienda()]);
    render(<Aziende piattaforma={false} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    fireEvent.change(screen.getByTestId("smtp-host"), { target: { value: "mail.acme.it" } });
    fireEvent.change(screen.getByTestId("smtp-da"), { target: { value: "allarmi@acme.it" } });
    fireEvent.click(screen.getByText("console.aziende.salva"));
    await waitFor(() => expect(amministrazioneModificaAzienda).toHaveBeenCalled());
    const corpo = corpoSalvato();
    expect(corpo.smtp_host).toBe("mail.acme.it");
    expect(corpo.smtp_da).toBe("allarmi@acme.it");
    expect(corpo.smtp_password).toBeNull();
    for (const riservato of ["stato", "marchio", "versione_predefinita", "max_byte", "max_progetti_aperti", "max_progetti_totali"]) {
      expect(corpo).not.toHaveProperty(riservato);
    }
  });

  it("la password salvata resta il segnaposto e non parte; svuotata, parte null", async () => {
    amministrazioneAziende.mockResolvedValue([azienda({ smtp_host: "mail.acme.it", smtp_da: "a@acme.it", smtp_password_impostata: true })]);
    render(<Aziende piattaforma={false} />);
    await waitFor(() => expect(screen.getByDisplayValue("********")).toBeTruthy());

    fireEvent.change(screen.getByTestId("smtp-host"), { target: { value: "altro.acme.it" } });
    fireEvent.click(screen.getByText("console.aziende.salva"));
    await waitFor(() => expect(amministrazioneModificaAzienda).toHaveBeenCalledTimes(1));
    expect(corpoSalvato()).not.toHaveProperty("smtp_password");
    expect(corpoSalvato().smtp_host).toBe("altro.acme.it");

    fireEvent.change(screen.getByDisplayValue("********"), { target: { value: "" } });
    fireEvent.click(screen.getByText("console.aziende.salva"));
    await waitFor(() => expect(amministrazioneModificaAzienda).toHaveBeenCalledTimes(2));
    expect(corpoSalvato().smtp_password).toBeNull();
  });

  it("la piattaforma manda quote e posta insieme", async () => {
    amministrazioneAziende.mockResolvedValue([azienda()]);
    render(<Aziende piattaforma={true} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    fireEvent.change(screen.getByTestId("smtp-host"), { target: { value: "mail.acme.it" } });
    fireEvent.click(screen.getByText("console.aziende.salva"));
    await waitFor(() => expect(amministrazioneModificaAzienda).toHaveBeenCalled());
    expect(corpoSalvato()).toHaveProperty("stato");
    expect(corpoSalvato()).toHaveProperty("max_byte");
    expect(corpoSalvato().smtp_host).toBe("mail.acme.it");
  });

  it("senza modifiche alla posta il PATCH non la tocca", async () => {
    amministrazioneAziende.mockResolvedValue([azienda({ smtp_host: "mail.acme.it", smtp_da: "a@acme.it" })]);
    render(<Aziende piattaforma={true} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "Acme Srl" } });
    fireEvent.click(screen.getByText("console.aziende.salva"));
    await waitFor(() => expect(amministrazioneModificaAzienda).toHaveBeenCalled());
    expect(corpoSalvato()).not.toHaveProperty("smtp_host");
  });

  it("la prova si accende solo con una posta salvata e la scheda pulita", async () => {
    amministrazioneAziende.mockResolvedValue([azienda({ smtp_host: "mail.acme.it", smtp_da: "a@acme.it" })]);
    render(<Aziende piattaforma={false} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    const indirizzo = screen.getByPlaceholderText("console.posta.indirizzo");
    fireEvent.change(indirizzo, { target: { value: "anna@acme.it" } });
    const invia = screen.getByText("console.posta.invia") as HTMLButtonElement;
    expect(invia.disabled).toBe(false);

    // Con una modifica non salvata la prova userebbe la posta vecchia: spenta.
    fireEvent.change(screen.getByTestId("smtp-host"), { target: { value: "nuovo.acme.it" } });
    expect(invia.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("smtp-host"), { target: { value: "mail.acme.it" } });
    expect(invia.disabled).toBe(false);

    fireEvent.click(invia);
    await waitFor(() => expect(amministrazioneProvaSmtpAzienda).toHaveBeenCalledWith(7, "anna@acme.it"));
  });

  it("un'azienda senza posta non si prova", async () => {
    amministrazioneAziende.mockResolvedValue([azienda()]);
    render(<Aziende piattaforma={false} />);
    await waitFor(() => expect(screen.getByTestId("smtp-host")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("console.posta.indirizzo"), { target: { value: "anna@acme.it" } });
    expect((screen.getByText("console.posta.invia") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("console.aziende.postaNessuna")).toBeTruthy();
  });
});
