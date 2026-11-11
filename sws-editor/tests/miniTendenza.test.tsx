/** La mini tendenza di sparkline e kpi a secchielli (piano «viewer leggero»,
 *  09-11-2026, passo 1). Prima teneva un campione per cambio di valore: sul
 *  WP630 la pagina iniziale di Montagna saturava il processore dopo un quarto
 *  d'ora, la linea scorreva solo se altri tag facevano ridisegnare la pagina,
 *  e il seme (tempo del server) si mescolava al dato vivo (tempo del browser).
 *  In edit la kpi non disegnava né mini tendenza né variazione. */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      getHistory: vi.fn(),
      getHistoryBuckets: vi.fn(),
      getHistoryStats: vi.fn(),
    },
  };
});

import "../src/i18n/index";
import { api } from "@/api/client";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { MiniSerie, secchielloPer } from "@/canvas/miniSerie";
import { accoda, azzeraOrologio, ricominciaMisura, svuotaOra } from "@/ws/coalescenza";
import type { BucketSample, SynopticObject, TagState } from "../src/types";

/** Un istante allineato ai secchielli da 517 ms e da 25 s. */
const T = 1_700_000_000_000 - (1_700_000_000_000 % (517 * 25_000));

// ── Il server finto: uno storico, e le due letture come le fa il server ──────
let storico: { ts: number; v: number }[] = [];
const nellaFinestra = (o: { fromMs?: number; toMs?: number }) =>
  storico.filter((s) => s.ts >= (o.fromMs ?? -Infinity) && s.ts <= (o.toMs ?? Infinity));

/** Come `aggregate_samples` in sws-historian. */
function daServer(campioni: { ts: number; v: number }[], secchiello: number): BucketSample[] {
  const out: BucketSample[] = [];
  for (const { ts, v } of campioni) {
    const inizio = ts - (ts % secchiello);
    const b = out[out.length - 1];
    if (b && b.ts_ms === inizio) {
      b.min = Math.min(b.min, v); b.max = Math.max(b.max, v);
      b.last = v; b.count++;
    } else {
      out.push({ ts_ms: inizio, min: v, max: v, avg: v, first: v, last: v, count: 1 });
    }
  }
  return out;
}

const stato = (v: number, ts: number): TagState => ({ value: v, quality: "Good", timestamp_ms: ts });

const disegna = (obj: SynopticObject, tagValues: Record<string, TagState>, isEditMode = false) => (
  <svg>
    <SvgObject obj={obj} objects={[obj]} tagValues={tagValues} selected={false} isEditMode={isEditMode}
      customSymbols={[]} faceplates={[]} />
  </svg>
);

const SPARK = {
  id: "sp", type: "sparkline", x: 0, y: 0, width: 120, height: 30, tag: "t", spark_window_s: 60,
} as unknown as SynopticObject;

const KPI = {
  id: "k", type: "kpi_tile", x: 0, y: 0, width: 160, height: 80, tag: "t", spark_window_s: 3600,
} as unknown as SynopticObject;

const puntiDi = (c: HTMLElement) => {
  const p = c.querySelector("polyline");
  return p ? (p.getAttribute("points") ?? "").split(" ").filter(Boolean) : [];
};

/** Un valore che arriva dal socket: passa dalla coalescenza, che stima
 *  l'orologio del server, e poi arriva all'oggetto come prop. */
const dalSocket = (st: TagState) => {
  accoda([["t", st]]);
  svuotaOra();
};

/** Fa passare il tempo e lascia arrivare le risposte. */
const scorri = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers({ now: T });
  // Una connessione nuova, con l'orologio del server ancora da stimare.
  ricominciaMisura();
  azzeraOrologio();
  storico = [];
  vi.mocked(api.getHistory).mockReset().mockImplementation(async (_t, o) =>
    nellaFinestra(o ?? {}).map((s) => ({ ts_ms: s.ts, value: s.v, quality: "Good" as const })));
  vi.mocked(api.getHistoryBuckets).mockReset().mockImplementation(async (_t, o) =>
    daServer(nellaFinestra(o), o.bucketMs));
  vi.mocked(api.getHistoryStats).mockReset().mockImplementation(async (tag, o) => ({
    tag, count: 10, min: 0, max: 0, stddev: 0, first_ts: null, last_ts: null,
    // La finestra corrente vale 12, la precedente 10: +20%.
    avg: (o?.toMs ?? 0) > Date.now() - 1_000 ? 12 : 10,
  }));
});

afterEach(() => { vi.useRealTimers(); });

