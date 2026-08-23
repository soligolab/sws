// F8.1 — il bordo trascinato in resize si aggancia ai bordi degli altri
// oggetti? Prima il resize conosceva solo la griglia: si misura trascinando la
// maniglia destra di A verso il bordo sinistro di B, fermandosi POCO PRIMA, e
// controllando che il risultato combaci esattamente.
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;
const IDE   = process.env.IDE;
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";

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

// Snap alla griglia SPENTO: così un risultato allineato al bordo di B non può
// essere merito della griglia da 10px.
const snapOff = await pg.evaluate(() => {
  const cb = [...document.querySelectorAll('input[type="checkbox"]')]
    .find((i) => (i.closest("label")?.textContent ?? "").toLowerCase().includes("snap"));
  if (!cb) return "checkbox snap non trovata";
  if (cb.checked) cb.click();
  return cb.checked ? "ancora attivo" : "spento";
});
console.log(`  snap griglia: ${snapOff}`);

await pg.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")]
    .map((s) => ({ s, r: s.getBoundingClientRect() }))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0].s;
  svg.setAttribute("data-measure-canvas", "1");
});
const toScreen = (x, y) => pg.evaluate(([x, y]) => {
  const svg = document.querySelector("svg[data-measure-canvas]");
  const g = svg.querySelector("g[transform]");
  const p = svg.createSVGPoint(); p.x = x; p.y = y;
  const s = p.matrixTransform((g ?? svg).getScreenCTM());
  return { x: s.x, y: s.y };
}, [x, y]);

// Seleziona A (100,100,100x60 → bordo destro a 200), poi trascina la maniglia
// destra fino a 3px prima del bordo sinistro di B (x=260).
const centerA = await toScreen(150, 130);
await pg.mouse.click(centerA.x, centerA.y);
await pg.waitForTimeout(200);

const handle = await toScreen(200, 130);   // maniglia "r" a metà altezza
const target = await toScreen(257, 130);   // 3px prima del bordo di B
await pg.mouse.move(handle.x, handle.y);
await pg.mouse.down();
await pg.mouse.move(target.x, target.y, { steps: 12 });
await pg.waitForTimeout(120);
// Le linee guida di snap devono comparire durante il trascinamento.
// Colore delle linee guida di snap: #06b6d4 (SvgCanvas, blocco snapLines).
const guides = await pg.evaluate(() =>
  document.querySelectorAll('svg[data-measure-canvas] line[stroke="#06b6d4"]').length);
await pg.mouse.up();
await pg.waitForTimeout(400);
await pg.keyboard.press("Control+s");
await pg.waitForTimeout(1500);

const after = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
const a = (after.objects ?? []).find((o) => o.id === "a");
console.log(`  A dopo il resize: x=${a?.x} width=${a?.width} (bordo destro ${(a?.x ?? 0) + (a?.width ?? 0)})`);
const right = (a?.x ?? 0) + (a?.width ?? 0);
if (Math.abs(right - 260) < 0.6) ok(`bordo destro agganciato a B (${right} ≈ 260)`);
else fail(`bordo destro ${right}, atteso 260 (aggancio al bordo di B)`);
if (guides > 0) ok(`linee guida visibili durante il resize (${guides})`);
else console.log("  · linee guida non rilevate (colore diverso?), non bloccante");

await browser.close();
console.log(bad === 0 ? "\nTUTTO OK" : `\n${bad} PROBLEMI`);
process.exit(bad === 0 ? 0 : 1);
