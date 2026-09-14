import { describe, it, expect } from "vitest";
import { avvisoRuoloMinimo } from "../src/editor/EditorShell";

/** L'avviso sul ruolo minimo quando il progetto non ha utenti.
 *
 *  Due errori già fatti, entrambi fissati qui.
 *
 *  1. Il piano del 2026-09-12 diceva di guardare `authRole === "no-auth"`.
 *     `authRole` porta il ruolo **vero** — «Admin», quello sintetico che
 *     l'autenticazione inietta quando il progetto non ha utenti — quindi quel
 *     confronto è sempre falso e l'avviso non sarebbe mai comparso: un lavoro
 *     finito, verde, e senza alcun effetto.
 *
 *  2. Il ripiego era `authToken === "no-auth"`, giusto finché il token valeva
 *     la sentinella **esattamente quando** il progetto era senza utenti. Il
 *     14-09-2026 quella coincidenza è finita: un'istanza IDE non si autentica
 *     più in nessun caso, quindi nell'editor il token è sempre `"no-auth"`.
 *     Con quel segnale l'avviso sarebbe comparso su ogni oggetto con un ruolo
 *     minimo, dicendo «il progetto non ha utenti» a chi li aveva appena
 *     definiti — il testo e la condizione avrebbero detto due cose diverse.
 *
 *  Il segnale giusto è il fatto: `auth_required` di `/api/system`, cioè
 *  `has_users()` sul progetto aperto.
 */

describe("avvisoRuoloMinimo", () => {
  it("si vede con un ruolo minimo impostato e nessun utente nel progetto", () => {
    expect(avvisoRuoloMinimo(false, "Admin")).toBe(true);
    expect(avvisoRuoloMinimo(false, "Operator")).toBe(true);
  });

  it("non si vede senza ruolo minimo: non c'è niente da avvisare", () => {
    expect(avvisoRuoloMinimo(false, undefined)).toBe(false);
    expect(avvisoRuoloMinimo(false, "")).toBe(false);
  });

  it("non si vede quando il progetto ha utenti, che è il caso normale", () => {
    // È il caso che dal 14-09-2026 il token da solo sbaglierebbe: nell'IDE
    // vale `"no-auth"` anche qui, ma gli utenti ci sono e sul dispositivo il
    // ruolo minimo funzionerà benissimo.
    expect(avvisoRuoloMinimo(true, "Admin")).toBe(false);
  });

  it("finché non si sa, non si dice niente", () => {
    // `/api/system` non ancora risposto, o irraggiungibile. Un avviso
    // sbagliato è peggio di un avviso assente: chi lo legge cambia il
    // progetto per un motivo che non esiste.
    expect(avvisoRuoloMinimo(null, "Admin")).toBe(false);
  });
});
