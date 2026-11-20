// How a new image object is sized (plan docs/archive/2026-11-19-libreria-immagini.md):
// with the proportions of its picture, the long side at most 240 px, never
// enlarged. Until 19-11-2026 every image was born 120×80 and stretched, so a
// square icon came out squashed.

/** The long side of a new image object. */
export const PLACE_MAX_SIDE = 240;

export function placedSize(size?: { width: number; height: number }): { width: number; height: number } {
  if (!size || !(size.width > 0) || !(size.height > 0)) return { width: 160, height: 120 };
  const k = Math.min(1, PLACE_MAX_SIDE / Math.max(size.width, size.height));
  return { width: Math.max(8, Math.round(size.width * k)), height: Math.max(8, Math.round(size.height * k)) };
}
