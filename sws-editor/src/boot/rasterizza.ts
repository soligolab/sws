// Dal disegno di una pagina di boot al PNG che il pannello mostrerà (T-72 F4).
//
// Il canvas dell'editor è un `<svg>`; il pannello vuole un PNG. Lo produce il
// **browser**, al salvataggio: né `resvg` (compilato senza il feature text, non
// disegna il testo) né l'istantanea LVGL (fotografa con un altro motore) possono
// fare da esportatore fedele, e su una pagina di boot ammessa solo agli oggetti
// vettoriali statici (`BOOT_TYPES`) il canvas web è esattamente ciò che si vuole.
//
// Un SVG caricato in un `<img>` non può chiedere risorse esterne e non eredita
// le variabili CSS dell'app. Quindi, prima di disegnarlo: ogni `<image href>` si
// incorpora come data URI e ogni `var(--brand-*)` si sostituisce con un valore
// concreto. Le due trasformazioni sono funzioni pure e provate; il resto (monta
// il canvas, disegna, `toBlob`) sta in `rasterizzaPagina` e si verifica a occhio
// confrontando l'anteprima col canvas.

import i18n from "i18next";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { getAuthToken, getBaseUrl } from "@/api/client";
import { LinguaContenutiProvider } from "@/i18n/linguaContenuti";
import { resolveMsg } from "@/i18n/projectI18n";
import { useAppStore } from "@/store";
import type { CustomSymbol, SynopticObject, SynopticPage } from "@/types";

/** Tetto del PNG: gemello di `MAX_BOOT_PNG_BYTES` in `sws-web/src/boot.rs`. */
export const MAX_PNG_BYTES = 5 * 1024 * 1024;

const RE_VAR = /var\(\s*(--brand-[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*?))?\s*\)/g;

/** Sostituisce ogni `var(--brand-*, fallback)` con un valore concreto: quello
 *  calcolato dall'app se c'è, altrimenti il `fallback` scritto accanto, altrimenti
 *  `transparent`. Le variabili che l'SVG definisce da sé (`--synoptic-text`) non
 *  si toccano: dentro un `<img>` funzionano. */
export function sostituisciVarBrand(svg: string, valoreDi: (nome: string) => string | undefined): string {
  return svg.replace(RE_VAR, (_m, nome: string, fallback: string | undefined) => {
    const v = valoreDi(nome)?.trim();
    if (v) return v;
    const f = fallback?.trim();
    return f ? f : "transparent";
  });
}

