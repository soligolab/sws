import { describe, it, expect } from "vitest";
import { raggruppa, titoloGruppo } from "@/components/WelcomeScreen";
import type { ProjectListEntry } from "@/types";

const base: ProjectListEntry = {
  name: "p", riferimento: "-/p", has_project_yaml: true,
  last_modified_ms: 0, path: "/x", last_opened_ms: 0, external: false,
};
const p = (o: Partial<ProjectListEntry>): ProjectListEntry => ({ ...base, ...o });

describe("titoloGruppo", () => {
  it("mette insieme motore e risoluzione", () => {
    expect(titoloGruppo(p({ motore: "web", risoluzione: "1024×600" }))).toBe("WEB · 1024×600");
    expect(titoloGruppo(p({ motore: "lvgl", risoluzione: "800×480" }))).toBe("LVGL · 800×480");
  });

  it("con uno solo dei due non lascia il separatore a penzoloni", () => {
    expect(titoloGruppo(p({ motore: "web" }))).toBe("WEB");
    expect(titoloGruppo(p({ risoluzione: "16:9" }))).toBe("16:9");
  });

  it("senza niente non inventa un titolo", () => {
    // Runtime più vecchio: i due campi non arrivano proprio.
    expect(titoloGruppo(p({}))).toBeUndefined();
  });
});

describe("raggruppa", () => {
  it("raccoglie per tecnologia e risoluzione", () => {
    const g = raggruppa([
      p({ name: "a", motore: "web", risoluzione: "1024×600" }),
      p({ name: "b", motore: "lvgl", risoluzione: "800×480" }),
      p({ name: "c", motore: "web", risoluzione: "1024×600" }),
    ]);
    expect(g.map((x) => x.titolo)).toEqual(["LVGL · 800×480", "WEB · 1024×600"]);
    expect(g[1].elenco.map((x) => x.name)).toEqual(["a", "c"]);
  });

  it("le aziende altrui restano separate, qualunque sia il formato", () => {
    // È la riga «da qui in giù non è tuo»: mescolare i progetti di un altro
    // cliente fra i propri perché hanno la stessa risoluzione sarebbe proprio
    // il guasto che quella separazione evita.
    const g = raggruppa([
      p({ name: "mio", motore: "web", risoluzione: "1024×600" }),
      p({ name: "altrui", motore: "web", risoluzione: "1024×600", altra_azienda: true }),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].altra).toBe(false);
    expect(g[0].elenco.map((x) => x.name)).toEqual(["mio"]);
    expect(g[1].altra).toBe(true);
  });

  it("quelli senza formato vanno in fondo", () => {
    const g = raggruppa([
      p({ name: "ignoto" }),
      p({ name: "noto", motore: "web", risoluzione: "1024×600" }),
    ]);
    expect(g.map((x) => x.titolo)).toEqual(["WEB · 1024×600", undefined]);
  });

  it("un runtime più vecchio non cambia niente: un gruppo solo", () => {
    const g = raggruppa([p({ name: "a" }), p({ name: "b" })]);
    expect(g).toHaveLength(1);
    expect(g[0].titolo).toBeUndefined();
    expect(g[0].elenco).toHaveLength(2);
  });
});
