// Le immagini del progetto che il server non ha ancora, e la versione di
// quelle che ha appena ricevuto (10-11-2026).
//
// # Due difetti dello stesso collaudo
//
// 1. Dopo «Applica» di una proposta dell'assistente con sfondi generati la
//    pagina era **senza sfondo** fino al Salva: le foto si caricano in
//    `images/` solo al Salva (`ai:sfondi:<id>` in `applyAiProposal`), e intanto
//    la pagina puntava a un file che sul server non c'era. Contro la regola
//    WYSIWYG del CLAUDE.md. Ora le foto in sospeso stanno qui, come data URI,
//    e il canvas le disegna da qui finché il Salva non le ha caricate.
// 2. Dopo il Salva, nell'IDE del cloud, lo sfondo **continuava a mancare**.
//    `useHrefImmagine` scarica l'immagine con la sessione quando l'URL cambia;
//    il primo tentativo, prima del Salva, aveva preso un 404, e l'URL non
//    cambiava più: nessuno lo richiedeva. (In locale, senza sessione, il
//    browser tiene l'`<image>` rotto con lo stesso URL.) Ora ogni caricamento
//    dà al file una **versione nuova**, e l'URL da disegnare porta `?v=<n>`:
//    l'URL cambia, e l'immagine si richiede.
//
// La stessa mappa serve alla foto di un progetto web chiesta dall'assistente
// (`ai/fotoDalBrowser.ts`): gli sfondi del banco della conversazione non sono
// ancora nel progetto, e per il tempo della foto si disegnano da qui.

import { useSyncExternalStore } from "react";

const inSospeso = new Map<string, string>();
const versioni = new Map<string, number>();
const ascoltatori = new Set<() => void>();
let giro = 0;

function avvisa() {
  giro += 1;
  for (const a of ascoltatori) a();
}

function iscrivi(a: () => void) {
  ascoltatori.add(a);
  return () => { ascoltatori.delete(a); };
}

/** L'href con cui le pagine nominano un file di `images/`. */
export function hrefImmagineProgetto(file: string): string {
  return `/api/project/images/${file}`;
}

/** Un'immagine da disegnare **prima** che il server l'abbia: `dati` è un data URI. */
export function mettiInSospeso(href: string, dati: string): void {
  inSospeso.set(href, dati);
  avvisa();
}

/** Non più in sospeso (proposta annullata, foto finita). */
export function togliDaSospeso(href: string): void {
  if (inSospeso.delete(href)) avvisa();
}

/** Il data URI di un'immagine in sospeso, se c'è. */
export function immagineInSospeso(href: string | undefined): string | undefined {
  return href ? inSospeso.get(href) : undefined;
}

/** Il file è arrivato sul server (o è cambiato): non è più in sospeso, e chi lo
 *  disegna lo richiede con una versione nuova. */
export function immagineCaricata(href: string): void {
  inSospeso.delete(href);
  versioni.set(href, (versioni.get(href) ?? 0) + 1);
  avvisa();
}

/** L'href da chiedere al server: quello della pagina, con `?v=<n>` se il file è
 *  stato caricato da quando l'IDE è aperto. */
export function hrefConVersione(href: string): string {
  const v = versioni.get(href);
  if (!v) return href;
  return `${href}${href.includes("?") ? "&" : "?"}v=${v}`;
}

/** Ciò che il disegno deve usare: la foto in sospeso, o l'href versionato. */
export function hrefDaDisegnare(href: string): string {
  return inSospeso.get(href) ?? hrefConVersione(href);
}

/** Ridisegna chi la usa quando la mappa cambia. */
export function useGiroImmagini(): number {
  return useSyncExternalStore(iscrivi, () => giro, () => giro);
}

/** Per i test. */
export function azzeraImmaginiInSospeso(): void {
  inSospeso.clear();
  versioni.clear();
  avvisa();
}
