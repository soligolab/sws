// Il configuratore dei moduli (25-10-2026, piano
// `docs/plans/2026-10-04-configuratore-moduli.md`): il progetto dice com'è
// configurato ogni modulo, e il runtime, a ogni sessione, scrive solo le
// differenze. Qui le funzioni pure che l'IDE usa per compilare il setup dal
// catalogo: ogni voce del setup è completa (indirizzo di lettura e di
// scrittura), perché il runtime il catalogo non lo legge.
import type { ParametroSetup, RegistroCatalogo, VoceCatalogo } from "@/types";

/** I parametri che il progetto può fissare: gruppo «configurazione»,
 *  scrivibili, non esclusi dal catalogo (`setup: false` su indirizzo, baud,
 *  parità: cambiarli dal progetto spezzerebbe la comunicazione). */
export function parametriSetup(voce: VoceCatalogo): RegistroCatalogo[] {
  return voce.registri.filter((r) => r.gruppo === "configurazione" && r.accesso === "rw" && r.setup !== false && !r.bit);
}

/** Dove si scrive un parametro letto a `indirizzo`: sugli MCM260X l'area
 *  2001-2100 si scrive 2000 più in là, che salva in memoria dopo 10 s invece
 *  che a ogni scrittura. `undefined` = dove si legge. */
export function indirizzoScrittura(voce: VoceCatalogo, indirizzo: number): number | undefined {
  const r = voce.modbus?.setup_ritardato;
  return r && indirizzo >= r.da && indirizzo <= r.a ? indirizzo + r.scostamento : undefined;
}

/** Il setup con un parametro fissato a `valore`, o tolto (`undefined` = non
 *  gestito: il modulo resta com'è). L'ordine segue quello del catalogo. */
export function conParametro(
  setup: readonly ParametroSetup[] | undefined,
  voce: VoceCatalogo,
  reg: RegistroCatalogo,
  valore: number | undefined,
): ParametroSetup[] {
  const altri = (setup ?? []).filter((p) => p.nome !== reg.nome);
  if (valore === undefined) return altri;
  const scrittura = indirizzoScrittura(voce, reg.indirizzo);
  const nuovo: ParametroSetup = { nome: reg.nome, indirizzo: reg.indirizzo, valore, ...(scrittura !== undefined ? { indirizzo_scrittura: scrittura } : {}) };
  const ordine = parametriSetup(voce).map((r) => r.nome);
  return [...altri, nuovo].sort((a, b) => ordine.indexOf(a.nome) - ordine.indexOf(b.nome));
}
