// Il tubo che segue un oggetto in **moto su percorso** (Fase 3 del piano
// `docs/plans/2026-10-21-tubo-che-segue-gli-oggetti.md`, 26-10-2026).
//
// **Perché serve un modulo e non due righe.** Le Fasi 1 e 2 hanno fatto
// seguire il tubo agli oggetti mossi da un *binding* di geometria: lì la
// posizione sta nel modello, `resolveObject` la calcola e il tubo la legge.
// Il moto su percorso no: sul web lo fa il browser, con
// `offset-path`/`offset-distance` e una transizione CSS. Durante quei 300 ms
// la posizione **non esiste da nessuna parte** se non dentro il browser —
// non nel modello, non nei tag, che hanno già il valore d'arrivo.
//
// Il maintainer ha scelto la strada di chiederla al browser, ma **solo
// mentre l'oggetto si muove** (26-10-2026): a impianto fermo non si paga
// niente. Le altre due strade scartate: rifare l'interpolazione in
// TypeScript fa sfarfallare il tubo, perché il nostro conto e quello del
// browser non vanno mai esattamente allo stesso passo; togliere la
// transizione fa muovere tutto a scatti.
//
// **Come si legge la posizione, e perché non basta `getCTM()`.** Misurato in
// un Chromium vero il 26-10-2026, non dedotto: `getCTM()` **include**
// la trasformazione generata da `offset-path` (a metà di un tragitto 0→300
// dice 158,3). Ma include anche tutto ciò che sta sopra — lo zoom e la
// panoramica del canvas. Con `translate(40 10) scale(2)` sopra, la lettura
// grezza dava 680 dove lo scostamento vero era 150. Quindi si prende la
// matrice dell'elemento **relativa a quella del padre**, che è esatta in
// unità utente qualunque cosa ci sia sopra.

import { useEffect, useState } from "react";
import type { SynopticObject } from "@/types";

/** Quanto dura la transizione di un oggetto in moto, se non la dichiara.
 *  Stesso numero di `SvgCanvas` (`obj.transition_duration_ms ?? 300`). */
export const DURATA_MOTO_MS = 300;

/** Un filo oltre la fine della transizione: l'ultimo fotogramma arriva dopo
 *  l'istante teorico, e fermarsi esatti lascerebbe il tubo a un pixel dalla
 *  posizione finale finché qualcos'altro non ridisegna. */
const CODA_MS = 60;

/** L'oggetto si muove su un percorso? */
export function eInMoto(o: SynopticObject | undefined): boolean {
  return !!o?.motion_tag && !!o.motion_path && o.motion_path.length >= 2;
}

/** Gli oggetti a cui questo tubo è agganciato e che si muovono su un
 *  percorso. Vuoto = il tubo non ha niente da rincorrere, e non paga niente:
 *  è la stessa esclusione che su LVGL evita di ricalcolare ogni tubo della
 *  pagina a ogni fotogramma. */
export function ancoreInMoto(
  pipe: SynopticObject,
  objects: readonly SynopticObject[],
): SynopticObject[] {
  const ids = [pipe.from_obj_id, pipe.to_obj_id].filter(Boolean) as string[];
  if (!ids.length) return [];
  return objects.filter((o) => o.id && ids.includes(o.id) && eInMoto(o));
}

/** Lo scostamento **locale** di un oggetto in moto, in unità utente, letto
 *  dal browser. `null` quando l'elemento non c'è o l'ambiente non sa fare
 *  matrici (jsdom nei test): chi chiama resta alla posizione del modello,
 *  che è il comportamento di prima. */
export function scostamentoMoto(id: string | undefined): { dx: number; dy: number } | null {
  if (!id || typeof document === "undefined") return null;
  const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const el = document.querySelector(`[data-moto="${sel}"]`) as SVGGraphicsElement | null;
  const padre = el?.parentNode as SVGGraphicsElement | null;
  if (!el || !padre || typeof el.getCTM !== "function" || typeof padre.getCTM !== "function") return null;
  const m = el.getCTM();
  const pm = padre.getCTM();
  if (!m || !pm) return null;
  try {
    const rel = pm.inverse().multiply(m);
    return { dx: rel.e, dy: rel.f };
  } catch {
    // Una matrice non invertibile (scala zero, elemento non disegnato):
    // niente scostamento è meglio di un NaN che sposta il tubo all'infinito.
    return null;
  }
}

/** La firma dei valori che muovono queste ancore: cambia, e la rincorsa
 *  riparte. Esportata perché è la sola parte verificabile senza un browser. */
export function firmaDelMoto(
  ancore: readonly SynopticObject[],
  tagValues: Record<string, { value: unknown } | undefined>,
): string {
  return ancore.map((o) => `${o.id}=${String(tagValues[o.motion_tag!]?.value ?? "")}`).join("|");
}

/** Quanto dura la rincorsa: la transizione più lunga fra le ancore. */
export function durataDellaRincorsa(ancore: readonly SynopticObject[]): number {
  if (!ancore.length) return 0;
  return Math.max(...ancore.map((o) => o.transition_duration_ms ?? DURATA_MOTO_MS)) + CODA_MS;
}

/** **Ridisegna il tubo a ogni fotogramma finché l'ancora si muove.**
 *
 *  Non tiene nessuno stato della posizione: fa solo ripassare il componente,
 *  che a quel punto rilegge il browser con `scostamentoMoto`. Parte quando il
 *  valore di un `motion_tag` cambia e si ferma da sé alla fine della
 *  transizione — a impianto fermo nessun fotogramma, nessuna lettura. */
export function useSegueIlMoto(
  ancore: readonly SynopticObject[],
  tagValues: Record<string, { value: unknown } | undefined>,
): void {
  const [, ridisegna] = useState(0);
  const firma = firmaDelMoto(ancore, tagValues);
  const durata = durataDellaRincorsa(ancore);
  useEffect(() => {
    if (!durata || typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    const fine = performance.now() + durata;
    const giro = () => {
      ridisegna((n) => n + 1);
      if (performance.now() < fine) raf = requestAnimationFrame(giro);
    };
    raf = requestAnimationFrame(giro);
    return () => cancelAnimationFrame(raf);
  }, [firma, durata]);
}
