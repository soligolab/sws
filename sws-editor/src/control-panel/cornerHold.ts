// The runtime gesture that opens the control panel: a finger held still for
// HOLD_MS in the top-right corner (CORNER_PX square, the corner of PixsysOS's
// STOP). Pure logic, so the tests do not need real time or a real screen.
//
// The touch still reaches the project as usual; only when the hold completes
// does the panel open, and the release that follows is swallowed so the button
// under the finger does not fire.

export const CORNER_PX = 80;
export const HOLD_MS = 5_000;
/** A finger that moves more than this is a drag, not a hold. */
export const MOVE_TOLERANCE_PX = 15;

export interface HoldState {
  startedAt: number;
  x: number;
  y: number;
}

export function inCorner(x: number, y: number, viewportWidth: number): boolean {
  return x >= viewportWidth - CORNER_PX && y <= CORNER_PX;
}

/** A press starts a hold only in the corner. */
export function startHold(x: number, y: number, viewportWidth: number, now: number): HoldState | null {
  return inCorner(x, y, viewportWidth) ? { startedAt: now, x, y } : null;
}

/** Whether the finger is still holding (`false` = the hold is over). */
export function stillHolding(h: HoldState, x: number, y: number): boolean {
  return Math.hypot(x - h.x, y - h.y) <= MOVE_TOLERANCE_PX;
}

/** 0..1, for the ring that fills up. */
export function holdProgress(h: HoldState, now: number): number {
  return Math.min(1, Math.max(0, (now - h.startedAt) / HOLD_MS));
}

export function holdComplete(h: HoldState, now: number): boolean {
  return now - h.startedAt >= HOLD_MS;
}
