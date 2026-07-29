// Misura le scrollbar del viewer a 1280×800 (il WP620), con e senza chrome.
// Lanciato da scripts/check_viewer_layout.sh, che prepara runtime e progetto.
//
// Cosa si verifica, e perché queste tre misure: il maintainer vedeva TRE barre
// di scorrimento per pochi pixel, e le cause erano indipendenti — il margine di
// default del body contro un figlio 100vh, l'<svg> a height letterale in
// modalità fisso senza sottrarre le fasce, e la larghezza mangiata da margini +
// scrollbar. Quindi si misura il documento E il contenitore della pagina.
import { chromium } from "@playwright/test";

const VIEWER = process.env.VIEWER ?? "http://localhost:8643";
const ADMIN = process.env.ADMIN ?? "http://localhost:8644/api";

async function setChrome(hide) {
  const cur = await (await fetch(`${ADMIN}/project`)).json();
  // `size_mode: fixed` prende le dimensioni dal synoptic; page_layout non ha
  // width/height (li avevo inventati: il PUT rispondeva 204 e li scartava).
  const layout = { ...(cur.page_layout ?? {}), size_mode: "fixed", hide_viewer_chrome: hide };
  const r = await fetch(`${ADMIN}/project/page-layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
  });
  if (!r.ok) throw new Error(`page-layout PUT ${r.status}: ${await r.text()}`);
  return layout;
}

async function measure(page, label) {
  await page.goto(VIEWER, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // WS + primo render del synoptic
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const svg = document.querySelector("svg");
    // Il contenitore scrollabile dell'area pagina: l'antenato dell'svg che
    // scorre. Si cerca risalendo, così non dipende dalla struttura esatta.
    let box = null;
    for (let el = svg?.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) { box = el; break; }
    }
    const rect = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    return {
      doc: { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight },
      bodyMargin: getComputedStyle(document.body).margin,
      svg: rect(svg),
      svgAttrs: svg ? { width: svg.getAttribute("width"), height: svg.getAttribute("height"), viewBox: svg.getAttribute("viewBox") } : null,
      overflowingBox: box ? { tag: box.tagName, sw: box.scrollWidth, cw: box.clientWidth, sh: box.scrollHeight, ch: box.clientHeight } : null,
      nav: !!document.querySelector("nav"),
    };
  });
  const hDoc = m.doc.sw > m.doc.cw;
  const vDoc = m.doc.sh > m.doc.ch;
  console.log(`\n=== ${label} ===`);
  console.log(`  documento: ${m.doc.sw}×${m.doc.sh} in ${m.doc.cw}×${m.doc.ch}` +
              `  → barra orizz: ${hDoc ? "SÌ" : "no"}, vert: ${vDoc ? "SÌ" : "no"}`);
  console.log(`  body margin: ${m.bodyMargin}`);
  console.log(`  <nav>: ${m.nav ? "presente" : "assente"}`);
  console.log(`  svg: ${m.svg ? `${m.svg.w}×${m.svg.h}` : "(nessuno)"}  attrs: ${JSON.stringify(m.svgAttrs)}`);
  console.log(`  contenitore che scorre: ${m.overflowingBox ? JSON.stringify(m.overflowingBox) : "nessuno"}`);
  const shots = process.env.SHOTS_DIR;
  if (shots) await page.screenshot({ path: `${shots}/${label.replace(/\W+/g, "-")}.png` });
  return { ...m, hDoc, vDoc };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console error]", m.text()); });

const results = {};
await setChrome(false);
results.conChrome = await measure(page, "chrome visibile");
await setChrome(true);
results.senzaChrome = await measure(page, "chrome nascosto");

// Finestra più piccola del progetto: la pagina deve rimpicciolirsi, non scorrere.
await page.setViewportSize({ width: 1024, height: 600 });
results.piccola = await measure(page, "finestra 1024x600 (scale-to-fit)");
// Finestra più grande: cap a 1, quindi resta 1280×800 con margini vuoti.
await page.setViewportSize({ width: 1600, height: 1000 });
results.grande = await measure(page, "finestra 1600x1000 (cap a 1)");

await browser.close();

console.log("\n=== esito ===");
const fails = [];
for (const [k, r] of Object.entries(results)) {
  if (r.hDoc || r.vDoc) fails.push(`${k}: barra sul documento (${r.doc.sw}×${r.doc.sh} in ${r.doc.cw}×${r.doc.ch})`);
  if (r.overflowingBox) fails.push(`${k}: contenitore che scorre ${JSON.stringify(r.overflowingBox)}`);
}
if (results.senzaChrome.nav) fails.push("chrome nascosto: <nav> ancora presente");
if (!results.conChrome.nav) fails.push("chrome visibile: <nav> assente (4 pagine, dovrebbe esserci)");
console.log(fails.length ? fails.map((f) => "  ✗ " + f).join("\n") : "  ✓ nessuna scrollbar in nessuna delle 4 configurazioni");
process.exit(fails.length ? 1 : 0);
