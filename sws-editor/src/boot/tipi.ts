// Le pagine di boot (T-72): l'immagine che il pannello mostra mentre parte.
// Nell'IDE sono pagine come le altre (`kind: "boot"`), ma su disco vivono in
// `boot/` e nessun viewer le vede.

import type { SynopticObjectType, SynopticPage } from "@/types";

/** I tipi di oggetto ammessi su una pagina di boot: solo vettoriali statici.
 *  Gemello di `BOOT_TYPES` in `sws-web/src/boot.rs`, che rifiuta il resto al
 *  salvataggio: gli altri sono `<foreignObject>` o `<canvas>` e il PNG che il
 *  browser ne ricava non sarebbe fedele. */
export const BOOT_TYPES: readonly SynopticObjectType[] = [
  "rect", "ellipse", "line", "pipe", "text", "image", "symbol",
];

/** Dimensioni con cui nasce una pagina di boot (la risoluzione del PNG). */
export const BOOT_LARGHEZZA = 1280;
export const BOOT_ALTEZZA = 800;
export const BOOT_SFONDO = "#0f172a";

export const eBoot = (p: { kind?: string } | undefined | null): boolean => p?.kind === "boot";

/** Le pagine che un pannello mostra e fra cui si naviga: tutte tranne quelle di boot. */
export function paginePerNavigazione<T extends { kind?: string }>(pages: readonly T[]): T[] {
  return pages.filter((p) => !eBoot(p));
}

export function pagineDiBoot<T extends { kind?: string }>(pages: readonly T[]): T[] {
  return pages.filter((p) => eBoot(p));
}

/** Sinottici prima, boot in fondo (ordine stabile). L'elenco pagine dell'IDE
 *  usa gli indici della sola parte sinottica: tenere le pagine di boot in coda
 *  li lascia validi. */
export function sinotticiPoiBoot<T extends { kind?: string }>(pages: readonly T[]): T[] {
  return [...paginePerNavigazione(pages), ...pagineDiBoot(pages)];
}

/** La chiave con cui il salvataggio ricorda una pagina già su disco: il nome
 *  da solo non basta, perché una sinottica e una di boot possono chiamarsi
 *  uguale (cartelle diverse). */
export function chiavePagina(p: Pick<SynopticPage, "name" | "kind">): string {
  return eBoot(p) ? `boot/${p.name}` : p.name;
}

/** Un nome libero per una nuova pagina di boot: «Immagine di boot», poi «… 2». */
export function nomeBootLibero(pages: readonly SynopticPage[], base: string): string {
  const usati = new Set(pagineDiBoot(pages).map((p) => p.name));
  if (!usati.has(base)) return base;
  let n = 2;
  while (usati.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
