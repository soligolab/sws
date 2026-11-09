import { describe, expect, it } from "vitest";
import { MiniSerie, secchielloPer, type GeometriaMini } from "./miniSerie";
import type { BucketSample } from "@/types";

/** I secchielli come li fa il server (`aggregate_samples` in sws-historian):
 *  allineati a `ts - ts % secchiello`, i vuoti assenti. */
function daServer(campioni: { ts: number; v: number }[], secchiello: number): BucketSample[] {
  const out: BucketSample[] = [];
  for (const { ts, v } of campioni) {
    const inizio = ts - (ts % secchiello);
    const b = out[out.length - 1];
    if (b && b.ts_ms === inizio) {
      b.min = Math.min(b.min, v);
      b.max = Math.max(b.max, v);
      b.avg += (v - b.avg) / (b.count + 1);
      b.last = v;
      b.count++;
    } else {
      out.push({ ts_ms: inizio, min: v, max: v, avg: v, first: v, last: v, count: 1 });
    }
  }
  return out;
}

/** Un'ora esatta di secchielli da 25 s: l'inizio è allineato. */
const T0 = 1_700_000_000_000;

describe("secchielloPer", () => {
  it("una colonna per secchiello, mai sotto i 100 ms", () => {
    expect(secchielloPer(3_600_000, 144)).toBe(25_000);
    expect(secchielloPer(60_000, 116)).toBe(517);
    expect(secchielloPer(5_000, 116)).toBe(100);
  });
});

