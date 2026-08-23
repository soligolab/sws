// Verifica Lotto 3 (F7.1-F7.4) — round-trip dei campi nuovi + prova che il
// rendering li usi davvero, sul DOM prodotto dal canvas.
import { chromium } from "@playwright/test";

const ADMIN = process.env.ADMIN;
const IDE   = process.env.IDE;
const PAGE  = process.env.PAGE_NAME ?? "Pagina 1";
const SHOT  = process.env.SHOT ?? "/tmp/sws-f7.png";

const api = async (path, init) => {
  const r = await fetch(`${ADMIN}${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
let bad = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); bad++; };

// ── 1. round-trip (il mirror synoptic.rs è dove i campi si perdono) ────────
const saved = await api(`/synoptics/${encodeURIComponent(PAGE)}`);
const byId = Object.fromEntries((saved.objects ?? []).map((o) => [o.id, o]));
const expect = {
  txt_wrap: { text_wrap: true, text_valign: "middle", line_height: 1.6, width: 200, height: 90 },
  bar_neg:  { bar_ticks: 5, bar_show_legend: true },
  bar_stk:  { bar_mode: "stacked" },
  pie_grp:  { pie_label_mode: "value_percent", pie_group_below_pct: 10, pie_explode_px: 8, pie_hole_color: "#ffffff" },
  tbl:      { table_sortable: true, table_filterable: true, table_font_size: 12, table_label_header: "SEGNALI" },
  // F7.5 — allarmi: comandi del viewer e storico piazzabile
  av:       { alarm_viewer_show_ack_all: true, alarm_viewer_show_shelve: true, alarm_shelve_minutes: 30 },
  ah:       { alarm_history_id: "AL_TEST" },
};
for (const [id, fields] of Object.entries(expect)) {
  for (const [k, v] of Object.entries(fields)) {
    const got = byId[id]?.[k];
    if (JSON.stringify(got) === JSON.stringify(v)) ok(`round-trip ${id}.${k} = ${JSON.stringify(got)}`);
    else fail(`round-trip ${id}.${k}: atteso ${JSON.stringify(v)}, trovato ${JSON.stringify(got)}`);
  }
}
const cols = byId.tbl?.table_columns;
if (Array.isArray(cols) && cols.join(",") === "label,value,unit,quality") ok(`round-trip table_columns = ${cols.join(",")}`);
else fail(`round-trip table_columns: ${JSON.stringify(cols)}`);
const r0 = byId.tbl?.table_rows?.[0];
if (r0?.writable === true && r0?.unit === "bar" && r0?.alarm_high === 9) ok("round-trip opzioni per-riga (writable/unit/soglie)");
else fail(`round-trip opzioni per-riga: ${JSON.stringify(r0)}`);

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
  const fo = [...canvas.querySelectorAll("foreignObject")].map((f) => ({
    x: Number(f.getAttribute("x")), y: Number(f.getAttribute("y")),
    w: Number(f.getAttribute("width")), h: Number(f.getAttribute("height")),
    html: f.innerHTML.slice(0, 400),
    // Testo visibile: l'HTML troncato a 400 caratteri non basta a cercarci
    // dentro un'intestazione che sta più in fondo.
    text: (f.textContent ?? "").slice(0, 300),
    // Stili risolti del primo div (per il testo multiriga).
    style: (() => {
      const d = f.querySelector("div");
      if (!d) return null;
      const cs = getComputedStyle(d);
      return { whiteSpace: cs.whiteSpace, alignItems: cs.alignItems, lineHeight: cs.lineHeight,
               textAlign: cs.textAlign, color: cs.color, fontSize: cs.fontSize };
    })(),
  }));
  const texts = [...canvas.querySelectorAll("text")].map((t) => ({
    x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")), s: t.textContent,
  }));
  const rects = [...canvas.querySelectorAll("rect")].map((r) => ({
    x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
    w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")),
    fill: r.getAttribute("fill"),
  }));
  const circles = [...canvas.querySelectorAll("circle")].map((c) => ({
    cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")), fill: c.getAttribute("fill"),
  }));
  // Tabelle HTML dentro il canvas (F7.1) con header e celle.
  const tables = [...canvas.querySelectorAll("table")].map((t) => ({
    headers: [...t.querySelectorAll("thead th")].map((h) => h.textContent?.trim()).filter(Boolean),
    firstRow: [...(t.querySelector("tbody tr")?.querySelectorAll("td") ?? [])].map((d) => d.textContent?.trim()),
    inputs: t.querySelectorAll("input").length,
  }));
  return { fo, texts, rects, circles, tables };
});

// F7.4 — testo multiriga
const txtFo = dom.fo.find((f) => f.x === 40 && f.y === 40 && f.w === 200);
if (txtFo?.style?.whiteSpace === "pre-wrap") ok("testo: whiteSpace pre-wrap (va a capo)");
else fail(`testo: stile ${JSON.stringify(txtFo?.style)}`);
if (txtFo?.style?.alignItems === "center") ok("testo: allineamento verticale centrato");
else fail(`testo: alignItems ${txtFo?.style?.alignItems}`);
// Il colore deve venire dal token di tema (--brand-text), non essere
// hardcoded: dentro un foreignObject una var CSS non risolta darebbe il colore
// ereditato e nessuno se ne accorgerebbe guardando uno screenshot.
// NB: se il tema attivo è chiaro, il token È scuro — il contrasto con lo
// sfondo scelto per la PAGINA è un tema aperto, annotato in OPEN_QUESTIONS.
const themeText = await pg.evaluate(() => {
  const probe = document.createElement("div");
  probe.style.color = "var(--brand-text, #e2e8f0)";
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
});
if (txtFo?.style?.color === themeText) ok(`testo: colore dal tema (${themeText})`);
else fail(`testo: colore ${txtFo?.style?.color}, atteso il token di tema ${themeText}`);
if (txtFo?.style?.lineHeight && parseFloat(txtFo.style.lineHeight) > 18) ok(`testo: interlinea applicata (${txtFo.style.lineHeight} su corpo ${txtFo.style.fontSize})`);
else fail(`testo: interlinea ${txtFo?.style?.lineHeight}`);

// F7.2 — barre negative: prima un valore < 0 veniva clampato a 0 (barra
// invisibile). La misura è geometrica: la barra rossa (-40) sta SOTTO la linea
// dello zero e quella verde (+80) sopra, e le due si toccano su quella linea.
const barBox = (r) => r.x > 280 && r.x < 560 && r.y > 40 && r.y < 240;
const redBar   = dom.rects.find((r) => r.fill === "#ef4444" && barBox(r));
const greenBar = dom.rects.find((r) => r.fill === "#22c55e" && barBox(r));
if (!redBar || !greenBar) {
  fail(`bar: barre non trovate (rosso=${JSON.stringify(redBar)} verde=${JSON.stringify(greenBar)})`);
} else {
  const greenBottom = greenBar.y + greenBar.h;
  const touching = Math.abs(redBar.y - greenBottom) < 1.5;
  if (redBar.y >= greenBottom - 1.5 && redBar.h > 4 && touching) {
    ok(`bar: negativa sotto lo zero (rossa y=${redBar.y.toFixed(1)} h=${redBar.h.toFixed(1)}, verde finisce a ${greenBottom.toFixed(1)})`);
  } else {
    fail(`bar: geometria inattesa — rossa y=${redBar.y} h=${redBar.h}, verde y=${greenBar.y} h=${greenBar.h}`);
  }
}
const negLabels = dom.texts.filter((t) => t.s === "-40.0");
if (negLabels.length === 1) ok("bar: valore negativo etichettato (-40.0)");
else fail(`bar: etichette -40.0 trovate ${negLabels.length}`);

// F7.3 — pie: fetta "altro" in legenda + etichetta valore(percentuale)
const altro = dom.texts.find((t) => t.s === "resto");
if (altro) ok("pie: fetta di raggruppamento 'resto' presente");
else fail(`pie: nessuna voce 'resto' (etichette: ${JSON.stringify(dom.texts.map((t) => t.s).filter((s) => s && s.length < 12).slice(0, 16))})`);
const valPct = dom.texts.find((t) => /\(\d+%\)/.test(t.s ?? ""));
if (valPct) ok(`pie: etichetta valore+percentuale ("${valPct.s}")`);
else fail("pie: nessuna etichetta nel formato valore (percentuale)");
const whiteHole = dom.circles.find((c) => c.fill === "#ffffff");
if (whiteHole) ok("pie: foro del donut col colore scelto");
else fail(`pie: foro non bianco (cerchi: ${JSON.stringify(dom.circles.slice(0, 6))})`);

// F7.1 — tabella HTML con le colonne scelte, ordinabile, filtri e cella scrivibile
const tbl = dom.tables[0];
if (!tbl) fail("table: nessuna tabella HTML nel canvas");
else {
  const hdr = tbl.headers.join("|");
  if (hdr.includes("SEGNALI") && hdr.includes("U.M.")) ok(`table: colonne scelte (${hdr})`);
  else fail(`table: intestazioni ${hdr}`);
  if (tbl.inputs > 0) ok(`table: riga filtri presente (${tbl.inputs} input)`);
  else fail("table: nessun input di filtro");
}

// F7.5 — lo storico allarmi è un oggetto vero sul canvas (intestazione propria).
const histFo = dom.fo.find((f) => f.x === 880 && f.y === 300);
if (histFo && /STORICO ALLARMI/i.test(histFo.text)) ok("alarm_history: storico reso nel canvas");
else fail(`alarm_history: contenuto inatteso (${histFo ? JSON.stringify(histFo.text.slice(0, 120)) : "foreignObject assente"})`);

await browser.close();
console.log(bad === 0 ? "\nTUTTO OK" : `\n${bad} PROBLEMI`);
process.exit(bad === 0 ? 0 : 1);
