// Misura il drag di una multi-selezione nell'editor.
//
// Il maintainer segnala che trascinando due oggetti selezionati se ne muove uno
// solo. Il fix esiste già (SvgCanvas.tsx) ma il bug persisterebbe: leggere il
// codice non ha trovato la causa, quindi qui si misura.
//
// Cosa fa: apre l'editor, seleziona due oggetti (shift-click), trascina uno dei
// due e confronta le coordinate di ENTRAMBI prima e dopo, leggendole dal
// synoptic salvato via API — non dal DOM, così la misura non dipende da come
// sono resi.
import { chromium } from "@playwright/test";

const ADMIN  = process.env.ADMIN;                   // http://host:port/api
const IDE    = process.env.IDE;                     // http://host:port
const PAGE   = process.env.PAGE_NAME ?? "Pagina 1";

const api = async (path, init) => {
  const r = await fetch(`${ADMIN}${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
};

/** Coordinate degli oggetti sulla pagina, dal synoptic salvato. */
const coords = async () => {
  const page = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
  return Object.fromEntries((page.objects ?? []).map((o) => [o.id, { x: o.x, y: o.y }]));
};

const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const pg = await ctx.newPage();
pg.on("console", (m) => { if (m.type() === "error") console.log(`    [browser] ${m.text()}`); });

await pg.goto(`${IDE}/index-admin.html`, { waitUntil: "domcontentloaded" });
// L'editor monta dopo getProject()+whoami(); si attende un elemento dell'editor.
await pg.waitForSelector('button:has-text("Menu"), button:has-text("☰")', { timeout: 30_000 });
await pg.waitForTimeout(1500);

// Diagnostica: che cosa mostra la pagina? Senza questo si tira a indovinare
// sul perché una clic non colpisce.
const shot = process.env.SHOT ?? "/tmp/sws-drag-debug.png";
await pg.screenshot({ path: shot, fullPage: false });
console.log(`  screenshot: ${shot}`);
const diag = await pg.evaluate(() => ({
  svgCount: document.querySelectorAll("svg").length,
  viewBox: document.querySelector("svg")?.getAttribute("viewBox") ?? null,
  buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 14),
  objIds: [...document.querySelectorAll("[data-obj-id]")].length,
  rects: document.querySelectorAll("svg rect").length,
}));
console.log(`  diagnostica: ${JSON.stringify(diag)}`);

const before = await coords();
const ids = Object.keys(before);
console.log(`  oggetti sulla pagina: ${ids.length} → ${ids.join(", ")}`);
if (ids.length < 2) { fail("servono almeno 2 oggetti sulla pagina"); await browser.close(); process.exit(); }

const [a, b] = ids;

// I due oggetti si selezionano cliccando il primo e shift-cliccando il secondo,
// esattamente come fa il maintainer.
// Si localizza ogni oggetto dal rettangolo SVG che ha ESATTAMENTE le sue
// coordinate logiche, e se ne prende il rettangolo su schermo. Il tentativo
// precedente calcolava l'origine dal primo `<svg>` del documento — che è il logo
// in alto a sinistra, non il canvas — e le clic finivano nel vuoto.
const box = async (id) => pg.evaluate(({ x, y }) => {
  // Il canvas è l'`<svg>` più grande: l'altro è la miniatura della pagina nel
  // pannello di sinistra, i cui rettangoli hanno le stesse coordinate logiche
  // ma misurano 3×2 px sullo schermo — cercando in tutto il documento si finiva
  // a cliccare la miniatura.
  const svgs = [...document.querySelectorAll("svg")];
  const canvas = svgs.reduce((best, s) => {
    const r = s.getBoundingClientRect();
    return !best || r.width * r.height > best.area ? { el: s, area: r.width * r.height } : best;
  }, null)?.el;
  if (!canvas) return null;
  const el = [...canvas.querySelectorAll("rect")].find(
    (r) => Number(r.getAttribute("x")) === x && Number(r.getAttribute("y")) === y,
  );
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, before[id]);

const boxA = await box(a), boxB = await box(b);
if (!boxA || !boxB) {
  fail(`oggetti non trovati sul canvas (a=${JSON.stringify(boxA)} b=${JSON.stringify(boxB)})`);
  await browser.close();
  process.exit();
}
console.log(`  ${a} sullo schermo: ${JSON.stringify(boxA)}`);
console.log(`  ${b} sullo schermo: ${JSON.stringify(boxB)}`);

const center = (bx) => ({ x: bx.x + (bx.width || 0) / 2, y: bx.y + (bx.height || 0) / 2 });
const cA = center(boxA), cB = center(boxB);

await pg.mouse.click(cA.x, cA.y);
await pg.waitForTimeout(200);
await pg.keyboard.down("Shift");
await pg.mouse.click(cB.x, cB.y);
await pg.keyboard.up("Shift");
await pg.waitForTimeout(300);

// Quanti oggetti risultano selezionati secondo lo store? Lo si legge dal DOM
// contando i rettangoli tratteggiati di selezione.
const selRects = await pg.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")];
  const canvas = svgs.reduce((best, s) => {
    const r = s.getBoundingClientRect();
    return !best || r.width * r.height > best.area ? { el: s, area: r.width * r.height } : best;
  }, null)?.el;
  if (!canvas) return 0;
  // Qualunque tratteggio: il contorno di selezione è disegnato da più percorsi di
  // rendering e cercare il valore esatto "4 2" riportava 0 mentre la selezione
  // era attiva — un dato diagnostico sbagliato è peggio di nessun dato.
  return [...canvas.querySelectorAll("rect")].filter((r) => r.getAttribute("stroke-dasharray")).length;
});
console.log(`  contorni tratteggiati sul canvas: ${selRects} (indicativo della selezione)`);

// Drag di 120×60 px partendo dal primo oggetto.
const DX = 120, DY = 60;
await pg.mouse.move(cA.x, cA.y);
await pg.mouse.down();
await pg.mouse.move(cA.x + DX / 2, cA.y + DY / 2, { steps: 5 });
await pg.mouse.move(cA.x + DX, cA.y + DY, { steps: 5 });
await pg.mouse.up();
await pg.waitForTimeout(500);

// Salvataggio, così il synoptic su disco riflette lo spostamento.
await pg.keyboard.press("Control+s");
await pg.waitForTimeout(1200);

const after = await coords();
const moved = (id) => ({
  dx: Math.round((after[id]?.x ?? 0) - (before[id]?.x ?? 0)),
  dy: Math.round((after[id]?.y ?? 0) - (before[id]?.y ?? 0)),
});
const mA = moved(a), mB = moved(b);
console.log(`  ancora   ${a}: dx=${mA.dx} dy=${mA.dy}`);
console.log(`  seguace  ${b}: dx=${mB.dx} dy=${mB.dy}`);

if (mA.dx === 0 && mA.dy === 0) {
  fail("nemmeno l'oggetto trascinato si è mosso: il drag non è partito");
} else if (mB.dx === 0 && mB.dy === 0) {
  fail(`si muove solo l'oggetto sotto il cursore — è il bug segnalato (selezionati: ${selRects})`);
} else if (mA.dx !== mB.dx || mA.dy !== mB.dy) {
  fail(`i due oggetti si muovono di quantità diverse: ${JSON.stringify(mA)} vs ${JSON.stringify(mB)}`);
} else {
  console.log("  ✓ entrambi gli oggetti si sono spostati dello stesso delta");
}

await browser.close();