describe("MiniSerie", () => {
  const kpi: GeometriaMini = { larghezza: 148, altezza: 30, margine: 2 };

  it("36.000 campioni a 10 Hz su un'ora e 144 colonne: al massimo 4·144+2 punti", () => {
    const s = new MiniSerie(3_600_000, 144);
    // Un segnale che si muove dentro ogni secchiello: il caso peggiore.
    for (let i = 0; i < 36_000; i++) s.aggiungi(T0 + i * 100, Math.sin(i / 7) * 50 + (i % 13));
    s.avanza(T0 + 3_599_900);
    const d = s.disegno(kpi);
    expect(d.punti).toBeLessThanOrEqual(4 * 144 + 2);
    // E non è un disegno vuoto: le colonne ci sono tutte.
    expect(d.punti).toBeGreaterThan(3 * 144);
  });

  it("i punti non crescono col tempo: un'altra ora dopo sono ancora al massimo 4·144+2", () => {
    const s = new MiniSerie(3_600_000, 144);
    for (let i = 0; i < 72_000; i++) s.aggiungi(T0 + i * 100, Math.sin(i / 7) * 50 + (i % 13));
    s.avanza(T0 + 7_199_900);
    expect(s.disegno(kpi).punti).toBeLessThanOrEqual(4 * 144 + 2);
  });

  describe("seme e dato vivo sovrapposti danno lo stesso disegno del solo dato vivo", () => {
    // Una sparkline di 60 s larga 120: secchielli da 517 ms. Il segnale è
    // monotono dentro ogni secchiello, così l'ordine ricavato dal seme è
    // quello vero; i salti stanno sui confini.
    const finestra = 60_000;
    const colonne = 116;
    const B = secchielloPer(finestra, colonne);
    const geo: GeometriaMini = { larghezza: 120, altezza: 30, margine: 2 };
    const inizio = T0 - (T0 % B);
    const campioni = Array.from({ length: 5_000 }, (_, i) => {
      const ts = inizio + i * 10;
      const k = Math.floor(ts / B);
      const frazione = (ts % B) / B;
      return { ts, v: ((k * 7) % 11) + (k % 2 ? frazione : -frazione) };
    });
    const fine = campioni[campioni.length - 1].ts;

    const soloVivo = () => {
      const s = new MiniSerie(finestra, colonne);
      for (const c of campioni) s.aggiungi(c.ts, c.v);
      s.avanza(fine);
      return s.disegno(geo);
    };

    it("prima un po' di vivo, poi il seme, poi il resto del vivo", () => {
      // Il vivo comincia in punti diversi di due secchielli, uno in salita e
      // uno in discesa: è lì che seme e vivo si fondono.
      const atteso = soloVivo();
      for (let i = 3_000; i < 3_104; i += 13) {
        const s = new MiniSerie(finestra, colonne);
        const j = i + 400; const m = i + 600;
        for (const c of campioni.slice(i, m)) s.aggiungi(c.ts, c.v);
        s.semina(daServer(campioni.slice(0, j + 1), B));
        for (const c of campioni.slice(m)) s.aggiungi(c.ts, c.v);
        s.avanza(fine);
        expect(s.disegno(geo), `vivo da ${i}`).toEqual(atteso);
      }
    });

    it("prima il seme, poi il vivo che lo ripete in parte", () => {
      const s = new MiniSerie(finestra, colonne);
      s.semina(daServer(campioni.slice(0, 3_401), B));
      for (const c of campioni.slice(3_000)) s.aggiungi(c.ts, c.v);
      s.avanza(fine);
      expect(s.disegno(geo)).toEqual(soloVivo());
    });

    it("lo stesso seme due volte non cambia niente", () => {
      const s = new MiniSerie(finestra, colonne);
      const seme = daServer(campioni.slice(0, 3_401), B);
      s.semina(seme);
      for (const c of campioni.slice(3_000, 3_600)) s.aggiungi(c.ts, c.v);
      s.semina(seme);
      for (const c of campioni.slice(3_600)) s.aggiungi(c.ts, c.v);
      s.avanza(fine);
      expect(s.disegno(geo)).toEqual(soloVivo());
    });
  });

  it("un picco di un solo campione resta nel massimo", () => {
    const s = new MiniSerie(3_600_000, 144);
    for (let i = 0; i < 36_000; i++) s.aggiungi(T0 + i * 100, i === 17_777 ? 90 : 10);
    s.avanza(T0 + 3_599_900);
    const geo = { ...kpi, yMin: 0, yMax: 100 };
    const d = s.disegno(geo);
    // y del picco: 2 + 26 − 0,9 · 26.
    const yPicco = (2 + 26 - 0.9 * 26).toFixed(1);
    expect(d.linea.split(" ").filter((p) => p.endsWith(`,${yPicco}`))).toHaveLength(1);
    expect(d.linea.split(" ").length).toBe(d.punti);
  });

  it("dentro un secchiello minimo e massimo stanno nell'ordine in cui sono arrivati", () => {
    const geo = { ...kpi, yMin: 0, yMax: 10 };
    const valori = (seq: number[]) => {
      const s = new MiniSerie(3_600_000, 144);
      seq.forEach((v, i) => s.aggiungi(T0 + i * 1_000, v));
      s.avanza(T0 + 10_000);
      // L'ultimo punto è «adesso»: qui coincide con l'ultimo del secchiello.
      return s.disegno(geo).linea.split(" ").map((p) => Math.round((28 - Number(p.split(",")[1])) / 2.6));
    };
    expect(valori([5, 9, 1, 6])).toEqual([5, 9, 1, 6]);
    expect(valori([5, 1, 9, 6])).toEqual([5, 1, 9, 6]);
  });

  it("la linea arriva fino ad «adesso» con l'ultimo valore, anche a valore fermo", () => {
    const s = new MiniSerie(60_000, 116);
    for (let i = 0; i < 100; i++) s.aggiungi(T0 + i * 100, i);
    s.avanza(T0 + 40_000);
    const d = s.disegno({ larghezza: 120, altezza: 30, margine: 2 });
    const ultimoPunto = d.linea.split(" ").pop()!;
    expect(ultimoPunto.split(",")[0]).toBe("118.0");
    expect(d.ultimo).toBe(99);
  });

  it("avanza di un'ora svuota tutto: resta solo l'ultimo valore, piatto fino ad adesso", () => {
    const s = new MiniSerie(3_600_000, 144);
    for (let i = 0; i < 36_000; i++) s.aggiungi(T0 + i * 100, Math.sin(i / 7) * 50);
    const v0 = s.versione;
    s.avanza(T0 + 3_600_000 + 3_600_000);
    expect(s.versione).toBeGreaterThan(v0);
    const d = s.disegno(kpi);
    expect(d.punti).toBe(2);
    expect(d.ultimo).toBeCloseTo(Math.sin(35_999 / 7) * 50);
    const [a, b] = d.linea.split(" ");
    expect(a.split(",")[1]).toBe(b.split(",")[1]);
  });

  it("una serie senza niente non disegna niente", () => {
    const s = new MiniSerie(60_000, 116);
    s.avanza(T0);
    expect(s.disegno({ larghezza: 120, altezza: 30, margine: 2 })).toEqual({ linea: "", area: "", ultimo: null, punti: 0 });
  });

  it("ricopia porta i secchielli di un'altra serie, non quelli oltre la sua testa", () => {
    const g = { larghezza: 120, altezza: 30, margine: 2 };
    const B = secchielloPer(60_000, 116);
    const vecchia = new MiniSerie(60_000, 116);
    for (let i = 0; i < 100; i++) vecchia.aggiungi(T0 + i * B, i % 9);
    // La stessa testa: lo stesso disegno.
    const uguale = new MiniSerie(60_000, 116);
    uguale.avanza(T0 + 99 * B);
    uguale.ricopia(vecchia);
    expect(uguale.disegno(g)).toEqual(vecchia.disegno(g));
    // Una testa dieci secchielli indietro: i dieci più recenti restano fuori,
    // e l'ultimo valore è quello del secchiello 89.
    const indietro = new MiniSerie(60_000, 116);
    indietro.avanza(T0 + 89 * B);
    indietro.ricopia(vecchia);
    expect(indietro.disegno(g).ultimo).toBe(89 % 9);
    // Una testa che arriva più avanti fa riapparire solo i secchielli veri.
    indietro.avanza(T0 + 99 * B);
    expect(indietro.disegno(g).ultimo).toBe(89 % 9);
  });

  it("un valore uguale nello stesso secchiello non cambia la versione", () => {
    const s = new MiniSerie(60_000, 116);
    s.aggiungi(T0, 5);
    const v = s.versione;
    s.aggiungi(T0 + 10, 5);
    s.avanza(T0 + 20);
    expect(s.versione).toBe(v);
  });
});
