/** Dai «dispositivi registrati» ci si connette (ramo 1a del piano
 *  docs/plans/2026-10-14-revisione-ide-collaudo-wp630.md, 17-10-2026). Un dispositivo
 *  nato da «+ Dispositivi» ha l'utente vuoto: prima il campo password non c'era,
 *  l'utente si salvava solo uscendo dal campo, e Connect mandava utente vuoto. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    listDevices: vi.fn(async () => [{ label: "TC620", url: "https://tc620.local:8444", user: "" }]),
    saveDevices: vi.fn(async (l: unknown) => l),
    getProjectFingerprint: vi.fn(async () => ({ sha256: "x" })),
    remoteConnect: vi.fn(async () => ({ ok: true })),
    remoteDisconnect: vi.fn(async () => ({})),
    discoverDispositivi: vi.fn(async () => []),
    deployToRuntime: vi.fn(async () => ({})),
  },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import i18n from "../src/i18n";
import { api } from "@/api/client";
import { DevicesTab } from "../src/config/schede/DevicesTab";
import { RT_USER_KEY } from "../src/config/schede/RuntimeConnectionTab";
import { useAppStore } from "../src/store";

beforeAll(async () => { await i18n.changeLanguage("it"); });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  localStorage.clear();
  vi.mocked(api.remoteConnect).mockClear();
  useAppStore.setState({ remoteConnected: false, remoteUrl: null });
});

describe("connettersi da un dispositivo registrato senza utente", () => {
  it("utente e password scritti nella riga arrivano a Connect, senza uscire dal campo né Invio", async () => {
    render(<DevicesTab />);
    const utente = await screen.findByTestId("dispositivo-utente-TC620");
    fireEvent.change(utente, { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("dispositivo-password-TC620"), { target: { value: "segreta" } });
    fireEvent.click(screen.getByTestId("dispositivo-connetti-TC620"));
    await waitFor(() => expect(api.remoteConnect).toHaveBeenCalledWith("https://tc620.local:8444", "admin", "segreta"));
    expect(localStorage.getItem(RT_USER_KEY)).toBe("admin");
  });

  it("Connect non è disabilitato e un utente vuoto non sovrascrive quello della connessione remota", async () => {
    localStorage.setItem(RT_USER_KEY, "operatore");
    render(<DevicesTab />);
    const connetti = await screen.findByTestId("dispositivo-connetti-TC620");
    expect((connetti as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(connetti);
    await waitFor(() => expect(api.remoteConnect).toHaveBeenCalledWith("https://tc620.local:8444", undefined, undefined));
    expect(localStorage.getItem(RT_USER_KEY)).toBe("operatore");
  });
});
