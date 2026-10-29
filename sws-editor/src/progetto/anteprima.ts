// La miniatura della pagina iniziale nell'elenco dei progetti (29-10-2026,
// ramo D del piano docs/plans/2026-10-26-aprire-sws-soligo-net.md).
//
// La si disegna al salvataggio, con la stessa catena delle pagine di boot
// (`boot/rasterizza.ts`), e la si manda al runtime, che la tiene nella cartella
// del progetto come `anteprima.png` (`sws-web/src/anteprima.rs`). Le tre scelte
// del maintainer: nel progetto, 400 pixel di larghezza e al massimo 256 KB, la
// pagina iniziale con la sua cornice.

import { paginePerNavigazione } from "@/boot/tipi";
import { corniceDellaPagina, eCornice, idCornice, paginaACornice } from "@/cornici/modello";
import type { Cornice, SynopticPage } from "@/types";

/** Gemello di `MAX_BYTES` in `sws-web/src/anteprima.rs`. */
export const MAX_ANTEPRIMA_BYTES = 256 * 1024;
export const LARGHEZZA_ANTEPRIMA = 400;

/** La pagina che fa da miniatura: quella iniziale del progetto, o la prima
 *  dell'albero che non sia una finestra. */
export function paginaDellAnteprima(pages: readonly SynopticPage[], homeId: string | undefined): SynopticPage | undefined {
  const sinottiche = paginePerNavigazione(pages);
  return (homeId ? sinottiche.find((p) => p.id === homeId) : undefined)
    ?? sinottiche.find((p) => !p.finestra)
    ?? sinottiche[0];
}

/** La cornice con cui quella pagina si vede, se ne ha una. */
export function corniceDellAnteprima(
  pagina: SynopticPage, pages: readonly SynopticPage[], predefinita: string | undefined,
): Cornice | undefined {
  const id = corniceDellaPagina(pagina, predefinita);
  const pc = id ? pages.find((p) => eCornice(p) && idCornice(p) === id) : undefined;
  return pc ? paginaACornice(pc) : undefined;
}

/** Cosa decide il disegno della miniatura: se non è cambiato dall'ultima
 *  volta, non la si rifà. */
export function firmaAnteprima(pagina: SynopticPage, cornice: Cornice | undefined): string {
  return JSON.stringify([pagina, cornice ?? null]);
}
