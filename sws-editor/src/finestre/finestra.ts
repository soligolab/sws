// Finestre popup generiche (P1, 17-10-2026, piano docs/archive/2026-10-17-finestre-popup.md):
// una pagina che si apre come finestra, modale o non modale, con parametri `{nome}`
// come i faceplate.

import type { SynopticObject, SynopticPage } from "@/types";
import { effectiveFaceplateParams, substituteFaceplateParams } from "@/canvas/SvgCanvas";

export const eFinestra = (p: Pick<SynopticPage, "finestra"> | undefined | null): boolean => !!p?.finestra;

/** I valori effettivi dei parametri: quelli passati dal bottone, poi i default
 *  della pagina. Stessa regola dei faceplate (`effectiveFaceplateParams`). */
export function parametriFinestra(page: SynopticPage, dati: Record<string, string> | undefined): Record<string, string> {
  return effectiveFaceplateParams(
    { id: page.id, label: page.name, params: page.finestra_parametri ?? [], objects: [] },
    dati,
  );
}

/** Le chiavi che non sono testo da tradurre, come `ESCLUSE` in `parametri.rs`. */
const NON_TESTO = new Set(["id", "type", "group_id", "faceplate_id"]);

/** Traduce i segnaposti `{{chiave}}` di ogni stringa, prima dei parametri
 *  (11-11-2026, piano parità LVGL §4): «Dettaglio di {nome}» arrivava solo con
 *  la traduzione al disegno, quando il `{nome}` non lo sostituiva più nessuno. */
function traduciProfondo<T>(v: T, tr: (s: string) => string): T {
  if (typeof v === "string") return (v.includes("{{") ? tr(v) : v) as T;
  if (Array.isArray(v)) return v.map((x) => traduciProfondo(x, tr)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = NON_TESTO.has(k) ? x : traduciProfondo(x, tr);
    return out as T;
  }
  return v;
}

/** Gli oggetti della finestra con i parametri sostituiti; `tr` traduce prima. */
export function oggettiFinestra(
  page: SynopticPage,
  dati: Record<string, string> | undefined,
  tr?: (s: string) => string,
): SynopticObject[] {
  const eff = parametriFinestra(page, dati);
  return page.objects.map((o) => substituteFaceplateParams(tr ? traduciProfondo(o, tr) : o, eff));
}

/** Il titolo della finestra: quello dichiarato (tradotto, con i parametri), o il nome della pagina. */
export function titoloFinestra(
  page: SynopticPage,
  dati: Record<string, string> | undefined,
  tr?: (s: string) => string,
): string {
  const grezzo = page.finestra?.titolo?.trim();
  if (!grezzo) return tr ? tr(page.name) : page.name;
  const t = tr ? tr(grezzo) : grezzo;
  const eff = parametriFinestra(page, dati);
  return t.replace(/\{(\w+)\}/g, (_, k) => eff[k] ?? `{${k}}`);
}
