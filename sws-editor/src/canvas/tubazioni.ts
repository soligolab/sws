// Le tubazioni: dove si aggancia un capo, e che strada fa (15-10-2026, piano
// docs/archive/2026-10-15-tubazioni-bocche-e-stili.md, ramo A).
//
// Gemello di `sws-core/src/tubazioni.rs`; i casi condivisi sono in
// `tests/fixtures/tubazioni.json`. Prima un capo agganciato andava al centro di
// un lato del riquadro, senza rotazione né specchiatura, e `orthogonal` e
// `diagonal` si disegnavano come una spezzata dritta fra i punti dell'utente.

import type { PortaLib } from "@/symbols/lib/manifest";
import type { PipePoint, SynopticObject } from "@/types";
import { trovaSimboloLib } from "@/symbols/lib/libreria";

export interface Punto { x: number; y: number }

/** Il riquadro con le trasformazioni di `applyTransform`: prima la specchiatura
 *  attorno al centro, poi la rotazione (gradi, orari sullo schermo). */
export interface Riquadro {
  x: number; y: number; w: number; h: number;
  rotation?: number; flip_h?: boolean; flip_v?: boolean;
}

/** Dove sta un capo, e verso dove esce il tubo (`0, 0` per il centro). */
export interface Aggancio { x: number; y: number; dx: number; dy: number }

const DIREZIONE: Record<string, [number, number]> = {
  left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1],
};

/** Come `tondo` in Rust: le cifre oltre il centesimo sono rumore della trigonometria. */
function tondo(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

function trasforma(r: Riquadro, x0: number, y0: number, dx0: number, dy0: number): Aggancio {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let x = x0, y = y0, dx = dx0, dy = dy0;
  if (r.flip_h) { x = 2 * cx - x; dx = -dx; }
  if (r.flip_v) { y = 2 * cy - y; dy = -dy; }
  const a = ((r.rotation ?? 0) * Math.PI) / 180;
  const s = Math.sin(a), c = Math.cos(a);
  const rx = x - cx, ry = y - cy;
  return { x: tondo(cx + rx * c - ry * s), y: tondo(cy + rx * s + ry * c), dx: tondo(dx * c - dy * s), dy: tondo(dx * s + dy * c) };
}

/** Una bocca del simbolo sulla pagina (`preserveAspectRatio="xMidYMid meet"`). */
export function aggancioBocca(viewBox: [number, number], porta: PortaLib, r: Riquadro): Aggancio {
  const [vw, vh] = viewBox;
  const s = Math.min(r.w / vw, r.h / vh);
  const ox = r.x + (r.w - vw * s) / 2;
  const oy = r.y + (r.h - vh * s) / 2;
  const [dx, dy] = DIREZIONE[porta.side] ?? [0, 0];
  return trasforma(r, ox + porta.x * s, oy + porta.y * s, dx, dy);
}

/** Il diametro della bocca sulla pagina, scalato col simbolo. */
export function diametroBocca(viewBox: [number, number], porta: PortaLib, r: Riquadro): number {
  return tondo(porta.d * Math.min(r.w / viewBox[0], r.h / viewBox[1]));
}

/** Uno dei cinque punti del riquadro; `trasformato` = segue rotazione e
 *  specchiatura (sì per i simboli, no per gli altri tipi: vedi il gemello Rust). */
export function aggancioRiquadro(lato: string, r: Riquadro, trasformato: boolean): Aggancio {
  const [x, y] =
    lato === "top" ? [r.x + r.w / 2, r.y] :
    lato === "bottom" ? [r.x + r.w / 2, r.y + r.h] :
    lato === "left" ? [r.x, r.y + r.h / 2] :
    lato === "right" ? [r.x + r.w, r.y + r.h / 2] :
    [r.x + r.w / 2, r.y + r.h / 2];
  const [dx, dy] = DIREZIONE[lato] ?? [0, 0];
  return trasformato ? trasforma(r, x, y, dx, dy) : { x: tondo(x), y: tondo(y), dx, dy };
}

export const TRATTO_DI_USCITA = 16;

/** Una tappa del percorso: un punto, e se il tratto che ci **arriva** va dritto.
 *  È la forma di `PipePoint` vista da qui, senza dipendere dai tipi dell'editor. */
export interface Tappa extends Punto { dritto?: boolean }

/** Un capo del percorso: il punto, e la direzione d'uscita se c'è.
 *  `dritto` vale solo sul capo d'arrivo: l'ultimo tratto va dritto. */
export interface Capo { punto: Punto; dir?: [number, number]; dritto?: boolean }

export function capoDa(a: Aggancio): Capo {
  return { punto: { x: a.x, y: a.y }, dir: a.dx !== 0 || a.dy !== 0 ? [a.dx, a.dy] : undefined };
}

/** Il percorso a 90° (o a 45° con `diagonale`) fra due capi, passando per i
 *  punti intermedi dell'utente. Stessa regola di `instrada` in Rust. */
export function instrada(da: Capo, a: Capo, intermedi: Tappa[], diagonale: boolean): Punto[] {
  const fuori = (c: Capo): Punto => c.dir
    ? { x: c.punto.x + c.dir[0] * TRATTO_DI_USCITA, y: c.punto.y + c.dir[1] * TRATTO_DI_USCITA }
    : c.punto;
  // Il flag sta sulla tappa d'**arrivo** di ogni tratto: «vieni qui dritto».
  const tappe: Tappa[] = [
    { ...fuori(da), dritto: false },
    ...intermedi,
    { ...fuori(a), dritto: !!a.dritto },
  ];
  const out: Punto[] = [da.punto];
  if (da.dir) out.push(tappe[0]);
  let andatura: [boolean, number] | null = da.dir
    ? (da.dir[0] !== 0 ? [true, Math.sign(da.dir[0])] : [false, Math.sign(da.dir[1])])
    : null;
  for (let i = 0; i + 1 < tappe.length; i++) {
    const p = tappe[i], q = tappe[i + 1];
    const ddx = q.x - p.x, ddy = q.y - p.y;
    // Tratto dritto chiesto da chi ha disegnato: nessun gomito, e l'andatura
    // riparte da zero — una diagonale non ha un verso d'asse da ereditare.
    if (q.dritto && (ddx !== 0 || ddy !== 0)) {
      out.push({ x: q.x, y: q.y });
      andatura = null;
      continue;
    }
    if (ddx === 0 || ddy === 0) {
      out.push(q);
      andatura = ddx !== 0 ? [true, Math.sign(ddx)] : [false, Math.sign(ddy)];
      continue;
    }
    if (diagonale) {
      const m = Math.min(Math.abs(ddx), Math.abs(ddy));
      out.push({ x: p.x + m * Math.sign(ddx), y: p.y + m * Math.sign(ddy) }, q);
      andatura = Math.abs(ddx) > Math.abs(ddy) ? [true, Math.sign(ddx)] : [false, Math.sign(ddy)];
      continue;
    }
    let primaOrizzontale = andatura === null
      ? Math.abs(ddx) >= Math.abs(ddy)
      : andatura[0] ? andatura[1] * ddx > 0 : andatura[1] * ddy <= 0;
    // Nell'ultimo tratto non si arriva nel verso d'uscita della bocca: sarebbe
    // un'inversione a U attraverso l'oggetto (vedi il gemello Rust).
    if (i + 1 === tappe.length - 1 && a.dir) {
      const arrivo = primaOrizzontale ? [0, Math.sign(ddy)] : [Math.sign(ddx), 0];
      if (arrivo[0] === a.dir[0] && arrivo[1] === a.dir[1]) primaOrizzontale = !primaOrizzontale;
    }
    out.push(primaOrizzontale ? { x: q.x, y: p.y } : { x: p.x, y: q.y }, q);
    andatura = primaOrizzontale ? [false, Math.sign(ddy)] : [true, Math.sign(ddx)];
  }
  if (a.dir) out.push(a.punto);
  return pulisci(out);
}

function pulisci(punti: Punto[]): Punto[] {
  const out: Punto[] = [];
  for (const p0 of punti) {
    const p = { x: tondo(p0.x), y: tondo(p0.y) };
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.x === p.x && ultimo.y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const allineati = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x) === 0;
      const stessoVerso = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0;
      if (allineati && stessoVerso) out.pop();
    }
    out.push(p);
  }
  return out;
}

