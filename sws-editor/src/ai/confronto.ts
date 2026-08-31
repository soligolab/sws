/**
 * Confronto profondo insensibile all'ordine delle chiavi.
 *
 * # Perché serve
 *
 * `GET /api/synoptics/:name` restituisce la pagina **nell'ordine in cui i campi
 * stanno nel file YAML**; una proposta dell'assistente passa dalla struct Rust
 * e quindi esce nell'ordine di dichiarazione. Gli oggetti sono gli stessi —
 * stesse chiavi, stessi valori — ma `JSON.stringify` li vede diversi.
 *
 * Misurato il 2026-08-31: su una proposta che aggiungeva **un** bottone, 46
 * oggetti su 47 risultavano «modificati». Un diff così nessuno lo rilegge, ed è
 * esattamente il rischio contro cui il diff esiste.
 */
export function uguale(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    // `undefined` e campo assente sono la stessa cosa in questo modello: serde
    // salta gli `Option::None` invece di scriverli `null`.
    return (a ?? null) === (b ?? null);
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => uguale(x, b[i]));
  }
  if (typeof a === "object") {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    // Le chiavi con valore `undefined` non contano, per la stessa ragione.
    const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
    const kb = Object.keys(ob).filter((k) => ob[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in ob && uguale(oa[k], ob[k]));
  }
  return false;
}
