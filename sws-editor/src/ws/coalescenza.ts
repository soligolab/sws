// I valori dei tag arrivano allo store una volta per fotogramma.
//
// Il socket manda una decina di messaggi al secondo, e fino al 09-11-2026 ogni
// voce era una scrittura nello store: una copia di tutta la mappa e un giro di
// tutti i selettori, per voce. Sul WP630 la pagina restava indietro e i
// messaggi si mettevano in coda (piano 2026-11-09-viewer-leggero, §2 e §5).
//
// Qui le voci si raccolgono, e per ogni tag vince l'ultima. Al fotogramma
// successivo vanno nello store con una scrittura sola (`applicaValori`). Se la
// pagina è in ritardo, i messaggi si fondono invece di accodarsi.
//
// Niente `flushSync`: React ridisegna nel microtask dopo la callback del
// fotogramma, quindi prima della pittura.
//
// Qui si misura anche quanto sono vecchi i valori quando arrivano a schermo:
// è la fascia «Dati in ritardo» del viewer (vedi più sotto).

import { useSyncExternalStore } from "react";
import { useAppStore } from "@/store";
import type { TagState } from "@/types";

/** Il timer di riserva. In una scheda nascosta `requestAnimationFrame` si
 *  ferma, e i valori devono arrivare lo stesso. */
export const RISERVA_MS = 100;
/** I fotogrammi al secondo senza `pannello.fps` nel progetto. */
export const FPS_PREDEFINITI = 20;

/** Chiede di chiamare `cb` una volta; restituisce come annullare la richiesta. */
export type Pianificatore = (cb: () => void) => () => void;

/** Il fotogramma, o il timer di riserva: parte chi arriva prima, l'altro si
 *  annulla. `requestAnimationFrame` si legge a ogni chiamata, perché in jsdom e
 *  nei test può mancare o essere finto. */
const fotogramma: Pianificatore = (cb) => {
  let raf: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attesa: ReturnType<typeof setTimeout> | null = null;
  const annulla = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    if (attesa !== null) clearTimeout(attesa);
    raf = null;
    timer = null;
    attesa = null;
  };
  const parti = () => {
    annulla();
    ultimoGiro = performance.now();
    cb();
  };
  const chiedi = () => {
    attesa = null;
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(parti);
    timer = setTimeout(parti, RISERVA_MS);
  };
  // Al più `fps` giri al secondo (`pannello.fps` del progetto, 12-11-2026):
  // se il giro di prima è troppo vicino, si aspetta il resto del periodo.
  const resto = ultimoGiro + periodoMs - performance.now();
  if (resto > 0) attesa = setTimeout(chiedi, resto);
  else chiedi();
  return annulla;
};

/** La durata minima fra due giri, da `pannello.fps` del progetto. */
let periodoMs = 1000 / FPS_PREDEFINITI;
let ultimoGiro = -Infinity;

/** Per i test: dimentica l'ultimo giro (l'orologio finto riparte da capo). */
export function azzeraRitmo(): void {
  ultimoGiro = -Infinity;
}

/** I fotogrammi al secondo del viewer (`pannello.fps`, predefinito 20, fra 1 e
 *  60): gli stessi limiti di `PannelloConfig::fps_effettivi` nel runtime. Fino
 *  al 12-11-2026 la pagina si aggiornava a ogni fotogramma del browser. */
export function impostaFps(fps: number | undefined): void {
  const f = fps === undefined || !Number.isFinite(fps) ? FPS_PREDEFINITI : Math.min(60, Math.max(1, Math.round(fps)));
  periodoMs = 1000 / f;
}

let pianifica: Pianificatore = fotogramma;
let inAttesa = new Map<string, TagState>();
let annullaGiro: (() => void) | null = null;

/** Mette le voci in attesa del prossimo fotogramma. Per ogni tag vince l'ultima.
 *  `origine` serve alla misura del ritardo: lo snapshot non dà un'età. */
export function accoda(
  voci: Iterable<readonly [string, TagState]>,
  origine: "delta" | "snapshot" = "delta",
): void {
  for (const [id, stato] of voci) {
    inAttesa.set(id, stato);
    // Un `ts` a 0 non dice niente, e non si conta.
    if (stato.timestamp_ms > 0) {
      if (origine === "delta") tsDelta = Math.max(tsDelta ?? 0, stato.timestamp_ms);
      else tsSnapshot = Math.max(tsSnapshot ?? 0, stato.timestamp_ms);
    }
  }
  if (inAttesa.size > 0 && annullaGiro === null) annullaGiro = pianifica(svuotaOra);
}

