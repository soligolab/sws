// Il formato predefinito di progetto (T-72 F3): la regola «la prima pagina
// modificata definisce lo stile delle altre».
//
// Il progetto tiene, in `page_layout`, misure e sfondo predefiniti. Servono a
// tre cose: una pagina nuova nasce con quelle misure; la **prima** volta che
// l'utente imposta misure o sfondo su una pagina e il predefinito è ancora
// vuoto, lo riempie con quel valore e lo **materializza** sulle pagine che non
// hanno un valore proprio; e un pulsante lo riapplica su richiesta.
//
// Si materializza, invece di risolvere al volo, perché il viewer LVGL legge
// `width`/`height` dalla pagina e non dal progetto: pagine intonse senza valore
// farebbero divergere web e LVGL, cioè esattamente la regola WYSIWYG che qui si
// tiene ferma. Le pagine salvate hanno sempre valori espliciti.
//
// Funzioni pure: niente store, niente rete.

import { BOOT_ALTEZZA, BOOT_LARGHEZZA, BOOT_SFONDO, eBoot } from "@/boot/tipi";
import { effectiveSizeMode } from "@/pageLayout";
import type { PageLayoutConfig, SynopticPage } from "@/types";

export type FormatoPagina = Partial<Pick<SynopticPage, "width" | "height" | "background" | "background_dark">>;

type Layout = Pick<PageLayoutConfig, "size_mode" | "default_width" | "default_height" | "default_background" | "default_background_dark"> & Partial<PageLayoutConfig>;

const pieno = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const testo = (s: string | undefined): s is string => typeof s === "string" && s.trim() !== "";

/** Le misure e lo sfondo con cui nasce una pagina nuova.
 *
 *  Sinottica: in modalità «fisso» misure e sfondi del predefinito; in «rapporto»
 *  le misure le scrive già Q38 (la risoluzione di riferimento) e qui restano gli
 *  sfondi; in «fluido» non ci sono misure per definizione. Pagina di boot: le
 *  misure sono sempre esplicite (sono la risoluzione del PNG) — predefinito di
 *  progetto se c'è, altrimenti 1280×800 — e conta un solo sfondo. */
export function valoriDiNascita(layout: PageLayoutConfig | undefined | null, tipo: "sinottica" | "boot"): FormatoPagina {
  if (tipo === "boot") {
    return {
      width: pieno(layout?.default_width) ? layout!.default_width : BOOT_LARGHEZZA,
      height: pieno(layout?.default_height) ? layout!.default_height : BOOT_ALTEZZA,
      background: testo(layout?.default_background) ? layout!.default_background : BOOT_SFONDO,
    };
  }
  const out: FormatoPagina = {};
  if (effectiveSizeMode(layout ?? undefined) === "fixed") {
    if (pieno(layout?.default_width)) out.width = layout!.default_width;
    if (pieno(layout?.default_height)) out.height = layout!.default_height;
  }
  if (testo(layout?.default_background)) out.background = layout!.default_background;
  if (testo(layout?.default_background_dark)) out.background_dark = layout!.default_background_dark;
  return out;
}

/** Se `patch` è la prima impostazione esplicita di qualcosa che il progetto non
 *  ha ancora come predefinito, il layout con quel predefinito riempito. `null`
 *  se non c'è niente da riempire. Le misure non contano in modalità «rapporto»
 *  (sono comuni a tutte le pagine per costruzione) né «fluido». */
export function primaImpostazione(layout: Layout | undefined | null, patch: FormatoPagina): Layout | null {
  const base: Layout = layout ?? { size_mode: "fixed" };
  const misure = effectiveSizeMode(base) === "fixed";
  const nuovo: Layout = { ...base };
  let cambiato = false;
  if (misure && pieno(patch.width) && !pieno(base.default_width)) { nuovo.default_width = patch.width; cambiato = true; }
  if (misure && pieno(patch.height) && !pieno(base.default_height)) { nuovo.default_height = patch.height; cambiato = true; }
  if (testo(patch.background) && !testo(base.default_background)) { nuovo.default_background = patch.background; cambiato = true; }
  if (testo(patch.background_dark) && !testo(base.default_background_dark)) { nuovo.default_background_dark = patch.background_dark; cambiato = true; }
  return cambiato ? nuovo : null;
}

/** Cosa scrivere sulle pagine che non hanno un valore proprio, perché prendano
 *  il predefinito.
 *
 *  Una pagina di boot ha sempre misure esplicite (nasce a 1280×800, sfondo
 *  neutro): finché ha ancora **esattamente** quei valori di nascita non ne ha di
 *  suoi, e conta come «senza formato proprio». Senza questo la regola non
 *  funzionerebbe fra le due pagine con cui nasce ogni progetto — impostare
 *  1024×600 su Page 1 lascerebbe la pagina di boot a 1280×800. Costa un caso
 *  limite dichiarato: una pagina di boot lasciata di proposito a 1280×800
 *  prende comunque il predefinito la prima volta. */
