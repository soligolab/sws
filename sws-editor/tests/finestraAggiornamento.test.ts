import { describe, expect, it } from "vitest";
import { giornoDellaSettimana, oraSuggerita } from "../src/boot/FinestraAggiornamento";

/** I campi della finestra partono dall'orologio del pannello (richiesta 50,
 *  28-09-2026): il maintainer aveva scelto «21:41» con il pannello alle 19:40
 *  UTC, e sarebbe scattato due ore dopo. */
describe("i campi della finestra partono dall'ora del pannello", () => {
  it("qualche minuto avanti, arrotondata ai 5", () => {
    expect(oraSuggerita("2026-09-28 19:40")).toEqual({ ora: "19:50", giorno: "oggi" });
    expect(oraSuggerita("2026-09-28 19:41")).toEqual({ ora: "19:55", giorno: "oggi" });
  });
  it("dopo mezzanotte il giorno diventa domani", () => {
    expect(oraSuggerita("2026-09-28 23:55")).toEqual({ ora: "00:05", giorno: "domani" });
  });
  it("il giorno della settimana dell'orologio del pannello", () => {
    expect(giornoDellaSettimana("2026-09-28 19:40")).toBe(1); // lunedì
    expect(giornoDellaSettimana("2026-10-04 03:00")).toBe(0); // domenica
  });
});
