// Verifica del Lotto 1 (coda WYSIWYG) — misura, non deduzione.
//
// 1. Ogni tipo convertito al pattern "contenuto runtime + pointerEvents:none"
//    deve restare SELEZIONABILE col mouse: senza hit-rect un oggetto non
//    selezionato e senza sfondo non si può cliccare (era il caso di
//    setpoint/checkbox/radio/sparkline dopo la sessione di ieri).
// 2. Lo slider orizzontale con label deve stare DENTRO l'altezza dichiarata.
// 3. Un trend in formato legacy deve migrare a trend_tags al salvataggio.
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;
const IDE   = process.env.IDE;
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";
const SHOT  = process.env.SHOT ?? "/tmp/sws-wysiwyg.png";

const api = async (path, init) => {
  const r = await fetch(`${ADMIN}${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
let bad = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); bad++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 }, ignoreHTTPSErrors: true });
const pg = await ctx.newPage();
pg.on("console", (m) => { if (m.type() === "error") console.log(`    [browser] ${m.text()}`); });

await pg.goto(`${IDE}/index-admin.html`, { waitUntil: "domcontentloaded" });
await pg.waitForSelector("svg", { timeout: 30_000 });
await pg.waitForTimeout(2500);
await pg.screenshot({ path: SHOT });
console.log(`  screenshot: ${SHOT}`);

// ── 1. selezionabilità ─────────────────────────────────────────────────────
// Si clicca al centro del box dichiarato di ogni oggetto e si controlla che il
// pannello proprietà mostri quell'id (l'editor scrive l'id nel campo "ID").
const page0 = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
const objs = page0.objects ?? [];

// Trasformazione pagina→schermo letta dal DOM: il canvas può essere zoomato.
// L'SVG più GRANDE è il canvas: `querySelector("svg")` pescava la miniatura
// della pagina nel pannello sinistro (32x20) e tutti i click andavano a vuoto.
const box = await pg.evaluate(() => {
  const all = [...document.querySelectorAll("svg")]
    .map((s) => ({ s, r: s.getBoundingClientRect() }))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const { s, r } = all[0];
  s.setAttribute("data-measure-canvas", "1");
  return { x: r.x, y: r.y, w: r.width, h: r.height, vb: s.getAttribute("viewBox") };
});
console.log(`  svg box: ${JSON.stringify(box)}`);
// Il canvas NON usa viewBox: pan e zoom stanno in un transform sul <g> interno.
// Stimare la scala da larghezza/altezza sbagliava fino al 10% in y e mancava
// tutti gli oggetti alti ~32px. Qui si usa la matrice vera (getScreenCTM).
const toScreen = async (x, y) => pg.evaluate(([x, y]) => {
  const svg = document.querySelector("svg[data-measure-canvas]");
  const g = svg.querySelector("g[transform]");
  const m = (g ?? svg).getScreenCTM();
  const p = svg.createSVGPoint();
  p.x = x; p.y = y;
  const s = p.matrixTransform(m);
  return { x: s.x, y: s.y };
}, [x, y]);

for (const o of objs) {
  const w = o.width ?? 100, h = o.height ?? 50;
  const c = await toScreen(o.x + w / 2, o.y + h / 2);
  await pg.mouse.click(c.x, c.y);
  await pg.waitForTimeout(120);
  const shown = await pg.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    const hit = inputs.find((i) => i.readOnly && /^[a-z0-9_\-]+$/i.test(i.value ?? ""));
    return hit?.value ?? null;
  });
  const selCount = await pg.evaluate(() =>
    document.querySelectorAll('svg[data-measure-canvas] rect[stroke="#facc15"]').length);
  if (selCount > 0) ok(`${o.type} (${o.id}) selezionabile col click`);
  else fail(`${o.type} (${o.id}) NON selezionabile col click (shown=${shown})`);
}

// ── 2. slider dentro il box ────────────────────────────────────────────────
const sl = objs.find((o) => o.type === "slider" && o.label);
if (sl) {
  const fo = await pg.evaluate(() => {
    const list = [...document.querySelectorAll("foreignObject")];
    return list.map((f) => ({
      y: Number(f.getAttribute("y")), h: Number(f.getAttribute("height")),
      x: Number(f.getAttribute("x")),
    }));
  });
  const mine = fo.find((f) => f.x === sl.x && f.y === sl.y);
  if (!mine) fail("slider: foreignObject non trovato");
  else if (mine.h === (sl.height ?? 50)) ok(`slider contenuto nel box (h=${mine.h} = dichiarata)`);
  else fail(`slider sfora il box: foreignObject h=${mine.h}, dichiarata ${sl.height}`);
}

// ── 3. migrazione trend ────────────────────────────────────────────────────
const trendBefore = objs.find((o) => o.type === "trend");
console.log(`  trend prima del salvataggio: ${JSON.stringify(trendBefore)}`);
// Ctrl+S salva la pagina corrente.
await pg.keyboard.press("Control+s");
await pg.waitForTimeout(2000);
const after = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
const trendAfter = (after.objects ?? []).find((o) => o.type === "trend");
console.log(`  trend dopo il salvataggio:  ${JSON.stringify(trendAfter)}`);
if (!trendAfter) fail("trend scomparso dopo il salvataggio");
else {
  if (Array.isArray(trendAfter.trend_tags) && trendAfter.trend_tags.length === 2) ok("trend_tags scritto con 2 tracce");
  else fail(`trend_tags atteso con 2 tracce, trovato ${JSON.stringify(trendAfter.trend_tags)}`);
  for (const legacy of ["extra_tags", "trend_series_styles", "line_color", "tag"]) {
    if (trendAfter[legacy] === undefined) ok(`campo legacy '${legacy}' rimosso`);
    else fail(`campo legacy '${legacy}' ancora presente: ${JSON.stringify(trendAfter[legacy])}`);
  }
}

await browser.close();
console.log(bad === 0 ? "\nTUTTO OK" : `\n${bad} PROBLEMI`);
process.exit(bad === 0 ? 0 : 1);
