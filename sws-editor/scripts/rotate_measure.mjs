// F8.4 — la maniglia di rotazione ruota davvero l'oggetto, e il resize
// funziona anche su un oggetto già ruotato?
//
// Le due cose si misurano sul synoptic salvato: `rotation` dopo il
// trascinamento della maniglia, e width/height dopo il trascinamento di una
// maniglia laterale su un oggetto ruotato di 90° (dove prima il resize era
// disabilitato del tutto).
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;
const IDE   = process.env.IDE;
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";

const api = async (path) => {
  const r = await fetch(`${ADMIN}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return JSON.parse(await r.text());
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
const save = async () => { await pg.keyboard.press("Control+s"); await pg.waitForTimeout(1200); };

// ── 1. rotazione col mouse ────────────────────────────────────────────────
// "plain" sta a (100,100,120x80): centro (160,140). La maniglia di rotazione è
// 18px sopra il bordo alto, cioè a (160, 82). Trascinandola a destra del
// centro l'oggetto ruota di ~90°.
const centerPlain = await toScreen(160, 140);
await pg.mouse.click(centerPlain.x, centerPlain.y);
await pg.waitForTimeout(250);
const rotHandle = await toScreen(160, 82);
const target90  = await toScreen(218, 140);   // a destra del centro = +90°
await pg.mouse.move(rotHandle.x, rotHandle.y);
await pg.mouse.down();
await pg.mouse.move(target90.x, target90.y, { steps: 14 });
await pg.mouse.up();
await save();

let objs = (await api(`/synoptics/${encodeURIComponent(PAGE)}`)).objects ?? [];
const plain = objs.find((o) => o.id === "plain");
const rot = plain?.rotation ?? 0;
if (Math.abs(rot - 90) <= 4) ok(`rotazione col mouse: ${rot}° (atteso ~90°)`);
else fail(`rotazione: ${rot}°, atteso ~90°`);

// ── 2. resize di un oggetto ruotato ───────────────────────────────────────
// "turned" è già ruotato di 90° (100x60 a 500,300). La maniglia "mr" (destra
// nel sistema LOCALE) dopo la rotazione si vede in basso: si trascina lungo
// l'asse locale +x, che sullo schermo è +y. La larghezza deve crescere,
// l'altezza restare.
const turned0 = objs.find((o) => o.id === "turned");
console.log(`  turned prima: w=${turned0?.width} h=${turned0?.height} rot=${turned0?.rotation}`);
const cTurned = await toScreen(550, 330);         // centro (500+50, 300+30)
await pg.mouse.click(cTurned.x, cTurned.y);
await pg.waitForTimeout(250);
// Maniglia mr in coordinate locali (600,330) → ruotata di 90° attorno al
// centro finisce a (550, 380) in coordinate pagina.
const mrScreen = await toScreen(550, 380);
const mrTarget = await toScreen(550, 420);        // +40 lungo l'asse locale x
await pg.mouse.move(mrScreen.x, mrScreen.y);
await pg.mouse.down();
await pg.mouse.move(mrTarget.x, mrTarget.y, { steps: 12 });
await pg.mouse.up();
await save();

objs = (await api(`/synoptics/${encodeURIComponent(PAGE)}`)).objects ?? [];
const turned = objs.find((o) => o.id === "turned");
console.log(`  turned dopo:  w=${turned?.width} h=${turned?.height} rot=${turned?.rotation}`);
if ((turned?.width ?? 0) > (turned0?.width ?? 0) + 20) ok(`resize su oggetto ruotato: larghezza ${turned0?.width} → ${turned?.width}`);
else fail(`resize su oggetto ruotato: larghezza ${turned0?.width} → ${turned?.width} (attesa in crescita)`);
if (Math.abs((turned?.height ?? 0) - (turned0?.height ?? 0)) < 6) ok(`altezza invariata (${turned?.height})`);
else fail(`altezza cambiata: ${turned0?.height} → ${turned?.height} (la maniglia laterale non deve toccarla)`);

await browser.close();
console.log(bad === 0 ? "\nTUTTO OK" : `\n${bad} PROBLEMI`);
process.exit(bad === 0 ? 0 : 1);
