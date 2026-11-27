/** The Users page as a draft (25-11-2026, plan `docs/plans/2026-11-25-save-nella-testata.md`).
 *  Before, every field saved by itself and «✓ Saved» showed for 2.5 s in the row: the
 *  maintainer saw it at the third attempt. Now the fields write a draft, and the one Save
 *  of the header writes it. The new password stays an action of its own and saves at once. */
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";

const { listUsers, updateUser } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, listUsers, updateUser } };
});

import { UsersTab } from "../src/config/schede/UsersTab";

beforeAll(async () => { await i18n.changeLanguage("it"); });
beforeEach(() => { useAppStore.setState({ pendingSections: {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const op = {
  username: "op", role: "Operator" as const, must_change_password: false, created_at_ms: 1, updated_at_ms: 1,
  session_ttl_secs: null, allowed_zones: [] as string[],
};

const pending = () => useAppStore.getState().pendingSections["users"];

describe("the Users page", () => {
  it("lets «zone1, zone2» be typed key by key, and the Save writes it once", async () => {
    listUsers.mockResolvedValue([op]);
    updateUser.mockResolvedValue({});
    render(<UsersTab />);
    const field = (await screen.findByTestId("utente-zone-op")) as HTMLInputElement;
    let typed = "";
    for (const ch of "zone1, zone2") {
      typed += ch;
      fireEvent.change(field, { target: { value: typed } });
    }
    expect(field.value).toBe("zone1, zone2");
    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("utente-modificato-op")).toBeTruthy();
    await waitFor(() => expect(pending()).toBeDefined());
    await act(async () => { await pending()!(); });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith("op", { allowed_zones: ["zone1", "zone2"] });
    await waitFor(() => expect(pending()).toBeUndefined());
  });

  it("puts the changes of one user in one request", async () => {
    listUsers.mockResolvedValue([op]);
    updateUser.mockResolvedValue({});
    render(<UsersTab />);
    fireEvent.change(await screen.findByTestId("utente-nome-op"), { target: { value: "Operatore" } });
    fireEvent.change(screen.getByTestId("utente-ruolo-op"), { target: { value: "Supervisor" } });
    await waitFor(() => expect(pending()).toBeDefined());
    await act(async () => { await pending()!(); });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith("op", { display_name: "Operatore", role: "Supervisor" });
  });

  it("is not changed when a field goes back to what it was", async () => {
    listUsers.mockResolvedValue([{ ...op, allowed_zones: ["a", "b"] }]);
    render(<UsersTab />);
    const field = (await screen.findByTestId("utente-zone-op")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "a, b, c" } });
    await waitFor(() => expect(pending()).toBeDefined());
    fireEvent.change(field, { target: { value: "a,b" } });
    await waitFor(() => expect(pending()).toBeUndefined());
    expect(screen.queryByTestId("utente-modificato-op")).toBeNull();
  });

  it("says why the Save is refused, and the save fails", async () => {
    listUsers.mockResolvedValue([{ ...op, role: "Admin" as const }]);
    updateUser.mockRejectedValue(new Error("409 last_admin"));
    render(<UsersTab />);
    fireEvent.change(await screen.findByTestId("utente-ruolo-op"), { target: { value: "Viewer" } });
    await waitFor(() => expect(pending()).toBeDefined());
    let failed = false;
    await act(async () => { try { await pending()!(); } catch { failed = true; } });
    expect(failed).toBe(true);
    expect(await screen.findByText(i18n.t("cfgUi.ultimoAmministratore"))).toBeTruthy();
  });
});