/** Porta subito nello store quello che è in attesa. */
export function svuotaOra(): void {
  annullaGiro?.();
  annullaGiro = null;
  if (inAttesa.size === 0) return;
  const voci = inAttesa;
  inAttesa = new Map();
  const adesso = Date.now();
  misura(adesso);
  useAppStore.getState().applicaValori(voci);
  aggiornaRitardo(adesso);
}

/** Per i test: un pianificatore a mano. Senza argomento torna il fotogramma. */
export function impostaPianificatore(p: Pianificatore = fotogramma): void {
  annullaGiro?.();
  annullaGiro = null;
  pianifica = p;
  if (inAttesa.size > 0) annullaGiro = pianifica(svuotaOra);
}

// ── Dati in ritardo (piano 2026-11-09-viewer-leggero, §5-bis) ──────────────
//
// Sul WP630 i valori a schermo erano vecchi fino a 29 s, e niente lo diceva.
// Il maintainer ha deciso il 09-11-2026: oltre 5 s compare in alto la fascia
// «Dati in ritardo di N s» e gli oggetti prendono lo stile «non aggiornato».
// La regola è la stessa del pannello LVGL (`sws-lvgl-viewer/src/ritardo.rs`),
// punto per punto: chi ne cambia una cambi anche l'altra.
//
// - **Si misura quando la pagina applica i valori**: `adesso − ts`, meno lo
//   scarto fra l'orologio del server e quello del browser. È qui che si vede
//   la coda, sia quella del server sia quella della pagina che non sta dietro.
// - **Lo scarto** è il minimo `adesso − ts` visto sulla connessione: un
//   orologio sfasato di un minuto non accende niente. Riparte quando il
//   socket si apre, non a ogni snapshot.
// - **Un salto dell'orologio del browser** (NTP, l'ora cambiata a mano) fa
//   ripartire la stima dello scarto. Senza, un salto indietro di 20 s con un
//   valore in volo lasciava lo scarto 20 s più basso, e la fascia accesa con
//   «20 s» finché il socket non si riapriva. Il salto si vede confrontando
//   `Date.now()` con `performance.now()`, che non salta mai; il lotto di quel
//   momento non si misura, perché può avere il `ts` del vecchio orologio.
// - **Conta la voce più recente del lotto.** Una foglia scritta fa arrivare
//   tutta la sua radice, e le foglie sorelle portano il loro `ts` vecchio.
// - **Lo snapshot non dà un'età**: porta anche i tag fermi da ore. Serve solo
//   alla stima dello scarto.
// - **Il socket giù conta**: chiuso o in riconnessione, i valori invecchiano
//   da quando è caduto.
// - **Un impianto fermo non è in ritardo.** Col socket vivo e nessun delta per
//   5 s, l'ultima misura non vale più: i valori a schermo sono quelli di adesso.
//
// Lo scarto serve anche alle mini tendenze (`oraDelServer`): un orologio solo
// per tutta la pagina, stimato prima del disegno e non dentro un effetto.

/** Oltre questa età i valori a schermo si dicono in ritardo. «Più di 5 s»: a
 *  5 000 ms esatti la fascia non c'è ancora. */
export const RITARDO_MS = 5_000;

/** Oltre questo spostamento fra `Date.now()` e `performance.now()` l'orologio
 *  del browser è saltato. Un orologio corretto piano da NTP si sposta di
 *  qualche millisecondo all'ora. */
export const SALTO_OROLOGIO_MS = 1_000;

/** Il `ts` più recente fra i delta in attesa, e fra gli snapshot in attesa. */
let tsDelta: number | null = null;
let tsSnapshot: number | null = null;
/** Il minimo `adesso − ts` visto su questa connessione. */
let scarto: number | null = null;
/** Vero dopo il primo delta misurato: prima lo scarto viene solo dallo
 *  snapshot, che può avere solo tag fermi da ore. */
let deltaVisto = false;
/** `Date.now() − performance.now()` all'ultima misura: se cambia, l'orologio
 *  del browser è saltato. */
let riferimento: number | null = null;
/** Lo scarto delle mini tendenze: quello della connessione, dal suo primo
 *  delta. Fra una connessione e l'altra resta quello di prima, che di solito è
 *  ancora giusto: azzerarlo farebbe rifare tutte le mini tendenze due volte a
 *  ogni riconnessione. Un salto dell'orologio del browser lo azzera. */
