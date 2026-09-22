import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n";
import { FormaNonValida, foglieDi } from "../src/tag/forma";
import type { TagDef, TypeDef } from "../src/types";

/** La forma di una variabile composita. **I casi non stanno qui**: stanno in
 *  `tests/fixtures/forme-tag.json`, alla radice del repo, e li legge anche il
 *  test Rust di `sws_core::percorso`. Due calcoli separati della forma
 *  divergerebbero in silenzio, e la divergenza si vedrebbe come un percorso
 *  che l'IDE offre e il runtime non ha. */
type Caso = { nome: string; types: TypeDef[]; tag: TagDef; foglie: { percorso: string; tipo: string }[] };
type Errore = { nome: string; types: TypeDef[]; tag: TagDef; cita: string; codice: string };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/forme-tag.json"), "utf8"),
) as { casi: Caso[]; errori: Errore[] };

describe("foglieDi — la stessa tabella di forme del runtime", () => {
  for (const c of fixture.casi) {
    it(c.nome, () => {
      const avute = foglieDi(c.tag, c.types).map((f) => ({ percorso: f.percorso, tipo: f.tipo }));
      expect(avute).toEqual(c.foglie);
    });
  }

  for (const c of fixture.errori) {
    it(`errore: ${c.nome}`, () => {
      // Si confronta il **codice**, non il messaggio: il messaggio passa dal
      // catalogo e cambia con la lingua dell'interfaccia. `cita` è per il
      // test Rust, dove il messaggio è la cosa che l'utente legge.
      let preso: unknown;
      try {
        foglieDi(c.tag, c.types);
      } catch (e) {
        preso = e;
      }
      expect(preso, "doveva lanciare").toBeInstanceOf(FormaNonValida);
      expect((preso as FormaNonValida).codice).toBe(c.codice);
      expect((preso as FormaNonValida).message).not.toBe("");
    });
  }
});

describe("foglieDi — i metadati del membro arrivano alla foglia", () => {
  it("unità, scala e storico si leggono dal tipo", () => {
    const types: TypeDef[] = [
      { id: "M", members: [
        { name: "v", data_type: "f32", unit: "rpm", raw_min: 0, raw_max: 100, eng_min: 0, eng_max: 3000, history: false },
      ]},
    ];
    const [f] = foglieDi({ id: "m1", description: "", type_ref: "M" } as TagDef, types);
    expect(f.percorso).toBe("m1.v");
    expect(f.membro?.unit).toBe("rpm");
    expect(f.membro?.eng_max).toBe(3000);
    expect(f.membro?.history).toBe(false);
  });

  it("gli elementi di un array dichiarato sul tag non hanno membro", () => {
    const foglie = foglieDi({ id: "m", description: "", data_type: "u16", array: [2] } as TagDef, []);
    expect(foglie).toHaveLength(2);
    expect(foglie[0].membro).toBeUndefined();
  });
});
