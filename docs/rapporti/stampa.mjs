// Stampa in PDF un rapporto di docs/rapporti/, con intestazione e piè di pagina.
//
//   node docs/rapporti/stampa.mjs [rapporto.html] [uscita.pdf]
//
// Predefiniti: runtime-risorse.html, e il PDF in <repo>/tmp/ (la cartella che il
// maintainer vede anche da remoto, vedi CLAUDE.md), col nome
// <codice>_rev<revisione>_<versione>.pdf.
//
// Titolo, codice, revisione, versione e data stanno nei <meta name="sws-…"> del
// rapporto e si cambiano a mano: dicono su quale versione il documento è stato
// verificato. Se la versione del workspace è un'altra, lo script lo dice — è il
// promemoria che il rapporto va riletto — ma stampa lo stesso.
//
// Usa il Chromium di Playwright, già installato per i test end-to-end dell'editor.

import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const qui = dirname(fileURLToPath(import.meta.url));
const repo = resolve(qui, "../..");
const sorgente = resolve(process.argv[2] ?? join(qui, "runtime-risorse.html"));

const html = readFileSync(sorgente, "utf8");
const meta = (nome) => {
  const m = html.match(new RegExp(`<meta name="sws-${nome}" content="([^"]*)"`));
  if (!m) throw new Error(`manca <meta name="sws-${nome}"> in ${sorgente}`);
  return m[1];
};
const titolo = meta("titolo");
const codice = meta("codice");
const revisione = meta("revisione");
const versione = meta("versione");
const data = meta("data");

const cargo = readFileSync(join(repo, "sws-runtime/Cargo.toml"), "utf8");
const versioneRepo = cargo.match(/^version = "([^"]+)"/m)?.[1];
if (versioneRepo && versioneRepo !== versione) {
  console.warn(
    `ATTENZIONE: il rapporto è della ${versione}, il workspace è alla ${versioneRepo}. ` +
      `Va riletto e, se cambia qualcosa, serve una revisione nuova.`,
  );
}

const uscita = resolve(
  process.argv[3] ?? join(repo, "tmp", `${codice}_rev${revisione}_${versione}.pdf`),
);
mkdirSync(dirname(uscita), { recursive: true });

const require = createRequire(join(repo, "sws-editor/package.json"));
const { chromium } = require("@playwright/test");

const stile = "font-family:'DejaVu Sans',Arial,sans-serif;font-size:7.5pt;color:#5c5c5c;width:100%;margin:0 16mm;display:flex;justify-content:space-between;";
const intestazione =
  `<div style="${stile}border-bottom:.6px solid #c9c9c9;padding-bottom:1.5mm;">` +
  `<span>${titolo}</span><span>${codice} · rev. ${revisione} · SWS ${versione}</span></div>`;
const piede =
  `<div style="${stile}"><span>Uso interno · ${data}</span>` +
  `<span>pag. <span class="pageNumber"></span> di <span class="totalPages"></span></span></div>`;

const browser = await chromium.launch();
try {
  const pagina = await browser.newPage();
  await pagina.goto(pathToFileURL(sorgente).href, { waitUntil: "load" });
  await pagina.pdf({
    path: uscita,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: intestazione,
    footerTemplate: piede,
    margin: { top: "20mm", bottom: "16mm", left: "16mm", right: "16mm" },
  });
} finally {
  await browser.close();
}
console.log(uscita);
