/** Cornici di pagina (15-10-2026): la composizione dell'editor è quella del
 *  runtime (`sws-web/src/cornici.rs`), sulla stessa fixture. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { corniceAPagina, corniceDellaPagina, oggettiComposti, paginaACornice } from "../src/cornici/modello";
import type { Cornice, SynopticPage } from "../src/types";

const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/cornici.json"), "utf8")) as {
  progetto: string; cornice: Cornice; pagina: SynopticPage; atteso: Record<string, unknown>[];
};

describe("cornici — la stessa composizione del runtime", () => {
  it("oggetti composti: ordine, id, segnaposti, capi agganciati", () => {
    const out = oggettiComposti(fx.cornice, { paginaNome: fx.pagina.name, paginaId: fx.pagina.id, progettoNome: fx.progetto });
    expect(out.map((o) => o.id)).toEqual(fx.atteso.map((a) => a.id));
    fx.atteso.forEach((a, i) => expect(out[i]).toMatchObject(a));
  });
  it("una cornice fa il giro pagina dello store → file senza perdere niente", () => {
    expect(paginaACornice(corniceAPagina(fx.cornice))).toEqual(fx.cornice);
  });
  it("i tre stati della cornice di una pagina", () => {
    const p = (cornice?: string | null): SynopticPage => ({ id: "p", name: "P", objects: [], ...(cornice !== undefined ? { cornice } : {}) });
    expect(corniceDellaPagina(p(), "base")).toBe("base");
    expect(corniceDellaPagina(p(), undefined)).toBe(null);
    expect(corniceDellaPagina(p(null), "base")).toBe(null);
    expect(corniceDellaPagina(p("altra"), "base")).toBe("altra");
    expect(corniceDellaPagina({ ...p("altra"), kind: "boot" }, "base")).toBe(null);
  });
});
