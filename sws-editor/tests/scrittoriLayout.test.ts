/** Chi scrive `page_layout` passa dalla coda (piano dell'impostazione
 *  iniziale, sessione I2, 08-11-2026). Il server sostituisce il `page_layout`
 *  intero e la `PUT` è versionata: uno scrittore fuori coda prende un 409 o
 *  cancella la scrittura di un altro. Erano cinque, e uno solo in coda. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src");
const AMMESSI = ["formatoProgettoAzioni.ts", "store/index.ts", "api/client.ts"];

function file(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? file(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("gli scrittori di page_layout", () => {
  it("chiamano api.updatePageLayout solo da salvaLayout e dal Salva, che stanno in coda", () => {
    const fuori = file(SRC)
      .filter((p) => readFileSync(p, "utf8").includes("updatePageLayout("))
      .map((p) => relative(SRC, p))
      .filter((p) => !AMMESSI.includes(p));
    expect(fuori).toEqual([]);
  });

  it("i due ammessi passano da inCodaLayout", () => {
    for (const p of ["formatoProgettoAzioni.ts", "store/index.ts"]) {
      expect(readFileSync(join(SRC, p), "utf8")).toContain("inCodaLayout(");
    }
  });
});