// ── il percorso di un oggetto `pipe` ─────────────────────────────────────────


/** Il riquadro di un oggetto: una `line` aggancia sul suo punto d'origine,
 *  come prima (`computeAnchor` con larghezza e altezza zero). */
function riquadroDi(o: SynopticObject): Riquadro {
  const linea = o.type === "line";
  return {
    x: o.x ?? 0, y: o.y ?? 0,
    w: linea ? 0 : (o.width ?? 80), h: linea ? 0 : (o.height ?? 80),
    rotation: o.rotation, flip_h: o.flip_h, flip_v: o.flip_v,
  };
}

/** Le bocche di un oggetto: solo i simboli di libreria (anche per alias) ne hanno. */
export function bocchePer(o: SynopticObject): { viewBox: [number, number]; porte: PortaLib[] } | undefined {
  if (o.type !== "symbol" || !o.symbol_id) return undefined;
  const sim = trovaSimboloLib(o.symbol_id);
  return sim?.ports?.length ? { viewBox: sim.viewBox, porte: sim.ports } : undefined;
}

/** Dove si aggancia un capo su `o`: la bocca `porta` se il simbolo ce l'ha,
 *  altrimenti uno dei cinque punti del riquadro (un nome sconosciuto = centro). */
export function aggancioSu(o: SynopticObject, porta: string | undefined): Aggancio {
  const b = bocchePer(o);
  const p = b?.porte.find((x) => x.id === porta);
  if (b && p) return aggancioBocca(b.viewBox, p, riquadroDi(o));
  return aggancioRiquadro(porta ?? "center", riquadroDi(o), o.type === "symbol");
}

