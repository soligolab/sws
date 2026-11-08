/** La riga «Verrà creato…» del nuovo progetto (29-10-2026, da `Appunti.txt`):
 *  senza cartella scelta incollava la scritta tradotta «Predefinita (la
 *  cartella dei progetti)» come se fosse un percorso. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { mieAziende, createProject } = vi.hoisted(() => ({ mieAziende: vi.fn(), createProject: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, mieAziende, createProject, listTemplates: vi.fn().mockResolvedValue([]) } };
});
import { NewProjectModal, erroreNomeProgetto } from "../src/components/benvenuto/NuovoProgetto";

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

// Piano dell'impostazione iniziale, 08-11-2026.
describe("il progetto vuoto e il suo nome", () => {
  it("un progetto vuoto chiede l'impostazione iniziale, e il motore non si sceglie più qui", async () => {
    mieAziende.mockResolvedValue([]);
    createProject.mockResolvedValue({ name: "impianto", riferimento: "-/impianto" });
    const onCreate = vi.fn();
    render(<NewProjectModal onClose={() => {}} onCreate={onCreate} />);
    expect(document.querySelector("select option[value='lvgl_wayland']")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(i18n.t("welcome.namePlaceholder") as string), { target: { value: "impianto" } });
    fireEvent.click(screen.getByText(i18n.t("welcome.createProject") as string));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ impostazione_iniziale: true }));
    expect(createProject.mock.calls[0][0]).not.toHaveProperty("target");
  });

  it("un nome che il server rifiuterebbe si dice prima di mandarlo", async () => {
    mieAziende.mockResolvedValue([]);
    createProject.mockClear();
    render(<NewProjectModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(i18n.t("welcome.namePlaceholder") as string), { target: { value: "linea:2" } });
    expect(testo()).toContain(i18n.t("welcome.nomeCaratteri") as string);
    // L'anteprima non mostra un nome «ripulito» che non esisterà.
    expect(testo()).not.toContain("«linea2»");
    fireEvent.click(screen.getByText(i18n.t("welcome.createProject") as string));
    expect(createProject).not.toHaveBeenCalled();
  });

  it("le regole sono quelle di safe_project_name", () => {
    expect(erroreNomeProgetto("impianto nord")).toBeNull();
    expect(erroreNomeProgetto("")).toBeNull();
    expect(erroreNomeProgetto(".nascosto")).toBe("welcome.nomePunto");
    expect(erroreNomeProgetto("x".repeat(65))).toBe("welcome.nomeLungo");
    expect(erroreNomeProgetto("a/b")).toBe("welcome.nomeCaratteri");
  });
});
