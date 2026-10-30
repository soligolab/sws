// Il modello delle planimetrie (29-10-2026, ramo 1 del piano
// `docs/archive/2026-10-25-planimetrie-3d.md`).
//
// Una planimetria è una pianta in **metri**: muri a polilinea con spessore e
// altezza, aperture (porte e finestre) agganciate a un muro, aree a pavimento,
// blocchi (macchine, arredi). Il server la archivia senza interpretarla
// (`sws-web/src/planimetrie.rs`): la struttura vive qui. Dalla pianta l'IDE
// genera una volta l'immagine 3D che fa da sfondo a una pagina.
//
// La geometria qui sotto è **pura**: niente DOM, niente three.js. La usano
// l'editor 2D (dove sta un'apertura sul suo muro) e la resa 3D (dove il muro
// va spezzato per lasciare il vano).

export type Punto = [number, number];

export interface Muro {
  id: string;
  punti: Punto[];
  /** Metri. */
  spessore: number;
  altezza: number;
}

export type TipoApertura = "porta" | "finestra";

export interface Apertura {
  id: string;
  muro: string;
  /** Dove sta il centro, da 0 a 1 lungo la polilinea del muro. */
  t: number;
  larghezza: number;
  altezza: number;
  tipo: TipoApertura;
  /** Solo finestre: l'altezza del davanzale. */
  da_terra?: number;
}

export interface Area {
  id: string;
  punti: Punto[];
  colore: string;
  etichetta?: string;
}

export interface Blocco {
  id: string;
  /** Il centro, in metri. */
  x: number;
  y: number;
  larghezza: number;
  profondita: number;
  altezza: number;
  /** Gradi, in senso orario visto dall'alto. */
  rotazione: number;
  colore: string;
  etichetta?: string;
}

export interface Camera {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface Planimetria {
  id: string;
  nome: string;
  /** La scala della pianta nell'editor: pixel per metro. */
  unita_px_m: number;
  muri: Muro[];
  aperture: Apertura[];
  aree: Area[];
  blocchi: Blocco[];
  /** L'ultima inquadratura della vista 3D. */
  camera?: Camera;
  sfondo?: string;
}

/** Le misure di partenza di ciò che si disegna (metri). */
export const PREDEFINITI = {
  spessoreMuro: 0.2,
  altezzaMuro: 2.7,
  porta: { larghezza: 0.9, altezza: 2.1 },
  finestra: { larghezza: 1.2, altezza: 1.2, da_terra: 0.9 },
  blocco: { larghezza: 1.2, profondita: 0.8, altezza: 1.5, colore: "#64748b" },
  area: { colore: "#1e3a5f" },
} as const;

export function nuovaPlanimetria(id: string, nome: string): Planimetria {
  return { id, nome, unita_px_m: 50, muri: [], aperture: [], aree: [], blocchi: [], sfondo: "#0f172a" };
}

/** Un id breve e leggibile, unico fra quelli già usati: `m1`, `m2`… */
export function idNuovo(prefisso: string, usati: Iterable<string>): string {
  const presi = new Set(usati);
  let n = 1;
  while (presi.has(`${prefisso}${n}`)) n++;
  return `${prefisso}${n}`;
}

export function tuttiGliId(p: Planimetria): string[] {
  return [...p.muri, ...p.aperture, ...p.aree, ...p.blocchi].map((x) => x.id);
}

const dist = (a: Punto, b: Punto) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function lunghezza(punti: readonly Punto[]): number {
  let l = 0;
  for (let i = 1; i < punti.length; i++) l += dist(punti[i - 1], punti[i]);
  return l;
}

/** Il punto a frazione `t` della polilinea, e la direzione del tratto in cui
 *  cade (radianti). Fuori da 0..1 si ferma agli estremi. */
export function puntoA(punti: readonly Punto[], t: number): { x: number; y: number; angolo: number } {
  if (punti.length === 0) return { x: 0, y: 0, angolo: 0 };
  if (punti.length === 1) return { x: punti[0][0], y: punti[0][1], angolo: 0 };
  const totale = lunghezza(punti);
  let resto = Math.min(Math.max(t, 0), 1) * totale;
  for (let i = 1; i < punti.length; i++) {
    const [a, b] = [punti[i - 1], punti[i]];
    const l = dist(a, b);
    const angolo = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (resto <= l || i === punti.length - 1) {
      const f = l === 0 ? 0 : Math.min(resto / l, 1);
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, angolo };
    }
    resto -= l;
  }
  return { x: punti[0][0], y: punti[0][1], angolo: 0 };
}

/** La frazione `t` del punto della polilinea più vicino a `p`, e quanto dista:
 *  serve a decidere su quale muro si è cliccato per mettere una porta. */
export function proiezione(punti: readonly Punto[], p: Punto): { t: number; distanza: number } {
  const totale = lunghezza(punti);
  if (punti.length < 2 || totale === 0) return { t: 0, distanza: punti.length ? dist(punti[0], p) : Infinity };
  let migliore = { t: 0, distanza: Infinity };
  let percorso = 0;
  for (let i = 1; i < punti.length; i++) {
    const [a, b] = [punti[i - 1], punti[i]];
    const l = dist(a, b);
    const f = l === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l)));
    const q: Punto = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const d = dist(q, p);
    if (d < migliore.distanza) migliore = { t: (percorso + f * l) / totale, distanza: d };
    percorso += l;
  }
  return migliore;
}

