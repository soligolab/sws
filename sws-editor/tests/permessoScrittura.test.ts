import { describe, expect, it } from "vitest";
import { puoScrivere, rangoRuolo, ruoloCheServe, sogliaEreditata, sogliaScritturaTag } from "@/auth/permessoScrittura";
import { isRoleAllowed } from "@/canvas/SvgCanvas";
import type { TagDef, TypeDef } from "@/types";

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

  it("la foglia di un'istanza prende la soglia del membro, come il server (04-11-2026)", () => {
    const tipi = [{ id: "pompa", members: [
      { name: "comando", data_type: "bool", write_min_role: "Viewer" },
      { name: "portata", data_type: "float" },
    ] }] as unknown as TypeDef[];
    const tag = [{ id: "p1", type_ref: "pompa" }, { id: "p2", type_ref: "pompa", write_min_role: "Supervisor" }] as unknown as TagDef[];
    // Il membro aperto vince sulla radice: è `build_tag_write_roles`.
    expect(sogliaScritturaTag(tag, "p1.comando", tipi)).toBe("Viewer");
    expect(sogliaScritturaTag(tag, "p2.comando", tipi)).toBe("Viewer");
    // Un membro senza soglia ripiega sulla radice, e poi su Operator.
    expect(sogliaScritturaTag(tag, "p2.portata", tipi)).toBe("Supervisor");
    expect(sogliaScritturaTag(tag, "p1.portata", tipi)).toBe("Operator");
    // Senza i tipi non si vede il membro: è il difetto che c'era.
    expect(sogliaScritturaTag(tag, "p1.comando")).toBe("Operator");
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

/** Il lucchetto (R7, 04-11-2026): il ruolo che manca, e se l'oggetto si
 *  attenua (lo chiede l'oggetto) o resta pieno (lo chiede la variabile). */
describe("il lucchetto sui comandi", () => {
  it("chi può non vede niente", () => {
    expect(ruoloCheServe({ type: "button", tag: "luce_stanza" }, null, TAG)).toBeNull();
    expect(ruoloCheServe({ type: "button", tag: "pompa" }, "Operator", TAG)).toBeNull();
    expect(ruoloCheServe({ type: "gauge", tag: "motore1" }, null, TAG)).toBeNull();
  });

  it("la variabile chiede il ruolo: lucchetto, oggetto pieno", () => {
    expect(ruoloCheServe({ type: "button", tag: "pompa" }, null, TAG)).toEqual({ ruolo: "Operator", attenua: false });
    expect(ruoloCheServe({ type: "slider", tag: "motore1.marcia" }, "Operator", TAG)).toEqual({ ruolo: "Supervisor", attenua: false });
  });

  it("l'oggetto chiede il ruolo: lucchetto e attenuato; vince il più severo", () => {
    expect(ruoloCheServe({ type: "button", tag: "luce_stanza", min_role: "Supervisor" }, "Operator", TAG))
      .toEqual({ ruolo: "Supervisor", attenua: true });
    expect(ruoloCheServe({ type: "button", tag: "motore1.marcia", min_role: "Operator" }, null, TAG))
      .toEqual({ ruolo: "Supervisor", attenua: true });
  });

  it("in sola lettura non comanda, e le righe scrivibili di una tabella sì", () => {
    expect(ruoloCheServe({ type: "slider", tag: "pompa", read_only: true }, null, TAG)).toBeNull();
    expect(ruoloCheServe({ type: "table", table_rows: [{ tag: "pompa", writable: true }] }, null, TAG))
      .toEqual({ ruolo: "Operator", attenua: false });
  });
});
