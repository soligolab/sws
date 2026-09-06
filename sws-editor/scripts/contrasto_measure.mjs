// Misura il contrasto di ogni testo dell'IDE contro il suo sfondo effettivo, in
// un tema o nell'altro. Vedi `scripts/check_contrasto.sh` per il perché.
import { chromium } from "@playwright/test";
const IDE = process.env.IDE, TEMA = process.env.TEMA ?? "light";
const b = await chromium.launch(process.env.SWS_E2E_CHROMIUM ? { executablePath: process.env.SWS_E2E_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const pg = await ctx.newPage();
await pg.addInitScript((t) => { try { localStorage.setItem("sws.theme", t); localStorage.setItem("sws.uiLang","it"); } catch {} }, TEMA);
await pg.goto(`${IDE}/index-admin.html`, { waitUntil: "domcontentloaded" });
await pg.waitForSelector('button:has-text("Menu"), button:has-text("☰")', { timeout: 30000 });
await pg.waitForTimeout(1500);

const scansiona = async (dove) => pg.evaluate((dove) => {
  const rgb = (s) => { const m = s.match(/\d+(\.\d+)?/g); return m ? m.slice(0,3).map(Number) : null; };
  const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const cr = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const sfondo = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const v = rgb(c);
      if (v && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
        const a = c.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
        if (!a || Number(a[1]) > 0.5) return v;
      }
    }
    return [255,255,255];
  };
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const testo = [...el.childNodes].filter(n => n.nodeType===3).map(n=>n.textContent.trim()).join(" ").trim();
    if (!testo || testo.length < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) < 0.2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // Dentro il canvas il colore di fondo non è un background CSS: è un <rect>
    // fratello (il foglio, T-52). Risalire gli antenati trova il tavolo e non
    // il foglio, quindi ogni testo del sinottico risulterebbe illeggibile
    // mentre a occhio è giusto. Il canvas si misura con l'occhio, non di qui.
    if (el.closest("svg")) continue;
    const fg = rgb(st.color); if (!fg) continue;
    const rap = cr(fg, sfondo(el));
    const grande = parseFloat(st.fontSize) >= 18 || (parseFloat(st.fontSize) >= 14 && Number(st.fontWeight) >= 700);
    if (rap < (grande ? 3 : 4.5)) out.push({ dove, testo: testo.slice(0,42), rap: Math.round(rap*100)/100,
      fg: st.color, bg: `rgb(${sfondo(el).join(",")})`, tag: el.tagName.toLowerCase() });
  }
  return out;
}, dove);

// **La banda d'avviso va provocata.** Non compare in un caricamento normale, e
// senza di lei la misura non guardava proprio il caso da cui è nata tutta questa
// storia: testo chiaro su fondo chiaro sulla banda «il progetto è cambiato».
// Si modifica il progetto da fuori — come farebbe un deploy — e si aspetta che
// il sorvegliante (3 s di intervallo) se ne accorga.
if (process.env.ADMIN) {
  await fetch(`${process.env.ADMIN}/api/project/tags`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    // Un id diverso a ogni giro: riscrivere lo **stesso** elenco non cambia
    // l'impronta del progetto, quindi il sorvegliante non si accorge di niente
    // e la banda non compare — è successo al secondo tema, che restava scoperto.
    body: JSON.stringify([{ id: `contrasto.sonda_${TEMA}_${Date.now()}`, data_type: "float" }]),
  }).catch(() => {});
  await pg.waitForTimeout(7000);
  const banda = await pg.getByText(/è cambiato|qualcun altro/).first()
    .isVisible().catch(() => false);
  console.log(`  banda d'avviso provocata: ${banda ? "sì" : "NO — la misura non la copre"}`);
}

let tutti = await scansiona("Editor");
const cfg = pg.getByRole("button", { name: /^Configurazione$/ }).first();
if (await cfg.isVisible().catch(() => false)) { await cfg.click(); await pg.waitForTimeout(2000); tutti = tutti.concat(await scansiona("Configurazione")); }
const visti = new Set(); const unici = tutti.filter(x => { const k = x.testo+x.fg+x.bg; if (visti.has(k)) return false; visti.add(k); return true; });
unici.sort((a,b) => a.rap - b.rap);
console.log(`  tema ${TEMA}: ${unici.length} testi sotto la soglia di contrasto`);
for (const x of unici.slice(0, 25)) console.log(`    ${String(x.rap).padStart(5)}  [${x.dove}] «${x.testo}»  ${x.fg} su ${x.bg}`);
if (unici.length > 25) console.log(`    … e altri ${unici.length - 25}`);
await b.close();
process.exitCode = unici.length === 0 ? 0 : 1;
