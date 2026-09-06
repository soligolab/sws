import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/**
 * Golden-path editor flow:
 *   1. Login as admin (start_runtime.sh must be given SWS_ADMIN_USER /
 *      SWS_ADMIN_PASSWORD — it seeds no user on its own; see playwright.config.ts).
 *   2. Skip the WelcomeScreen — the runtime auto-opens the only project under
 *      `--projects-root`, so this usually no-ops.
 *   3. Add a rectangle via the palette.
 *   4. Save the project ("Salva tutto" in the hamburger menu).
 *   5. Reload the page.
 *   6. Verify the rectangle survived the round-trip.
 *
 * Selectors prefer roles + text so they survive cosmetic changes. The
 * canvas itself is a single <svg>; we count `<rect>` children with the
 * fill colour the rect-default uses (`#3b82f6`) to spot test artefacts
 * vs the page-boundary indicator (which is stroke-only).
 */

async function login(page: Page, username = "admin", password = "admin") {
  await page.goto("/");
  // The login form's password input has autofocus + placeholder labels via
  // <label>. We address it by autocomplete attribute (already in source).
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(passwordInput).toBeVisible();
  const userInput = page.locator('input[autocomplete="username"]');
  await userInput.fill(username);
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /Accedi|Log ?in/i }).click();
  // Dopo il login può comparire la WelcomeScreen (nessun progetto attivo) invece
  // della shell dell'editor: si apre il primo progetto disponibile e solo allora
  // si attende il menu. Prima il test aspettava il menu subito e andava in
  // timeout ogni volta che il runtime non aveva un progetto aperto.
  const apri = page.getByRole("button", { name: /^Apri$/i }).first();
  if (await apri.isVisible({ timeout: 3_000 }).catch(() => false)) await apri.click();
  await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
}

async function openProjectFromWelcomeIfNeeded(page: Page) {
  // WelcomeScreen only renders when no project is active. The runtime
  // auto-opens the only project present under `--projects-root` — but a fresh
  // clone (no projects yet) lands here. Try the first "Apri" button if
  // visible; otherwise no-op.
  const openBtn = page.getByRole("button", { name: /^Apri$/i }).first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
    await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
  }
}

/** Se la banda «il progetto sul runtime è cambiato» è comparsa, la si onora.
 *
 *  Aprire un progetto è a tutti gli effetti una modifica esterna, e la suite ne
 *  apre uno: `bugcheck.spec.ts` prova il canvas di un progetto vuoto e poi
 *  rimette aperto quello con contenuto. Se l'avviso arriva a pagina già
 *  montata, il canvas resta sulla versione di prima e ogni oggetto aggiunto non
 *  compare — un rosso che parla di rettangoli mentre il problema è che la
 *  pagina sta mostrando dati vecchi, e lo dice pure, in cima allo schermo.
 *
 *  Si fa quello che farebbe una persona: si preme «Ricarica», che è l'unica
 *  cosa che l'app offre in quel momento. Aspettare e sperare renderebbe il test
 *  intermittente, che è come stava prima. */
async function dismissStaleBanner(page: Page) {
  const ricarica = page.getByRole("button", { name: /^Ricarica$/ }).first();
  if (await ricarica.isVisible().catch(() => false)) {
    await ricarica.click();
    await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
  }
}

async function ensureEditMode(page: Page) {
  // The app boots in edit mode; if a previous test left it in runtime mode
  // the header shows "Modifica" → click to flip back.
  const editBtn = page.getByRole("button", { name: /^Modifica$/i });
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click();
  }
}

async function addRect(page: Page) {
  // The "Forme" palette group is open by default and contains a "Rettangolo"
  // button. Click it once to spawn a default rect on the current page.
  await page.getByRole("button", { name: /Rettangolo/i }).first().click();
}

/** Quanti rettangoli "nuovi" ci sono **sul canvas**.
 *
 *  Si conta con `evaluate` sull'`<svg>` di area maggiore, non con un locator su
 *  tutto il documento: il pannello sinistro contiene una **miniatura** della
 *  pagina, quindi ogni oggetto del canvas compare due volte nel DOM e il conteggio
 *  raddoppiava (atteso 1, ricevuto 2). Stessa trappola già pagata in
 *  `multiselect_drag_measure.mjs`.
 *
 *  I riempimenti accettati sono tre: `#4a90d9` è il default attuale della palette
 *  (`EditorShell.tsx`, `case "rect"`), gli altri due coprono il valore di prima e
 *  la forma `var(--brand-*)` introdotta col branding.
 */
async function countCanvasRects(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("svg")].reduce(
      (best: { el: SVGSVGElement; area: number } | null, s) => {
        const r = (s as SVGSVGElement).getBoundingClientRect();
        const area = r.width * r.height;
        return !best || area > best.area ? { el: s as SVGSVGElement, area } : best;
      }, null)?.el;
    if (!canvas) return 0;
    return [...canvas.querySelectorAll("rect")].filter((r) => {
      const f = r.getAttribute("fill") ?? "";
      return f === "#4a90d9" || f === "#3b82f6" || f.includes("brand-primary");
    }).length;
  });
}

