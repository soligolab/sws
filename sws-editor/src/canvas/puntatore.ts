/** Il trascinamento col puntatore — mouse, dito e penna con un codice solo
 *  (revisione dello slider, fase 2, 30-10-2026).
 *
 *  Il primo oggetto del canvas che gestisce il puntatore a mano: lo slider. È
 *  scritto a parte perché servirà al bottone (piano dello slider, «Fuori»).
 *
 *  `setPointerCapture` tiene il gesto anche quando il dito esce dall'oggetto,
 *  come fa un controllo nativo; chi lo usa mette `touch-action: none`
 *  sull'elemento, altrimenti su un pannello touch il trascinamento diventa
 *  lo scorrimento della pagina. */
import { useRef } from "react";

/** Il punto del puntatore nelle coordinate dell'elemento SVG che lo riceve
 *  (quelle del disegno, non dello schermo): tiene conto di zoom e pan. */
export function puntoLocale(el: SVGGraphicsElement, clientX: number, clientY: number): { x: number; y: number } {
  const m = typeof el.getScreenCTM === "function" ? el.getScreenCTM() : null;
  if (m && typeof DOMPoint !== "undefined") {
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  // Senza matrice (jsdom, nei test): il rettangolo a schermo, scala 1.
  // Il rettangolo a schermo parte dal suo `x`/`y`, che si rimettono.
  const r = el.getBoundingClientRect();
  const ox = (el as unknown as { x?: { baseVal?: { value: number } } }).x?.baseVal?.value ?? 0;
  const oy = (el as unknown as { y?: { baseVal?: { value: number } } }).y?.baseVal?.value ?? 0;
  return { x: clientX - r.left + ox, y: clientY - r.top + oy };
}

export interface Trascinamento {
  /** Il puntatore è sceso, o si è mosso tenendolo: il punto locale. */
  muovi: (p: { x: number; y: number }) => void;
  /** Il gesto è finito: `annullato` se il sistema l'ha tolto (`pointercancel`). */
  fine: (annullato: boolean) => void;
  /** L'elemento rispetto a cui misurare il punto. Assente = quello che riceve l'evento. */
  riferimento?: () => SVGGraphicsElement | null;
}

type Ev = React.PointerEvent<SVGElement>;

export function useTrascinamento(t: Trascinamento) {
  const attivo = useRef<number | null>(null);
  const punto = (e: Ev) =>
    puntoLocale(t.riferimento?.() ?? (e.currentTarget as SVGGraphicsElement), e.clientX, e.clientY);
  const chiudi = (e: Ev, annullato: boolean) => {
    if (attivo.current !== e.pointerId) return;
    attivo.current = null;
    t.fine(annullato);
  };
  return {
    onPointerDown: (e: Ev) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      attivo.current = e.pointerId;
      try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
      e.preventDefault();
      t.muovi(punto(e));
    },
    onPointerMove: (e: Ev) => {
      if (attivo.current === e.pointerId) t.muovi(punto(e));
    },
    onPointerUp: (e: Ev) => chiudi(e, false),
    onPointerCancel: (e: Ev) => chiudi(e, true),
  };
}
