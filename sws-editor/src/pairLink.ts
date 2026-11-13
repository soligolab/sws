// The pairing link of the panel QR (13-11-2026): `<cloud>/#pair=<code>`.
//
// The hash is read once, before anything renders, and kept in sessionStorage:
// the first thing a phone without a session shows is the login screen, and
// the code must still be there after it (and after a forced password
// change). The hash is removed from the address so a reload does not reopen
// the confirmation, and so it does not end in the history.

const KEY = "sws.pair";

export function capturePairCode(): void {
  try {
    const m = /^#pair=([^&]+)$/.exec(window.location.hash);
    if (!m) return;
    sessionStorage.setItem(KEY, decodeURIComponent(m[1]));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* no storage (private mode): the code is typed by hand */
  }
}

/** The captured code, once: whoever takes it opens the confirmation. */
export function takePairCode(): string | null {
  try {
    const c = sessionStorage.getItem(KEY);
    if (c) sessionStorage.removeItem(KEY);
    return c;
  } catch {
    return null;
  }
}
