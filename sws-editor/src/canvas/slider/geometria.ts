/** La geometria dello slider, senza DOM (revisione dello slider, fase 2,
 *  30-10-2026 — `docs/plans/2026-10-30-revisione-slider.md`).
 *
 *  **Gemella di `geometria_slider` in `sws-lvgl-viewer/src/lvgl_render.rs`**: i
 *  due motori impilano gli stessi pezzi con gli stessi numeri, così uno slider
 *  sta nello stesso punto sul web e sul pannello. Chi cambia un numero qui lo
 *  cambia anche là.
 *
 *  Tutte le coordinate sono relative all'angolo del riquadro dichiarato. */

export type PosizioneValore = "sotto" | "sopra" | "dentro" | "cursore";

/** Lo spessore della traccia dello stile classico: quello del pannello LVGL di
 *  sempre, ora anche sul web (decisione 3 del piano). */
export const SPESSORE_CLASSICO = 16;
/** Di quanto il cursore tondo sborda dalla traccia, per lato: il `pad` della
 *  parte `KNOB` su LVGL. */
export const SBORDO_CURSORE = 5;
/** Lo spazio fra una riga e l'altra della colonna. */
const SPAZIO = 2;

export interface Rett { x: number; y: number; w: number; h: number }

export interface GeometriaSlider {
  verticale: boolean;
  traccia: Rett;
  raggioCursore: number;
  /** Il centro della riga dell'etichetta, se c'è. */
  etichetta: { cx: number; cy: number } | null;
  /** Il centro della riga del valore: sotto, sopra o dentro la traccia. Per
   *  `cursore` è `null`: il fumetto segue il cursore (`fumettoCursore`). */
  valore: { cx: number; cy: number } | null;
}

export interface IngressoGeometria {
  verticale: boolean;
  w: number;
  h: number;
  /** Altezza della riga dell'etichetta (0 senza etichetta). */
  altoEtichetta: number;
  /** Altezza della riga del valore (0 senza valore). */
  altoValore: number;
  spessore?: number;
  posizione?: PosizioneValore;
}

export function geometriaSlider(i: IngressoGeometria): GeometriaSlider {
  const posizione = i.posizione ?? "sotto";
  // Il valore occupa una riga sua solo sotto o sopra la traccia.
  const rigaValore = posizione === "sotto" || posizione === "sopra" ? i.altoValore : 0;
  if (i.verticale) {
    const t = Math.min(i.spessore ?? SPESSORE_CLASSICO, i.w);
    const sopra = posizione === "sopra" ? rigaValore : 0;
    const sotto = posizione === "sotto" ? rigaValore : 0;
    const lunghezza = Math.max(24, i.h - i.altoEtichetta - rigaValore - 8);
    const traccia = { x: (i.w - t) / 2, y: i.altoEtichetta + sopra + 4, w: t, h: lunghezza };
    return {
      verticale: true,
      traccia,
      raggioCursore: t / 2 + SBORDO_CURSORE,
      etichetta: i.altoEtichetta > 0 ? { cx: i.w / 2, cy: i.altoEtichetta / 2 } : null,
      valore:
        posizione === "cursore" || i.altoValore === 0 ? null
        : posizione === "dentro" ? { cx: i.w / 2, cy: traccia.y + traccia.h / 2 }
        : posizione === "sopra" ? { cx: i.w / 2, cy: i.altoEtichetta + sopra / 2 }
        : { cx: i.w / 2, cy: i.h - sotto / 2 },
    };
  }
  // Orizzontale: la colonna del web di prima — etichetta, (valore), traccia,
  // (valore) — centrata nell'altezza, anche quando sborda.
  const t = Math.min(i.spessore ?? SPESSORE_CLASSICO, i.h);
  const righe: [string, number][] = [];
  if (i.altoEtichetta > 0) righe.push(["etichetta", i.altoEtichetta]);
  if (posizione === "sopra" && rigaValore > 0) righe.push(["valore", rigaValore]);
  righe.push(["traccia", t]);
  if (posizione === "sotto" && rigaValore > 0) righe.push(["valore", rigaValore]);
  const blocco = righe.reduce((s, [, a]) => s + a, 0) + SPAZIO * (righe.length - 1);
  let y = (i.h - blocco) / 2;
  const centri: Record<string, number> = {};
  for (const [nome, alto] of righe) {
    centri[nome] = y + alto / 2;
    y += alto + SPAZIO;
  }
  const yTraccia = Math.max(0, Math.min(i.h - t, centri.traccia - t / 2));
  const traccia = { x: 0, y: yTraccia, w: i.w, h: t };
  return {
    verticale: false,
    traccia,
    raggioCursore: t / 2 + SBORDO_CURSORE,
    etichetta: centri.etichetta !== undefined ? { cx: i.w / 2, cy: centri.etichetta } : null,
    valore:
      posizione === "cursore" || i.altoValore === 0 ? null
      : posizione === "dentro" ? { cx: i.w / 2, cy: yTraccia + t / 2 }
      : centri.valore !== undefined ? { cx: i.w / 2, cy: centri.valore } : null,
  };
}

