/** The project trash (13-11-2026): the X moves a project there, the section
 *  shows the 30 days retention and the days left on each project, and
 *  «Restore» / «Delete now» call the right API. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const fns = vi.hoisted(() => ({
  listProjects: vi.fn(),
  trashProject: vi.fn(),
  untrashProject: vi.fn(),
  deleteProject: vi.fn(),
  identitaStato: vi.fn(),
  mieAziende: vi.fn(),
  getSystemStatus: vi.fn(),
  statoAccount: vi.fn(),
  spazioMio: vi.fn(),
  whoami: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, ...fns } };
});
vi.mock("@/finestraAvviso/finestraAvviso", async () => {
  const actual = await vi.importActual<typeof import("@/finestraAvviso/finestraAvviso")>("@/finestraAvviso/finestraAvviso");
  return { ...actual, conferma: vi.fn().mockResolvedValue(true) };
});

import "../src/i18n/index";
import { WelcomeScreen, giorniAllaCancellazione } from "../src/components/WelcomeScreen";

const GIORNO = 24 * 3600 * 1000;

function voce(name: string, extra: object = {}) {
  return { name, riferimento: `-/${name}`, path: `/p/${name}`, external: false, last_opened_ms: null, ...extra };
}

describe("project trash", () => {
  beforeEach(() => {
    for (const f of Object.values(fns)) f.mockReset();
    fns.identitaStato.mockResolvedValue({ gateway: false });
    fns.mieAziende.mockResolvedValue([]);
    fns.getSystemStatus.mockRejectedValue(new Error("no"));
    fns.statoAccount.mockResolvedValue({ chiudibile: false });
    fns.spazioMio.mockResolvedValue([]);
    fns.whoami.mockResolvedValue({});
    for (const f of [fns.trashProject, fns.untrashProject, fns.deleteProject]) f.mockResolvedValue(undefined);
  });

  it("days left: whole days, 0 on the last day", () => {
    expect(giorniAllaCancellazione(10 * GIORNO, 0)).toBe(10);
    expect(giorniAllaCancellazione(10 * GIORNO, 9.5 * GIORNO)).toBe(1);
    expect(giorniAllaCancellazione(10 * GIORNO, 11 * GIORNO)).toBe(0);
  });

  it("the X moves a project to the trash", async () => {
    fns.listProjects.mockResolvedValue([voce("impianto")]);
    render(<WelcomeScreen onProjectOpened={() => {}} />);
    fireEvent.click(await screen.findByTestId("trash--/impianto"));
    await waitFor(() => expect(fns.trashProject).toHaveBeenCalledWith("-/impianto"));
    expect(fns.deleteProject).not.toHaveBeenCalled();
  });

  it("the section shows the retention and the days left; restore and delete now", async () => {
    const ora = Date.now();
    fns.listProjects.mockResolvedValue([
      voce("vivo"),
      voce("vecchio", { cestino: { quando_ms: ora - 2 * GIORNO, da: "mauro", scade_ms: ora + 28 * GIORNO - 1000 } }),
    ]);
    render(<WelcomeScreen onProjectOpened={() => {}} />);
    const toggle = await screen.findByTestId("cestino-toggle");
    expect(toggle.textContent).toMatch(/30 (giorni di ritenzione|days retention)/);
    fireEvent.click(toggle);
    expect(screen.getByTestId("cestino-giorni--/vecchio").textContent).toMatch(/^28/);
    fireEvent.click(screen.getByTestId("untrash--/vecchio"));
    await waitFor(() => expect(fns.untrashProject).toHaveBeenCalledWith("-/vecchio"));
    fireEvent.click(screen.getByTestId("delete-now--/vecchio"));
    await waitFor(() => expect(fns.deleteProject).toHaveBeenCalledWith("-/vecchio"));
  });
});
