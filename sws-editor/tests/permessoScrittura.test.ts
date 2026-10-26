import { describe, expect, it } from "vitest";
import { puoScrivere, rangoRuolo, sogliaEreditata, sogliaScritturaTag } from "@/auth/permessoScrittura";
import { isRoleAllowed } from "@/canvas/SvgCanvas";
import type { TagDef } from "@/types";

/** La tabella del piano 2026-10-25-scrittura-senza-login: tag e oggetto valgono
 *  tutti e due, e vince il più severo. */
const TAG = [
  { id: "luce_stanza", write_min_role: "Viewer" },
  { id: "pompa" },
  { id: "motore1", write_min_role: "Supervisor" },
] as unknown as TagDef[];

/** Il pulsante comanda? Prima l'oggetto (canvas), poi il tag (RuntimeView). */
const comanda = (minRoleOggetto: string | undefined, tag: string, ruolo: string | null) =>
  isRoleAllowed(minRoleOggetto, ruolo) && puoScrivere(sogliaScritturaTag(TAG, tag), ruolo);

describe("chi comanda un tag dal viewer", () => {
  it("la soglia del tag: la sua, quella della radice dell'istanza, o Operator", () => {
    expect(sogliaScritturaTag(TAG, "luce_stanza")).toBe("Viewer");
    expect(sogliaScritturaTag(TAG, "pompa")).toBe("Operator");
    expect(sogliaScritturaTag(TAG, "motore1.marcia")).toBe("Supervisor");
    expect(sogliaScritturaTag(TAG, "sconosciuto")).toBe("Operator");
  });

  it("A (stanza): tag Chiunque, oggetto senza vincolo → l'anonimo comanda", () => {
    expect(comanda(undefined, "luce_stanza", "Viewer")).toBe(true);
    // Prima che whoami risponda il ruolo è null: conta come anonimo, non come niente.
    expect(comanda(undefined, "luce_stanza", null)).toBe(true);
  });

  it("B (pagina tecnica): stesso tag, oggetto da Operator → serve il login", () => {
    expect(comanda("Operator", "luce_stanza", "Viewer")).toBe(false);
    expect(comanda("Operator", "luce_stanza", "Operator")).toBe(true);
  });

  it("un tag senza soglia resta Operator anche con l'oggetto senza vincolo — com'era", () => {
    expect(comanda(undefined, "pompa", "Viewer")).toBe(false);
    expect(comanda(undefined, "pompa", "Operator")).toBe(true);
  });
});

/** La soglia che il pannello proprietà mostra nel campo «ruolo minimo»
 *  dell'oggetto (26-10-2026): quella che l'oggetto eredita dai tag che
 *  scrive. Nasce da uno slider che chiedeva il login senza che niente
 *  nell'oggetto lo facesse prevedere — il tag non aveva soglia, e un tag
 *  senza soglia vale Operator. */
describe("la soglia che l'oggetto eredita dalle sue variabili", () => {
  it("uno slider eredita la soglia del suo tag", () => {
    expect(sogliaEreditata(TAG, { type: "slider", tag: "luce_stanza" })).toBe("Viewer");
    expect(sogliaEreditata(TAG, { type: "slider", tag: "motore1" })).toBe("Supervisor");
  });

  it("**un tag senza soglia eredita Operator**, ed è il caso che ha ingannato", () => {
    expect(sogliaEreditata(TAG, { type: "slider", tag: "pompa" })).toBe("Operator");
  });

  it("chi non scrive niente non eredita niente", () => {
    expect(sogliaEreditata(TAG, { type: "gauge", tag: "luce_stanza" })).toBeUndefined();
    expect(sogliaEreditata(TAG, { type: "slider" })).toBeUndefined();
  });

  it("con più assegnazioni vince la più severa: servono tutte per usarlo", () => {
    const obj = { type: "button", assegnazioni: [{ tag: "luce_stanza" }, { tag: "motore1" }] };
    expect(sogliaEreditata(TAG, obj)).toBe("Supervisor");
  });

  it("il simbolo guarda il suo command_tag, non il tag che mostra", () => {
    const obj = { type: "symbol", tag: "motore1", command_tag: "luce_stanza" };
    expect(sogliaEreditata(TAG, obj)).toBe("Viewer");
  });

  it("i ranghi si ordinano, e un nome sconosciuto vale Viewer come sul pannello", () => {
    expect(rangoRuolo("Admin")).toBeGreaterThan(rangoRuolo("Supervisor"));
    expect(rangoRuolo("Supervisor")).toBeGreaterThan(rangoRuolo("Operator"));
    expect(rangoRuolo("Operator")).toBeGreaterThan(rangoRuolo("Viewer"));
    expect(rangoRuolo("boh")).toBe(rangoRuolo("Viewer"));
  });
});
