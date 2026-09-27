// Luminosità e lampeggio sfumato (piano `docs/archive/2026-09-26-pannello-luce-forme.md`,
// Fase B). Le formule stanno qui, pure, perché **devono** essere le stesse del
// motore LVGL (`sws-lvgl-viewer/src/effects.rs`, funzioni gemelle con gli stessi
// numeri nei test): un LED che sul web respira fino al 40 % e sul pannello fino
// al 60 % è la divergenza che un collaudo a occhio non vede.
//
// Luminosità `b` in −100…+100 %:
// - negativa → verso il nero: ogni canale × (1 + b/100)       (LVGL: lv_color_darken)
// - positiva → verso il bianco: c + (1 − c) × b/100           (LVGL: lv_color_lighten)
// Sul web è un filtro SVG `feComponentTransfer` lineare: pendenza e intercetta.

/** La luminosità dentro −100…+100; tutto ciò che non è un numero vale 0. */
export function luminositaValida(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-100, Math.min(100, n));
}

/** Pendenza e intercetta del filtro lineare per la luminosità `b`, o `null` se
 *  non c'è niente da fare (b = 0). */
export function parametriLuminosita(b: number): { slope: number; intercept: number } | null {
  const v = luminositaValida(b);
  if (v === 0) return null;
  if (v < 0) return { slope: 1 + v / 100, intercept: 0 };
  const k = v / 100;
  return { slope: 1 - k, intercept: k };
}

/** Il fattore di `filter: brightness()` al fondo del respiro, per una
 *  profondità in −100…0 % (0 = nessun respiro, −100 = fino al nero). */
export function fattoreFondoRespiro(profondita: number | undefined): number {
  const p = Math.max(-100, Math.min(0, Number.isFinite(profondita as number) ? (profondita as number) : -60));
  return 1 + p / 100;
}

/** La profondità di default del lampeggio sfumato (scelta del 26-09-2026). */
export const PROFONDITA_RESPIRO_DEFAULT = -60;
