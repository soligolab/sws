/** «Abbina un pannello» with no project (13-11-2026): from the panel QR link
 *  (`#pair=<code>`, kept through the login) or from the user menu. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { mieAziende, waitingPanel, pairPanel } = vi.hoisted(() => ({
  mieAziende: vi.fn(),
  waitingPanel: vi.fn(),
  pairPanel: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, mieAziende, waitingPanel, pairPanel } };
});

import "../src/i18n/index";
import { PairPanel, normalizeCode } from "../src/components/PairPanel";
import { capturePairCode, takePairCode } from "../src/pairLink";

const CODE = "7KQ2-M9XD-3HWP-T4BZ";

describe("pairing link", () => {
  it("the code survives the login and is taken once", () => {
    window.history.replaceState(null, "", `/#pair=${CODE}`);
    capturePairCode();
    expect(window.location.hash).toBe("");
    expect(takePairCode()).toBe(CODE);
    expect(takePairCode()).toBeNull();
  });

  it("codes are read the way a person types them", () => {
    expect(normalizeCode("7kq2 m9xd 3hwp t4bz")).toBe(CODE);
    expect(normalizeCode("7KQ2M9XD")).toBeNull();
  });
});

describe("PairPanel", () => {
  beforeEach(() => {
    for (const f of [mieAziende, waitingPanel, pairPanel]) f.mockReset();
    waitingPanel.mockResolvedValue({ nome_proposto: "ty570-1ad-p1-06e990" });
  });

  it("from the QR: shows which panel, and with one company pairs to it", async () => {
    mieAziende.mockResolvedValue([{ id: 1, nome: "Casa", implicita: true, ruolo: "sviluppatore", cartella: "-" }]);
    pairPanel.mockResolvedValue({ nome: "ty570-1ad-p1-06e990", azienda: "-", url: "https://sws/dev/ty570-1ad-p1-06e990" });
    render(<PairPanel initialCode={CODE} onClose={() => {}} />);
    expect((await screen.findByTestId("pair-panel-proposed")).textContent).toContain("ty570-1ad-p1-06e990");
    expect(screen.queryByRole("combobox")).toBeNull();
    const pair = screen.getByRole("button", { name: /Abbina$|Pair$/ });
    await waitFor(() => expect((pair as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pair);
    expect((await screen.findByTestId("pair-panel-done")).textContent).toContain("Casa");
    expect(pairPanel).toHaveBeenCalledWith({
      codice: CODE, nome: undefined, azienda: "-", username: undefined, password: undefined,
    });
  });

  it("with two companies the user chooses", async () => {
    mieAziende.mockResolvedValue([
      { id: 1, nome: "Casa", implicita: true, ruolo: "sviluppatore", cartella: "-" },
      { id: 2, nome: "Acme", implicita: false, ruolo: "sviluppatore", cartella: "acme" },
    ]);
    pairPanel.mockResolvedValue({ nome: "ty570", azienda: "acme" });
    render(<PairPanel initialCode={CODE} onClose={() => {}} />);
    const select = await screen.findByRole("combobox");
    const pair = screen.getByRole("button", { name: /Abbina$|Pair$/ }) as HTMLButtonElement;
    expect(pair.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "acme" } });
    fireEvent.click(pair);
    await screen.findByTestId("pair-panel-done");
    expect(pairPanel.mock.calls[0][0].azienda).toBe("acme");
  });

  it("from the menu the code is typed, and an unknown one says so", async () => {
    mieAziende.mockResolvedValue([{ id: 1, nome: "Casa", implicita: true, ruolo: "sviluppatore", cartella: "-" }]);
    waitingPanel.mockRejectedValue(new Error("404"));
    render(<PairPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX-XXXX-XXXX"), { target: { value: CODE } });
    expect(await screen.findByText(/Nessun pannello in attesa|No panel is waiting/)).toBeTruthy();
  });
});
