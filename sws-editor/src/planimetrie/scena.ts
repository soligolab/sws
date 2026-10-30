// La scena 3D di una planimetria, **come dati** (29-10-2026, ramo 2 del piano
// `docs/plans/2026-10-25-planimetrie-3d.md`).
//
// three.js riceve una lista di scatole e di pavimenti già calcolati: tutta la
// geometria sta qui, pura e provata senza WebGL. La pianta è in metri con la y
// verso il basso dello schermo; nella scena x resta x, la y della pianta
// diventa la z, e l'altezza è la y di three.

import { lunghezza, spigoliBlocco, trattiDelMuro, centroDi, type Planimetria, type Punto } from "./modello";

/** Una scatola: centro, misure, rotazione attorno alla verticale (radianti). */
export interface Scatola {
  centro: [number, number, number];
  misure: [number, number, number];
  rotazioneY: number;
  colore: string;
  tipo: "muro" | "blocco";
  etichetta?: string;
}

/** Un pavimento colorato: il poligono dell'area, a quota zero. */
export interface Pavimento {
  punti: Punto[];
  colore: string;
  etichetta?: string;
  centro: Punto;
}

export interface Scena {
  scatole: Scatola[];
  pavimenti: Pavimento[];
  /** Il riquadro della pianta, per inquadrare: [minX, minZ, maxX, maxZ]. */
  limiti: [number, number, number, number];
  altezzaMassima: number;
}

/** Il colore dei muri: chiaro, perché la luce li modelli. */
export const COLORE_MURI = "#cbd5e1";

export function costruisciScena(p: Planimetria): Scena {
  const scatole: Scatola[] = [];
  for (const m of p.muri) {
    // I tratti sono in metri lungo tutta la polilinea: un tratto che passa un
    // angolo si spezza sui due lati, uno per segmento.
    const tratti = trattiDelMuro(m, p.aperture);
    let inizio = 0;
    for (let i = 1; i < m.punti.length; i++) {
      const [a, b] = [m.punti[i - 1], m.punti[i]];
      const l = lunghezza([a, b]);
      const fine = inizio + l;
      const angolo = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const tr of tratti) {
        const da = Math.max(tr.da, inizio);
        const al = Math.min(tr.a, fine);
        if (al - da <= 1e-6) continue;
        const centroLungo = (da + al) / 2 - inizio;
        const cx = a[0] + Math.cos(angolo) * centroLungo;
        const cz = a[1] + Math.sin(angolo) * centroLungo;
        for (const [z0, z1] of tr.pieni) {
          if (z1 - z0 <= 1e-6) continue;
          scatole.push({
            centro: [cx, (z0 + z1) / 2, cz],
            // Lungo il muro un filo in più dello spessore: gli angoli si
            // chiudono senza fessure dove due segmenti si incontrano.
            misure: [al - da + (tr.pieni.length === 1 && z0 === 0 ? m.spessore : 0), z1 - z0, m.spessore],
            rotazioneY: -angolo,
            colore: COLORE_MURI,
            tipo: "muro",
          });
        }
      }
      inizio = fine;
    }
  }
  for (const b of p.blocchi) {
    scatole.push({
      centro: [b.x, b.altezza / 2, b.y],
      misure: [b.larghezza, b.altezza, b.profondita],
      rotazioneY: (-b.rotazione * Math.PI) / 180,
      colore: b.colore,
      tipo: "blocco",
      etichetta: b.etichetta,
    });
  }
  const pavimenti: Pavimento[] = p.aree
    .filter((a) => a.punti.length >= 3)
    .map((a) => ({ punti: a.punti, colore: a.colore, etichetta: a.etichetta, centro: centroDi(a.punti) }));

  const tutti: Punto[] = [
    ...p.muri.flatMap((m) => m.punti),
    ...p.aree.flatMap((a) => a.punti),
    ...p.blocchi.flatMap(spigoliBlocco),
  ];
  const xs = tutti.map((q) => q[0]);
  const zs = tutti.map((q) => q[1]);
  const limiti: Scena["limiti"] = tutti.length
    ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
    : [0, 0, 10, 8];
  const altezzaMassima = Math.max(0, ...p.muri.map((m) => m.altezza), ...p.blocchi.map((b) => b.altezza));
  return { scatole, pavimenti, limiti, altezzaMassima };
}

/** Un'inquadratura di partenza: dall'alto e di sbieco, verso il centro, alla
 *  distanza a cui la pianta intera entra nell'angolo di campo (con margine e
 *  anche in una vista più stretta che alta). La prima stesura metteva la
 *  camera a una distanza fissa e si partiva quasi dentro la stanza. */
export function inquadraturaDiPartenza(s: Scena): { pos: [number, number, number]; target: [number, number, number]; fov: number } {
  const fov = 45;
  const [x0, z0, x1, z1] = s.limiti;
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  // La diagonale della pianta, più l'altezza dei muri: è quello che deve stare dentro.
  const lato = Math.max(Math.hypot(x1 - x0, z1 - z0), 4) + s.altezzaMassima;
  const distanza = (lato / 2 / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.25;
  const direzione: [number, number, number] = [0.15, 1.1, 0.9];
  const n = Math.hypot(...direzione);
  return {
    pos: [cx + (direzione[0] / n) * distanza, (direzione[1] / n) * distanza, cz + (direzione[2] / n) * distanza],
    target: [cx, 0, cz],
    fov,
  };
}
