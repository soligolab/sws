// The runtime gesture that opens the control panel: a finger held still for
// HOLD_MS in a corner (CORNER_PX square; top right unless the device says
// otherwise, the corner of PixsysOS's STOP). Pure logic, so the tests do not need real time or a real screen.
//
// The touch still reaches the project as usual; only when the hold completes
// does the panel open, and the release that follows is swallowed so the button
// under the finger does not fire.

export const CORNER_PX = 80;
export const HOLD_MS = 5_000;
/** A touch in a corner counts for nothing during this first moment: no ring, no
 *  counting; the time of the gesture is counted after it (TY570, 15-11-2026). */
export const GRACE_MS = 1_000;
/** How far out of the corner a resting finger may drift. */
export const MOVE_TOLERANCE_PX = 15;

/** A corner of the screen, or none: the same names as the runtime's. */
export type Corner = "none" | "top_left" | "top_right" | "bottom_right" | "bottom_left";

export interface HoldState {
  startedAt: number;
  corner: Corner;
  /** The side of the corner's square and how long the finger must stay:
   *  the device's own measures (control panel → Screen). */
  size: number;
  holdMs: number;
}

export function inCorner(x: number, y: number, width: number, height: number, corner: Corner, size = CORNER_PX): boolean {
  const left = x <= size, right = x >= width - size;
  const top = y <= size, bottom = y >= height - size;
  switch (corner) {
    case "top_left": return left && top;
    case "top_right": return right && top;
    case "bottom_right": return right && bottom;
    case "bottom_left": return left && bottom;
    default: return false;
  }
}

/** A press starts a hold only in the corner. */
export function startHold(
  x: number, y: number, width: number, height: number, corner: Corner, now: number,
  size = CORNER_PX, holdMs = HOLD_MS,
): HoldState | null {
  return inCorner(x, y, width, height, corner, size) ? { startedAt: now, corner, size, holdMs } : null;
}

/** Whether the finger is still holding (`false` = the hold is over): it may
 *  drift inside the corner, and ends the hold when it leaves it. */
export function stillHolding(h: HoldState, x: number, y: number, width: number, height: number): boolean {
  return inCorner(x, y, width, height, h.corner, h.size + MOVE_TOLERANCE_PX);
}

/** 0..1, for the ring that fills up. */
export function holdProgress(h: HoldState, now: number): number {
  return Math.min(1, Math.max(0, (now - h.startedAt - GRACE_MS) / h.holdMs));
}

export function holdComplete(h: HoldState, now: number): boolean {
  return now - h.startedAt >= GRACE_MS + h.holdMs;
}
