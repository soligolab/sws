// Le pagine di boot (T-72): le regole pure che tengono l'IDE d'accordo con sé stesso.
import { describe, expect, it } from "vitest";
import {
  BOOT_TYPES, chiavePagina, eBoot, nomeBootLibero, paginePerNavigazione, pagineDiBoot, sinotticiPoiBoot,
} from "@/boot/tipi";
import { findBrokenNavLinks, findOrphanPageIds, pickInitialPageId } from "@/pageLayout";
import { gruppiPerTipo, gruppoEffettivo } from "@/editor/EditorShell";
import type { SynopticPage } from "@/types";

const sin = (id: string, name = id): SynopticPage => ({ id, name, objects: [] });
const boot = (id: string, name = id): SynopticPage => ({ id, name, objects: [], kind: "boot" });

describe("l'elenco delle pagine", () => {
  it("le pagine di boot non sono pagine di navigazione", () => {
    const tutte = [sin("a"), boot("b"), sin("c")];
    expect(paginePerNavigazione(tutte).map((p) => p.id)).toEqual(["a", "c"]);
    expect(pagineDiBoot(tutte).map((p) => p.id)).toEqual(["b"]);
  });

  it("i sinottici stanno prima e le pagine di boot in coda, senza cambiare l'ordine dentro i due gruppi", () => {
    const tutte = [boot("b1"), sin("a"), boot("b2"), sin("c")];
    expect(sinotticiPoiBoot(tutte).map((p) => p.id)).toEqual(["a", "c", "b1", "b2"]);
  });

  it("una sinottica e una di boot con lo stesso nome hanno chiavi diverse", () => {
    expect(chiavePagina(sin("a", "Home"))).toBe("Home");
    expect(chiavePagina(boot("b", "Home"))).toBe("boot/Home");
  });

  it("il nome di una nuova pagina di boot non collide con quelle che ci sono", () => {
    const tutte = [boot("b1", "Immagine di boot"), boot("b2", "Immagine di boot 2"), sin("s", "Immagine di boot 3")];
    expect(nomeBootLibero(tutte, "Immagine di boot")).toBe("Immagine di boot 3");
    expect(nomeBootLibero([], "Immagine di boot")).toBe("Immagine di boot");
  });
});

describe("dove una pagina di boot non deve comparire", () => {
  it("la pagina iniziale non è mai una pagina di boot", () => {
    expect(pickInitialPageId([boot("b"), sin("a")], undefined)).toBe("a");
    expect(pickInitialPageId([boot("b"), sin("a")], "b")).toBe("a");
  });

  it("una pagina di boot non è «orfana»: nessun pulsante potrebbe raggiungerla", () => {
    const orfane = findOrphanPageIds([sin("a"), sin("c"), boot("b")], "a");
    expect(orfane.has("b")).toBe(false);
    expect(orfane.has("c")).toBe(true);
  });

  it("un pulsante che punta a una pagina di boot ha il collegamento rotto", () => {
    const p = sin("a");
    p.objects = [{ id: "n", type: "navbutton", x: 0, y: 0, target_page: "b" }];
    expect(findBrokenNavLinks([p, boot("b")]).map((x) => x.targetId)).toEqual(["b"]);
  });
});

describe("il pannello proprietà di una pagina di boot", () => {
  it("mostra solo oggetto, testo e resa: niente dati, eventi né comportamento", () => {
    expect(gruppiPerTipo("rect", true).map((g) => g.id)).toEqual(["oggetto", "resa"]);
    expect(gruppiPerTipo("text", true).map((g) => g.id)).toEqual(["oggetto", "testo", "resa"]);
    expect(gruppiPerTipo("rect").map((g) => g.id)).toContain("dato");
  });

  it("un gruppo scelto altrove ripiega su Oggetto entrando in una pagina di boot", () => {
    expect(gruppoEffettivo("dato", "rect", true)).toBe("oggetto");
    expect(gruppoEffettivo("dato", undefined, true)).toBe("oggetto");
    expect(gruppoEffettivo("resa", "rect", true)).toBe("resa");
  });
});

describe("i tipi ammessi", () => {
  it("sono solo vettoriali statici", () => {
    for (const t of ["trend", "table", "button", "gauge", "grid", "slider"]) {
      expect(BOOT_TYPES).not.toContain(t);
    }
    expect(eBoot({ kind: "boot" })).toBe(true);
    expect(eBoot({})).toBe(false);
  });
});