const RE_IMG_HREF = /(<image\b[^>]*?\s(?:xlink:)?href=)(["'])(.*?)\2/g;

/** Incorpora ogni `<image href="…">` come data URI. `leggi` restituisce il data
 *  URI di un href, o `null` se non si può (l'immagine resta com'è: nel PNG non
 *  comparirà, ma non si perde il resto). Quelli già `data:` si saltano. */
export async function incorporaImmagini(svg: string, leggi: (href: string) => Promise<string | null>): Promise<string> {
  const trovati = new Set<string>();
  for (const m of svg.matchAll(RE_IMG_HREF)) {
    const href = m[3].replace(/&amp;/g, "&");
    if (!href.startsWith("data:")) trovati.add(href);
  }
  const risolti = new Map<string, string>();
  await Promise.all([...trovati].map(async (href) => {
    try {
      const d = await leggi(href);
      if (d) risolti.set(href, d);
    } catch { /* si lascia l'href originale */ }
  }));
  return svg.replace(RE_IMG_HREF, (tutto, testa: string, q: string, href: string) => {
    const d = risolti.get(href.replace(/&amp;/g, "&"));
    return d ? `${testa}${q}${d}${q}` : tutto;
  });
}

/** Toglie dall'SVG ciò che **macchia il canvas** (`toBlob` risponde «Tainted canvases may
 *  not be exported»): un `<foreignObject>` (HTML dentro l'SVG) e un `<image>` che punta
 *  fuori dal documento. Non si possono disegnare comunque — quello che resta è un PNG
 *  senza quegli oggetti, e ogni cosa tolta è un avviso: meglio un PNG incompleto e
 *  detto che nessun PNG con un errore che non spiega niente. */
export function neutralizzaNonStatico(svg: string): { svg: string; avvisi: string[] } {
  const avvisi: string[] = [];
  let fuori = 0;
  let out = svg.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/g, () => { fuori += 1; return ""; });
  if (fuori > 0) avvisi.push(i18n.t("boot.warnForeignObject", { n: fuori }));
  let esterne = 0;
  out = out.replace(/<image\b[^>]*>(?:\s*<\/image>)?/g, (tag) => {
    const m = tag.match(/\s(?:xlink:)?href=(["'])(.*?)\1/);
    if (m && !m[2].startsWith("data:")) { esterne += 1; return ""; }
    return tag;
  });
  if (esterne > 0) avvisi.push(i18n.t("boot.warnExternalImage", { n: esterne }));
  return { svg: out, avvisi };
}

/** Le righe in cui un testo va a capo dentro `larghezza`, come farebbe il browser con
 *  `white-space: pre-wrap` e `word-break: break-word`: gli a-capo scritti a mano
 *  restano, le parole si mandano a capo, una parola più larga della riga si spezza. */
export function righeDiTesto(testo: string, larghezza: number, misura: (t: string) => number): string[] {
  const out: string[] = [];
  for (const paragrafo of testo.split("\n")) {
    if (paragrafo === "") { out.push(""); continue; }
    let riga = "";
    for (const parola of paragrafo.split(" ")) {
      const candidata = riga ? `${riga} ${parola}` : parola;
      if (misura(candidata) <= larghezza) { riga = candidata; continue; }
      if (riga) out.push(riga);
      if (misura(parola) <= larghezza) { riga = parola; continue; }
      let pezzo = "";
      for (const c of parola) {
        if (pezzo && misura(pezzo + c) > larghezza) { out.push(pezzo); pezzo = c; } else pezzo += c;
      }
      riga = pezzo;
    }
    out.push(riga);
  }
  return out;
}

/** Sostituisce ogni testo con `text_wrap` — che il canvas disegna in un `<foreignObject>`, e
 *  un `<foreignObject>` macchia il canvas del PNG — con un oggetto `text` per riga, già
 *  mandato a capo qui con lo stesso metro (`misura`) del browser. Lavora su una **copia** della
 *  pagina: quella salvata non cambia. Lo sfondo (`bg_color`) diventa un rettangolo dietro. */
export function spezzaTestiACapo(
  page: SynopticPage,
  misura: (font: string, testo: string) => number,
  risolvi: (testo: string) => string = (t) => t,
): SynopticPage {
  const objects: SynopticObject[] = [];
  for (const o of page.objects) {
    if (o.type !== "text" || !o.text_wrap) { objects.push(o); continue; }
    const size = o.font_size ?? 14;
    const font = `${o.font_style === "italic" ? "italic" : "normal"} ${o.font_weight ?? "normal"} ${size}px ${o.font_family ?? FONT_PREDEFINITO}`;
    const bw = o.width ?? 160;
    const bh = o.height ?? 60;
    const passo = (o.line_height ?? 1.25) * size;
    const righe = righeDiTesto(risolvi(o.text ?? "Testo"), bw, (t) => misura(font, t));
    const totale = righe.length * passo;
    const valign = o.text_valign ?? "top";
    const y0 = valign === "middle" ? o.y + (bh - totale) / 2 : valign === "bottom" ? o.y + bh - totale : o.y;
    const anchor = o.text_anchor ?? "start";
    const x = anchor === "middle" ? o.x + bw / 2 : anchor === "end" ? o.x + bw : o.x;
    if (o.bg_color) {
      objects.push({ id: `${o.id}_sfondo`, type: "rect", x: o.x, y: o.y, width: bw, height: bh, fill: o.bg_color });
    }
    righe.forEach((riga, i) => {
      objects.push({
        ...o, id: `${o.id}_r${i}`, text: riga, text_wrap: false, tag: undefined,
        x, y: y0 + i * passo + (passo - size) / 2 + size * 0.8,
        width: undefined, height: undefined, bg_color: undefined, bg_image: undefined,
      });
    });
  }
  return { ...page, objects };
}

/** Legge un'immagine di progetto (`/api/project/images/…`) come data URI, con le
 *  credenziali dell'IDE. Gli URL esterni non si scaricano: dall'SVG del PNG
 *  sarebbero comunque bloccati, e non è compito nostro portarli dentro. */
async function immagineComeDataUri(href: string): Promise<string | null> {
  if (!href.startsWith("/api/")) return null;
  const headers = new Headers();
  const tok = getAuthToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  const res = await fetch(`${getBaseUrl()}${href}`, { headers });
  if (!res.ok) return null;
  const blob = await res.blob();
  return await new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}

/** Il font del testo che non ne dichiara uno. È lo stesso stack del resto dell'IDE;
 *  il PNG usa comunque i font **della macchina che lo produce**. */
const FONT_PREDEFINITO = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

const attendi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Disegna la pagina in un contenitore staccato e ne restituisce il markup SVG,
 *  con larghezza e altezza fissate alle misure della pagina. */
async function svgDellaPagina(page: SynopticPage, customSymbols: CustomSymbol[]): Promise<string> {
  // La lingua dei contenuti è quella **predefinita del progetto**, non quella che chi salva sta
  // guardando: un'immagine di boot non deve cambiare a seconda di chi preme «Salva».
  const tabella = useAppStore.getState().project?.languages;
  const lingua = { lang: tabella?.default ?? "", table: tabella };
  const w = page.width ?? 1280;
  const h = page.height ?? 800;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${w}px;height:${h}px;overflow:hidden;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // Modalità viewer (nessun `onMove`), fissa 1:1, effetti spenti: è una foto ferma.
    flushSync(() => root.render(createElement(LinguaContenutiProvider, { value: lingua },
      createElement(SvgCanvas, {
        objects: page.objects,
        background: page.background,
        customSymbols,
        pageWidth: w,
        pageHeight: h,
        sizeMode: "fixed",
        pageId: page.id,
      }))));
    // Un giro perché gli effetti di montaggio (font, immagini) si assestino.
    await attendi(60);
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("il canvas non ha prodotto un <svg>");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    // Un SVG staccato dal documento non eredita il font dell'app: senza questo il
    // testo che non dichiara un font esce in serif.
    clone.setAttribute("font-family", FONT_PREDEFINITO);
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    return new XMLSerializer().serializeToString(clone);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Il PNG di una pagina di boot, alle sue misure, a 1 pixel per unità, e gli **avvisi** su ciò
 *  che nel PNG non c'è (oggetti che non si possono disegnare senza macchiare il canvas). */
export async function rasterizzaPagina(
  paginaOriginale: SynopticPage,
  customSymbols: CustomSymbol[] = [],
): Promise<{ png: Blob; avvisi: string[] }> {
  const w = paginaOriginale.width ?? 1280;
  const h = paginaOriginale.height ?? 800;
  const page = spezzaTestiACapo(
    paginaOriginale,
    (font, testo) => { const c = document.createElement("canvas").getContext("2d"); if (!c) return testo.length * 8; c.font = font; return c.measureText(testo).width; },
    (t) => { const tab = useAppStore.getState().project?.languages; return resolveMsg(t, tab?.default ?? "", tab); },
  );
  let svg = await svgDellaPagina(page, customSymbols);
  const stile = getComputedStyle(document.documentElement);
  svg = sostituisciVarBrand(svg, (n) => stile.getPropertyValue(n));
  svg = await incorporaImmagini(svg, immagineComeDataUri);
  const pulito = neutralizzaNonStatico(svg);
  svg = pulito.svg;

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    // Un tetto di tempo: un SVG che il browser non carica né rifiuta lascerebbe
    // «Salva» in sospeso per sempre.
    await new Promise<void>((ok, ko) => {
      const timer = setTimeout(() => ko(new Error("il browser non ha caricato l'SVG della pagina entro 15 secondi")), 15_000);
      img.onload = () => { clearTimeout(timer); ok(); };
      img.onerror = () => { clearTimeout(timer); ko(new Error("il browser non ha caricato l'SVG della pagina")); };
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D non disponibile");
    // Il foglio: lo sfondo della pagina, sotto l'SVG (un `background` sul
    // `<svg>` radice non è affidabile fra i browser).
    ctx.fillStyle = page.background || "#0f172a";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob>((ok, ko) =>
      canvas.toBlob((b) => (b ? ok(b) : ko(new Error("toBlob non ha prodotto il PNG"))), "image/png"));
    return { png, avvisi: pulito.avvisi };
  } finally {
    URL.revokeObjectURL(url);
  }
}
