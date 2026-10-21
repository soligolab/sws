/** I simboli della famiglia «Comandi» nascono già col loro comando
 *  (21-10-2026). Il test guarda il manifesto vero: se domani si aggiunge un
 *  simbolo a quella famiglia e ci si dimentica il comando, questo diventa
 *  rosso — che è il punto, perché un pulsante muto non lo nota nessuno
 *  finché non ci si clicca sopra in impianto. */
import { describe, expect, it } from "vitest";
import manifest from "../public/symbols/lib/manifest.json";
import { oggettoSimbolo } from "@/editor/EditorShell";

/** Si comandano con le assegnazioni (una variabile per posizione), non con un
 *  modo solo: nascono senza, e la scelta è dichiarata. */
const CON_ASSEGNAZIONI = new Set([
  "lib:controls/selector-3",
  "lib:controls/rotary-switch-5",
  "lib:controls/joystick",
  "lib:controls/potentiometer",
]);

const comandi = manifest.symbols.filter((s) => s.family === "controls");

describe("i simboli della famiglia Comandi", () => {
  it("ci sono, e sono più di uno", () => {
    expect(comandi.length).toBeGreaterThan(10);
  });

  it("nascono col comando giusto, o dichiaratamente senza", () => {
    for (const s of comandi) {
      const o = oggettoSimbolo(s.id, 0, 0);
      if (CON_ASSEGNAZIONI.has(s.id)) {
        expect(o.button_mode, `${s.id} non deve nascere con un modo`).toBeUndefined();
      } else {
        expect(o.button_mode, `${s.id} deve nascere con un comando`).toBeTruthy();
      }
    }
  });

  it("un simbolo di un'altra famiglia resta muto", () => {
    expect(oggettoSimbolo("lib:process/ball-valve", 0, 0).button_mode).toBeUndefined();
  });
});
