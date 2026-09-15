import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMsg } from "../src/i18n/projectI18n";
import type { LanguageTable } from "../src/types";

/** Il risolutore dei token `{{chiave}}` dei contenuti di progetto.
 *
 *  **I casi non stanno qui**: stanno in `tests/fixtures/risoluzione-token.json`,
 *  alla radice del repo, e li legge *anche* il test Rust del viewer LVGL
 *  (`lvgl_render.rs`, modulo `risoluzione_token_tests`). Due motori disegnano
 *  gli stessi progetti, e due copie della stessa tabella di casi
 *  divergerebbero in silenzio — che è esattamente il difetto che questa rete
 *  esiste per intercettare.
 *
 *  Fino al 15-09-2026 non esisteva **nessun** test su questo risolutore, su
 *  nessuno dei due motori, e le due implementazioni divergevano davvero in due
 *  punti: una entry senza valori dava il nome nudo della chiave da una parte e
 *  `{{chiave}}` dall'altra, e `{{a b}}` era un token per il Rust e non per il
 *  TypeScript.
 */

type Caso = { nome: string; testo: string; lang: string; atteso: string };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/risoluzione-token.json"), "utf8"),
) as { tabella: LanguageTable; casi: Caso[] };

describe("resolveMsg — la tabella di casi condivisa col viewer LVGL", () => {
  for (const c of fixture.casi) {
    it(c.nome, () => {
      expect(resolveMsg(c.testo, c.lang, fixture.tabella)).toBe(c.atteso);
    });
  }
});

describe("resolveMsg — casi che riguardano solo il lato web", () => {
  it("senza tabella il testo passa invariato", () => {
    expect(resolveMsg("{{ciao}}", "it", null)).toBe("{{ciao}}");
    expect(resolveMsg("{{ciao}}", "it", undefined)).toBe("{{ciao}}");
  });

  it("una tabella vuota non risolve niente, e non rompe niente", () => {
    const vuota: LanguageTable = { default: "", langs: [], entries: [] };
    expect(resolveMsg("{{ciao}}", "it", vuota)).toBe("{{ciao}}");
  });
});
