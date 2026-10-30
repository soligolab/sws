/** La geometria dello slider, senza DOM (revisione dello slider, fase 2,
 *  30-10-2026 — `docs/plans/2026-10-30-revisione-slider.md`).
 *
 *  **Gemella di `geometria_slider` in `sws-lvgl-viewer/src/lvgl_render.rs`**: i
 *  due motori impilano gli stessi pezzi con gli stessi numeri, così uno slider
 *  sta nello stesso punto sul web e sul pannello. Chi cambia un numero qui lo
 *  cambia anche là.
 *
 *  Tutte le coordinate sono relative all'angolo del riquadro dichiarato. */

export type PosizioneValore = "sotto" | "sopra" | "dentro" | "cursore";
export type StileSlider = "classico" | "pillola" | "piastra" | "isa";

/** Come è fatto uno stile (fase 3, 30-10-2026). Gemella di `aspetto_stile` in
 *  `lvgl_render.rs`: i `pad` sono quelli della parte `KNOB` di LVGL, cioè di
 *  quanto il cursore sborda dalla traccia lungo l'asse e di traverso (negativi =
 *  rientra). */
export interface AspettoStile {
  /** Spessore predefinito della traccia; 0 = tutto il riquadro (piastra). */
  spessore: number;
  cursore: "tondo" | "dentro" | "rettangolo" | "nessuno";
  padAsse: number;
  padTraverso: number;
  /** Raggio della traccia: `null` = pieno (metà dello spessore). */
  raggioTraccia: number | null;
  posizione: PosizioneValore;
}

export function aspettoStile(stile: StileSlider | undefined): AspettoStile {
  switch (stile) {
    case "pillola": return { spessore: 28, cursore: "dentro", padAsse: -3, padTraverso: -3, raggioTraccia: null, posizione: "sotto" };
    case "piastra": return { spessore: 0, cursore: "nessuno", padAsse: 0, padTraverso: 0, raggioTraccia: 12, posizione: "dentro" };
    case "isa": return { spessore: 6, cursore: "rettangolo", padAsse: 2, padTraverso: 7, raggioTraccia: 1, posizione: "sotto" };
    default: return { spessore: 16, cursore: "tondo", padAsse: 5, padTraverso: 5, raggioTraccia: null, posizione: "sotto" };
  }
}

/** I colori fissi dello stile ISA-101: niente colori accesi (decisione 4). */
export const COLORI_ISA = { traccia: "#64748b", indicatore: "#94a3b8", cursore: "#cbd5e1", bordo: "#334155" };
/** Il cursore bianco della pillola, dentro la traccia. */
export const CURSORE_PILLOLA = "#ffffff";
/** Il margine interno della piastra. */
const MARGINE_PIASTRA = 12;

/** Lo spessore della traccia dello stile classico: quello del pannello LVGL di
 *  sempre, ora anche sul web (decisione 3 del piano). */
export const SPESSORE_CLASSICO = 16;
/** Di quanto il cursore tondo sborda dalla traccia, per lato: il `pad` della
 *  parte `KNOB` su LVGL. */
export const SBORDO_CURSORE = 5;
/** Lo spazio fra una riga e l'altra della colonna. */
const SPAZIO = 2;

export interface Rett { x: number; y: number; w: number; h: number }

export interface GeometriaSlider {
  verticale: boolean;
  traccia: Rett;
  raggioTraccia: number;
  /** Il cursore tondo (classico e pillola), il raggio. */
  raggioCursore: number;
  /** Il cursore come rettangolo: larghezza e altezza (0×0 = nessuno). */
  cursore: { w: number; h: number };
  /** L'icona della piastra, se c'è. */
  icona: { cx: number; cy: number; lato: number } | null;
  /** Come si allineano i testi: al centro, o a sinistra (piastra orizzontale). */
  allinea: "middle" | "start";
  /** Dove comincia la zona di bande e tacche: la `y` sotto la traccia
   *  nell'orizzontale, la `x` a destra nel verticale. */
  inizioTacche: number;
  /** Il centro della riga dell'etichetta, se c'è. */
  etichetta: { cx: number; cy: number } | null;
  /** Il centro della riga del valore: sotto, sopra o dentro la traccia. Per
   *  `cursore` è `null`: il fumetto segue il cursore (`fumettoCursore`). */
  valore: { cx: number; cy: number } | null;
}

