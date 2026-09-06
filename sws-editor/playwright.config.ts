import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for SWS editor end-to-end tests.
 *
 * The runtime must be running before invoking the tests. It serves the built
 * SPA itself — there is no Vite dev server in this flow any more, so the IDE
 * lives on the admin port, not on 5173:
 *
 *   # Terminal A
 *   SWS_ADMIN_USER=admin SWS_ADMIN_PASSWORD=admin ./scripts/start_runtime.sh
 *
 *   # Terminal B
 *   cd sws-editor && pnpm test:e2e
 *
 * The admin credentials must be passed explicitly: `start_runtime.sh` does not
 * seed a user (without them the runtime comes up in no-auth mode and the login
 * step these tests perform has nothing to log into). `dev.sh` used to seed
 * `admin`/`admin` by itself, which is why the tests assumed it.
 *
 * We deliberately don't use Playwright's `webServer` config because the runtime
 * spawn flow expects a writable `.run/` directory, a built `dist/` and the admin
 * env vars. `start_runtime.sh` encapsulates all of that — letting Playwright
 * drive the runtime would mean duplicating the bootstrap.
 *
 * `baseURL` is **http**: a fresh `.run/config` has no certificate, so the
 * runtime starts in plain HTTP (the banner it prints says so). Switch to
 * `https://localhost:8444` after enabling TLS from ConfigView → Stato;
 * `ignoreHTTPSErrors` is left on so the self-signed cert works either way.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Un worker solo, e non è una precauzione generica: **il runtime ha un
  // progetto attivo per volta**, ed è stato globale del server. `fullyParallel:
  // false` impedisce ai test dello stesso file di sovrapporsi, ma Playwright
  // distribuisce comunque i **file** su più worker, quindi due spec finivano per
  // contendersi quel progetto.
  //
  // È successo davvero: `bugcheck.spec.ts` apre un progetto vuoto per provare
  // che il canvas resti vuoto, e nel frattempo il percorso principale di
  // `editor.spec.ts` si trovava sotto i piedi un progetto senza pagine — quindi
  // nessun canvas su cui aggiungere un rettangolo, e un rosso che parlava di
  // rettangoli mentre il difetto era di isolamento. Riaprire il progetto giusto
  // all'inizio del test non basta: l'altro worker lo richiude un istante dopo.
  //
  // Il costo è qualche secondo in più; il beneficio è un rosso che significa
  // qualcosa.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.SWS_E2E_BASE_URL ?? "http://localhost:8444",
    ignoreHTTPSErrors: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Su una macchina senza i browser scaricati da Playwright (`npx playwright
    // install`), si può puntare a un Chromium di sistema:
    //
    //     SWS_E2E_CHROMIUM=/usr/bin/chromium pnpm test:e2e
    //
    // Non è la configurazione supportata da Playwright — la versione del
    // browser di sistema non è quella con cui la libreria è stata provata — ma
    // è la differenza fra poter lanciare il gate su questo server e non
    // poterlo lanciare affatto. Se la variabile non c'è, niente cambia.
    launchOptions: process.env.SWS_E2E_CHROMIUM
      ? { executablePath: process.env.SWS_E2E_CHROMIUM }
      : {},
  },
  projects: [
    {
      // Il gate: le verifiche vere. `screenshots.spec.ts` è escluso perché non
      // verifica niente — cattura immagini per la documentazione, e 10 dei 16
      // test della cartella sono suoi. Tenerlo dentro renderebbe il gate lento e
      // rumoroso senza aumentare di una riga ciò che controlla.
      name: "chromium",
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Su richiesta: `pnpm test:e2e --project=screenshots`.
      name: "screenshots",
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
