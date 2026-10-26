/** La foglia Telefono delle notifiche (P4, 26-10-2026; piano
 *  `docs/plans/2026-10-26-sms-voce-reperibilita.md`).
 *
 *  Tre cose che il pannello deve poter credere:
 *  - quello che si scrive qui (Twilio, reperibili, attesa) arriva nel salvataggio,
 *    col token mascherato rimandato com'è — il server lo legge «tieni il vecchio»;
 *  - SMS e voce si scelgono solo per lo scatto e l'escalation: un rientro o una
 *    versione nuova non telefonano a nessuno;
 *  - l'SMS di prova parte col numero scritto, e non a bozza sporca.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { saveNotifications, provaSms } = vi.hoisted(() => ({
  saveNotifications: vi.fn().mockResolvedValue(undefined),
  provaSms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, saveNotifications, provaSms } };
});

import { NotificationsTab } from "../src/config/schede/NotificationsTab";
import { useAppStore } from "../src/store";

const TWILIO = { account_sid: "AC123", auth_token: "********", numero: "+39000" };

function progetto(notifications: unknown, foglia: string) {
  useAppStore.setState({
    pendingSections: {},
    configTab: foglia,
    project: {
      meta: { name: "telefono", version: "0.1.0" },
      tags: [], sources: [], alarms: [], functions: [],
      notifications,
    } as never,
  } as never);
}

describe("Notifiche → Telefono", () => {
  beforeEach(() => {
    saveNotifications.mockClear();
    provaSms.mockClear();
  });

  it("Twilio e un reperibile nuovo arrivano nel salvataggio, il token mascherato resta com'è", async () => {
    progetto({ twilio: TWILIO, reperibili: [{ nome: "Anna", telefono: "+39111" }] }, "telefono");
    render(<NotificationsTab />);
    expect((screen.getByTestId("twilio-attivo") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByTestId("reperibile-nuovo"));
    const telefoni = screen.getAllByPlaceholderText("+39…");
    // L'ultimo campo «+39…» è il telefono del reperibile appena aggiunto.
    fireEvent.change(telefoni.at(-1)!, { target: { value: "+39222" } });

    const salva = useAppStore.getState().pendingSections["notifications"];
    expect(salva, "la foglia deve registrare la bozza").toBeTruthy();
    await salva!();
    await waitFor(() => expect(saveNotifications).toHaveBeenCalled());
    const inviata = saveNotifications.mock.calls.at(-1)![0];
    expect(inviata.twilio).toEqual(TWILIO);
    expect(inviata.reperibili.map((r: { telefono: string }) => r.telefono)).toEqual(["+39111", "+39222"]);
  });

  it("SMS e voce solo per lo scatto e l'escalation", () => {
    progetto({}, "eventi");
    render(<NotificationsTab />);
    for (const canale of ["sms", "voce"]) {
      const caselle = screen.getAllByLabelText(new RegExp(`— ${canale}$`));
      expect(caselle).toHaveLength(2);
    }
  });

  it("l'SMS di prova parte col numero scritto", async () => {
    progetto({ twilio: TWILIO }, "telefono");
    render(<NotificationsTab />);
    // Il primo «+39…» dopo il numero mittente è quello della prova.
    const campi = screen.getAllByPlaceholderText("+39…");
    fireEvent.change(campi[1], { target: { value: " +39333 " } });
    fireEvent.click(screen.getByRole("button", { name: /SMS/ }));
    await waitFor(() => expect(provaSms).toHaveBeenCalledWith("+39333"));
  });
});
