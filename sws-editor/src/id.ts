/** Generates a compact, sufficiently-unique client-side id: a base36
 *  timestamp plus a random suffix, optionally prefixed. Not cryptographically
 *  secure — fine for object/page/faceplate/etc. ids in a single-user editor,
 *  where the only real risk is two ids minted in the same millisecond.
 *
 *  Previously reimplemented independently in 4+ places (store/index.ts,
 *  EditorShell.tsx, SvgCanvas.tsx, ConfigView.tsx — one of which, new
 *  faceplates, had no random suffix at all and could collide on a fast
 *  double-click). Single source of truth now. */
export function genId(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