describe("la mini tendenza a secchielli", () => {
  it("5.000 cambi in 50 s su una sparkline di 60 s larga 120: al massimo 4·116+2 punti", async () => {
    const r = render(disegna(SPARK, {}));
    await scorri(0);
    for (let i = 0; i < 5_000; i++) {
      act(() => { vi.advanceTimersByTime(10); });
      r.rerender(disegna(SPARK, { t: stato(Math.sin(i / 5) * 50 + i * 1e-6, Date.now()) }));
    }
    const n = puntiDi(r.container).length;
    expect(n).toBeGreaterThan(0);
    // Prima erano 5.000: un punto per cambio.
    expect(n).toBeLessThanOrEqual(4 * 116 + 2);
  }, 60_000);

  it("senza valori nuovi la linea scorre lo stesso, e arriva fino ad «adesso»", async () => {
    // Trenta secondi di rampa nello storico, poi più niente.
    for (let i = 0; i <= 300; i++) storico.push({ ts: T - 30_000 + i * 100, v: i });
    const r = render(disegna(SPARK, { t: stato(300, T) }));
    await scorri(0);
    const prima = puntiDi(r.container);
    expect(prima.length).toBeGreaterThan(2);
    await scorri(3 * secchielloPer(60_000, 116));
    const dopo = puntiDi(r.container);
    // Prima restava ferma: niente la faceva ridisegnare.
    expect(dopo).not.toEqual(prima);
    expect(dopo[dopo.length - 1]).toMatch(/^118\.0,/);
  });

  it("col server 10 minuti avanti, nessun campione si perde e nessuno si raddoppia", async () => {
    const avanti = 10 * 60_000;
    const S = T + avanti; // l'orologio del server
    const B = secchielloPer(60_000, 116);
    // Due minuti di storico sul server, monotono dentro ogni secchiello: così
    // l'ordine fra minimo e massimo ricavato dal seme è quello vero.
    const segnale = (ts: number) => {
      const k = Math.floor(ts / B);
      const frazione = (ts % B) / B;
      return ((k * 7) % 11) + (k % 2 ? frazione : -frazione);
    };
    for (let ts = S - 120_000; ts <= S; ts += 100) storico.push({ ts, v: segnale(ts) });

    const r = render(disegna(SPARK, { t: stato(segnale(S), S) }));
    await scorri(0);
    // Due secondi di dato vivo, a 10 Hz, col tempo del server: il server lo
    // scrive anche nello storico.
    for (let i = 1; i <= 20; i++) {
      await scorri(100);
      const ts = Date.now() + avanti;
      storico.push({ ts, v: segnale(ts) });
      dalSocket(stato(segnale(ts), ts));
      r.rerender(disegna(SPARK, { t: stato(segnale(ts), ts) }));
      await scorri(0);
    }

    // Quello che si dovrebbe vedere: tutti i campioni, una volta sola.
    const attesa = new MiniSerie(60_000, 116);
    for (const s of storico) attesa.aggiungi(s.ts, s.v);
    attesa.avanza(Date.now() + avanti);
    const d = attesa.disegno({ larghezza: 120, altezza: 30, margine: 2 });
    expect(puntiDi(r.container).join(" ")).toBe(d.linea);
    // Il seme del montaggio era nell'ora del browser; al primo arrivo
    // l'orologio è noto e il seme si chiede di nuovo, una volta.
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(2);
  });
});

describe("una mini tendenza ferma", () => {
  // Decisione del maintainer dell'11-11-2026: a metà, come su LVGL; in basso
  // sembrava uno zero.
  it("sta a metà altezza, con la scala automatica", () => {
    const m = new MiniSerie(60_000, 116);
    for (let i = 0; i < 50; i++) m.aggiungi(T - 50_000 + i * 1000, 7.5);
    const d = m.disegno({ larghezza: 120, altezza: 30, margine: 2 });
    const ys = d.linea.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeCloseTo(15, 5);
  });
});

