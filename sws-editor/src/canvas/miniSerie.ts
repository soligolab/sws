// ── La mini tendenza a secchielli (09-11-2026, piano «viewer leggero» §5) ───
//
// Prima la mini tendenza di `kpi_tile` e `sparkline` teneva un campione per
// ogni cambio di valore. Un tag a 10 Hz arrivava a 36.000 punti in un'ora, e
// ogni render li copiava, li filtrava e li riscriveva tutti: sul WP630 la
// pagina iniziale di Montagna saturava il processore dopo un quarto d'ora.
//
// Qui una colonna di pixel è un secchiello di tempo. Per ogni secchiello si
// tengono primo valore, minimo, massimo, ultimo valore e l'ordine fra minimo e
// massimo: il metodo «M4». Disegnati in quest'ordine danno la stessa immagine
// di tutti i campioni, picchi compresi, e i punti non superano quattro per
// colonna, qualunque sia il ritmo del tag e da quanto è aperta la pagina.
//
// Logica pura, senza React: la usa `MiniTendenza.tsx`. Il viewer LVGL segue
// lo stesso principio, con la stessa formula del secchiello.

import type { BucketSample } from "@/types";

/** Il secchiello più corto: sotto, una finestra breve su un oggetto largo
 *  farebbe un secchiello per messaggio. */
export const SECCHIELLO_MINIMO_MS = 100;

/** L'ampiezza del secchiello, la stessa formula del viewer LVGL. */
export function secchielloPer(finestraMs: number, colonne: number): number {
  return Math.max(SECCHIELLO_MINIMO_MS, Math.round(finestraMs / Math.max(1, colonne)));
}

export interface GeometriaMini {
  larghezza: number;
  altezza: number;
  /** Il margine su tutti i lati. */
  margine: number;
  /** La scala fissa. Senza, segue i valori in finestra. */
  yMin?: number;
  yMax?: number;
}

export interface DisegnoMini {
  /** L'attributo `points` della polilinea. Vuoto se non c'è niente. */
  linea: string;
  /** Il `d` dell'area sotto la linea. */
  area: string;
  /** L'ultimo valore noto, anche se viene da prima della finestra. */
  ultimo: number | null;
  /** Quanti punti ha la linea. */
  punti: number;
}

export class MiniSerie {
  readonly secchielloMs: number;
  /** I secchielli in finestra: uno per colonna, meno se il secchiello è al minimo. */
  readonly n: number;
  /** Cresce ogni volta che il disegno cambia, anche quando scorre la testa. */
  versione = 0;

  /** Il secchiello di «adesso», come indice assoluto: `floor(ts / secchiello)`,
   *  cioè l'allineamento del server, `ts - ts % secchiello` (`aggregate_samples`
   *  in sws-historian). Così seme e dato vivo cadono negli stessi secchielli. */
  private testa = -Infinity;
  // L'anello: il secchiello `k` sta nel posto `k mod n`. `chiave` dice quale
  // secchiello c'è davvero, così un posto rimasto da un giro prima vale vuoto
  // senza doverlo pulire.
  private readonly chiave: Float64Array;
  private readonly primo: Float64Array;
  private readonly minimo: Float64Array;
  private readonly massimo: Float64Array;
  private readonly ultimo: Float64Array;
  /** 1 se il minimo viene prima del massimo. */
  private readonly minPrima: Uint8Array;
  /** 1 se nel secchiello è entrato il dato vivo. */
  private readonly vivo: Uint8Array;
  // L'ultimo valore di prima della finestra, col suo secchiello: la linea
  // parte da lì, come fa `ancora` sul server (`sws_historian::ancora`).
  private prima: number | null = null;
  private primaK = -Infinity;

  constructor(finestraMs: number, colonne: number) {
    this.secchielloMs = secchielloPer(finestraMs, colonne);
    this.n = Math.max(1, Math.min(Math.floor(colonne), Math.ceil(finestraMs / this.secchielloMs)));
    this.chiave = new Float64Array(this.n).fill(NaN);
    this.primo = new Float64Array(this.n);
    this.minimo = new Float64Array(this.n);
    this.massimo = new Float64Array(this.n);
    this.ultimo = new Float64Array(this.n);
    this.minPrima = new Uint8Array(this.n);
    this.vivo = new Uint8Array(this.n);
  }

  /** L'inizio del primo secchiello in finestra, per un dato «adesso»:
   *  il `from` da chiedere al server per il seme. */
  inizioFinestra(adesso: number): number {
    return (Math.floor(adesso / this.secchielloMs) - this.n + 1) * this.secchielloMs;
  }

