/** «Usa come base» durante un turno (collaudo degli sfondi, 05-11-2026): il
 *  bottone era spento finché il modello non finiva, senza dirlo, e il clic
 *  sembrava perso. Ora la scelta resta in coda e parte col frame `fine`. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import type { MsgIn } from "../src/types/ai";

let ascoltatore: ((m: MsgIn) => void) | null = null;
const inviati: unknown[] = [];

vi.mock("@/ws/aiStream", () => ({
  ascolta: (fn: (m: MsgIn) => void) => { ascoltatore = fn; return () => { ascoltatore = null; }; },
  chiedi: (testo: string) => { inviati.push({ t: "chiedi", testo }); return true; },
  approvaSfondo: (id: string) => { inviati.push({ t: "approva_sfondo", id }); return true; },
  nuovaConversazione: () => {},
  suConversazioneNuova: () => () => {},
}));

import { ChatPanel } from "../src/components/ChatPanel";

// jsdom non disegna: niente scrollIntoView.
Element.prototype.scrollIntoView = () => {};

afterEach(() => { cleanup(); inviati.length = 0; });

const arriva = (m: unknown) => act(() => { ascoltatore!(m as MsgIn); });

describe("Usa come base", () => {
  it("cliccato durante il turno resta in coda e parte a fine turno", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    // Un turno in corso: la persona ha chiesto qualcosa.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "uno sfondo di montagna" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await arriva({ t: "sfondo", id: "a1", base: true, approvata: false, jpg: "" });
    inviati.length = 0;

    fireEvent.click(screen.getByTestId("usa-base-a1"));
    expect(inviati).toEqual([]);
    expect(screen.getByTestId("base-in-coda-a1")).toBeTruthy();

    await arriva({ t: "fine" });
    expect(inviati[0]).toEqual({ t: "approva_sfondo", id: "a1" });
    expect((inviati[1] as { t: string }).t).toBe("chiedi");
  });

  it("a turno finito parte subito", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    await arriva({ t: "sfondo", id: "b2", base: true, approvata: false, jpg: "" });
    fireEvent.click(screen.getByTestId("usa-base-b2"));
    expect(inviati[0]).toEqual({ t: "approva_sfondo", id: "b2" });
  });
});

describe("the twin of a background (20-11-2026)", () => {
  it("shows size and orientation, and the twin is chosen with its base", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    await arriva({ t: "sfondo", id: "s-portrait", base: true, approvata: false, jpg: "",
                   w: 600, h: 930, facing: "portrait", twin_of: null });
    await arriva({ t: "sfondo", id: "s-landscape", base: true, approvata: false, jpg: "",
                   w: 1024, h: 506, facing: "landscape", twin_of: "s-portrait" });
    expect(screen.getByTestId("sfondo-misura-s-portrait").textContent).toMatch(/^600×930 · (verticale|portrait)$/);
    expect(screen.getByTestId("sfondo-misura-s-landscape").textContent).toMatch(/^1024×506 · (orizzontale|landscape)$/);
    expect(screen.getByTestId("sfondo-s-landscape").textContent).toMatch(/progetto girato|turned project/);
    // One button, on the base.
    expect(screen.queryByTestId("usa-base-s-landscape")).toBeNull();
    fireEvent.click(screen.getByTestId("usa-base-s-portrait"));
    expect(inviati[0]).toEqual({ t: "approva_sfondo", id: "s-portrait" });
    await arriva({ t: "sfondo_approvato", id: "s-portrait", ok: true });
    expect(screen.getByTestId("sfondo-s-portrait").textContent).toMatch(/base scelta|base chosen/);
    expect(screen.getByTestId("sfondo-s-landscape").textContent).not.toMatch(/si sceglie con la sua base|chosen with its base/);
  });
});
