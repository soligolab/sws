// I faceplate disegnati sul canvas (29-10-2026, piano
// docs/archive/2026-10-27-faceplate-disegnato-sul-canvas.md).
//
// Nell'IDE un faceplate si modifica come una pagina: è una pagina dello store
// con `kind: "faceplate"`, come le cornici hanno `kind: "cornice"`. Su disco
// vive in `faceplates/<id>.yaml` con la sua forma (`FaceplateDef`): queste
// funzioni passano dall'una all'altra. Prima lo si scriveva in JSON in una
// textarea della Configurazione.

import type { FaceplateDef, FaceplateParamDef, SynopticObject, SynopticPage } from "@/types";
import { faceplateDefBBox, normalizeFaceplateParams } from "./definizione";

/** Il tipo del trascinamento di un faceplate dal suo ramo sul canvas. */
export const TRASCINA_FACEPLATE = "application/x-sws-faceplate";

/** Prefisso dell'id della pagina-faceplate nello store, per non collidere con le pagine. */
const PREFISSO_PAGINA = "faceplate:";

/** I faceplate che il runtime porta con sé (`BUILTIN_FACEPLATES` in
 *  `sws-web/src/router.rs`): si personalizzano e si ripristinano, non si
 *  eliminano. */
export type OrigineFaceplate = "intatto" | "personalizzato";

export const eFaceplateDef = (p: { kind?: string } | undefined | null): boolean => p?.kind === "faceplate";

export function pagineFaceplate<T extends { kind?: string }>(pages: readonly T[]): T[] {
  return pages.filter((p) => eFaceplateDef(p));
}

/** L'id del faceplate di una pagina-faceplate dello store. */
export function idFaceplate(p: Pick<SynopticPage, "id">): string {
  return p.id.startsWith(PREFISSO_PAGINA) ? p.id.slice(PREFISSO_PAGINA.length) : p.id;
}

export function idPaginaDiFaceplate(id: string): string {
  return PREFISSO_PAGINA + id;
}

/** La pagina con cui un faceplate si apre sul canvas. La misura è quella
 *  dichiarata, o — per i faceplate nati prima che esistesse — il riquadro dei
 *  figli, che è esattamente quello che le istanze usano già per scalare. */
export function faceplateAPagina(def: FaceplateDef, origine?: OrigineFaceplate): SynopticPage {
  const box = faceplateDefBBox(def);
  return {
    id: idPaginaDiFaceplate(def.id),
    name: def.label || def.id,
    kind: "faceplate",
    width: def.width ?? box.w,
    height: def.height ?? box.h,
    objects: def.objects ?? [],
    faceplate_parametri: normalizeFaceplateParams(def),
    ...(origine ? { faceplate_predefinito: origine } : {}),
  };
}

/** La definizione da salvare. I parametri si scrivono sempre nella forma
 *  tipizzata: quella a stringhe nude dei predefiniti si normalizza al primo
 *  salvataggio, ed è accettata ovunque. La misura si scrive sempre: da qui in
 *  avanti la decide chi disegna, non il riquadro dei figli. */
export function paginaAFaceplate(p: SynopticPage): FaceplateDef {
  return {
    id: idFaceplate(p),
    label: p.name,
    params: p.faceplate_parametri ?? [],
    objects: p.objects,
    width: p.width,
    height: p.height,
  };
}

/** I valori con cui i figli si vedono sul canvas mentre si disegna: il
 *  predefinito, o il nome del parametro se non ne ha uno — un segnaposto
 *  leggibile, la stessa regola dell'anteprima che c'era nella Configurazione. */
export function anteprimaParametri(params: readonly FaceplateParamDef[] | undefined): Record<string, string> {
  return Object.fromEntries((params ?? []).map((p) => [p.name, p.default ?? p.name]));
}

export interface UsiDelFaceplate {
  istanze: number;
  popup: number;
  pagine: string[];
}

/** Dove un faceplate è usato: istanze piazzate e pulsanti che lo aprono come
 *  popup, pagina per pagina. */
export function usiDelFaceplate(pages: readonly SynopticPage[], id: string): UsiDelFaceplate {
  const nomi = new Set<string>();
  let istanze = 0;
  let popup = 0;
  for (const pg of pages) {
    if (eFaceplateDef(pg) && idFaceplate(pg) === id) continue;
    for (const o of pg.objects) {
      if (o.type === "faceplate" && o.faceplate_id === id) { istanze++; nomi.add(pg.name); }
      if (o.button_action?.type === "open_faceplate" && o.button_action.faceplate_id === id) { popup++; nomi.add(pg.name); }
    }
  }
  return { istanze, popup, pagine: [...nomi] };
}

/** Un faceplate non si mette dentro un faceplate: il pannello non lo disegna
 *  (`render_faceplate` in LVGL lo salta), e sul web l'annidamento non ha una
 *  guardia di ciclo. Vale per gli oggetti e per i loro figli di griglia. */
export function contieneFaceplate(objects: readonly SynopticObject[]): boolean {
  return objects.some((o) => o.type === "faceplate");
}

/** La firma di una definizione: il salvataggio scrive solo i faceplate che
 *  cambiano. Risalvare un predefinito identico lo materializzerebbe come file
 *  del progetto, e da lì non seguirebbe più gli aggiornamenti del runtime. */
export function firmaFaceplate(p: SynopticPage): string {
  return JSON.stringify(paginaAFaceplate(p));
}

/** Un id libero per un faceplate nuovo, ricavato dal nome. */
export function idFaceplateLibero(nome: string, usati: ReadonlySet<string>): string {
  const base = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "faceplate";
  if (!usati.has(base)) return base;
  let n = 2;
  while (usati.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
