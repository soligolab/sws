// Why the sign-in screen is showing (22-11-2026): a page that sends the user
// back there can leave one line, read once. Only a sentence for the person,
// never anything about credentials.
const KEY = "sws.loginNotice";

export function lasciaAvvisoAccesso(testo: string): void {
  try { sessionStorage.setItem(KEY, testo); } catch { /* not shown, nothing lost */ }
}

export function prendiAvvisoAccesso(): string | null {
  try {
    const n = sessionStorage.getItem(KEY);
    if (n) sessionStorage.removeItem(KEY);
    return n;
  } catch { return null; }
}
