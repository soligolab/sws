import { describe, expect, it } from "vitest";
import { puoScrivere, sogliaScritturaTag } from "@/auth/permessoScrittura";
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
