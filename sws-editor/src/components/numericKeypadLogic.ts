// What each key of the numeric keypad does and what the confirmation accepts. Pure, twin of
// `sws-lvgl-viewer/src/numeric_keypad.rs`: the cases are in `tests/fixtures/tastierino-numerico.json`
// and both read them — if the two engines diverged, the same key would write two different numbers.

export type KeypadError = { kind: "invalid" } | { kind: "below_min"; min: number } | { kind: "above_max"; max: number };

/** The draft the keypad opens with: the current value, or empty. */
export function initialDraft(initial?: number): string {
  return initial !== undefined && Number.isFinite(initial) ? String(initial) : "";
}

/** The draft after pressing `key`. The first digit replaces the preloaded value, as anyone who has
 *  used an HMI expects: you press "5" to write 5, not to append it to the current value. */
export function press(draft: string, key: string, initial?: number): string {
  if (key === "C") return "";
  if (key === "⌫") return draft.slice(0, -1);
  if (key === "±") return draft.startsWith("-") ? draft.slice(1) : `-${draft}`;
  if (key === "." && draft.includes(".")) return draft;
  return draft === initialDraft(initial) ? (key === "." ? "0." : key) : draft + key;
}

/** The value to write, or why not. min/max are checked BEFORE confirming, with an explicit message. */
export function validateDraft(draft: string, min?: number, max?: number): { value: number } | { error: KeypadError } {
  const n = Number(draft);
  if (draft.trim() === "" || !Number.isFinite(n)) return { error: { kind: "invalid" } };
  if (min !== undefined && n < min) return { error: { kind: "below_min", min } };
  if (max !== undefined && n > max) return { error: { kind: "above_max", max } };
  return { value: n };
}
