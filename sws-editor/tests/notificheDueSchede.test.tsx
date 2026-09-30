/** Due schede scrivono la stessa sezione del progetto senza cancellarsi.
 *
 *  Dal 30-09-2026 la scheda Notifiche è divisa in tre foglie (SMTP, Telegram,
 *  «cosa e dove») e le tre lingue delle notifiche si scelgono in **Lingue**,
 *  su richiesta del maintainer. Le foglie condividono una bozza sola — sono
 *  lo stesso componente — ma Lingue è un'altra scheda, e scrive dentro
 *  `notifications` come loro.
 *
 *  È la forma esatta di un difetto già pagato due volte qui: un payload
 *  composto da una copia presa al mount, che riscrive sopra i campi che
 *  un'altra scheda ha cambiato nel frattempo. La difesa è che ognuna
 *  ricomponga la sezione **da quel che c'è adesso nello store**, toccando
 *  solo i propri campi — e questo test è lì per accorgersene se qualcuno
 *  tornasse a fidarsi di una copia.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { saveNotifications, updateLanguages } = vi.hoisted(() => ({
  saveNotifications: vi.fn().mockResolvedValue(undefined),
  updateLanguages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, saveNotifications, updateLanguages } };
});

import { LanguagesTab } from "../src/config/schede/LanguagesTab";
import { useAppStore } from "../src/store";

/** Un progetto con notifiche già configurate: server, token, destinatari. */
const NOTIFICHE = {
  smtp: { host: "mail.example.com", port: 587, from: "a@b.it", starttls: true },
  telegram: { bot_token: "tok", chat_ids: ["1"] },
  destinatari_email: [{ indirizzo: "chi@legge.it", lingua: "it" }],
};

describe("Lingue e Notifiche scrivono la stessa sezione", () => {
  beforeEach(() => {
    saveNotifications.mockClear();
    useAppStore.setState({
      pendingSections: {},
      project: {
        meta: { name: "due-schede", version: "0.1.0" },
        tags: [], sources: [], alarms: [], functions: [],
        languages: { default: "it", langs: ["it", "en"], entries: [] },
        notifications: { ...NOTIFICHE },
      } as never,
    });
  });

  it("cambiare la lingua delle notifiche non cancella server, token e destinatari", async () => {
    render(<LanguagesTab />);
    // La tendina della lingua per l'email: la prima delle tre è «predefinita».
    const tendine = screen.getAllByRole("combobox");
    const perEmail = tendine.find((t) => (t as HTMLSelectElement).parentElement?.textContent?.match(/email/i));
    expect(perEmail, "la tendina della lingua email deve esserci in Lingue").toBeTruthy();
    fireEvent.change(perEmail!, { target: { value: "en" } });
    // Il salvataggio di ConfigView è unico: ogni scheda registra la propria
    // funzione fra le `pendingSections`, e il «Salva» le chiama tutte. Il test
    // passa di lì invece di cercare un pulsante che nella scheda non c'è.
    const salva = useAppStore.getState().pendingSections["languages"];
    expect(salva, "la scheda Lingue deve registrarsi fra le sezioni da salvare").toBeTruthy();
    await salva!();

    await waitFor(() => expect(saveNotifications).toHaveBeenCalled());
    const inviata = saveNotifications.mock.calls.at(-1)![0];
    expect(inviata.notify_lang_email).toBe("en");
    // Tutto il resto deve essere passato di qui intatto.
    expect(inviata.smtp).toEqual(NOTIFICHE.smtp);
    expect(inviata.telegram).toEqual(NOTIFICHE.telegram);
    expect(inviata.destinatari_email).toEqual(NOTIFICHE.destinatari_email);
  });
});
