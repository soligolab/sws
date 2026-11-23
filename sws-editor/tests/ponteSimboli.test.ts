// The bridge between the IDE and the symbol editor's own window (22-11-2026):
// the window gets the symbol and the project from the IDE, asks the version
// before writing, and the IDE takes what was written.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { impostaVersioneProgetto, versioneProgetto } from "../src/api/client";
import { idEditore } from "../src/ai/ponte";
import { useAppStore } from "../src/store";
import { avviaPonteSimboliIde, collegaFinestra, preparaFinestra } from "../src/symbols/editor/ponteSimboli";
import { writeHooks } from "../src/symbols/editor/open";
import type { DescrizioneSimbolo } from "../src/types";

const stufa = { slug: "stufa", w: 100, h: 140, body: "body-pump", it: "Stufa", en: "Stove", ops: [] } as unknown as DescrizioneSimbolo;

describe("the symbol editor's own window", () => {
  let stop = () => {};
  afterEach(() => { stop(); writeHooks.before = null; writeHooks.after = null; });

  it("gets the symbol and the project from the IDE, and the IDE takes what it wrote", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    act(() => {
      useAppStore.getState().setProject({ name: "Casa", tags: [], simboli: [stufa] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
    impostaVersioneProgetto("v7");
    stop = avviaPonteSimboliIde();
    const t = preparaFinestra({ draft: stufa, isNew: false });
    const ok = await collegaFinestra(`#e=${encodeURIComponent(idEditore())}&t=${encodeURIComponent(t)}`);
    expect(ok).toBe(true);
    expect(useAppStore.getState().symbolEditor?.draft.slug).toBe("stufa");
    expect(useAppStore.getState().symbolEditor?.inline).toBe(true);
    // The IDE saved something meanwhile: the window writes on its version.
    impostaVersioneProgetto("v8");
    await writeHooks.before!();
    expect(versioneProgetto()).toBe("v8");
    const nuova = { ...stufa, it: "Stufa nuova" };
    writeHooks.after!([nuova]);
    await new Promise((r) => setTimeout(r, 50));
    expect(useAppStore.getState().project?.simboli?.[0].it).toBe("Stufa nuova");
  });

  it("says so when no IDE answers", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    expect(await collegaFinestra("#e=nobody&t=x")).toBe(false);
  }, 10000);
});