export function patchDaPredefinito(
  pages: readonly SynopticPage[],
  layout: Layout | undefined | null,
): { id: string; patch: FormatoPagina }[] {
  if (!layout) return [];
  const misure = effectiveSizeMode(layout) === "fixed";
  const out: { id: string; patch: FormatoPagina }[] = [];
  for (const p of pages) {
    const patch: FormatoPagina = {};
    if (eBoot(p)) {
      // Le misure di una pagina di boot non dipendono dalla modalità del progetto.
      if (p.width === BOOT_LARGHEZZA && pieno(layout.default_width) && layout.default_width !== BOOT_LARGHEZZA) patch.width = layout.default_width;
      if (p.height === BOOT_ALTEZZA && pieno(layout.default_height) && layout.default_height !== BOOT_ALTEZZA) patch.height = layout.default_height;
      if (p.background === BOOT_SFONDO && testo(layout.default_background) && layout.default_background !== BOOT_SFONDO) patch.background = layout.default_background;
      if (Object.keys(patch).length > 0) out.push({ id: p.id, patch });
      continue;
    }
    if (misure && !pieno(p.width) && pieno(layout.default_width)) patch.width = layout.default_width;
    if (misure && !pieno(p.height) && pieno(layout.default_height)) patch.height = layout.default_height;
    if (!testo(p.background) && testo(layout.default_background)) patch.background = layout.default_background;
    if (!testo(p.background_dark) && testo(layout.default_background_dark)) patch.background_dark = layout.default_background_dark;
    if (Object.keys(patch).length > 0) out.push({ id: p.id, patch });
  }
  return out;
}

/** Che genere di pagina è, per «Applica a tutte le pagine» (05-11-2026). */
export type GenerePagina = "pagina" | "finestra" | "cornice" | "faceplate" | "boot";

/** Le pagine già spuntate in «Applica a tutte le pagine»: le pagine normali,
 *  le cornici e l'immagine di boot. Una finestra ha di proposito una misura sua,
 *  più piccola della pagina; un faceplate non segue mai il progetto. */
export const SPUNTATA_DI_PARTENZA: Readonly<Record<GenerePagina, boolean>> = {
  pagina: true, cornice: true, boot: true, finestra: false, faceplate: false,
};

/** «Applica a tutte le pagine» (05-11-2026, richiesta del maintainer): il
 *  formato del progetto **sopra** quello delle pagine scelte, anche dove ne
 *  avevano uno loro. Al contrario di `patchDaPredefinito`, qui il valore della
 *  pagina non conta: conta cosa si è scelto di applicare.
 *
 *  - la misura vale con il dimensionamento fisso, e sul boot sempre (come sopra);
 *  - gli sfondi non toccano cornici e faceplate, che uno sfondo loro non ce
 *    l'hanno; sul boot c'è il solo sfondo chiaro;
 *  - lo sfondo scuro del progetto vuoto toglie quello della pagina: «come lo
 *    chiaro», lo stesso che vale per il progetto.
 *
 *  Gli oggetti non si spostano: per riscalarli c'è «Cambia risoluzione». */
export function patchSovrascrittura(
  pages: readonly { pagina: SynopticPage; genere: GenerePagina }[],
  layout: Layout | undefined | null,
  scelta: { misura: boolean; sfondi: boolean },
): { id: string; patch: FormatoPagina }[] {
  if (!layout) return [];
  const fisso = effectiveSizeMode(layout) === "fixed";
  const out: { id: string; patch: FormatoPagina }[] = [];
  for (const { pagina: p, genere } of pages) {
    const patch: FormatoPagina = {};
    if (scelta.misura && pieno(layout.default_width) && pieno(layout.default_height) && (fisso || genere === "boot")) {
      if (p.width !== layout.default_width) patch.width = layout.default_width;
      if (p.height !== layout.default_height) patch.height = layout.default_height;
    }
    if (scelta.sfondi && testo(layout.default_background) && genere !== "cornice" && genere !== "faceplate") {
      if (p.background !== layout.default_background) patch.background = layout.default_background;
      const scuro = testo(layout.default_background_dark) ? layout.default_background_dark : undefined;
      if (genere !== "boot" && p.background_dark !== scuro) patch.background_dark = scuro;
    }
    if (Object.keys(patch).length > 0) out.push({ id: p.id, patch });
  }
  return out;
}

/** Una pagina segue il predefinito di progetto? (per la riga «— predefinito di
 *  progetto» nel pannello: vale finché le misure coincidono con quelle del
 *  progetto, cioè finché nessuno le ha sovrascritte a mano.) */
export function seguePredefinito(page: Pick<SynopticPage, "width" | "height">, layout: Layout | undefined | null): boolean {
  return !!layout && pieno(layout.default_width) && pieno(layout.default_height)
    && page.width === layout.default_width && page.height === layout.default_height;
}