/** Un tratto di muro, in metri lungo la polilinea: pieno da terra al soffitto,
 *  o il pezzo che resta sopra e sotto un'apertura. */
export interface Tratto {
  da: number;
  a: number;
  /** Dove il muro c'è, in altezza: `[0, altezza]` per un tratto pieno. Una
   *  porta lascia l'architrave; una finestra il davanzale e l'architrave. */
  pieni: [number, number][];
}

/** **Il muro spezzato alle aperture** — senza CSG: per ogni apertura il vano
 *  è un tratto con i soli pezzi pieni sopra (e sotto, per una finestra).
 *  Due aperture che si sovrappongono si fondono nel vano più largo; un'apertura
 *  che sborda dal muro viene tagliata ai suoi capi. */
export function trattiDelMuro(muro: Muro, aperture: readonly Apertura[]): Tratto[] {
  const L = lunghezza(muro.punti);
  if (L === 0) return [];
  const h = muro.altezza;
  const vani = aperture
    .filter((ap) => ap.muro === muro.id)
    .map((ap) => {
      const centro = Math.min(Math.max(ap.t, 0), 1) * L;
      const da = Math.max(0, centro - ap.larghezza / 2);
      const a = Math.min(L, centro + ap.larghezza / 2);
      const basso = ap.tipo === "finestra" ? Math.max(0, ap.da_terra ?? PREDEFINITI.finestra.da_terra) : 0;
      const alto = Math.min(h, basso + ap.altezza);
      return { da, a, basso, alto };
    })
    .filter((v) => v.a > v.da)
    .sort((x, y) => x.da - y.da);
  // Le sovrapposizioni si fondono: il vano che ne esce è il più largo, e in
  // altezza tiene il più basso dei bassi e il più alto degli alti.
  const fusi: typeof vani = [];
  for (const v of vani) {
    const ultimo = fusi[fusi.length - 1];
    if (ultimo && v.da < ultimo.a) {
      ultimo.a = Math.max(ultimo.a, v.a);
      ultimo.basso = Math.min(ultimo.basso, v.basso);
      ultimo.alto = Math.max(ultimo.alto, v.alto);
    } else fusi.push({ ...v });
  }
  const tratti: Tratto[] = [];
  let cursore = 0;
  for (const v of fusi) {
    if (v.da > cursore) tratti.push({ da: cursore, a: v.da, pieni: [[0, h]] });
    const pieni: [number, number][] = [];
    if (v.basso > 0) pieni.push([0, v.basso]);
    if (v.alto < h) pieni.push([v.alto, h]);
    tratti.push({ da: v.da, a: v.a, pieni });
    cursore = v.a;
  }
  if (cursore < L) tratti.push({ da: cursore, a: L, pieni: [[0, h]] });
  return tratti;
}

/** Arrotonda al passo della griglia (metri). */
export function aggancia(v: number, passo: number): number {
  return passo > 0 ? Math.round(v / passo) * passo : v;
}

/** I quattro spigoli di un blocco, ruotato, visto dall'alto. */
export function spigoliBlocco(b: Blocco): Punto[] {
  const r = (b.rotazione * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const [w, d] = [b.larghezza / 2, b.profondita / 2];
  return ([[-w, -d], [w, -d], [w, d], [-w, d]] as Punto[]).map(([x, y]) => [b.x + x * c - y * s, b.y + x * s + y * c]);
}

/** Il baricentro di un poligono (per l'etichetta di un'area). */
export function centroDi(punti: readonly Punto[]): Punto {
  if (punti.length === 0) return [0, 0];
  const [sx, sy] = punti.reduce(([x, y], p) => [x + p[0], y + p[1]], [0, 0]);
  return [sx / punti.length, sy / punti.length];
}

/** Il riquadro che contiene tutto, in metri, con un margine: l'editor ci si
 *  centra all'apertura. Una pianta vuota è 10×8 m. */
export function ingombro(p: Planimetria, margine = 1): { x: number; y: number; w: number; h: number } {
  const tutti: Punto[] = [
    ...p.muri.flatMap((m) => m.punti),
    ...p.aree.flatMap((a) => a.punti),
    ...p.blocchi.flatMap(spigoliBlocco),
  ];
  if (tutti.length === 0) return { x: -margine, y: -margine, w: 10 + 2 * margine, h: 8 + 2 * margine };
  const xs = tutti.map((q) => q[0]);
  const ys = tutti.map((q) => q[1]);
  const [x0, y0] = [Math.min(...xs) - margine, Math.min(...ys) - margine];
  return { x: x0, y: y0, w: Math.max(...xs) + margine - x0, h: Math.max(...ys) + margine - y0 };
}

/** Le aperture di un muro che non c'è più si tolgono con lui. */
export function senzaOrfani(p: Planimetria): Planimetria {
  const muri = new Set(p.muri.map((m) => m.id));
  return { ...p, aperture: p.aperture.filter((a) => muri.has(a.muro)) };
}

/** Quello che arriva dal server, con i campi mancanti riempiti: un file scritto
 *  a mano, o da una versione futura, non deve far cadere l'editor. */
export function normalizza(v: Partial<Planimetria> & { id: string }): Planimetria {
  return {
    ...nuovaPlanimetria(v.id, v.nome ?? v.id),
    ...v,
    muri: v.muri ?? [],
    aperture: v.aperture ?? [],
    aree: v.aree ?? [],
    blocchi: v.blocchi ?? [],
  };
}
