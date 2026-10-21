// Gli stili 2.5D del tubo e le sue estremità (15-10-2026, piano
// docs/archive/2026-10-15-tubazioni-bocche-e-stili.md, ramo B).
//
// Gemello di `sws-core/src/stili_tubo.rs`: i due devono produrre **la stessa
// stringa** SVG, e lo verificano sui casi di `tests/fixtures/stili-tubo.json`,
// che contiene anche la tabella degli stili. Il web la mette nella pagina, il
// pannello la rasterizza con resvg.

import type { Punto } from "./tubazioni";

export interface StileTubo {
  id: string;
  /** Il materiale del corpo; `null` = il colore del tubo (`stroke`), o `colore`. */
  materiale: string | null;
  colore: string;
  /** Frazione del diametro. */
  larghezza: number;
  /** `metal`, `paint`, `dark` o `""`. */
  velo: string;
  contorno: boolean;
  giunzione: "round" | "miter";
  /** Tratteggio sopra il corpo: [pieno, vuoto, colore, opacità]. */
  decoro: [number, number, string, number] | null;
  /** Tratteggio del corpo stesso (la linea di segnale). */
  tratteggio: [number, number] | null;
  /** L'estremità che `auto` mette su una bocca. */
  estremita: string;
}

export const STILI_TUBO: StileTubo[] = [
  { id: "metallo", materiale: "steel", colore: "#9aa5af", larghezza: 1.0, velo: "metal", contorno: true, giunzione: "round", decoro: null, tratteggio: null, estremita: "flange" },
  { id: "inox", materiale: "stainless", colore: "#b4bec7", larghezza: 1.0, velo: "metal", contorno: true, giunzione: "round", decoro: null, tratteggio: null, estremita: "welded" },
  { id: "coibentato", materiale: "stainless", colore: "#b4bec7", larghezza: 1.35, velo: "paint", contorno: true, giunzione: "round", decoro: [2.0, 36.0, "#000", 0.3], tratteggio: null, estremita: "flange" },
  { id: "pvc", materiale: null, colore: "#8e9ba6", larghezza: 1.0, velo: "paint", contorno: true, giunzione: "round", decoro: null, tratteggio: null, estremita: "union" },
  { id: "flessibile", materiale: "rubber", colore: "#2a2d31", larghezza: 0.9, velo: "dark", contorno: true, giunzione: "round", decoro: [1.6, 2.4, "#fff", 0.16], tratteggio: null, estremita: "quick" },
  { id: "canale", materiale: "stainless", colore: "#b4bec7", larghezza: 1.6, velo: "paint", contorno: true, giunzione: "miter", decoro: [2.0, 58.0, "#000", 0.25], tratteggio: null, estremita: "collar" },
  { id: "cavo", materiale: null, colore: "#2a2d31", larghezza: 0.55, velo: "dark", contorno: true, giunzione: "round", decoro: null, tratteggio: null, estremita: "gland" },
  { id: "segnale", materiale: null, colore: "#94a3b8", larghezza: 0.2, velo: "", contorno: false, giunzione: "round", decoro: null, tratteggio: [6.0, 4.0], estremita: "none" },
];

export function stileTubo(id: string | undefined): StileTubo | undefined {
  return STILI_TUBO.find((s) => s.id === id);
}

/** Le estremità che si possono scegliere, oltre a `auto` e a nessuna. */
export const ESTREMITA_TUBO = ["flange", "welded", "union", "quick", "reducer", "gland", "collar", "arrow", "dot"] as const;

export const MATERIALI_TUBO: Record<string, string> = {
  rubber: "#2a2d31", stainless: "#b4bec7", steel: "#9aa5af", "steel-dark": "#4a545d",
};

const VELI: Record<string, [number, string, number][]> = {
  metal: [[0, "#000", 0.42], [0.18, "#fff", 0.85], [0.45, "#fff", 0.25], [0.8, "#000", 0.19], [1, "#000", 0.49]],
  paint: [[0, "#000", 0.25], [0.2, "#fff", 0.5], [0.45, "#fff", 0.08], [0.75, "#000", 0.12], [1, "#000", 0.45]],
  dark: [[0, "#fff", 0.1], [0.2, "#fff", 0.37], [0.6, "#000", 0.17], [1, "#000", 0.48]],
};

/** Come `num` in Rust: arrotondato al centesimo, scritto come JavaScript. */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r);
}

export interface TuboSvg {
  id: string;
  punti: Punto[];
  stile: StileTubo;
  d: number;
  coloreStato?: string;
  stroke?: string;
  materiali: Record<string, string>;
  volume: number;
  contorno: [string, number];
  estremita: [string | undefined, string | undefined];
  bocche: [number | undefined, number | undefined];
}

