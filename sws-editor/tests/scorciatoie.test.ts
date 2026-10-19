/** Il registro delle scorciatoie (18-10-2026): una combinazione per azione, cambiabile,
 *  letta allo stesso modo da tastiera, guida e preferenze. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  AZIONI, azioneDi, combinazione, combinazioneDi, conflittiDi, leggiPersonalizzate, righeDalRegistro, salvaPersonalizzate,
} from "../src/scorciatoie/registro";

const tasto = (key: string, m: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; code: string }> = {}) => ({
  key, code: m.code ?? "", ctrlKey: !!m.ctrl, metaKey: !!m.meta, altKey: !!m.alt, shiftKey: !!m.shift,
});

beforeEach(() => localStorage.clear());

describe("registro delle scorciatoie", () => {
  it("normalizza: Ctrl e ⌘ sono Mod, le lettere maiuscole, Maiusc esplicito tranne nei simboli", () => {
    expect(combinazioneDi(tasto("z", { ctrl: true }))).toBe("Mod+Z");
    expect(combinazioneDi(tasto("Z", { meta: true, shift: true }))).toBe("Mod+Shift+Z");
    expect(combinazioneDi(tasto("?", { shift: true }))).toBe("?");
    expect(combinazioneDi(tasto("}", { ctrl: true, shift: true, code: "BracketRight" }))).toBe("Mod+Shift+]");
    expect(combinazioneDi(tasto("PageDown", { alt: true }))).toBe("Alt+PageDown");
    expect(combinazioneDi(tasto("Shift", { shift: true }))).toBeNull();
  });

  it("trova l'azione nel contesto, e le globali valgono ovunque", () => {
    expect(azioneDi(tasto("z", { ctrl: true }), "editor")).toBe("annulla");
    expect(azioneDi(tasto("s", { ctrl: true }), "editor")).toBe("salva");
    expect(azioneDi(tasto("z", { ctrl: true }), "globale")).toBeNull();
    expect(azioneDi(tasto("Delete"), "editor")).toBe("elimina");
  });

  it("una combinazione cambiata vale al posto della predefinita", () => {
    salvaPersonalizzate({ annulla: "Alt+Z" });
    expect(leggiPersonalizzate()).toEqual({ annulla: "Alt+Z" });
    expect(azioneDi(tasto("z", { alt: true }), "editor")).toBe("annulla");
    expect(azioneDi(tasto("z", { ctrl: true }), "editor")).toBeNull();
    expect(combinazione("annulla")).toBe("Alt+Z");
  });

  it("dice chi usa già una combinazione", () => {
    expect(conflittiDi("Mod+C", "annulla")).toEqual(["copia"]);
    expect(conflittiDi("Mod+C", "copia")).toEqual([]);
  });

  it("ogni azione ha una predefinita diversa, e la guida unisce le alternative", () => {
    const pred = AZIONI.map((a) => a.predefinita);
    expect(new Set(pred).size).toBe(pred.length);
    const righe = righeDalRegistro({});
    expect(righe.some(([k, d]) => d === "shortcut.redo" && k.includes("+Y") && k.includes("Shift+Z"))).toBe(true);
    expect(righe.filter(([, d]) => d === "shortcut.redo")).toHaveLength(1);
  });
});
