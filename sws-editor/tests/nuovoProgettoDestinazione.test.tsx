/** La riga «Verrà creato…» del nuovo progetto (29-10-2026, da `Appunti.txt`):
 *  senza cartella scelta incollava la scritta tradotta «Predefinita (la
 *  cartella dei progetti)» come se fosse un percorso. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { mieAziende } = vi.hoisted(() => ({ mieAziende: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, mieAziende, listTemplates: vi.fn().mockResolvedValue([]) } };
});
import { NewProjectModal } from "../src/components/benvenuto/NuovoProgetto";

beforeAll(async () => { await i18n.changeLanguage("it"); });

const testo = () => document.body.textContent ?? "";

describe("dove nasce il progetto", () => {
  it("senza cartella non si inventa un percorso", async () => {
    mieAziende.mockResolvedValue([{ id: 1, nome: "Questa installazione", implicita: true }]);
    render(<NewProjectModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(i18n.t("welcome.namePlaceholder") as string), { target: { value: "impianto" } });
    await waitFor(() => expect(testo()).toContain("Verrà creato nella cartella dei progetti, come «impianto»"));
    expect(testo()).not.toContain("Predefinita (la cartella dei progetti)/");
  });

  it("con un'azienda sua, lo dice", async () => {
    mieAziende.mockResolvedValue([{ id: 7, nome: "Acme", implicita: false }]);
    render(<NewProjectModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(i18n.t("welcome.namePlaceholder") as string), { target: { value: "linea" } });
    await waitFor(() => expect(testo()).toContain("Verrà creato nella cartella dell'azienda «Acme», come «linea»"));
  });
});
