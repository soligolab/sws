// La chat staccata sa del progetto riaperto (collaudo della rc.12, 11-11-2026).
//
// Il verso rotto: l'editor diceva il progetto solo in risposta al `ciao` della
// chat, e dopo uscita, rientro e progetto riaperto la chat restava su «No
// project open in the editor», col compositore spento.

import { afterEach, describe, expect, it } from "vitest";

import { annunciaProgettoAllaChat } from "@/ai/progettoAllaChat";
import { useAppStore } from "@/store";

const progetto = (name: string) => ({ meta: { name } }) as never;

afterEach(() => useAppStore.setState({ project: null, noActiveProject: false }));

describe("annunciaProgettoAllaChat", () => {
  it("dice a ogni chat presentata il progetto aperto, chiuso o cambiato", () => {
    const mandati: unknown[] = [];
    const chat = new Set(["c1", "c2"]);
    const stop = annunciaProgettoAllaChat({ manda: (m) => { mandati.push(m); return true; } }, () => chat);

    useAppStore.setState({ project: progetto("Montagna") });
    useAppStore.setState({ project: null });

    expect(mandati).toEqual([
      { t: "stato", a: "c1", progetto: "Montagna" },
      { t: "stato", a: "c2", progetto: "Montagna" },
      { t: "stato", a: "c1", progetto: null },
      { t: "stato", a: "c2", progetto: null },
    ]);
    stop();
  });

  it("un salvataggio dello stesso progetto non è un cambio, e dopo stop tace", () => {
    const mandati: unknown[] = [];
    useAppStore.setState({ project: progetto("Montagna") });
    const stop = annunciaProgettoAllaChat({ manda: (m) => { mandati.push(m); return true; } }, () => ["c1"]);

    useAppStore.setState({ project: progetto("Montagna") });
    expect(mandati).toEqual([]);

    stop();
    useAppStore.setState({ project: progetto("Altro") });
    expect(mandati).toEqual([]);
  });

  it("un'uscita è un progetto chiuso anche se lo store lo tiene, e riaprirlo si annuncia", () => {
    const mandati: unknown[] = [];
    useAppStore.setState({ project: progetto("Specchio") });
    const stop = annunciaProgettoAllaChat({ manda: (m) => { mandati.push(m); return true; } }, () => ["c1"]);

    useAppStore.setState({ noActiveProject: true });
    useAppStore.setState({ noActiveProject: false });

    expect(mandati).toEqual([
      { t: "stato", a: "c1", progetto: null },
      { t: "stato", a: "c1", progetto: "Specchio" },
    ]);
    stop();
  });
});
