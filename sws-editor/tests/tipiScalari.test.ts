import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOMI_TIPI, TIPI_SCALARI, categoriaDi, normalizzaTipo } from "../src/tag/tipiScalari";

/** D5: i tipi scalari ricchi. La fonte è `tests/fixtures/tipi-scalari.json`,
 *  letta anche dal test Rust di `sws_core::tipo`: due tabelle separate
 *  divergerebbero in silenzio, e un `u16` che l'editor conosce e il runtime no
 *  sarebbe un tag non scrivibile. */
type Fixture = { tipi: { nome: string; categoria: string; bit?: number; alias?: string[] }[] };
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/tipi-scalari.json"), "utf8")) as Fixture;

describe("tipiScalari — la tabella condivisa col runtime", () => {
  it("stessi nomi, stesso ordine, stesse categorie, stessi alias", () => {
    expect(NOMI_TIPI).toEqual(fixture.tipi.map((t) => t.nome));
    for (const t of fixture.tipi) {
      const mio = TIPI_SCALARI.find((x) => x.nome === t.nome)!;
      expect(mio.categoria, t.nome).toBe(t.categoria);
      expect(mio.bit, t.nome).toBe(t.bit);
      expect(mio.alias ?? [], t.nome).toEqual(t.alias ?? []);
    }
  });

  it("normalizza alias, maiuscole e string(N); rifiuta ciò che non è un tipo", () => {
    expect(normalizzaTipo("int")).toBe("i64");
    expect(normalizzaTipo("float")).toBe("f64");
    expect(normalizzaTipo(" U16 ")).toBe("u16");
    expect(normalizzaTipo("string(16)")).toBe("string");
    expect(normalizzaTipo(undefined)).toBe("f64");
    expect(normalizzaTipo("real")).toBeUndefined();
    expect(categoriaDi("datetime")).toBe("tempo");
    expect(categoriaDi("i8")).toBe("intero");
  });
});
