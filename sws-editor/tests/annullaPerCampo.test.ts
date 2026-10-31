/** Ctrl+Z annulla una modifica, non un tasto (31-10-2026): scrivere in un
 *  campo del pannello proprietà spingeva una voce di annulla per carattere. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNIONE_MS, selectIsDirty, useAppStore } from "../src/store";
import type { SynopticPage } from "../src/types";

const s = useAppStore.getState;
const pagina = (): SynopticPage => ({
  id: "p1", name: "P1",
  objects: [
    { id: "a", type: "label", x: 0, y: 0, width: 50, height: 20, text: "" } as never,
    { id: "b", type: "label", x: 0, y: 40, width: 50, height: 20, text: "" } as never,
  ],
});
const testo = (id: string) => s().pages[0].objects.find((o) => o.id === id)!.text;
const scrivi = (id: string, parola: string) => {
  for (let i = 1; i <= parola.length; i++) s().updateObject(id, { text: parola.slice(0, i) } as never);
};

describe("annulla per campo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    s().setPages([pagina()], "p1");
    useAppStore.setState({ past: [], future: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("una parola scritta di fila è una voce sola", () => {
    scrivi("a", "Prova");
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(testo("a")).toBe("");
  });

  it("dopo una pausa nasce una voce nuova", () => {
    scrivi("a", "Pro");
    vi.advanceTimersByTime(UNIONE_MS + 1);
    s().updateObject("a", { text: "Prova" } as never);
    expect(s().past).toHaveLength(2);
    s().undo();
    expect(testo("a")).toBe("Pro");
  });

  it("un altro oggetto o un altro campo spezzano la raffica", () => {
    scrivi("a", "x");
    scrivi("b", "y");
    s().updateObject("a", { text: "xx" } as never);
    s().updateObject("a", { font_size: 14 } as never);
    expect(s().past).toHaveLength(4);
  });

  it("dopo un annulla non si riattacca alla voce di prima", () => {
    scrivi("a", "ab");
    s().undo();
    scrivi("a", "c");
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(testo("a")).toBe("");
  });

  it("salvato a metà raffica, il seguito torna «non salvato»", () => {
    scrivi("a", "ab");
    s().markPagesSaved();
    expect(selectIsDirty(s())).toBe(false);
    s().updateObject("a", { text: "abc" } as never);
    expect(selectIsDirty(s())).toBe(true);
  });
});
