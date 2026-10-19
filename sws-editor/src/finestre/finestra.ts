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

/** Gli oggetti della finestra con i parametri sostituiti. */
export function oggettiFinestra(page: SynopticPage, dati: Record<string, string> | undefined): SynopticObject[] {
  const eff = parametriFinestra(page, dati);
  return page.objects.map((o) => substituteFaceplateParams(o, eff));
}

/** Il titolo della finestra: quello dichiarato (con i parametri), o il nome della pagina. */
export function titoloFinestra(page: SynopticPage, dati: Record<string, string> | undefined): string {
  const t = page.finestra?.titolo?.trim();
  if (!t) return page.name;
  const eff = parametriFinestra(page, dati);
  return t.replace(/\{(\w+)\}/g, (_, k) => eff[k] ?? `{${k}}`);
}
