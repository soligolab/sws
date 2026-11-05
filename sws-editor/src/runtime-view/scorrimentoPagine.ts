/** Il cambio di pagina col dito nel viewer (T-19): uno scorrimento in
 *  orizzontale di almeno 50 px porta alla pagina dopo (verso sinistra) o a
 *  quella prima (verso destra).
 *
 *  Tranne quando il dito parte su un elemento che il dito lo usa per sé — lo
 *  slider, una finestra aperta sopra la pagina, la fila delle pagine che
 *  scorre — e lo
 *  dichiara con `data-gesto-proprio`. Prima non c'era questa eccezione:
 *  trascinare uno slider verso destra tornava alla pagina precedente
 *  (collaudo della 2.25.1, «Montagna», 05-11-2026). `touch-action: none`
 *  ferma i gesti del browser, non gli eventi touch che risalgono fino a qui.
 *
 *  Le pagine sono quelle della barra (`pagineNavigabili`): prima lo
 *  scorrimento passava anche dalle pagine di boot e da quelle che si aprono
 *  come finestra. */
import { useRef } from "react";
import type { TouchEvent } from "react";

export const SOGLIA_SCORRIMENTO_PX = 50;

/** L'attributo di chi ha un gesto suo. */
const GESTO_PROPRIO = "data-gesto-proprio";

/** Il dito è partito dentro un elemento che ha un gesto suo. */
export function partitoSuUnGestoProprio(bersaglio: EventTarget | null): boolean {
  return bersaglio instanceof Element && bersaglio.closest(`[${GESTO_PROPRIO}]`) !== null;
}

/** La pagina dove porta uno scorrimento di `dx` px, o `null` se resta dov'è. */
export function paginaDopoScorrimento(
  pagine: readonly { id: string }[], corrente: string | null | undefined, dx: number,
): string | null {
  if (Math.abs(dx) < SOGLIA_SCORRIMENTO_PX) return null;
  const i = pagine.findIndex((p) => p.id === corrente);
  if (i < 0) return null;
  if (dx < 0 && i < pagine.length - 1) return pagine[i + 1].id;
  if (dx > 0 && i > 0) return pagine[i - 1].id;
  return null;
}

/** I due gestori da mettere sul contenitore della pagina. */
export function useScorrimentoPagine(
  pagine: readonly { id: string }[], corrente: string | null | undefined, vai: (id: string) => void,
) {
  const inizioX = useRef<number | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      inizioX.current = partitoSuUnGestoProprio(e.target) ? null : (e.touches[0]?.clientX ?? null);
    },
    onTouchEnd: (e: TouchEvent) => {
      if (inizioX.current === null) return;
      const dx = (e.changedTouches[0]?.clientX ?? 0) - inizioX.current;
      inizioX.current = null;
      const id = paginaDopoScorrimento(pagine, corrente, dx);
      if (id) vai(id);
    },
  };
}
