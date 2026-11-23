/** The symbol editor's assistant, session 1 (plan
 *  docs/plans/2026-11-23-assistente-dei-simboli.md): the IDE's chat in a
 *  column of the editor, on a conversation of its own; every question carries
 *  the symbol as it is, and «Apply» on a proposed drawing is one step Ctrl+Z
 *  takes back, with the editor's own names. */
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";
import type { MsgIn } from "../src/types/ai";
import type { DescrizioneSimbolo } from "../src/types";

/** The conversation the editor opens: what it was asked, and a way to answer. */
const fake = vi.hoisted(() => ({
  asked: [] as { testo: string; simbolo?: unknown }[],
  listener: null as ((m: unknown) => void) | null,
  opened: [] as string[],
  released: [] as string[],
}));

vi.mock("@/ws/aiStream", () => {
  const channel = {
    chiedi: (testo: string, simbolo?: unknown) => { fake.asked.push({ testo, simbolo }); return true; },
    approvaSfondo: () => true,
    mandaFoto: () => true,
    ascolta: (fn: (m: unknown) => void) => { fake.listener = fn; return () => { fake.listener = null; }; },
    nuovaConversazione: () => {},
    suConversazioneNuova: () => () => {},
  };
  return {
    ...channel,
    symbolChannel: (slug: string) => { fake.opened.push(slug); return channel; },
    releaseSymbolChannel: (slug: string) => { fake.released.push(slug); },
  };
});

import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { svuotaCoda } from "../src/finestraAvviso/finestraAvviso";
import { SymbolEditorHost } from "../src/symbols/editor/SymbolEditor";
import { newRect, type Op } from "../src/symbols/editor/model";

Element.prototype.scrollIntoView = () => {};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8">
    <rect x="20" y="20" width="60" height="60" data-op="1"/>
  </g>
</svg>
`;

function compiled(d: DescrizioneSimbolo) {
  return {
    slug: d.slug, ok: true, errori: [], svg: SVG,
    voce: {
      id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
      viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
    },
  } as never;
}

const draft = (ops: Op[]): DescrizioneSimbolo =>
  ({ slug: "stufa", w: 100, h: 100, body: "body-pump", it: "Stufa", en: "Stove", ops } as DescrizioneSimbolo);
const arrives = (m: unknown) => act(() => { fake.listener!(m as MsgIn); });
const rows = () => screen.queryAllByTestId(/^symbol-op-row-/).length;

describe("the symbol editor's assistant", () => {
  beforeEach(() => {
    fake.asked.length = 0; fake.opened.length = 0; fake.released.length = 0;
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map(compiled));
    vi.spyOn(api, "symbolCatalog").mockResolvedValue({ materials: [], veils: [] });
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [], simboli: [] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => { svuotaCoda(); });
    act(() => useAppStore.getState().closeSymbolEditor());
  });

  it("opens the chat on the symbol's conversation, with the symbol in every question", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })]), isNew: false,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    // «Disegno con l'IA» is gone; «Genera foto» stays until session 3.
    expect(screen.queryByTestId("symbol-section-ai-draw")).toBeNull();
    expect(screen.getByTestId("symbol-section-ai-photo")).toBeTruthy();
    expect(screen.queryByTestId("symbol-assistant-column")).toBeNull();

    fireEvent.click(screen.getByTestId("symbol-editor-assistant"));
    expect(screen.getByTestId("symbol-assistant-column")).toBeTruthy();
    expect(fake.opened).toContain("stufa");
    await arrives({ t: "pronto", attivo: true, modello: "finto" });
    const box = screen.getByTestId("symbol-assistant-column").querySelector("textarea")!;
    fireEvent.change(box, { target: { value: "fallo più alto" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fake.asked).toHaveLength(1);
    expect(fake.asked[0].testo).toBe("fallo più alto");
    expect(fake.asked[0].simbolo).toMatchObject({ slug: "stufa", it: "Stufa" });
    expect((fake.asked[0].simbolo as DescrizioneSimbolo).ops).toHaveLength(2);
  });

  it("«Apply» puts the drawing in the editor with its own names, and Ctrl+Z takes it back", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })]), isNew: false,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-editor-assistant"));
    await arrives({ t: "pronto", attivo: true, modello: "finto" });
    const before = rows();
    // The model wrote another slug and other labels: the editor's stay.
    const proposed = {
      slug: "altra", w: 100, h: 100, body: "body-pump", it: "Altra", en: "Other", ops: [
        { op: "corpo" }, newRect({ x: 10, y: 10, w: 30, h: 30 }), newRect({ x: 50, y: 50, w: 30, h: 30 }),
        newRect({ x: 10, y: 60, w: 20, h: 20 }),
      ],
    };
    await arrives({ t: "proposta_simbolo", id: "p1", motivo: "più pezzi", simbolo: proposed, svg: SVG });
    await arrives({ t: "fine" });
    expect(screen.getByTestId("chat-proposta-simbolo").textContent).toMatch(/più pezzi/);
    fireEvent.click(screen.getByTestId("chat-applica-simbolo"));
    await waitFor(() => expect(rows()).toBe(before + 2));
    expect(screen.queryByTestId("chat-applica-simbolo")).toBeNull();
    // The next question carries the applied drawing, with the editor's names.
    const box = screen.getByTestId("symbol-assistant-column").querySelector("textarea")!;
    fireEvent.change(box, { target: { value: "ok" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fake.asked.at(-1)!.simbolo).toMatchObject({ slug: "stufa", it: "Stufa", en: "Stove" });
    expect((fake.asked.at(-1)!.simbolo as DescrizioneSimbolo).ops).toHaveLength(4);
    // One step back.
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(rows()).toBe(before));
  });

  it("closing the editor lets the symbol's conversation go", async () => {
    act(() => useAppStore.getState().openSymbolEditor({ draft: draft([{ op: "corpo" }]), isNew: false }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    act(() => useAppStore.getState().closeSymbolEditor());
    expect(fake.released).toContain("stufa");
  });
});
