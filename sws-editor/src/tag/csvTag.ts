// L'esportazione CSV di variabili e tipi (Fase 2 del piano tag, 22-09-2026).
//
// Un file solo per le due cose, su richiesta del maintainer: prima
// l'esportazione portava via solo le variabili, e un'istanza con
// `type_ref: Motore` senza la definizione di `Motore` è un file che non si può
// reimportare da nessuna parte.
//
// Righe eterogenee, distinte dalla prima colonna: `type` è la definizione di un
// tipo, `member` un suo membro (il tipo sta in `owner`), `tag` una variabile.
// Le colonne condivise stanno nelle stesse posizioni, così resta un foglio solo
// da aprire in un foglio di calcolo. Chi vuole un file stretto cancella le
// colonne che non gli servono: l'import non azzera ciò che il file non nomina.
//
// Sta in un modulo suo e non dentro `ConfigView.tsx`, che è già a 11 700 righe
// (vedi il seme `docs/plans/2026-09-22-riorganizzare-i-file-dell-editor.md`).

import type { TagDef, TypeDef } from "@/types";

/** L'ordine delle colonne. `kind` e `owner` dicono cos'è la riga, il resto
 *  sono i campi che l'import sa applicare — tutti, perché «preservare i dati»
 *  vuol dire che un giro esporta→importa non perde niente. */
export const COLONNE_CSV = [
  "kind", "owner", "id", "data_type", "type_ref", "array", "description",
  "unit", "decimals", "history", "history_deadband", "history_min_interval_ms",
  "expression", "write_min_role", "raw_min", "raw_max", "eng_min", "eng_max",
  "range_lo", "range_hi", "limit_lo_lo", "limit_lo", "limit_hi", "limit_hi_hi",
] as const;

/** Le dimensioni con la «x» (`2x3`): dentro un CSV una virgola costringerebbe
 *  alle virgolette ogni riga di un array, e il file si aprirebbe storto. */
function cella(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join("x");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function riga(campi: Record<string, unknown>): string {
  return COLONNE_CSV.map((c) => cella(campi[c]))
    .map((v) => (v.includes(",") || v.includes("\n") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v))
    .join(",");
}

/** Il file: prima i tipi con i loro membri, poi le variabili. L'ordine conta —
 *  l'import applica i tipi per primi, perché un'istanza senza il suo tipo è
 *  una forma che non sta in piedi. */
export function csvVariabiliETipi(
  tags: readonly TagDef[],
  types: readonly TypeDef[],
): string {
  const righe: string[] = [];
  for (const td of types) {
    righe.push(riga({ kind: "type", id: td.id, description: td.description }));
    for (const m of td.members ?? []) {
      // `name` del membro finisce in `id`: una colonna sola per «come si
      // chiama questa cosa», qualunque cosa sia la riga.
      righe.push(riga({ ...m, kind: "member", owner: td.id, id: m.name }));
    }
  }
  for (const tg of tags) {
    righe.push(riga({ ...tg, kind: "tag", data_type: tg.data_type ?? "float", history: !!tg.history }));
  }
  return [COLONNE_CSV.join(","), ...righe].join("\n");
}