export interface IngressoGeometria {
  verticale: boolean;
  w: number;
  h: number;
  /** Altezza della riga dell'etichetta (0 senza etichetta). */
  altoEtichetta: number;
  /** Altezza della riga del valore (0 senza valore). */
  altoValore: number;
  spessore?: number;
  posizione?: PosizioneValore;
  stile?: StileSlider;
  conIcona?: boolean;
  /** Fase 4: lo spessore della zona di bande e tacche sotto la traccia
   *  (`altezzaZonaTacche`). Nel verticale sta a destra e non sposta niente. */
  altoTacche?: number;
}

/** Il cursore di uno stile, per una traccia spessa `t`. */
function cursoreDi(a: AspettoStile, t: number, verticale: boolean) {
  if (a.cursore === "nessuno") return { raggio: 0, w: 0, h: 0 };
  const lungoAsse = t + 2 * a.padAsse;
  const traverso = t + 2 * a.padTraverso;
  return {
    raggio: (t + 2 * a.padTraverso) / 2,
    w: verticale ? traverso : lungoAsse,
    h: verticale ? lungoAsse : traverso,
  };
}

export function geometriaSlider(i: IngressoGeometria): GeometriaSlider {
  const a = aspettoStile(i.stile);
  if (i.stile === "piastra") return geometriaPiastra(i, a);
  const posizione = i.posizione ?? a.posizione;
  const spessorePredefinito = a.spessore;
  // Il valore occupa una riga sua solo sotto o sopra la traccia.
  const rigaValore = posizione === "sotto" || posizione === "sopra" ? i.altoValore : 0;
  if (i.verticale) {
    const t = Math.min(i.spessore ?? spessorePredefinito, i.w);
    const k = cursoreDi(a, t, true);
    const sopra = posizione === "sopra" ? rigaValore : 0;
    const sotto = posizione === "sotto" ? rigaValore : 0;
    const lunghezza = Math.max(24, i.h - i.altoEtichetta - rigaValore - 8);
    const traccia = { x: (i.w - t) / 2, y: i.altoEtichetta + sopra + 4, w: t, h: lunghezza };
    return {
      verticale: true,
      traccia,
      raggioTraccia: a.raggioTraccia ?? t / 2,
      raggioCursore: k.raggio,
      cursore: { w: k.w, h: k.h },
      icona: null,
      allinea: "middle",
      inizioTacche: traccia.x + traccia.w + 1,
      etichetta: i.altoEtichetta > 0 ? { cx: i.w / 2, cy: i.altoEtichetta / 2 } : null,
      valore:
        posizione === "cursore" || i.altoValore === 0 ? null
        : posizione === "dentro" ? { cx: i.w / 2, cy: traccia.y + traccia.h / 2 }
        : posizione === "sopra" ? { cx: i.w / 2, cy: i.altoEtichetta + sopra / 2 }
        : { cx: i.w / 2, cy: i.h - sotto / 2 },
    };
  }
  // Orizzontale: la colonna del web di prima — etichetta, (valore), traccia,
  // (valore) — centrata nell'altezza, anche quando sborda.
  const t = Math.min(i.spessore ?? spessorePredefinito, i.h);
  const k = cursoreDi(a, t, false);
  const righe: [string, number][] = [];
  if (i.altoEtichetta > 0) righe.push(["etichetta", i.altoEtichetta]);
  if (posizione === "sopra" && rigaValore > 0) righe.push(["valore", rigaValore]);
  righe.push(["traccia", t]);
  if ((i.altoTacche ?? 0) > 0) righe.push(["tacche", i.altoTacche!]);
  if (posizione === "sotto" && rigaValore > 0) righe.push(["valore", rigaValore]);
  const blocco = righe.reduce((s, [, a]) => s + a, 0) + SPAZIO * (righe.length - 1);
  let y = (i.h - blocco) / 2;
  const centri: Record<string, number> = {};
  for (const [nome, alto] of righe) {
    centri[nome] = y + alto / 2;
    y += alto + SPAZIO;
  }
  const yTraccia = Math.max(0, Math.min(i.h - t, centri.traccia - t / 2));
  const traccia = { x: 0, y: yTraccia, w: i.w, h: t };
  return {
    verticale: false,
    traccia,
    raggioTraccia: a.raggioTraccia ?? t / 2,
    raggioCursore: k.raggio,
    cursore: { w: k.w, h: k.h },
    icona: null,
    allinea: "middle",
    inizioTacche: yTraccia + t + 1,
    etichetta: centri.etichetta !== undefined ? { cx: i.w / 2, cy: centri.etichetta } : null,
    valore:
      posizione === "cursore" || i.altoValore === 0 ? null
      : posizione === "dentro" ? { cx: i.w / 2, cy: yTraccia + t / 2 }
      : centri.valore !== undefined ? { cx: i.w / 2, cy: centri.valore } : null,
  };
}