  /** Il prossimo confine di secchiello dopo `adesso`: lì la linea scorre. */
  prossimoConfine(adesso: number): number {
    return (Math.floor(adesso / this.secchielloMs) + 1) * this.secchielloMs;
  }

  /** Sposta la testa ad `adesso`. Non torna mai indietro. */
  avanza(adesso: number): void {
    const k = Math.floor(adesso / this.secchielloMs);
    if (k > this.testa) this.sposta(k);
  }

  /** Un campione vivo, col tempo del server. O(1). */
  aggiungi(ts: number, v: number): void {
    if (!Number.isFinite(v) || !Number.isFinite(ts)) return;
    const k = Math.floor(ts / this.secchielloMs);
    if (k > this.testa) this.sposta(k);
    if (k <= this.testa - this.n) {
      this.ricordaPrima(k, v);
      return;
    }
    const i = this.posto(k);
    if (this.chiave[i] !== k) {
      this.chiave[i] = k;
      this.primo[i] = this.minimo[i] = this.massimo[i] = this.ultimo[i] = v;
      this.minPrima[i] = 1;
      this.vivo[i] = 1;
      this.versione++;
      return;
    }
    let cambiato = false;
    // L'estremo appena superato è il più recente dei due.
    if (v < this.minimo[i]) { this.minimo[i] = v; this.minPrima[i] = 0; cambiato = true; }
    if (v > this.massimo[i]) { this.massimo[i] = v; this.minPrima[i] = 1; cambiato = true; }
    if (this.ultimo[i] !== v) { this.ultimo[i] = v; cambiato = true; }
    this.vivo[i] = 1;
    if (cambiato) this.versione++;
  }

  /** I secchielli dello storico (`getHistoryBuckets`). La fusione col dato vivo
   *  è idempotente: seme e vivo possono sovrapporsi senza doppioni, e un seme
   *  chiesto due volte non cambia niente. */
  semina(secchielli: readonly BucketSample[]): void {
    for (const b of secchielli) {
      if (![b.ts_ms, b.first, b.min, b.max, b.last].every(Number.isFinite)) continue;
      const k = Math.floor(b.ts_ms / this.secchielloMs);
      if (k > this.testa) this.sposta(k);
      if (k <= this.testa - this.n) {
        this.ricordaPrima(k, b.last);
        continue;
      }
      const i = this.posto(k);
      // Il server non dice se il minimo viene prima del massimo: si ricava
      // dall'andamento fra primo e ultimo valore.
      const salita = b.last >= b.first ? 1 : 0;
      if (this.chiave[i] !== k || !this.vivo[i]) {
        // Vuoto, o da un seme di prima: il seme nuovo copre almeno lo stesso.
        this.chiave[i] = k;
        this.primo[i] = b.first;
        this.minimo[i] = b.min;
        this.massimo[i] = b.max;
        this.ultimo[i] = b.last;
        this.minPrima[i] = salita;
        this.vivo[i] = 0;
        this.versione++;
        continue;
      }
      // C'è già il dato vivo. Il seme comincia dall'inizio del secchiello, quindi
      // il primo valore è suo; il vivo arriva fino ad adesso, quindi l'ultimo
      // resta del vivo. Un estremo che porta solo il seme viene prima del vivo.
      const nuovoMin = b.min < this.minimo[i];
      const nuovoMax = b.max > this.massimo[i];
      if (nuovoMin && nuovoMax) this.minPrima[i] = salita;
      else if (nuovoMin) this.minPrima[i] = 1;
      else if (nuovoMax) this.minPrima[i] = 0;
      if (nuovoMin) this.minimo[i] = b.min;
      if (nuovoMax) this.massimo[i] = b.max;
      if (nuovoMin || nuovoMax || this.primo[i] !== b.first) {
        this.primo[i] = b.first;
        this.versione++;
      }
    }
  }

  /** I secchielli di un'altra serie uguale che cadono nella finestra di questa.
   *  Serve quando la serie si rifà perché la stima dell'orologio è cambiata:
   *  i secchielli hanno il tempo del server e restano giusti, e così la linea
   *  non si svuota mentre arriva il seme nuovo. Quelli oltre la testa di
   *  questa serie si lasciano: sarebbero nel suo futuro. */
  ricopia(da: MiniSerie): void {
    if (da.secchielloMs !== this.secchielloMs || da.n !== this.n) return;
    for (let j = 0; j < da.n; j++) {
      const k = da.chiave[j];
      if (Number.isNaN(k) || k > this.testa || k <= this.testa - this.n) continue;
      const i = this.posto(k);
      this.chiave[i] = k;
      this.primo[i] = da.primo[j];
      this.minimo[i] = da.minimo[j];
      this.massimo[i] = da.massimo[j];
      this.ultimo[i] = da.ultimo[j];
      this.minPrima[i] = da.minPrima[j];
      this.vivo[i] = da.vivo[j];
    }
    if (da.prima !== null) this.ricordaPrima(Math.min(da.primaK, this.testa - this.n), da.prima);
    this.versione++;
  }

