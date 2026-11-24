/** rc.30, collaudo on the PLX800 (23-11-2026): the Users tab saves every field
 *  by itself and said nothing, and the Zones field saved at every key — the
 *  field went disabled and the comma vanished as soon as it was typed. */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

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
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const op = {
  username: "op", role: "Operator" as const, must_change_password: false, created_at_ms: 1, updated_at_ms: 1,
  session_ttl_secs: null, allowed_zones: [] as string[],
};

describe("the Users tab", () => {
  it("lets «zone1, zone2» be typed key by key and saves it once, on leaving the field", async () => {
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
    fireEvent.blur(field);
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser).toHaveBeenCalledWith("op", { allowed_zones: ["zone1", "zone2"] });
  });

  it("says «Saved» on the row that has just been saved", async () => {
    listUsers.mockResolvedValue([op]);
    updateUser.mockResolvedValue({});
    render(<UsersTab />);
    const name = await screen.findByTestId("utente-nome-op");
    fireEvent.change(name, { target: { value: "Operatore" } });
    fireEvent.blur(name);
    expect((await screen.findByTestId("utente-salvato-op")).textContent).toContain("Salvato");
  });

  it("does not save a field left as it was", async () => {
    listUsers.mockResolvedValue([{ ...op, allowed_zones: ["a", "b"] }]);
    render(<UsersTab />);
    const field = (await screen.findByTestId("utente-zone-op")) as HTMLInputElement;
    expect(field.value).toBe("a, b");
    fireEvent.blur(field);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("keeps the next field usable while the one just left saves (review of the rc.30)", async () => {
    listUsers.mockResolvedValue([op]);
    let finish: () => void = () => {};
    updateUser.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    render(<UsersTab />);
    const name = await screen.findByTestId("utente-nome-op");
    const zones = (await screen.findByTestId("utente-zone-op")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Operatore" } });
    fireEvent.blur(name);
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    // The save is still running: the next field is not disabled.
    expect(zones.disabled).toBe(false);
    finish();
  });
});
