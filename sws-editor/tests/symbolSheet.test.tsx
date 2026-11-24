/** The symbol editor's assistant, session 2 (plan
 *  docs/plans/2026-11-23-assistente-dei-simboli.md): the sheet of the
 *  interview, editable in the chat until «Confirm», goes with the next
 *  question; a photo can be attached to a question, in both chats. */
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import type { MsgIn, SymbolSheet } from "../src/types/ai";

let listener: ((m: MsgIn) => void) | null = null;
const sent: { testo: string; extras?: Record<string, unknown> }[] = [];

vi.mock("@/ws/aiStream", () => ({
  ascolta: (fn: (m: MsgIn) => void) => { listener = fn; return () => { listener = null; }; },
  chiedi: (testo: string, extras?: Record<string, unknown>) => { sent.push({ testo, extras }); return true; },
  approvaSfondo: () => true,
  mandaFoto: () => true,
  nuovaConversazione: () => {},
  suConversazioneNuova: () => () => {},
}));
vi.mock("@/images/optimize", () => ({
  pictureForModel: async () => ({ media_type: "image/jpeg", data: "AAAA" }),
}));

import { ChatPanel } from "../src/components/ChatPanel";
import { sheetProblems } from "../src/symbols/editor/SymbolSheetCard";

Element.prototype.scrollIntoView = () => {};
afterEach(() => { cleanup(); sent.length = 0; });
const arrives = (m: unknown) => act(() => { listener!(m as MsgIn); });

const stove = (): SymbolSheet => ({
  name: "Stufa a pellet", size: { w: 100, h: 140 }, style: "vector", state_colors: true,
  inputs: [{ id: "acceso", type: "bool" }, { id: "potenza", type: "number", min: 0, max: 100, unit: "%" }],
  parts: [{ id: "fiamma", what: "la fiamma" }, { id: "camino", what: "il tubo del fumo" }],
  ports: [{ id: "fumi", side: "top" }],
  effects: [{ kind: "flame", part: "fiamma", input: "acceso" }],
});

describe("the sheet of a symbol", () => {
  it("names what keeps it from being confirmed", () => {
    expect(sheetProblems(stove())).toEqual([]);
    const s = stove();
    s.parts[1].id = "fiamma";
    s.effects[0].input = "nessuno";
    s.inputs.push({ id: "Brutto Nome", type: "bool" });
    expect(sheetProblems(s)).toEqual(expect.arrayContaining(["fiamma", "nessuno", "Brutto Nome"]));
  });

  it("is corrected in the card and goes with the next question when confirmed", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "finto" });
    await arrives({ t: "symbol_sheet", id: "s1", sheet: stove() });
    await arrives({ t: "fine" });
    // The person renames the symbol and adds an effect.
    fireEvent.change(screen.getByTestId("sheet-name"), { target: { value: "Stufa del soggiorno" } });
    fireEvent.click(screen.getByText(/\+ (effetto|effect)/));
    // A broken name holds «Confirm» back.
    fireEvent.change(screen.getByTestId("sheet-input-0").querySelector("input")!, { target: { value: "" } });
    expect((screen.getByTestId("sheet-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("sheet-problems")).toBeTruthy();
    fireEvent.change(screen.getByTestId("sheet-input-0").querySelector("input")!, { target: { value: "acceso" } });
    fireEvent.click(screen.getByTestId("sheet-confirm"));
    expect(sent).toHaveLength(1);
    const sheet = sent[0].extras!.sheet as SymbolSheet;
    expect(sheet.name).toBe("Stufa del soggiorno");
    expect(sheet.effects).toHaveLength(2);
    // Confirmed: read only.
    expect(screen.queryByTestId("sheet-confirm")).toBeNull();
    expect((screen.getByTestId("sheet-name") as HTMLInputElement).closest("fieldset")!.disabled).toBe(true);
  });
});

describe("a photo attached to a question", () => {
  it("goes with the next message and shows in it, in the project's chat too", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "finto" });
    const file = new File(["x"], "stufa.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("chat-photo-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("chat-photo-waiting")).toBeTruthy());
    // Without words: a default sentence goes with it.
    const send = screen.getAllByRole("button").find((b) => /Manda|Send/.test(b.textContent ?? ""))!;
    fireEvent.click(send);
    expect(sent).toHaveLength(1);
    expect(sent[0].extras).toMatchObject({ photo: { media_type: "image/jpeg", data: "AAAA" } });
    expect(screen.queryByTestId("chat-photo-waiting")).toBeNull();
    expect(screen.getByTestId("chat-user-photo").getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });
});