/** Come il chiamante risolve un oggetto agganciato prima di leggerne il riquadro.
 *
 *  Esiste perché questo file è il gemello puro di `sws-core/src/tubazioni.rs` e
 *  non sa niente di tag: la risoluzione dei binding sta nel chiamante, che i tag
 *  ce li ha. Senza, il tubo si calcola sulla geometria **scritta nel file**
 *  mentre l'oggetto a cui è agganciato viene disegnato dove dicono i suoi
 *  binding — e il tubo nasce staccato già al primo fotogramma (22-10-2026). */
export type RisolviAncora = (o: SynopticObject) => SynopticObject;

/** I punti da disegnare per un tubo: i capi agganciati risolti sugli oggetti
 *  della pagina e, con `orthogonal`/`diagonal`, il percorso calcolato attraverso
 *  i punti intermedi dell'utente. Con `straight`/`bezier` i punti restano quelli
 *  scritti, coi capi agganciati sostituiti — come prima. */
export function percorsoTubo(
  pipe: SynopticObject,
  objects: SynopticObject[],
  risolvi?: RisolviAncora,
): PipePoint[] {
  const pts = [...(pipe.points ?? [])];
  const trova = (id: string | undefined) => {
    const o = id ? objects.find((x) => x.id === id) : undefined;
    return o && risolvi ? risolvi(o) : o;
  };
  const src = trova(pipe.from_obj_id);
  const dst = trova(pipe.to_obj_id);
  // Due capi agganciati bastano a fare un tubo anche senza punti scritti.
  if (pts.length < 2 && src && dst) pts.splice(0, pts.length, { x: 0, y: 0 }, { x: 0, y: 0 });
  if (pts.length < 2) return pts;
  const da = src ? aggancioSu(src, pipe.from_port) : undefined;
  const a = dst ? aggancioSu(dst, pipe.to_port) : undefined;
  const routing = pipe.routing ?? "straight";
  if (routing === "orthogonal" || routing === "diagonal") {
    const ultimo = pts[pts.length - 1];
    return instrada(
      da ? capoDa(da) : { punto: pts[0] },
      // Il `dritto` dell'ultimo punto vale anche quando il capo è agganciato a
      // una bocca: dice come arrivarci, non dove.
      { ...(a ? capoDa(a) : { punto: ultimo }), dritto: ultimo.dritto },
      pts.slice(1, -1),
      routing === "diagonal",
    );
  }
  if (da) pts[0] = { x: da.x, y: da.y };
  if (a) pts[pts.length - 1] = { x: a.x, y: a.y };
  return pts;
}

/** Un posto dove agganciare un capo: l'oggetto, la bocca (o il lato) e dove sta. */
export interface Bersaglio { objId: string; porta: string; x: number; y: number; bocca: boolean }

const LATI_RIQUADRO = ["top", "right", "bottom", "left", "center"] as const;

/** Tutti i posti d'aggancio della pagina: le bocche dei simboli, e i cinque
 *  punti del riquadro di ogni oggetto che non è un tubo (né `escludi`). */
export function bersagli(objects: SynopticObject[], escludi: string): Bersaglio[] {
  const out: Bersaglio[] = [];
  for (const o of objects) {
    if (o.id === escludi || o.type === "pipe") continue;
    for (const p of bocchePer(o)?.porte ?? []) {
      const a = aggancioSu(o, p.id);
      out.push({ objId: o.id, porta: p.id, x: a.x, y: a.y, bocca: true });
    }
    for (const lato of LATI_RIQUADRO) {
      const a = aggancioSu(o, lato);
      out.push({ objId: o.id, porta: lato, x: a.x, y: a.y, bocca: false });
    }
  }
  return out;
}

/** La calamita: il bersaglio più vicino a `punto` entro `raggio`. Una bocca
 *  vince su un lato del riquadro a parità di portata — è quello che si cerca
 *  avvicinando un tubo a una pompa. */
export function calamita(candidati: Bersaglio[], punto: Punto, raggio: number): Bersaglio | null {
  let migliore: Bersaglio | null = null;
  let dMigliore = Infinity;
  for (const b of candidati) {
    const d = Math.hypot(b.x - punto.x, b.y - punto.y) - (b.bocca ? raggio / 2 : 0);
    if (Math.hypot(b.x - punto.x, b.y - punto.y) <= raggio && d < dMigliore) {
      migliore = b;
      dMigliore = d;
    }
  }
  return migliore;
}

/** Il diametro (sulla pagina) della bocca a cui è agganciato ciascun capo, se è
 *  una bocca: serve alle estremità «auto» e allo spessore predefinito. */
export function diametriCapi(
  pipe: SynopticObject,
  objects: SynopticObject[],
  risolvi?: RisolviAncora,
): [number | undefined, number | undefined] {
  const uno = (id: string | undefined, porta: string | undefined) => {
    const grezzo = id ? objects.find((x) => x.id === id) : undefined;
    const o = grezzo && risolvi ? risolvi(grezzo) : grezzo;
    const b = o ? bocchePer(o) : undefined;
    const p = b?.porte.find((x) => x.id === porta);
    return o && b && p ? diametroBocca(b.viewBox, p, riquadroDi(o)) : undefined;
  };
  return [uno(pipe.from_obj_id, pipe.from_port), uno(pipe.to_obj_id, pipe.to_port)];
}