function materiale(t: TuboSvg, nome: string): string {
  return t.materiali[nome] ?? MATERIALI_TUBO[nome] ?? "#9aa5af";
}

export function coloreCorpo(t: TuboSvg): string {
  if (t.coloreStato) return t.coloreStato;
  return t.stile.materiale ? materiale(t, t.stile.materiale) : (t.stroke ?? t.stile.colore);
}

export function larghezzaTubo(s: StileTubo, d: number): number {
  return Math.max(d * s.larghezza, 1.5);
}

export function estremitaEffettiva(s: StileTubo, richiesta: string | undefined, bocca: number | undefined, w: number): string {
  const r = richiesta ?? "auto";
  if ((ESTREMITA_TUBO as readonly string[]).includes(r)) return r;
  if (r !== "auto") return "none";
  if (bocca === undefined) return "none";
  if (s.giunzione === "round" && Math.abs(w - bocca) > 0.15 * Math.max(w, bocca)) return "reducer";
  return s.estremita;
}

const TRATTI_CURVA = 6;

/** Come `raccorda` in Rust: gli spigoli raccordati da una curva. */
export function raccorda(p: Punto[], r: number): Punto[] {
  if (p.length < 3 || r <= 0) return [...p];
  const out: Punto[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (l1 === 0 || l2 === 0) { out.push(b); continue; }
    const u1 = [(b.x - a.x) / l1, (b.y - a.y) / l1], u2 = [(c.x - b.x) / l2, (c.y - b.y) / l2];
    const coseno = Math.min(1, Math.max(-1, u1[0] * u2[0] + u1[1] * u2[1]));
    const angolo = Math.acos(coseno);
    if (angolo < 1e-6) { out.push(b); continue; }
    const arretra = Math.min(r * Math.tan(angolo / 2), l1 / 2, l2 / 2);
    const p1 = { x: b.x - u1[0] * arretra, y: b.y - u1[1] * arretra };
    const p2 = { x: b.x + u2[0] * arretra, y: b.y + u2[1] * arretra };
    const n = Math.max(2, Math.ceil((angolo / (Math.PI / 2)) * TRATTI_CURVA));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const m1 = (1 - t) * (1 - t), m2 = 2 * (1 - t) * t, m3 = t * t;
      out.push({ x: m1 * p1.x + m2 * b.x + m3 * p2.x, y: m1 * p1.y + m2 * b.y + m3 * p2.y });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

function polilinea(p: Punto[]): string {
  return p.map((q, i) => `${i === 0 ? "M" : " L"}${num(q.x)} ${num(q.y)}`).join("");
}

function gradiente(id: string, nome: string, volume: number, da: [number, number], a: [number, number]): string {
  let s = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(da[0])}" y1="${num(da[1])}" x2="${num(a[0])}" y2="${num(a[1])}">`;
  for (const [o, c, op] of VELI[nome] ?? []) s += `<stop offset="${num(o)}" stop-color="${c}" stop-opacity="${num(op * volume)}"/>`;
  return s + "</linearGradient>";
}

const normale = (ux: number, uy: number): [number, number] => [Math.abs(uy), Math.abs(ux)];

/** Il tubo come frammento SVG, in coordinate di pagina. */
export function svgTubo(t: TuboSvg): string {
  const p = t.punti;
  if (p.length < 2) return "";
  const s = t.stile;
  const w = larghezzaTubo(s, t.d);
  const corpo = coloreCorpo(t);
  // Con la freccia il corpo si ferma alla base del triangolo (vedi il gemello Rust).
  const base = [...p];
  for (const [k, i, j] of [[0, 0, 1], [1, p.length - 1, p.length - 2]] as const) {
    if (estremitaEffettiva(s, t.estremita[k], t.bocche[k], w) === "arrow") {
      const a = base[i], b = base[j];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const accorcia = Math.min(1.1 * Math.max(w, 6) - 1, l * 0.9);
      if (l > 0) base[i] = { x: a.x + (b.x - a.x) / l * accorcia, y: a.y + (b.y - a.y) / l * accorcia };
    }
  }
  const curva = s.giunzione === "round" ? raccorda(base, w) : base;
  const d = polilinea(curva);
  const join = s.giunzione === "miter" ? "miter" : "round";
  const cap = "butt";
  let defs = "";
  let g = "";
  if (s.contorno && t.contorno[1] > 0) {
    g += `<path d="${d}" fill="none" stroke="${t.contorno[0]}" stroke-width="${num(w + 2 * t.contorno[1])}" stroke-linejoin="${join}" stroke-linecap="${cap}"/>`;
  }
  const tratto = s.tratteggio ? ` stroke-dasharray="${num(s.tratteggio[0])} ${num(s.tratteggio[1])}"` : "";
  g += `<path d="${d}" fill="none" stroke="${corpo}" stroke-width="${num(w)}" stroke-linejoin="${join}" stroke-linecap="${cap}"${tratto}/>`;
  if (s.velo && t.volume > 0) {
    for (let i = 0; i + 1 < curva.length; i++) {
      const a = curva[i], b = curva[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l === 0) continue;
      const [nx, ny] = normale(dx / l, dy / l);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const gid = `${t.id}-v${i}`;
      defs += gradiente(gid, s.velo, t.volume, [mx - nx * w / 2, my - ny * w / 2], [mx + nx * w / 2, my + ny * w / 2]);
      g += `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="url(#${gid})" stroke-width="${num(w)}" stroke-linecap="butt"/>`;
    }
  }
  if (s.decoro) {
    const [a, b, c, op] = s.decoro;
    g += `<path d="${d}" fill="none" stroke="${c}" stroke-opacity="${num(op)}" stroke-width="${num(w)}" stroke-linejoin="${join}" stroke-linecap="butt" stroke-dasharray="${num(a)} ${num(b)}"/>`;
  }

  const n = p.length;
  const capi: [Punto, Punto][] = [[p[0], p[1]], [p[n - 1], p[n - 2]]];
  capi.forEach(([punto, prima], k) => {
    const e = estremitaEffettiva(s, t.estremita[k], t.bocche[k], w);
    const dx = punto.x - prima.x, dy = punto.y - prima.y;
    const l = Math.hypot(dx, dy);
    if (e === "none" || l === 0) return;
    const ux = dx / l, uy = dy / l;
    const nx = -uy, ny = ux;
    const at = (a: number, b: number): [number, number] => [punto.x + ux * a + nx * b, punto.y + uy * a + ny * b];
    const poligono = (pts: [number, number][]) => pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");
    const pezzo = (idx: number, a0: number, a1: number, b: number, mat: string) => {
      const colore = materiale(t, mat);
      const gid = `${t.id}-e${k}${idx}`;
      const [lx, ly] = normale(ux, uy);
      const [cx, cy] = at((a0 + a1) / 2, 0);
      defs += gradiente(gid, "metal", t.volume, [cx - lx * b, cy - ly * b], [cx + lx * b, cy + ly * b]);
      const pts = poligono([at(a0, -b), at(a1, -b), at(a1, b), at(a0, b)]);
      const bordo = t.contorno[1] > 0 ? ` stroke="${t.contorno[0]}" stroke-width="${num(t.contorno[1])}" stroke-linejoin="round"` : "";
      g += `<polygon points="${pts}" fill="${colore}"${bordo}/><polygon points="${pts}" fill="url(#${gid})"/>`;
    };
    switch (e) {
      case "flange": pezzo(0, -0.32 * w, 0, 0.82 * w, "steel"); break;
      case "welded": pezzo(0, -0.14 * w, 0, 0.56 * w, "steel-dark"); break;
      case "union": pezzo(0, -0.95 * w, -0.15 * w, 0.72 * w, "steel"); pezzo(1, -0.15 * w, 0, 0.6 * w, "steel"); break;
      case "quick": pezzo(0, -1.0 * w, -0.45 * w, 0.66 * w, "steel"); pezzo(1, -0.45 * w, 0, 0.52 * w, "stainless"); break;
      case "gland": pezzo(0, -0.8 * w, 0, 0.7 * w, "steel-dark"); break;
      case "collar": pezzo(0, -0.42 * w, 0, 0.6 * w, "stainless"); break;
      case "reducer": {
        const dp = t.bocche[k] ?? w;
        g += `<polygon points="${poligono([at(-w, -w / 2), at(0, -dp / 2), at(0, dp / 2), at(-w, w / 2)])}" fill="${corpo}"/>`;
        break;
      }
      // Freccia e pallino hanno una misura minima (vedi il gemello Rust).
      case "arrow": {
        const m = Math.max(w, 6);
        g += `<polygon points="${poligono([at(0, 0), at(-1.1 * m, -0.85 * m), at(-1.1 * m, 0.85 * m)])}" fill="${corpo}"/>`;
        break;
      }
      case "dot":
        g += `<circle cx="${num(punto.x)}" cy="${num(punto.y)}" r="${num(0.7 * Math.max(w, 6))}" fill="${corpo}"/>`;
        break;
    }
  });
  return `<g data-tubo="${s.id}">${defs ? `<defs>${defs}</defs>` : ""}${g}</g>`;
}

export function margineTubo(s: StileTubo, d: number): number {
  return larghezzaTubo(s, d) * 1.2 + 4;
}
