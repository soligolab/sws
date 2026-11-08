// Rinominare una funzione aggiorna chi la chiama (08-11-2026, piano della
// logica unificata, L1). Gli oggetti la citano per **nome** in `on_press_fn` e
// `on_release_fn` — sull'oggetto, nelle celle di una griglia, nelle sottocelle,
// nei figli — e fino a oggi una rinomina li lasciava a chiamare una funzione
// che non c'era più, senza un avviso.
//
// Un giro solo su tutto l'albero degli oggetti, a qualunque profondità: le
// forme che portano quei due campi sono quattro e ne nasceranno altre, e un
// elenco di percorsi da visitare sarebbe un elenco da tenere allineato.

const CAMPI = ["on_press_fn", "on_release_fn"] as const;

/** Una copia di `valore` con `vecchio` al posto di ogni chiamata, e quante ne
 *  ha cambiate. Senza cambi restituisce lo stesso oggetto (React confronta per
 *  identità). */
export function sostituisciFunzione<T>(valore: T, vecchio: string, nuovo: string): { valore: T; n: number } {
  if (Array.isArray(valore)) {
    let n = 0;
    const out = valore.map((v) => { const r = sostituisciFunzione(v, vecchio, nuovo); n += r.n; return r.valore; });
    return { valore: (n > 0 ? out : valore) as T, n };
  }
  if (valore === null || typeof valore !== "object") return { valore, n: 0 };
  let n = 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valore as Record<string, unknown>)) {
    if ((CAMPI as readonly string[]).includes(k) && v === vecchio) { out[k] = nuovo; n++; continue; }
    const r = sostituisciFunzione(v, vecchio, nuovo);
    out[k] = r.valore;
    n += r.n;
  }
  return { valore: (n > 0 ? out : valore) as T, n };
}
