// Il viewer si ricarica da solo quando arriva una SPA nuova?
// Lanciato da scripts/check_spa_autoreload.sh, che prepara runtime e progetto.
//
// Il marker messo sulla pagina prima del "deploy" deve sparire: se resta, la
// pagina non si è ricaricata e sul pannello si continuerebbe a vedere la
// versione vecchia — l'abbaglio già pagato una volta sul WP620.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VIEWER = process.env.VIEWER ?? "http://localhost:8647";
const SERVED = process.env.SERVED;
if (!SERVED) { console.error("SERVED non impostato"); process.exit(2); }

/**
 * Simula la distribuzione di un frontend nuovo: rinomina il chunk di entry con
 * un hash diverso e aggiorna il riferimento in index.html. È lo stesso segnale
 * che Vite produce a ogni build (hash di contenuto) e che il watcher osserva.
 *
 * Si tocca **solo** l'entry: gli altri chunk sono importati per nome dall'entry
 * stesso, non da index.html, quindi rinominarli romperebbe gli import.
 */
function simulaDeploy() {
  const indexPath = path.join(SERVED, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const m = html.match(/assets\/(main-[A-Za-z0-9_-]+)\.js/);
  if (!m) throw new Error("chunk di entry non trovato in index.html");
  const vecchio = m[1];
  const nuovo = `${vecchio.split("-")[0]}-DEPLOY0001`;
  fs.renameSync(path.join(SERVED, "assets", `${vecchio}.js`), path.join(SERVED, "assets", `${nuovo}.js`));
  fs.writeFileSync(indexPath, html.replaceAll(`${vecchio}.js`, `${nuovo}.js`));
  return { vecchio, nuovo };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(VIEWER, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

await page.evaluate(() => { window.__marker = "prima-del-deploy"; });
const assetPrima = await page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).join(","));
console.log(`  asset serviti: ${assetPrima}`);

const { vecchio, nuovo } = simulaDeploy();
console.log(`  deploy simulato: ${vecchio}.js → ${nuovo}.js`);

// L'intervallo del watcher è 30 s: si attende fino a 60.
const scadenza = Date.now() + 60_000;
let ricaricata = false;
while (Date.now() < scadenza) {
  await page.waitForTimeout(2000);
  const marker = await page.evaluate(() => window.__marker).catch(() => undefined);
  if (marker === undefined) { ricaricata = true; break; }
}
const attesa = Math.round((60_000 - (scadenza - Date.now())) / 1000);
const assetDopo = ricaricata
  ? await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).join(","))
  : assetPrima;
await browser.close();

if (!ricaricata) {
  console.log(`\n  ✗ non ricaricata entro 60 s — il pannello resterebbe sulla versione vecchia`);
  process.exit(1);
}
if (assetDopo === assetPrima) {
  console.log(`\n  ✗ ricaricata ma serve ancora ${assetPrima} — non ha preso il bundle nuovo`);
  process.exit(1);
}
console.log(`\n  ✓ ricaricata dopo ~${attesa} s, ora serve ${assetDopo}`);
