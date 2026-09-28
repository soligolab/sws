import { describe, expect, it } from "vitest";
import { novitaNellaLingua } from "../src/api/client";

/** Le Novità nella lingua dell'interfaccia (decisione 57, 28-09-2026). */
describe("le Novità nella lingua dell'interfaccia", () => {
  const n = { versione: "2.12.0", testo: "- breve", compatibilita: "- riaprire", testo_en: "- short", compatibilita_en: "- reopen" };
  it("inglese se l'interfaccia è inglese", () => {
    expect(novitaNellaLingua(n, "en")).toEqual({ testo: "- short", compatibilita: "- reopen" });
    expect(novitaNellaLingua(n, "en-GB").testo).toBe("- short");
  });
  it("italiano altrimenti, e come ripiego se l'inglese manca", () => {
    expect(novitaNellaLingua(n, "it").testo).toBe("- breve");
    expect(novitaNellaLingua({ versione: "2.12.0-rc.5", testo: "- vecchia" }, "en")).toEqual({ testo: "- vecchia", compatibilita: "" });
  });
});
