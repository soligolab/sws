// T-52 — misura il **limite morbido** del bordo pagina, col mouse vero.
//
// La matematica (`softEdgeAxis`) è provata a tavolino in
// `tests/pageLayout.test.ts`. Quello che nessun unit test può dire è se quella
// matematica arriva davvero sotto il dito: la gabbia calcolata alla presa, gli
// offset, lo zoom del canvas e la cascata di snap stanno tutti fra la funzione
// pura e l'oggetto che si muove.
//
// Quattro misure, tutte leggendo le coordinate dal synoptic salvato via API e
// non dal DOM, così non dipendono da come l'oggetto è disegnato:
//
//   a) puntatore poco oltre il bordo  ⇒ l'oggetto resta incollato a pageW - w;
//   b) puntatore molto oltre          ⇒ si sgancia e segue il puntatore;
//   c) la soglia è in pixel SCHERMO   ⇒ con il canvas non a scala 1, esiste uno
//      scostamento che è "poco" in pixel schermo e "molto" in unità pagina: il
//      comportamento deve seguire i pixel schermo. È l'unica misura che
//      distingue una soglia giusta da una scritta in unità pagina, e le prime
//      due da sole non la vedrebbero;
//   d) multi-selezione oltre il bordo ⇒ trattenuta come un blocco, cioè la
//      distanza fra i due oggetti non cambia.
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;                 // http://host:port/api
const IDE   = process.env.IDE;                   // http://host:port
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";
const PAGE_W = Number(process.env.PAGE_W ?? 1280);
const RESIST = 24;                               // PAGE_EDGE_RESIST_PX, in px schermo

let bad = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); bad++; };
const pass = (msg) => console.log(`  ✓ ${msg}`);

const api = async (path, init) => {
  const r = await fetch(`${ADMIN}${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
};

const coords = async () => {
  const page = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
  return Object.fromEntries((page.objects ?? []).map((o) => [o.id, { x: o.x, y: o.y, w: o.width, h: o.height }]));
};

/** Rimette gli oggetti dove stavano: ogni misura parte dalla stessa posizione. */
const reset = async (objects) =>
  api(`/synoptics/${encodeURIComponent(PAGE)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "pagina-1", name: PAGE, width: PAGE_W, height: 800, objects }),
  });

const OBJECTS = [
  { id: "rect_a", type: "rect", x: 100, y: 100, width: 120, height: 80, fill: "#3b82f6" },
  { id: "rect_b", type: "rect", x: 400, y: 100, width: 120, height: 80, fill: "#ef4444" },
];

