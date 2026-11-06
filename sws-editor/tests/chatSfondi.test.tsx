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
