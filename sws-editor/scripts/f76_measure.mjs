// Verifica F7.6 — rifiniture di forma.
//
// 1. Round-trip dei campi nuovi (PUT → GET): il mirror Rust di synoptic.rs è
//    l'unico punto dove un campo si perde in silenzio.
// 2. Il rendering li usa davvero: si leggono gli attributi SVG prodotti
//    (rx, stroke-dasharray, url(#grad), preserveAspectRatio, zone del gauge,
//    tacche, lancetta setpoint, forma del led, gap della griglia).
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;
const IDE   = process.env.IDE;
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";
const SHOT  = process.env.SHOT ?? "/tmp/sws-f76.png";

const api = async (path, init) => {
  const r = await fetch(`${ADMIN}${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
let bad = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); bad++; };

// ── 1. round-trip ──────────────────────────────────────────────────────────
const saved = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
const byId = Object.fromEntries((saved.objects ?? []).map((o) => [o.id, o]));
const expect = {
  rect_fx:  { corner_radius: 12, stroke_dasharray: "6 3", fill_gradient: "vertical" },
  gauge_fx: { gauge_ticks: 5, gauge_start_angle: -120, gauge_end_angle: 120, gauge_sp_tag: "t.sp", gauge_sp_color: "#f59e0b" },
  led_sq:   { led_shape: "square" },
  grid_fx:  { grid_gap: 8, grid_padding: 6 },
  img_fx:   { image_fit: "contain" },
};
for (const [id, fields] of Object.entries(expect)) {
  for (const [k, v] of Object.entries(fields)) {
    const got = byId[id]?.[k];
    if (JSON.stringify(got) === JSON.stringify(v)) ok(`round-trip ${id}.${k} = ${JSON.stringify(got)}`);
    else fail(`round-trip ${id}.${k}: atteso ${JSON.stringify(v)}, trovato ${JSON.stringify(got)}`);
  }
}
const zones = byId.gauge_fx?.gauge_zones;
if (Array.isArray(zones) && zones.length === 2 && zones[0].color === "#22c55e") ok(`round-trip gauge_zones (${zones.length} zone)`);
else fail(`round-trip gauge_zones: ${JSON.stringify(zones)}`);

// ── 2. rendering ───────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 }, ignoreHTTPSErrors: true });
const pg = await ctx.newPage();
pg.on("console", (m) => { if (m.type() === "error") console.log(`    [browser] ${m.text()}`); });
await pg.goto(`${IDE}/index-admin.html`, { waitUntil: "domcontentloaded" });
await pg.waitForSelector("svg", { timeout: 30_000 });
await pg.waitForTimeout(2500);
await pg.screenshot({ path: SHOT });
console.log(`  screenshot: ${SHOT}`);

const dom = await pg.evaluate(() => {
  const canvas = [...document.querySelectorAll("svg")]
    .map((s) => ({ s, r: s.getBoundingClientRect() }))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0].s;
  const rects = [...canvas.querySelectorAll("rect")].map((r) => ({
    x: r.getAttribute("x"), y: r.getAttribute("y"), w: r.getAttribute("width"), h: r.getAttribute("height"),
    rx: r.getAttribute("rx"), dash: r.getAttribute("stroke-dasharray"), fill: r.getAttribute("fill"),
  }));
  return {
    rects,
    gradients: canvas.querySelectorAll("linearGradient, radialGradient").length,
    polygons: canvas.querySelectorAll("polygon").length,
    images: [...canvas.querySelectorAll("image")].map((i) => i.getAttribute("preserveAspectRatio")),
    // Le zone e le tacche del gauge: path con opacity 0.55 e linee sottili.
    zonePaths: [...canvas.querySelectorAll("path")].filter((p) => p.getAttribute("opacity") === "0.55").length,
    // Etichette di tacca: testi numerici dentro il riquadro del gauge
    // (x 260..460, y 40..210), altrimenti si contano anche gli 0/50/100 altrui.
    tickTexts: [...canvas.querySelectorAll("text")].filter((t) => {
      const x = Number(t.getAttribute("x")), y = Number(t.getAttribute("y"));
      return /^(0|25|50|75|100)$/.test(t.textContent ?? "")
        && x > 250 && x < 480 && y > 30 && y < 220;
    }).length,
    lines: canvas.querySelectorAll("line").length,
  };
});

const rectFx = dom.rects.find((r) => r.x === "40" && r.y === "40");
if (rectFx?.rx === "12") ok("rect: rx=12 applicato"); else fail(`rect: rx atteso 12, trovato ${rectFx?.rx}`);
if (rectFx?.dash === "6 3") ok("rect: tratteggio applicato"); else fail(`rect: dash ${rectFx?.dash}`);
if ((rectFx?.fill ?? "").startsWith("url(#")) ok(`rect: riempimento sfumato (${rectFx.fill})`); else fail(`rect: fill ${rectFx?.fill}`);
if (dom.gradients >= 1) ok(`defs: ${dom.gradients} gradiente(i)`); else fail("defs: nessun gradiente");
if (dom.zonePaths === 2) ok("gauge: 2 zone colorate disegnate"); else fail(`gauge: zone disegnate ${dom.zonePaths}`);
if (dom.tickTexts >= 5) ok(`gauge: ${dom.tickTexts} etichette di tacca`); else fail(`gauge: etichette tacca ${dom.tickTexts}`);
if (dom.images.includes("xMidYMid meet")) ok("image: preserveAspectRatio=meet (contieni)"); else fail(`image: ${JSON.stringify(dom.images)}`);
// Led quadrato: il CORPO (rect pieno 24x24), non l'indicatore d'ingombro
// tratteggiato che l'editor disegna su ogni oggetto (fill="none").
const ledSq = dom.rects.find((r) => r.x === "700" && r.y === "40"
  && r.w === "24" && r.h === "24" && r.fill && r.fill !== "none" && r.fill !== "transparent");
if (ledSq) ok(`led: corpo quadrato disegnato (fill=${ledSq.fill})`);
else fail(`led: corpo quadrato non trovato fra ${JSON.stringify(dom.rects.filter((r) => r.x === "700").slice(0, 4))}`);
// Griglia col gap: le celle sono rientrate di gap/2 dal bordo dichiarato.
const cell = dom.rects.find((r) => r.x === "50" && r.y === "260");
if (cell) ok("grid: celle rientrate da padding+gap (x=50 su box x=40)"); else fail(
  `grid: cella attesa a x=50/y=260, trovate ${JSON.stringify(dom.rects.filter((r) => Number(r.x) > 39 && Number(r.x) < 70 && Number(r.y) > 250).slice(0, 4))}`);

await browser.close();
console.log(bad === 0 ? "\nTUTTO OK" : `\n${bad} PROBLEMI`);
process.exit(bad === 0 ? 0 : 1);