const limita = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0);

/** Dove sta un valore sulla traccia, da 0 (minimo) a 1 (massimo). */
export function frazioneDaValore(v: number, min: number, max: number): number {
  return max > min ? limita((v - min) / (max - min)) : 0;
}

/** Il centro del cursore per una frazione. */
export function centroCursore(g: GeometriaSlider, f: number): { cx: number; cy: number } {
  const t = g.traccia;
  return g.verticale
    ? { cx: t.x + t.w / 2, cy: t.y + t.h * (1 - f) }
    : { cx: t.x + t.w * f, cy: t.y + t.h / 2 };
}

/** Dove va il fumetto del valore con `posizione: "cursore"`: sopra il cursore
 *  nell'orizzontale, alla sua destra nel verticale. */
export function fumettoCursore(g: GeometriaSlider, f: number, altoValore: number): { cx: number; cy: number } {
  const c = centroCursore(g, f);
  return g.verticale
    ? { cx: c.cx + g.raggioCursore + 4 + altoValore, cy: c.cy }
    : { cx: c.cx, cy: c.cy - g.raggioCursore - 4 - altoValore / 2 };
}

/** La frazione sotto un punto (relativo al riquadro). */
export function frazioneDaPunto(g: GeometriaSlider, px: number, py: number): number {
  const t = g.traccia;
  return g.verticale ? limita(1 - (py - t.y) / t.h) : limita((px - t.x) / t.w);
}

const passoValido = (step: number | undefined) => (step !== undefined && Number.isFinite(step) && step > 0 ? step : 1);
const pulito = (v: number) => Math.round(v * 1e9) / 1e9;

/** Il valore sul passo più vicino, dentro l'intervallo. Come LVGL
 *  (`passi_slider`): l'ultimo passo è per difetto, 0..10 col passo 4 si ferma a 8. */
export function agganciaAlPasso(v: number, min: number, max: number, step?: number): number {
  const s = passoValido(step);
  const passi = Math.max(1, Math.floor((max - min) / s + 1e-9));
  const i = Math.min(passi, Math.max(0, Math.round((v - min) / s)));
  return pulito(min + i * s);
}

export function valoreDaFrazione(f: number, min: number, max: number, step?: number): number {
  return agganciaAlPasso(min + limita(f) * (max - min), min, max, step);
}

/** Il valore dopo un tasto, o `null` se il tasto non è dello slider. Frecce un
 *  passo, PagSu/PagGiù un decimo dell'intervallo (almeno un passo), Home/Fine
 *  gli estremi. */
export function valoreDaTasto(tasto: string, v: number, min: number, max: number, step?: number): number | null {
  const s = passoValido(step);
  const grande = Math.max(s, (max - min) / 10);
  const nuovo =
    tasto === "ArrowRight" || tasto === "ArrowUp" ? v + s
    : tasto === "ArrowLeft" || tasto === "ArrowDown" ? v - s
    : tasto === "PageUp" ? v + grande
    : tasto === "PageDown" ? v - grande
    : tasto === "Home" ? min
    : tasto === "End" ? max
    : null;
  return nuovo === null ? null : agganciaAlPasso(nuovo, min, max, step);
}