/** La piastra: la traccia è tutto il riquadro, niente cursore, e dentro
 *  icona, etichetta e valore. Orizzontale: l'icona a sinistra, i due testi in
 *  colonna accanto, allineati a sinistra. Verticale (una tapparella): l'icona in
 *  alto, l'etichetta sotto, il valore in fondo, tutti centrati. */
function geometriaPiastra(i: IngressoGeometria, a: AspettoStile): GeometriaSlider {
  const m = MARGINE_PIASTRA;
  const traccia = { x: 0, y: 0, w: i.w, h: i.h };
  const comune = {
    traccia, raggioTraccia: Math.min(a.raggioTraccia ?? 12, i.w / 2, i.h / 2), raggioCursore: 0, cursore: { w: 0, h: 0 },
    inizioTacche: 0,
  };
  const conValore = i.altoValore > 0 && i.posizione !== "cursore";
  if (i.verticale) {
    const lato = i.conIcona ? Math.min(28, i.w - 2 * m) : 0;
    return {
      ...comune,
      verticale: true,
      icona: lato > 0 ? { cx: i.w / 2, cy: m + lato / 2, lato } : null,
      allinea: "middle",
      etichetta: centro(i.altoEtichetta > 0, i.w / 2, m + lato + (lato > 0 ? 8 : 0) + i.altoEtichetta / 2),
      valore: centro(conValore, i.w / 2, i.h - m - i.altoValore / 2),
    };
  }
  const lato = i.conIcona ? Math.min(28, i.h - 16) : 0;
  const xTesto = m + (lato > 0 ? lato + 10 : 0);
  const righe = i.altoEtichetta + (conValore ? i.altoValore : 0);
  const cima = (i.h - righe) / 2;
  return {
    ...comune,
    verticale: false,
    icona: lato > 0 ? { cx: m + lato / 2, cy: i.h / 2, lato } : null,
    allinea: "start",
    etichetta: centro(i.altoEtichetta > 0, xTesto, cima + i.altoEtichetta / 2),
    valore: centro(conValore, xTesto, cima + i.altoEtichetta + i.altoValore / 2),
  };
}

/** Un centro, o nessuno se il pezzo non c'è. */
function centro(c: boolean, cx: number, cy: number): { cx: number; cy: number } | null {
  return c ? { cx, cy } : null;
}

const limita = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0);

/** Dove sta un valore sulla traccia, da 0 (minimo) a 1 (massimo). */
export function frazioneDaValore(v: number, min: number, max: number): number {
  return max > min ? limita((v - min) / (max - min)) : 0;
}

/** Il centro del cursore per una frazione. */
export function centroCursore(g: GeometriaSlider, f: number): { cx: number; cy: number } {
  const t = g.traccia;
  return g.verticale
    ? { cx: t.x + t.w / 2, cy: t.y + t.h * (1 - f) }
    : { cx: t.x + t.w * f, cy: t.y + t.h / 2 };
}