// Su una macchina senza i browser scaricati da Playwright si punta a un
// Chromium di sistema, come già permette `playwright.config.ts`. Gli altri
// script di misura non lo onorano, e su frodo è la differenza fra poter
// lanciare questa guardia e non poterla lanciare affatto.
const browser = await chromium.launch(
  process.env.SWS_E2E_CHROMIUM ? { executablePath: process.env.SWS_E2E_CHROMIUM } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const pg = await ctx.newPage();
pg.on("console", (m) => { if (m.type() === "error") console.log(`    [browser] ${m.text()}`); });

await pg.goto(`${IDE}/index-admin.html`, { waitUntil: "domcontentloaded" });
await pg.waitForSelector('button:has-text("Menu"), button:has-text("☰")', { timeout: 30_000 });
await pg.waitForTimeout(1500);

/** Il rettangolo su schermo dell'oggetto con quelle coordinate logiche.
 *  Il canvas è l'`<svg>` più grande: l'altro è la miniatura nel pannello di
 *  sinistra, che ha le stesse coordinate logiche e misura pochi pixel. */
const box = async (logical) => pg.evaluate(({ x, y }) => {
  const canvas = [...document.querySelectorAll("svg")].reduce((best, s) => {
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
}, logical);

/** Il rettangolo su schermo del canvas — l'`<svg>` più grande. Serve perché il
 *  drag vive su `onMouseMove` dell'`<svg>`: appena il puntatore esce da lì gli
 *  eventi finiscono e l'oggetto si ferma dove capita. Senza questo controllo la
 *  misura fallirebbe dando la colpa al limite morbido. */
const canvasRect = async () => pg.evaluate(() => {
  const el = [...document.querySelectorAll("svg")].reduce((best, s) => {
    const r = s.getBoundingClientRect();
    return !best || r.width * r.height > best.area ? { el: s, area: r.width * r.height } : best;
  }, null)?.el;
  const r = el.getBoundingClientRect();
  return { left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
});

/** Allontana la vista di `n` scatti di Ctrl+rotella (1/1.1 l'uno).
 *  Due scopi: il bordo destro della pagina deve stare **dentro** il canvas, o
 *  il puntatore non può arrivarci; e a scala diversa da 1 la misura (c) può
 *  distinguere una soglia in pixel schermo da una in unità pagina. */
const zoomOut = async (n) => {
  const c = await canvasRect();
  await pg.mouse.move((c.left + c.right) / 2, (c.top + c.bottom) / 2);
  await pg.keyboard.down("Control");
  for (let i = 0; i < n; i++) { await pg.mouse.wheel(0, 120); await pg.waitForTimeout(80); }
  await pg.keyboard.up("Control");
  await pg.waitForTimeout(300);
};

/** Trascina `rect_a` finché l'origine dell'oggetto arriva a `targetPageX`,
 *  poi salva e restituisce le coordinate lette dal synoptic. */
const dragTo = async (targetPageX, opts = {}) => {
  await reset(OBJECTS);
  await pg.reload({ waitUntil: "domcontentloaded" });
  await pg.waitForSelector('button:has-text("Menu"), button:has-text("☰")', { timeout: 30_000 });
  await pg.waitForTimeout(1200);
  await zoomOut(6);

  const bA = await box({ x: 100, y: 100 });
  const bB = await box({ x: 400, y: 100 });
  if (!bA || !bB) throw new Error(`oggetti non trovati sul canvas (a=${JSON.stringify(bA)})`);
  const scale = bA.width / 120;                        // px schermo per unità pagina
  const cA = { x: bA.x + bA.width / 2, y: bA.y + bA.height / 2 };

  if (opts.group) {
    const cB = { x: bB.x + bB.width / 2, y: bB.y + bB.height / 2 };
    await pg.mouse.click(cA.x, cA.y);
    await pg.waitForTimeout(150);
    await pg.keyboard.down("Shift");
    await pg.mouse.click(cB.x, cB.y);
    await pg.keyboard.up("Shift");
    await pg.waitForTimeout(250);
  }

  const dxScreen = (targetPageX - 100) * scale;
  const c = await canvasRect();
  if (cA.x + dxScreen > c.right - 8) {
    throw new Error(
      `il puntatore dovrebbe arrivare a x=${Math.round(cA.x + dxScreen)} ma il canvas finisce a `
      + `${Math.round(c.right)}: il drag perderebbe gli eventi e la misura direbbe una bugia. `
      + "Allontanare di più la vista (zoomOut) o rimpicciolire la pagina di prova.");
  }
  await pg.mouse.move(cA.x, cA.y);
  await pg.mouse.down();
  await pg.mouse.move(cA.x + dxScreen / 2, cA.y, { steps: 6 });
  await pg.mouse.move(cA.x + dxScreen, cA.y, { steps: 6 });
  await pg.mouse.up();
  await pg.waitForTimeout(400);
  await pg.keyboard.press("Control+s");
  await pg.waitForTimeout(1200);
  return { after: await coords(), scale };
};

// ── a) e b): trattenuto poco oltre, sganciato molto oltre ───────────────────
const maxX = PAGE_W - 120;                             // 1160: il lato destro tocca il bordo
{
  const { scale } = await dragTo(maxX);                // taratura: leggo la scala
  console.log(`  scala del canvas: ${scale.toFixed(4)} px schermo per unità pagina`);

  const poco = maxX + Math.max(2, Math.round((RESIST * 0.5) / scale));
  const r1 = (await dragTo(poco)).after.rect_a;
  if (Math.round(r1.x) === maxX) pass(`trattenuto al bordo: puntatore a ${poco}, oggetto fermo a ${maxX}`);
  else fail(`doveva restare a ${maxX}, è a ${r1.x} (puntatore a ${poco})`);

  const molto = maxX + Math.round((RESIST * 3) / scale);
  const r2 = (await dragTo(molto)).after.rect_a;
  if (r2.x > maxX + 1) pass(`sganciato: puntatore a ${molto}, oggetto a ${Math.round(r2.x)}`);
  else fail(`doveva sganciarsi oltre ${maxX}, è a ${r2.x} (puntatore a ${molto})`);
}

// ── c) la soglia è in pixel schermo, non in unità pagina ────────────────────
{
  const { scale } = await dragTo(maxX);
  // Cerco uno scostamento che i due modi di misurare giudicano in modo opposto.
  // Con canvas rimpicciolito (scale < 1) esiste fra 24*scale e 24 px schermo:
  // è meno di 24 px sullo schermo (⇒ trattenuto, giusto) ma più di 24 unità
  // pagina (⇒ sganciato, se qualcuno avesse scordato di dividere per lo zoom).
  let overScreen = null, atteso = null;
  if (scale < 0.98)      { overScreen = (RESIST * scale + RESIST) / 2; atteso = "trattenuto"; }
  else if (scale > 1.02) { overScreen = (RESIST + RESIST * scale) / 2; atteso = "sganciato"; }

  if (overScreen === null) {
    console.log("  ∅ canvas a scala 1: nessuno scostamento distingue i due modi di misurare, misura saltata");
  } else {
    const target = maxX + overScreen / scale;
    const r = (await dragTo(target)).after.rect_a;
    const trattenuto = Math.round(r.x) === maxX;
    if (trattenuto === (atteso === "trattenuto")) {
      pass(`soglia in pixel schermo: ${overScreen.toFixed(1)} px = ${(overScreen / scale).toFixed(1)} unità pagina ⇒ ${atteso}`);
    } else {
      fail(`la soglia sembra misurata in unità pagina: a ${overScreen.toFixed(1)} px schermo `
         + `(${(overScreen / scale).toFixed(1)} unità) l'oggetto è ${trattenuto ? "trattenuto" : "sganciato"}, atteso ${atteso}`);
    }
  }
}

// ── d) la multi-selezione è trattenuta come un blocco ───────────────────────
{
  // Gabbia dell'unione: da 100 a 520 ⇒ larga 420, quindi il blocco si ferma
  // quando la sua origine arriva a 1280 - 420 = 860. È anche la prova che la
  // gabbia è l'**unione** e non il solo oggetto sotto il cursore: con quella
  // sbagliata l'ancora si fermerebbe a 1160 e il seguace sarebbe già fuori.
  const maxGroup = PAGE_W - 420;
  {
    const { after } = await dragTo(maxGroup + 15, { group: true });
    if (Math.round(after.rect_a.x) === maxGroup) {
      pass(`multi-selezione trattenuta sulla gabbia dell'unione (origine a ${maxGroup})`);
    } else {
      fail(`la gabbia del gruppo non è l'unione: ancora a ${Math.round(after.rect_a.x)}, atteso ${maxGroup}`);
    }
  }
  const { after } = await dragTo(maxGroup + 400, { group: true });
  const a = after.rect_a, b = after.rect_b;
  const distanza = Math.round(b.x - a.x);
  if (distanza !== 300) fail(`la multi-selezione si è deformata: distanza ${distanza} invece di 300`);
  else if (Math.round(a.x) <= 100) fail(`la multi-selezione non si è mossa affatto (rect_a a ${a.x})`);
  else pass(`multi-selezione: blocco integro (distanza 300), rect_a a ${Math.round(a.x)}, rect_b a ${Math.round(b.x)}`);
}

await browser.close();
process.exitCode = bad === 0 ? 0 : 1;
