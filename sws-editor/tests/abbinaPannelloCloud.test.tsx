/** «Abbina un pannello» nell'IDE nel cloud: dal 24-11-2026 nasce anche l'Admin
 *  del dispositivo (utente e password sempre); se il pannello ha già utenti, i
 *  campi chiedono quelli di un suo amministratore; poi riepilogo e Rinomina. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { remoteCloud, abbinaPannelloCloud, pannelloCloud, rinominaPannelloCloud } = vi.hoisted(() => ({
  remoteCloud: vi.fn(),
  abbinaPannelloCloud: vi.fn(),
  pannelloCloud: vi.fn(),
  rinominaPannelloCloud: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, remoteCloud, abbinaPannelloCloud, pannelloCloud, rinominaPannelloCloud } };
});

import "../src/i18n/index";
import { AbbinaPannelloCloud } from "../src/config/schede/AbbinaPannelloCloud";

const CODICE = "7KQ2-M9XD-3HWP-T4BZ";

describe("AbbinaPannelloCloud", () => {
  beforeEach(() => {
    for (const f of [remoteCloud, abbinaPannelloCloud, pannelloCloud, rinominaPannelloCloud]) f.mockReset();
    remoteCloud.mockResolvedValue({ cloud: true });
  });

  it("fuori dal cloud non compare", async () => {
    remoteCloud.mockResolvedValue({ cloud: false });
    render(<AbbinaPannelloCloud onAbbinato={() => {}} />);
    await waitFor(() => expect(remoteCloud).toHaveBeenCalled());
    expect(screen.queryByTestId("abbina-pannello-cloud")).toBeNull();
  });

  it("si abbina col codice e l'Admin del dispositivo, poi riepilogo e Rinomina", async () => {
    const onAbbinato = vi.fn();
    abbinaPannelloCloud.mockResolvedValue({ nome: "tc620-casa-2", azienda: "-", url: "https://sws/dev/tc620-casa-2" });
    pannelloCloud.mockResolvedValue({ nome: "tc620-casa-2", url: "https://sws/dev/tc620-casa-2", collegato: true, senza_utenti: true, versione: "2.13.0", arch: "aarch64" });
    rinominaPannelloCloud.mockResolvedValue({ nome: "tc620-casa" });
    render(<AbbinaPannelloCloud onAbbinato={onAbbinato} />);
    await screen.findByTestId("abbina-pannello-cloud");
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { target: { value: CODICE } });
    fireEvent.change(screen.getByTestId("abbina-cloud-utente"), { target: { value: "admin" } });
    // A short password keeps «Pair» off.
    fireEvent.change(screen.getByTestId("abbina-cloud-password"), { target: { value: "corta" } });
    expect((screen.getByRole("button", { name: /abbina|pair/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("abbina-cloud-password"), { target: { value: "una-password" } });
    fireEvent.keyDown(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { key: "Enter" });
    const riepilogo = await screen.findByTestId("riepilogo-pannello");
    expect(abbinaPannelloCloud).toHaveBeenCalledWith(CODICE, undefined, "admin", "una-password");
    expect(onAbbinato).toHaveBeenCalledWith("https://sws/dev/tc620-casa-2");
    expect(riepilogo.textContent).toContain("2.13.0");
    const campo = screen.getByLabelText(/Rinomina|Rename/);
    fireEvent.change(campo, { target: { value: "tc620-casa" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(rinominaPannelloCloud).toHaveBeenCalledWith("tc620-casa-2", "tc620-casa"));
    await waitFor(() => expect(onAbbinato).toHaveBeenLastCalledWith("https://sws/dev/tc620-casa"));
    // Many steps: under the full suite it went past the default 5 s once.
  }, 15000);

  it("se il pannello ha già utenti, i campi chiedono quelli di un suo amministratore", async () => {
    abbinaPannelloCloud.mockRejectedValueOnce(new Error('API x: 401 — {"error":"abbinamento","detail":"questo pannello ha già utenti: per abbinarlo al cloud servono utente e password di un suo amministratore"}'));
    render(<AbbinaPannelloCloud onAbbinato={() => {}} />);
    await screen.findByTestId("abbina-pannello-cloud");
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { target: { value: CODICE } });
    fireEvent.change(screen.getByTestId("abbina-cloud-utente"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("abbina-cloud-password"), { target: { value: "una-password" } });
    fireEvent.keyDown(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { key: "Enter" });
    expect(await screen.findByText(/servono utente e password/)).toBeTruthy();
  });
});

describe("AbbinaPannelloCloud: il riepilogo aspetta il pannello", () => {
  beforeEach(() => {
    for (const f of [remoteCloud, abbinaPannelloCloud, pannelloCloud, rinominaPannelloCloud]) f.mockReset();
    remoteCloud.mockResolvedValue({ cloud: true });
  });

  // WP630, 02-11-2026: il primo riepilogo arrivava prima che il pannello
  // richiamasse col nome nuovo, e diceva «Connected: no» per sempre.
  it("se il pannello non è ancora collegato riprova, e mostra quando lo è", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      abbinaPannelloCloud.mockResolvedValue({ nome: "wp630-ufficio", azienda: "-" });
      pannelloCloud
        .mockResolvedValueOnce({ nome: "wp630-ufficio", url: "", collegato: false })
        .mockResolvedValue({ nome: "wp630-ufficio", url: "https://sws/dev/wp630-ufficio", collegato: true });
      render(<AbbinaPannelloCloud onAbbinato={() => {}} />);
      const campo = await screen.findByPlaceholderText("XXXX-XXXX-XXXX-XXXX");
      fireEvent.change(campo, { target: { value: CODICE } });
      fireEvent.change(screen.getByTestId("abbina-cloud-utente"), { target: { value: "admin" } });
      fireEvent.change(screen.getByTestId("abbina-cloud-password"), { target: { value: "una-password" } });
      fireEvent.click(screen.getByRole("button", { name: /abbina|pair/i }));
      await waitFor(() => expect(pannelloCloud).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(2100);
      await waitFor(() => expect(pannelloCloud).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
