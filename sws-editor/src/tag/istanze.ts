/** Creare un'istanza di un tipo dalla scheda Tipi (03-10-2026).
 *
 *  Un tipo da solo non produce variabili: le sue parti esistono solo in una
 *  variabile che lo istanzia (`type_ref`). Al collaudo del 03-10 il maintainer
 *  aveva un tipo `hosts` e nessun posto da cui crearne un'istanza. */

/** Il nome proposto: l'id del tipo in minuscolo, reso unico (`hosts`, `hosts2`…). */
export function nomeIstanzaProposto(tipoId: string, esistenti: readonly string[]): string {
  const base = tipoId.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "istanza";
  const usati = new Set(esistenti);
  if (!usati.has(base)) return base;
  let n = 2;
  while (usati.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Perché un nome non va bene, come chiave i18n; `null` se va bene. Un id con
 *  `.` o `[` si confonderebbe con il percorso di una foglia (`sistema.cpu`). */
export function motivoNomeIstanza(nome: string, esistenti: readonly string[]): string | null {
  const n = nome.trim();
  if (n === "") return "tipiTab.nomeVuoto";
  if (/[\s.[\]]/.test(n)) return "tipiTab.nomeCaratteri";
  if (esistenti.includes(n)) return "tipiTab.nomeEsiste";
  return null;
}
