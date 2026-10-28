/** Le icone dell'interfaccia: una famiglia sola, e nessuna emoji.
 *
 *  Le due schermate che un nuovo arrivato vede per prime erano fatte di emoji
 *  letterali (📁 ⬆ ✓ ✕ ✎ 🗄 ▦ ☰ ⚑ 📦 📂). Le disegna il sistema operativo,
 *  quindi cambiano da una macchina all'altra, e su un pannello senza font
 *  emoji diventano rettangoli vuoti.
 *
 *  La prova che conta è quella sul **file**: una `toBeTruthy()` su un
 *  componente non si accorgerebbe di un'emoji rimessa fra sei mesi. */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ICONE_UI, NOMI_ICONE_UI } from "@/ui/iconeInterfaccia";
import { IconaUI } from "@/ui/IconaUI";

/** Quello che si vuole fuori: **pittogrammi disegnati dal sistema**, cioè
 *  emoji vere (📁 🗄 📦 📂), dingbat usati come icone (✓ ✕ ✗ ✎), frecce di
 *  blocco (⬆), il menu ☰ e la griglia ▦.
 *
 *  Quello che **resta ammesso**, e vale la pena dire perché: le frecce
 *  tipografiche dentro un testo (`Apri →`) e i triangolini di apertura
 *  (`▾ ▸`). Non sono icone al posto di icone: sono segni di testo, li disegna
 *  il font dell'interfaccia come qualunque altro carattere, e sono uguali su
 *  ogni macchina. Un controllo che li vietasse non starebbe difendendo
 *  niente — direbbe solo che chi l'ha scritto non ha guardato. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2630}\u{2691}\u{25A6}]/u;

/** Via i commenti: è lì che si spiega **perché** quei segni sono stati tolti,
 *  e un controllo che si inciampa nella propria spiegazione è inutile. */
function senzaCommenti(testo: string): string {
  return testo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("le icone dell'interfaccia", () => {
  it("nessuna emoji nelle due schermate che si vedono per prime", () => {
    for (const f of ["WelcomeScreen.tsx", "LoginScreen.tsx"]) {
      const testo = senzaCommenti(readFileSync(resolve(__dirname, `../src/components/${f}`), "utf8"));
      const colpevoli = testo
        .split("\n")
        .map((riga, i) => ({ riga, n: i + 1 }))
        .filter(({ riga }) => EMOJI.test(riga));
      expect(colpevoli.map((c) => `${f}:${c.n} ${c.riga.trim()}`)).toEqual([]);
    }
  });

  it("e nemmeno nel catalogo dei testi: un'icona non è una traduzione", () => {
    const it = readFileSync(resolve(__dirname, "../src/i18n/it.json"), "utf8");
    const voci = Object.entries(JSON.parse(it).welcome as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && EMOJI.test(v as string));
    expect(voci).toEqual([]);
  });

  it("ogni icona ha un contenuto SVG, e nessuna è vuota", () => {
    expect(NOMI_ICONE_UI.length).toBeGreaterThan(10);
    for (const nome of NOMI_ICONE_UI) {
      expect(ICONE_UI[nome], nome).toMatch(/<(path|rect|circle|ellipse)/);
    }
  });

  it("sola dentro un pulsante porta un nome; decorativa è nascosta", () => {
    const { container: con } = render(<IconaUI nome="chiudi" titolo="Chiudi" />);
    expect(con.querySelector("svg")?.getAttribute("aria-label")).toBe("Chiudi");
    expect(con.querySelector("svg")?.getAttribute("aria-hidden")).toBeNull();

    const { container: senza } = render(<IconaUI nome="chiudi" />);
    expect(senza.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("un nome sconosciuto non esplode: disegna niente", () => {
    const { container } = render(<IconaUI nome="non-esiste" />);
    expect(container.querySelector("svg")?.innerHTML).toBe("");
  });
});