/** Dove va il fumetto del valore con `posizione: "cursore"`: sopra il cursore
 *  nell'orizzontale, alla sua destra nel verticale. */
export function fumettoCursore(g: GeometriaSlider, f: number, altoValore: number): { cx: number; cy: number } {
  const c = centroCursore(g, f);
  return g.verticale
    ? { cx: c.cx + g.raggioCursore + 4 + altoValore, cy: c.cy }
    : { cx: c.cx, cy: c.cy - g.raggioCursore - 4 - altoValore / 2 };
}

/** La frazione sotto un punto (relativo al riquadro). */
export function frazioneDaPunto(g: GeometriaSlider, px: number, py: number): number {
  const t = g.traccia;
  return g.verticale ? limita(1 - (py - t.y) / t.h) : limita((px - t.x) / t.w);
}

const passoValido = (step: number | undefined) => (step !== undefined && Number.isFinite(step) && step > 0 ? step : 1);
const pulito = (v: number) => Math.round(v * 1e9) / 1e9;

/** Il valore sul passo più vicino, dentro l'intervallo. Come LVGL
 *  (`passi_slider`): l'ultimo passo è per difetto, 0..10 col passo 4 si ferma a 8. */
export function agganciaAlPasso(v: number, min: number, max: number, step?: number): number {
  const s = passoValido(step);
  const passi = Math.max(1, Math.floor((max - min) / s + 1e-9));
  const i = Math.min(passi, Math.max(0, Math.round((v - min) / s)));
  return pulito(min + i * s);
}

export function valoreDaFrazione(f: number, min: number, max: number, step?: number): number {
  return agganciaAlPasso(min + limita(f) * (max - min), min, max, step);
}

/** Il valore dopo un tasto, o `null` se il tasto non è dello slider. Frecce un
 *  passo, PagSu/PagGiù un decimo dell'intervallo (almeno un passo), Home/Fine
 *  gli estremi. */
export function valoreDaTasto(tasto: string, v: number, min: number, max: number, step?: number): number | null {
  const s = passoValido(step);
  const grande = Math.max(s, (max - min) / 10);
  const nuovo =
    tasto === "ArrowRight" || tasto === "ArrowUp" ? v + s
    : tasto === "ArrowLeft" || tasto === "ArrowDown" ? v - s
    : tasto === "PageUp" ? v + grande
    : tasto === "PageDown" ? v - grande
    : tasto === "Home" ? min
    : tasto === "End" ? max
    : null;
  return nuovo === null ? null : agganciaAlPasso(nuovo, min, max, step);
}

// ── Fase 4: tacche e bande ───────────────────────────────────────────────────

/** Una tacca: dove sta (frazione), se è marcata, e il suo numero. */
export interface Tacca { f: number; maggiore: boolean; testo?: string }

/** Le lunghezze delle tacche e della striscia delle bande, in px. */
export const TACCA_MAGGIORE = 6;
export const TACCA_MINORE = 3;
export const STRISCIA_BANDE = 4;
/** Oltre tante tacche non si disegna: un passo sbagliato non deve fermare la pagina. */
const MASSIMO_TACCHE = 200;

/** Lo spessore della zona sotto la traccia: la striscia delle bande, le tacche e
 *  la riga dei numeri. Zero se non c'è niente. */
export function altezzaZonaTacche(conTacche: boolean, conNumeri: boolean, conBande: boolean, corpoNumeri: number): number {
  let h = 0;
  if (conBande) h += STRISCIA_BANDE + 1;
  if (conTacche) h += TACCA_MAGGIORE + 1;
  if (conTacche && conNumeri) h += Math.ceil(corpoNumeri * 1.3);
  return h;
}

/** I decimali con cui scrivere i numeri di un passo: 0,5 → 1, 0,25 → 2. */
export function decimaliDelPasso(passo: number): number {
  for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(passo * 10 ** d) - passo * 10 ** d) < 1e-9) return d;
  return 6;
}

/** Le tacche sui multipli dei due passi, dentro l'intervallo. Una tacca che è
 *  di tutti e due è marcata. */
