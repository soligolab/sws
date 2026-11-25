// After a reset the page loads itself again (25-11-2026, plan
// docs/plans/2026-11-25-correzioni-collaudo-dev3.md, part A).
//
// The reset answers first and starts the runtime again half a second later
// (`control_panel/reset.rs`). On the PLX800 (collaudo of 2.27.0-dev.3) the
// page under the control panel stayed on the deleted project, with the values
// frozen, until the browser was started again. The maintainer's correction:
// after «Delete» the control panel closes and the page starts again.
//
// The page loads again only when the runtime answers `/health`: the runtime
// also serves the page, and a page loaded while it is down is a browser error
// that no script can leave.

import { prefissoSchermo } from "@/api/prefisso";

/** The first check: the old process is gone after half a second. */
export const FIRST_CHECK_MS = 2_000;
/** Then a check this often, like the viewer while the panel restarts. */
export const CHECK_EVERY_MS = 2_000;

export interface ReloadDeps {
  /** True when the runtime answers. */
  answers: () => Promise<boolean>;
  reload: () => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

const browserDeps = (): ReloadDeps => ({
  // On the cloud's remote screen (`/schermo/<panel>/`) the panel answers under
  // that prefix: the gateway's own `/health` always says "ok", even while the
  // panel restarts and its tunnel is down.
  answers: () =>
    fetch(`${prefissoSchermo()}/health`, { cache: "no-store" }).then((r) => r.ok, () => false),
  reload: () => window.location.reload(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
});

/** Waits until the runtime answers, then loads the page again. Returns the
 *  function that stops the wait (the component went away). */
export function reloadWhenBack(deps: ReloadDeps = browserDeps()): () => void {
  let stopped = false;
  let timer: number | null = null;
  const check = () => {
    timer = null;
    void deps.answers().then((ok) => {
      if (stopped) return;
      if (ok) deps.reload();
      else timer = deps.setTimer(check, CHECK_EVERY_MS);
    });
  };
  timer = deps.setTimer(check, FIRST_CHECK_MS);
  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
  };
}
