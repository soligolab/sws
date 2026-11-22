// `{{user.*}}` (22-11-2026): the cases shared with the LVGL viewer are in
// tests/fixtures/segnaposto-utente.json.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { campoUtente, dataOraAccesso, impostaUtenteDeiTesti, localizeObject, resolveMsg } from "@/i18n/projectI18n";
import type { LanguageTable, SynopticObject } from "@/types";

type Caso = { nome: string; utente: { username: string; name?: string; role?: string } | null; testo: string; lang: string; atteso: string };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/segnaposto-utente.json"), "utf8"),
) as { tabella: LanguageTable; casi: Caso[] };

afterEach(() => impostaUtenteDeiTesti(null));

describe("{{user.*}} — the cases shared with the LVGL viewer", () => {
  for (const c of fixture.casi) {
    it(c.nome, () => {
      impostaUtenteDeiTesti(c.utente);
      expect(resolveMsg(c.testo, c.lang, fixture.tabella)).toBe(c.atteso);
    });
  }
});

describe("{{user.*}} — the web side", () => {
  it("resolves without a language table, in the text fields", () => {
    impostaUtenteDeiTesti({ username: "mario", name: "Mario" });
    const o = { id: "t", type: "text", text: "Benvenuto {{user.name}}" } as SynopticObject;
    expect(localizeObject(o, "", null).text).toBe("Benvenuto Mario");
    const plain = { id: "p", type: "text", text: "Nessun segnaposto" } as SynopticObject;
    expect(localizeObject(plain, "", null)).toBe(plain);
  });
  it("writes the previous login as DD-MM-YYYY HH:MM, local time", () => {
    const ms = new Date(2026, 10, 21, 18, 30).getTime();
    expect(dataOraAccesso(ms)).toBe("21-11-2026 18:30");
    expect(campoUtente("last_login", "it", { username: "m", lastLoginMs: ms })).toBe("21-11-2026 18:30");
  });
});