  /** I punti della linea e dell'area, in O(colonne). La linea arriva fino ad
   *  «adesso» con l'ultimo valore, come lo storico con `ancora`. */
  disegno(g: GeometriaMini): DisegnoMini {
    const { n } = this;
    const sinistra = this.testa - n + 1;
    // Prima passata: la scala e l'ultimo valore.
    let lo = Infinity;
    let hi = -Infinity;
    let ultimo: number | null = null;
    for (let c = 0; c < n; c++) {
      const i = this.posto(sinistra + c);
      if (this.chiave[i] !== sinistra + c) continue;
      if (this.minimo[i] < lo) lo = this.minimo[i];
      if (this.massimo[i] > hi) hi = this.massimo[i];
      ultimo = this.ultimo[i];
    }
    const colonnaZeroVuota = this.chiave[this.posto(sinistra)] !== sinistra;
    const conPrima = this.prima !== null && colonnaZeroVuota;
    if (conPrima) {
      const p = this.prima as number;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      if (ultimo === null) ultimo = p;
    }
    if (ultimo === null) return { linea: "", area: "", ultimo: null, punti: 0 };

    lo = g.yMin ?? lo;
    hi = g.yMax ?? hi;
    const range = hi - lo || 1;
    const pw = g.larghezza - g.margine * 2;
    const ph = g.altezza - g.margine * 2;
    const dx = pw / n;
    const aY = (v: number) => g.margine + ph - ((v - lo) / range) * ph;

    const xs: number[] = [];
    const vs: number[] = [];
    const metti = (x: number, v: number) => {
      const j = vs.length - 1;
      // Lo stesso punto due volte (l'ultimo di un secchiello e il primo del
      // successivo, uguali) non aggiunge niente.
      if (j >= 0 && vs[j] === v && Math.abs(xs[j] - x) < 1e-6) return;
      xs.push(x);
      vs.push(v);
    };

    if (conPrima) metti(g.margine, this.prima as number);
    for (let c = 0; c < n; c++) {
      const k = sinistra + c;
      const i = this.posto(k);
      if (this.chiave[i] !== k) continue;
      const x0 = g.margine + c * dx;
      metti(x0, this.primo[i]);
      if (this.minimo[i] === this.massimo[i]) continue;
      const [a, b] = this.minPrima[i]
        ? [this.minimo[i], this.massimo[i]]
        : [this.massimo[i], this.minimo[i]];
      // Dentro il secchiello si salta il valore uguale al precedente.
      if (a !== vs[vs.length - 1]) metti(x0 + dx / 3, a);
      if (b !== vs[vs.length - 1]) metti(x0 + (2 * dx) / 3, b);
      if (this.ultimo[i] !== vs[vs.length - 1]) metti(x0 + dx, this.ultimo[i]);
    }
    // Fino ad «adesso», cioè al bordo destro, con l'ultimo valore.
    metti(g.margine + pw, ultimo);

    const linea = xs.map((x, j) => `${x.toFixed(1)},${aY(vs[j]).toFixed(1)}`).join(" ");
    const fondo = g.margine + ph;
    const area = `M ${xs[0].toFixed(1)} ${fondo} L ${linea} L ${xs[xs.length - 1].toFixed(1)} ${fondo} Z`;
    return { linea, area, ultimo, punti: xs.length };
  }

  private posto(k: number): number {
    return ((k % this.n) + this.n) % this.n;
  }

  private sposta(k: number): void {
    // I secchielli che escono dalla finestra: il più recente con dati diventa
    // il valore di prima. Al più `n` giri, e solo quando la testa si muove.
    if (Number.isFinite(this.testa)) {
      for (let j = Math.min(this.testa, k - this.n); j > this.testa - this.n; j--) {
        const i = this.posto(j);
        if (this.chiave[i] === j) {
          this.ricordaPrima(j, this.ultimo[i]);
          break;
        }
      }
    }
    this.testa = k;
    this.versione++;
  }

  private ricordaPrima(k: number, v: number): void {
    if (k < this.primaK) return;
    if (this.prima !== v) this.versione++;
    this.prima = v;
    this.primaK = k;
  }
}