describe("l'orologio della mini tendenza", () => {
  it("un primo valore arrivato in ritardo non rifà la serie", async () => {
    // Una pagina lenta al montaggio: il primo valore si disegna 1,5 s dopo la
    // sua scrittura, il successivo con 50 ms. Prima ogni mini tendenza stimava
    // l'orologio da sola, dentro un effetto, e rifaceva la serie due volte:
    // tre richieste, e una linea di due punti finché non tornava il seme.
    for (let i = 0; i <= 300; i++) storico.push({ ts: T - 30_000 + i * 100, v: i % 17 });
    const r = render(disegna(SPARK, { t: stato(5, T - 5_000) }));
    await scorri(0);
    await scorri(1_500);
    r.rerender(disegna(SPARK, { t: stato(6, Date.now() - 1_500) }));
    expect(puntiDi(r.container).length).toBeGreaterThan(2);
    await scorri(100);
    r.rerender(disegna(SPARK, { t: stato(7, Date.now() - 50) }));
    expect(puntiDi(r.container).length).toBeGreaterThan(2);
    await scorri(0);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(1);
  });

  it("quando la stima dell'orologio cambia la serie si rifà, e la linea non si svuota", async () => {
    // Il server 60 s avanti: al montaggio non si sa ancora.
    const avanti = 60_000;
    for (let i = 0; i <= 600; i++) storico.push({ ts: T + avanti - 60_000 + i * 100, v: i % 13 });
    const r = render(disegna(SPARK, { t: stato(1, T + avanti) }));
    await scorri(0);
    const prima = puntiDi(r.container).length;
    expect(prima).toBeGreaterThan(2);
    await scorri(100);
    const ts = Date.now() + avanti;
    dalSocket(stato(2, ts));
    r.rerender(disegna(SPARK, { t: stato(2, ts) }));
    // Il seme nuovo non è ancora arrivato: restano i secchielli di prima.
    expect(puntiDi(r.container).length).toBeGreaterThan(2);
    await scorri(0);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(2);
  });

  it("un salto indietro dell'orologio rifà la serie: l'ultimo valore è quello nuovo", async () => {
    // Il WP630: server e browser sullo stesso orologio, che NTP porta indietro
    // di 20 s. Prima la testa della serie restava 20 s avanti, e i valori
    // nuovi finivano a sinistra di quelli vecchi.
    const obj = { ...SPARK, spark_show_last: true } as unknown as SynopticObject;
    const r = render(disegna(obj, { t: stato(0, T) }));
    await scorri(0);
    for (let i = 1; i <= 20; i++) {
      await scorri(100);
      const st = stato(i, Date.now());
      dalSocket(st);
      r.rerender(disegna(obj, { t: st }));
    }
    expect(r.container.textContent).toContain("20.0");
    vi.setSystemTime(Date.now() - 20_000);
    for (let i = 0; i < 5; i++) {
      await scorri(100);
      const st = stato(999 - i, Date.now());
      dalSocket(st);
      r.rerender(disegna(obj, { t: st }));
    }
    await scorri(0);
    expect(r.container.textContent).toContain("995.0");
  });
});

describe("il ridimensionamento in edit", () => {
  it("non rifà la serie a ogni pixel: una richiesta quando la larghezza si ferma", async () => {
    for (let i = 0; i <= 300; i++) storico.push({ ts: T - 30_000 + i * 100, v: i });
    const r = render(disegna(SPARK, { t: stato(300, T) }, true));
    await scorri(0);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(1);
    for (let w = 121; w <= 160; w++) {
      r.rerender(disegna({ ...SPARK, width: w } as SynopticObject, { t: stato(300, T) }, true));
      await scorri(10);
      // Intanto la linea c'è, allargata: nessun lampo vuoto.
      expect(puntiDi(r.container).length).toBeGreaterThan(2);
    }
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(1);
    await scorri(300);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(2);
    expect(puntiDi(r.container).pop()).toMatch(/^158\.0,/);
  });
});

describe("la kpi in edit", () => {
  it("disegna mini tendenza e variazione, con una richiesta sola", async () => {
    for (let i = 0; i <= 360; i++) storico.push({ ts: T - 3_600_000 + i * 10_000, v: i % 50 });
    const r = render(disegna(KPI, { t: stato(10, T) }, true));
    await scorri(0);
    // Prima in edit la kpi non aveva né l'una né l'altra (regola UI 1).
    expect(puntiDi(r.container).length).toBeGreaterThan(2);
    expect(r.container.textContent).toContain("20.0%");
    expect(api.getHistoryStats).toHaveBeenCalledTimes(2);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(1);
    await scorri(60_000);
    // Niente polling in edit: le due statistiche restano quelle del montaggio.
    expect(api.getHistoryStats).toHaveBeenCalledTimes(2);
    expect(api.getHistoryBuckets).toHaveBeenCalledTimes(1);
  });

  it("in runtime la variazione si aggiorna ancora ogni 30 s", async () => {
    render(disegna(KPI, { t: stato(10, T) }));
    await scorri(0);
    expect(api.getHistoryStats).toHaveBeenCalledTimes(2);
    await scorri(30_000);
    expect(api.getHistoryStats).toHaveBeenCalledTimes(4);
  });
});
