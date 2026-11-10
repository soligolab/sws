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
  // Un IDE con l'archivio delle identità (dal 10-2026) chiede l'**email**, e il
  // suo campo non è `autocomplete="username"`: si prende il primo campo di
  // testo del modulo, che è l'uno o l'altro.
  await page.locator('input:not([type=password]):not([type=checkbox])').first().fill(ADMIN_USER);
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

/** Porta all'editor. Dal 25-09-2026 non c'è più il pulsante «Editor» in
 *  testata: dove si è lo decide l'albero del pannello sinistro, e una pagina
 *  scelta lì apre l'editor su di lei. */
export async function vaiAllEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("albero-pagine").locator('div[draggable="true"]').first().click();
  await page.waitForTimeout(800);
}

/** Porta in Configurazione, sulla scheda `id` (una foglia dell'albero). */
export async function vaiInConfigurazione(page: import("@playwright/test").Page, id = "tags"): Promise<void> {
  await page.getByTestId(`foglia-config-${id}`).click();
  await page.waitForTimeout(800);
}

/**
 * Prepara un progetto da un template, entra nell'IDE e apre la chat
 * dell'assistente. Restituisce le intestazioni per le chiamate API.
 *
 * La chat dal 04-11-2026 si apre dal menù IA del pannello laterale, non più dal
 * ☰: si parte col cassetto già aperto (`sws.chatPanel.open`, la stessa chiave
 * che l'IDE usa per ricordarlo). Le intestazioni si chiedono **prima** di
 * creare il progetto: con gli utenti, senza token la creazione prende 401.
 */
export async function apriChatDellIde(
  page: import("@playwright/test").Page,
  request: APIRequestContext,
  progetto: string,
  template = "demo-items-web",
): Promise<Record<string, string>> {
  let headers = await authHeaders(request);
  // Da capo ogni volta: un giro precedente può aver salvato la sua modifica, e
  // il secondo diff non la proporrebbe più.
  await request.delete(`${ADMIN}/api/projects/${progetto}`, { headers });
  await request.post(`${ADMIN}/api/projects`, { headers, data: { name: progetto, template } });
  await request.post(`${ADMIN}/api/projects/${progetto}/open`, { headers });
  // Aprire un progetto può invalidare le sessioni (vedi `authHeaders`).
  headers = await authHeaders(request);

  await page.addInitScript(() => {
    try { localStorage.setItem("sws.chatPanel.open", "1"); } catch { /* storage negato */ }
  });
  await page.goto(`${ADMIN}/`, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1500);
  // Un'istanza IDE riparte dalla schermata dei progetti: si apre quello giusto.
  const scheda = page.getByRole("button", { name: new RegExp(progetto) }).first();
  if (await scheda.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await scheda.click();
    await page.waitForTimeout(2000);
  }
  // Nessun ricarico dopo l'accesso, di proposito (10-11-2026): il cassetto è
  // aperto da prima del login, e la chat deve rifarsi il socket col token
  // nuovo da sola. Fino a quel giorno qui c'era un `page.reload()` che
  // aggirava il «…» per sempre al posto del modello.
  return headers;
}

/** Il modello che la chat dichiara, aspettando il suo «pronto» (finché non
 *  arriva l'intestazione dice «…»). `finto` = runtime con `SWS_AI_FAKE`. */
export async function modelloDellaChat(chat: import("@playwright/test").Locator): Promise<string> {
  await expect(chat).toContainText(/finto|claude|kimi|moonshot|nessuna chiave/i, { timeout: 15_000 }).catch(() => {});
  return chat.innerText();
}