let scartoOrologio: number | null = null;
/** Cresce a ogni salto dell'orologio del browser. */
let epoca = 0;
/** L'età dell'ultimo delta applicato, scarto tolto, e quando lo si è applicato. */
let etaMs = 0;
let misuratoIl = 0;
/** Da quando il socket è giù, e l'età che i valori avevano in quel momento. */
let giuDa: number | null = null;
let etaAllaCaduta = 0;
/** Quello che la fascia mostra: i secondi, o `null` se non c'è. */
let ritardoS: number | null = null;
const ascoltatori = new Set<() => void>();
/** L'orologio a 1 s: gira solo col socket giù o con la fascia accesa, cioè
 *  quando la fascia può cambiare senza che arrivi niente. */
let orologio: ReturnType<typeof setInterval> | null = null;

function misura(adesso: number): void {
  const rif = adesso - performance.now();
  const saltato = riferimento !== null && Math.abs(rif - riferimento) > SALTO_OROLOGIO_MS;
  riferimento = rif;
  if (saltato) {
    // Lo scarto di prima è dell'orologio di prima. Si riparte dal lotto
    // dopo: questo può avere voci scritte prima del salto.
    tsDelta = null;
    tsSnapshot = null;
    scarto = null;
    deltaVisto = false;
    scartoOrologio = null;
    epoca++;
    etaMs = 0;
    misuratoIl = 0;
    return;
  }
  if (tsSnapshot !== null) {
    const grezza = adesso - tsSnapshot;
    scarto = scarto === null ? grezza : Math.min(scarto, grezza);
    tsSnapshot = null;
  }
  if (tsDelta !== null) {
    const grezza = adesso - tsDelta;
    scarto = scarto === null ? grezza : Math.min(scarto, grezza);
    etaMs = grezza - scarto;
    misuratoIl = adesso;
    deltaVisto = true;
    tsDelta = null;
  }
  if (deltaVisto) scartoOrologio = scarto;
}

/** L'ora del server, stimata: `adesso` meno lo scarto. Senza un delta vale
 *  `adesso`: lo snapshot da solo può avere tutti tag fermi da ore, e
 *  sposterebbe «adesso» di ore. Lo scarto è un minimo, quindi quest'ora non
 *  va mai oltre quella vera: nessun valore arriva «dal futuro». */
export function oraDelServer(adesso = Date.now()): number {
  return scartoOrologio === null ? adesso : adesso - scartoOrologio;
}

/** Cambia quando l'orologio del browser salta: chi ha costruito qualcosa
 *  sull'ora di prima (le mini tendenze) lo rifà. */
export function epocaOrologio(): number {
  return epoca;
}

/** Per i test: l'orologio del server torna sconosciuto. */
export function azzeraOrologio(): void {
  scartoOrologio = null;
  riferimento = null;
}

function etaAdesso(adesso: number): number {
  if (giuDa !== null) return etaAllaCaduta + (adesso - giuDa);
  return adesso - misuratoIl > RITARDO_MS ? 0 : etaMs;
}

function aggiornaRitardo(adesso = Date.now()): void {
  const eta = etaAdesso(adesso);
  const nuovo = eta > RITARDO_MS ? Math.round(eta / 1000) : null;
  const serveOrologio = giuDa !== null || nuovo !== null;
  if (serveOrologio && orologio === null) orologio = setInterval(() => aggiornaRitardo(), 1000);
  if (!serveOrologio && orologio !== null) {
    clearInterval(orologio);
    orologio = null;
  }
  if (nuovo === ritardoS) return;
  ritardoS = nuovo;
  for (const f of ascoltatori) f();
}

/** La misura riparte da capo: il socket si è appena aperto, ed è una
 *  connessione nuova con un suo scarto; o non c'è un socket da misurare,
 *  perché nessuno è entrato. */
export function ricominciaMisura(): void {
  tsDelta = null;
  tsSnapshot = null;
  scarto = null;
  deltaVisto = false;
  riferimento = null;
  etaMs = 0;
  misuratoIl = 0;
  giuDa = null;
  etaAllaCaduta = 0;
  aggiornaRitardo();
}

/** Il socket è chiuso o in riconnessione. Vale il primo istante: i tentativi
 *  che falliscono non lo spostano in avanti. */
export function segnaScollegato(): void {
  if (giuDa !== null) return;
  const adesso = Date.now();
  etaAllaCaduta = etaAdesso(adesso);
  giuDa = adesso;
  aggiornaRitardo(adesso);
}

function iscriviRitardo(f: () => void): () => void {
  ascoltatori.add(f);
  return () => { ascoltatori.delete(f); };
}

/** I secondi di ritardo da mostrare nella fascia, o `null`. */
export function useDatiInRitardo(): number | null {
  return useSyncExternalStore(iscriviRitardo, () => ritardoS);
}