export function tacche(min: number, max: number, maggiore?: number, minore?: number, conNumeri = true): Tacca[] {
  if (!(max > min)) return [];
  const valido = (p?: number) => (p !== undefined && Number.isFinite(p) && p > 0 && (max - min) / p <= MASSIMO_TACCHE ? p : undefined);
  const M = valido(maggiore);
  const m = valido(minore);
  const mappa = new Map<string, Tacca>();
  const aggiungi = (p: number, marcata: boolean) => {
    for (let k = Math.ceil(min / p - 1e-9); k * p <= max + 1e-9; k++) {
      const v = Math.round(k * p * 1e9) / 1e9;
      const chiave = v.toFixed(9);
      const prima = mappa.get(chiave);
      if (prima?.maggiore) continue;
      mappa.set(chiave, {
        f: (v - min) / (max - min),
        maggiore: marcata,
        testo: marcata && conNumeri ? v.toFixed(decimaliDelPasso(p)) : undefined,
      });
    }
  };
  if (m) aggiungi(m, false);
  if (M) aggiungi(M, true);
  return [...mappa.values()].sort((a, b) => a.f - b.f);
}

export interface Limiti { alarmLow?: number; warnLow?: number; warnHigh?: number; alarmHigh?: number }
export interface Banda { da: number; a: number; tipo: "allarme" | "avviso" }

/** I colori delle bande: quelli delle soglie della barra (`thresholdColor`). */
export const COLORI_BANDE = { allarme: "#ef4444", avviso: "#eab308" } as const;

/** Le bande dai quattro limiti, come frazioni della traccia. */
export function bande(min: number, max: number, l: Limiti): Banda[] {
  if (!(max > min)) return [];
  const f = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const out: Banda[] = [];
  const basso = l.alarmLow !== undefined ? f(l.alarmLow) : undefined;
  const alto = l.alarmHigh !== undefined ? f(l.alarmHigh) : undefined;
  if (basso !== undefined && basso > 0) out.push({ da: 0, a: basso, tipo: "allarme" });
  if (l.warnLow !== undefined) out.push({ da: basso ?? 0, a: f(l.warnLow), tipo: "avviso" });
  if (l.warnHigh !== undefined) out.push({ da: f(l.warnHigh), a: alto ?? 1, tipo: "avviso" });
  if (alto !== undefined && alto < 1) out.push({ da: alto, a: 1, tipo: "allarme" });
  return out.filter((b) => b.a > b.da);
}

/** Il valore sta in una banda: per `slider_bands: in_allarme`. */
export function fuoriDaiLimiti(v: number, l: Limiti): boolean {
  return (l.alarmHigh !== undefined && v >= l.alarmHigh) || (l.alarmLow !== undefined && v <= l.alarmLow)
    || (l.warnHigh !== undefined && v >= l.warnHigh) || (l.warnLow !== undefined && v <= l.warnLow);
}

/** Il passo con cui si muove il cursore: quello delle tacche, se ci si aggancia. */
export function passoEffettivo(step: number | undefined, aggancia: boolean, maggiore?: number, minore?: number): number | undefined {
  if (!aggancia) return step;
  return minore && minore > 0 ? minore : maggiore && maggiore > 0 ? maggiore : step;
}

// ── Fase 5: il segno del valore misurato ─────────────────────────────────────

/** Il triangolino del PV: sopra la traccia e con la punta in giù
 *  nell'orizzontale, a sinistra con la punta a destra nel verticale. Come la
 *  lancetta SP del gauge, al contrario. Gemello di `punti_pv` in `lvgl_render.rs`. */
export function puntiPv(verticale: boolean, t: Rett, f: number): [number, number][] {
  if (verticale) {
    const y = t.y + t.h * (1 - f);
    return [[t.x - 9, y - 5], [t.x - 9, y + 5], [t.x - 2, y]];
  }
  const x = t.x + t.w * f;
  return [[x - 5, t.y - 9], [x + 5, t.y - 9], [x, t.y - 2]];
}
