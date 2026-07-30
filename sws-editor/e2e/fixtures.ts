/**
 * Base comune dei test end-to-end: lingua della UI fissata e token admin.
 *
 * Due dipendenze implicite tenevano la suite ferma, e nessuna delle due era
 * evidente leggendo un singolo file:
 *
 * 1. **La lingua della UI.** I test cercano etichette italiane ("Accedi",
 *    "Apri", "Credenziali non valide"), ma la SPA parte in inglese se
 *    `localStorage["sws.uiLang"]` non è impostato: il pulsante di login dice
 *    "Log in" e il click va in timeout. Un solo file (`bugcheck.spec.ts`) se ne
 *    era accorto e lo impostava a mano; gli altri dipendevano dalla lingua
 *    ambientale. Qui si fissa per tutti.
 *
 * 2. **L'autenticazione.** I test che parlano direttamente all'API creavano un
 *    contesto senza token e prendevano `401`. Funzionavano solo contro un
 *    runtime in no-auth — cioè non nella configurazione in cui gira il prodotto.
 *
 * Importare `test` da qui invece che da `@playwright/test`: la lingua viene
 * impostata da sola, il token si chiede con `adminToken()`.
 */
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { ADMIN, ADMIN_USER, ADMIN_PASS } from "./_env";

export const test = base.extend<{ uiLangIt: void }>({
  uiLangIt: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        try { localStorage.setItem("sws.uiLang", "it"); } catch { /* storage negato: pazienza */ }
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Token di sessione admin, o `null` se il runtime è in no-auth (nessun utente
 * definito: `POST /api/auth/login` non serve e le route sono aperte).
 *
 * Restituire `null` invece di lanciare è deliberato: così lo stesso test gira in
 * entrambe le configurazioni, e non si scopre a metà suite che l'ambiente non era
 * quello previsto.
 */
export async function adminToken(request: APIRequestContext): Promise<string | null> {
  const res = await request.post(`${ADMIN}/api/auth/login`, {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  return body?.token ?? null;
}

/**
 * Fa il login dalla UI se compare il form, altrimenti non fa niente.
 *
 * Serve perché il runtime gira in due modi — con utenti configurati mostra il
 * login, in no-auth entra diretto — e i test erano scritti chi per un modo chi per
 * l'altro: alcuni si fermavano sul form cercando il pulsante "Editor" che non
 * c'era ancora. Così valgono in entrambi.
 */
export async function ensureLoggedIn(page: import("@playwright/test").Page): Promise<void> {
  const pwd = page.locator('input[autocomplete="current-password"]');
  if (!(await pwd.isVisible({ timeout: 2_000 }).catch(() => false))) return;
  await page.locator('input[autocomplete="username"]').fill(ADMIN_USER);
  await pwd.fill(ADMIN_PASS);
  await page.getByRole("button", { name: /Accedi|Log ?in/i }).click();
  await pwd.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
}

/** Intestazioni da passare alle chiamate API: vuote in no-auth.
 *
 *  **Da chiamare DOPO aver aperto il progetto**: aprire un progetto sostituisce
 *  lo store di autenticazione e invalida tutte le sessioni, quindi un token
 *  ottenuto prima arriva morto e la chiamata successiva prende 401. È il motivo
 *  per cui questi test fallivano anche dopo aver aggiunto il token. */
export async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await adminToken(request);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
