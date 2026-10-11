/** «Abbina un pannello» nell'IDE nel cloud (fetta E, 11-10-2026): niente utente
 *  da creare, credenziali solo se il pannello ne ha già, poi riepilogo e Rinomina. */
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

  it("si abbina col solo codice, poi riepilogo e Rinomina", async () => {
    const onAbbinato = vi.fn();
    abbinaPannelloCloud.mockResolvedValue({ nome: "tc620-casa-2", azienda: "-", url: "https://sws/dev/tc620-casa-2" });
    pannelloCloud.mockResolvedValue({ nome: "tc620-casa-2", url: "https://sws/dev/tc620-casa-2", collegato: true, senza_utenti: true, versione: "2.13.0", arch: "aarch64" });
    rinominaPannelloCloud.mockResolvedValue({ nome: "tc620-casa" });
    render(<AbbinaPannelloCloud onAbbinato={onAbbinato} />);
    await screen.findByTestId("abbina-pannello-cloud");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { target: { value: CODICE } });
    fireEvent.keyDown(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { key: "Enter" });
    const riepilogo = await screen.findByTestId("riepilogo-pannello");
    expect(abbinaPannelloCloud).toHaveBeenCalledWith(CODICE, undefined, undefined, undefined);
    expect(onAbbinato).toHaveBeenCalledWith("https://sws/dev/tc620-casa-2");
    expect(riepilogo.textContent).toContain("2.13.0");
    const campo = screen.getByLabelText(/Rinomina|Rename/);
    fireEvent.change(campo, { target: { value: "tc620-casa" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(rinominaPannelloCloud).toHaveBeenCalledWith("tc620-casa-2", "tc620-casa"));
    await waitFor(() => expect(onAbbinato).toHaveBeenLastCalledWith("https://sws/dev/tc620-casa"));
  });

  it("le credenziali compaiono solo se il pannello ha già utenti", async () => {
    abbinaPannelloCloud.mockRejectedValueOnce(new Error('API x: 401 — {"error":"abbinamento","detail":"questo pannello ha già utenti: per abbinarlo al cloud servono utente e password di un suo amministratore"}'));
    render(<AbbinaPannelloCloud onAbbinato={() => {}} />);
    await screen.findByTestId("abbina-pannello-cloud");
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { target: { value: CODICE } });
    fireEvent.keyDown(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { key: "Enter" });
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
    expect(await screen.findByText(/servono utente e password/)).toBeTruthy();
  });
});
