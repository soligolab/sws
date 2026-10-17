// Una tendina che esce dal flusso (17-10-2026, ramo 2 del piano
// docs/plans/2026-10-14-revisione-ide-collaudo-wp630.md).
//
// Le tendine di `TagInput` erano `position: absolute` dentro il campo, quindi le
// ritagliava qualunque antenato con `overflow` diverso da `visible`: il pannello
// proprietà (`overflow: hidden`, poi `overflowY: auto`, che per la specifica
// ritaglia anche in orizzontale) e le schede di configurazione (`S.card`). Nel
// pannello stretto si vedeva solo la colonna di destra — il tipo `i32` — e mai il
// nome del tag. Qui la tendina va in un portal su `document.body` con
// `position: fixed`: nessun antenato la può più tagliare. Precedente:
// `AlarmBellPanel.tsx`. In più segue il campo quando qualcosa scorre, si
// ribalta verso l'alto se sotto non c'è posto, e resta dentro la finestra.

import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const MARGINE = 6;
const STACCO = 2;

export interface Riquadro { left: number; top: number; right: number; bottom: number; width: number }

export interface Posizione {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
}

/** Dove mettere la tendina, dato il campo (`r`), la finestra (`vw`×`vh`) e la
 *  misura della tendina già disegnata (`w`×`h`, 0 al primo giro). Pura. */
export function posizionaTendina(
  r: Riquadro, vw: number, vh: number, w: number, h: number, altezzaMax: number, larghezzaMax: number,
): Posizione {
  const maxWidth = Math.max(r.width, Math.min(larghezzaMax, vw - 2 * MARGINE));
  const larga = Math.max(w, r.width);
  // Si allinea al campo; se uscirebbe a destra si sposta a sinistra, mai oltre il margine.
  const left = Math.max(MARGINE, Math.min(r.left, vw - larga - MARGINE));
  const sotto = vh - r.bottom - STACCO - MARGINE;
  const sopra = r.top - STACCO - MARGINE;
  const voluta = Math.min(altezzaMax, h > 0 ? h : altezzaMax);
  if (sotto >= voluta || sotto >= sopra) {
    return { left, top: r.bottom + STACCO, maxHeight: Math.max(0, Math.min(altezzaMax, sotto)), minWidth: r.width, maxWidth };
  }
  return { left, bottom: vh - r.top + STACCO, maxHeight: Math.max(0, Math.min(altezzaMax, sopra)), minWidth: r.width, maxWidth };
}

/** La tendina: `ancora` è il campo da cui si apre, `rif` il suo contenitore (per
 *  riconoscere i clic dentro). Si riposiziona a ogni scorrimento e
 *  ridimensionamento, perché il pannello sotto può muoversi. */
export function TendinaFluttuante({ ancora, rif, altezzaMax = 200, larghezzaMax = 520, stile, children, ...resto }: {
  ancora: RefObject<HTMLElement | null>;
  rif?: RefObject<HTMLDivElement | null>;
  altezzaMax?: number;
  larghezzaMax?: number;
  stile?: CSSProperties;
  children: ReactNode;
  role?: string;
  "data-testid"?: string;
}) {
  const [pos, setPos] = useState<Posizione | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const calcola = () => {
      const a = ancora.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const el = rif?.current;
      setPos(posizionaTendina(r, window.innerWidth, window.innerHeight,
        el?.offsetWidth ?? 0, el?.scrollHeight ?? 0, altezzaMax, larghezzaMax));
    };
    const presto = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(calcola); };
    calcola();
    // Un secondo giro dopo il primo disegno: ora la misura della tendina c'è.
    raf = requestAnimationFrame(calcola);
    window.addEventListener("scroll", presto, true);
    window.addEventListener("resize", presto);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", presto, true);
      window.removeEventListener("resize", presto);
    };
  }, [ancora, rif, altezzaMax, larghezzaMax]);

  return createPortal(
    <div ref={rif} {...resto}
      style={{
        ...stile,
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top,
        bottom: pos?.bottom,
        minWidth: pos?.minWidth,
        maxWidth: pos?.maxWidth,
        maxHeight: pos?.maxHeight ?? altezzaMax,
        width: "max-content",
        overflowY: "auto",
        zIndex: 10000,
        visibility: pos ? "visible" : "hidden",
      }}>
      {children}
    </div>,
    document.body,
  );
}