async function saveAll(page: Page) {
  await page.locator('button:has-text("☰ Menu")').click();
  // Senza ancore: l'etichetta è dinamica (`MainMenu.tsx` la cambia in
  // "Salvataggio…"/"Salvato"/errore) e può portare l'indicatore di modifiche non
  // salvate. Un `/^Salva tutto$/` esatto si rompe a ogni decorazione.
  await page.getByRole("button", { name: /Salva tutto/i }).first().click();
  // The button label flips to "✓ Salvato" briefly. Don't assert on it —
  // just wait for the dropdown to close (avoids race with the next action).
  await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible();
}

test.describe("editor golden path", () => {
  test("login → add rect → save → reload preserves the rect", async ({ page }) => {
    // **Niente `POST /projects/:name/open` qui.** Il progetto giusto lo rimette
    // aperto `bugcheck.spec.ts` alla fine, *prima* che questo test carichi la
    // pagina — ed è l'unico momento in cui si può fare.
    //
    // Aprire un progetto è a tutti gli effetti una **modifica esterna**: la SPA
    // se ne accorge e mostra la banda «il progetto sul runtime è cambiato,
    // questa pagina mostra ancora la versione precedente». Farlo all'inizio del
    // test sembrava prudente e invece lo rendeva intermittente: a seconda di
    // quando l'avviso arrivava rispetto al montaggio, il canvas restava sulla
    // versione di prima e il rettangolo aggiunto non compariva. Due giri su
    // quattro passavano, ed è il genere di rosso che si dà alla sfortuna.
    await login(page);
    await openProjectFromWelcomeIfNeeded(page);
    await dismissStaleBanner(page);
    await ensureEditMode(page);

    // Si aspetta che la pagina sia **davvero** disegnata prima di toccare la
    // palette: la shell dell'IDE compare prima che il progetto sia caricato, e
    // una clic che arriva in mezzo finisce su nessuna pagina — `addObject` in
    // quel caso ne inventa una nuova, quindi non fallisce, semplicemente mette
    // l'oggetto altrove.
    await expect.poll(() => page.evaluate(() => {
      const c = [...document.querySelectorAll("svg")].reduce(
        (b: { el: Element; a: number } | null, s) => {
          const r = s.getBoundingClientRect(); const a = r.width * r.height;
          return !b || a > b.a ? { el: s, a } : b;
        }, null);
      return c ? c.el.querySelectorAll("rect").length : 0;
    }), { timeout: 15_000 }).toBeGreaterThan(0);

    const before = await countCanvasRects(page);

    // Due tentativi, e la ragione è scritta perché non sembri superstizione:
    // la banda «il progetto è cambiato» può ricomparire **dopo** che l'abbiamo
    // congedata — la suite apre un progetto, e ogni apertura è una modifica
    // esterna — e quando compare sposta tutto in basso di una riga. Una clic
    // partita un istante prima atterra dove il pulsante non è più, Playwright
    // la considera riuscita (il bersaglio era attuabile quando ha guardato) e
    // il rettangolo non nasce.
    //
    // Riprovare una volta, congedando di nuovo l'avviso, è quello che farebbe
    // una persona. Non è mascherare un difetto del prodotto: il difetto è che
    // questo test guida una UI che si muove sotto le mani, e lo si dichiara.
    let aggiunto = false;
    for (let tentativo = 1; tentativo <= 2 && !aggiunto; tentativo++) {
      await dismissStaleBanner(page);
      await addRect(page);
      // `> before` e non `== before + tentativo`: se la prima clic non ha
      // aggiunto niente, la seconda deve portare a `before + 1`, non a
      // `before + 2`. Contare i tentativi invece degli oggetti era un errore
      // mio, e faceva fallire proprio il caso che questo giro doveva salvare.
      aggiunto = await expect.poll(() => countCanvasRects(page), { timeout: 6_000 })
        .toBeGreaterThan(before)
        .then(() => true).catch(() => false);
    }
    expect(aggiunto, "il rettangolo non è comparso nemmeno al secondo tentativo").toBe(true);

    await saveAll(page);

    // Wait a beat for the save POST to complete server-side before reload.
    // We can detect this via the saveStatus → "ok" header chip; we approximate
    // with a 1s wait, which is more than enough on a local box.
    await page.waitForTimeout(1500);

    await page.reload();
    // Editor remounts — wait for the menu button again.
    await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
    await ensureEditMode(page);

    // The rect we added should still be on the page.
    await expect.poll(() => countCanvasRects(page)).toBeGreaterThanOrEqual(before + 1);
  });

  test("login form shows error on wrong password", async ({ page }) => {
    await page.goto("/");
    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toBeVisible();
    await page.locator('input[autocomplete="username"]').fill("admin");
    await passwordInput.fill("definitely-wrong-password");
    await page.getByRole("button", { name: /Accedi|Log ?in/i }).click();
    await expect(page.getByText(/Credenziali non valide/)).toBeVisible({ timeout: 10_000 });
  });
});
