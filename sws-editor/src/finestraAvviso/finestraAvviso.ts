/** La «Finestra di avviso» (piano docs/archive/2026-11-04-finestra-di-avviso.md,
 *  sessione F1): un'area al centro della pagina al posto di `alert`, `confirm`
 *  e `prompt` del browser, che sembrano errori e di cui la gente diffida.
 *
 *  Sono funzioni di modulo e non hook perché le chiama anche codice fuori da
 *  React (lo store). Ognuna mette una richiesta in coda e restituisce una
 *  Promise; l'host (`FinestraAvviso.tsx`, montato una volta in `avvia()`)
 *  mostra la prima e la chiude con la risposta. Una richiesta alla volta,
 *  nell'ordine in cui arrivano — tranne quella aperta da dentro un `modulo`
 *  (una conferma chiesta dalla finestra delle impostazioni): quella va sopra
 *  di lui, e il modulo resta montato sotto, perché dentro c'è chi aspetta. */
import type { ReactNode } from "react";
// `i18next` e non `@/i18n`: questo modulo lo importa lo store (vedi `conferme428.ts`).
import i18n from "i18next";

export type Livello = "info" | "errore";

export interface Scelta<K> {
  valore: K;
  etichetta: string;
  pericolo?: boolean;
}

interface OpzioniBase {
  titolo?: string;
  testo?: string;
}

export interface OpzioniAvviso extends OpzioniBase { livello?: Livello; ok?: string }
export interface OpzioniConferma extends OpzioniBase { pericolo?: boolean; si?: string; no?: string }
export interface OpzioniChiedi extends OpzioniBase {
  iniziale?: string;
  password?: boolean;
  /** Il messaggio d'errore da mostrare, o `null` se il valore va bene. */
  valida?: (v: string) => string | null;
  ok?: string;
  no?: string;
}
/** `no`: l'etichetta di Annulla. Il viewer la passa nella lingua dei contenuti
 *  (`testoSistema`), come le altre etichette del pannello (F3). */
export interface OpzioniScegli<K> extends OpzioniBase { scelte: Scelta<K>[]; no?: string }
export interface OpzioniModulo<T> {
  titolo: string;
  corpo: (fine: (v: T | null) => void) => ReactNode;
  /** Esc e la ✕ chiudono con `null`; `false` per un modulo che va finito. */
  chiudibile?: boolean;
}

/** Una richiesta in coda, come la vede l'host. `sopra`: il modulo da cui è
 *  stata aperta, che resta visibile sotto di lei. */
export type Richiesta =
  | ({ id: number; sopra?: number; tipo: "avviso" } & OpzioniAvviso)
  | ({ id: number; sopra?: number; tipo: "conferma" } & OpzioniConferma)
  | ({ id: number; sopra?: number; tipo: "chiedi" } & OpzioniChiedi)
  | ({ id: number; sopra?: number; tipo: "scegli" } & OpzioniScegli<unknown>)
  | ({ id: number; sopra?: number; tipo: "modulo" } & OpzioniModulo<unknown>);

type InCoda = { richiesta: Richiesta; fine: (v: unknown) => void };

let coda: InCoda[] = [];
let prossimoId = 1;
/** Quello che si vede, dal basso verso l'alto: la richiesta attiva e i moduli
 *  da cui discende. Ricalcolata a ogni cambio, così l'host riceve lo stesso
 *  oggetto finché niente cambia (`useSyncExternalStore` lo chiede). */
let catena: Richiesta[] = [];
const ascoltatori = new Set<() => void>();
const avvisa = () => {
  const attiva = coda[0]?.richiesta;
  const c: Richiesta[] = attiva ? [attiva] : [];
  while (c[0]?.sopra !== undefined) {
    const madre = coda.find((x) => x.richiesta.id === c[0].sopra)?.richiesta;
    if (!madre) break;
    c.unshift(madre);
  }
  catena = c;
  ascoltatori.forEach((f) => f());
};

/** Per l'host: la coda e come seguirla (`useSyncExternalStore`). */
export function iscriviti(f: () => void): () => void {
  ascoltatori.add(f);
  return () => { ascoltatori.delete(f); };
}
/** Le finestre da disegnare, dal basso verso l'alto; l'ultima è quella attiva. */
export function finestreAperte(): Richiesta[] {
  return catena;
}
export function richiestaAperta(): Richiesta | null {
  return coda[0]?.richiesta ?? null;
}
/** Chiude la richiesta `id` con il suo valore; quella dopo diventa visibile. */
export function rispondiA(id: number, valore: unknown): void {
  const i = coda.findIndex((c) => c.richiesta.id === id);
  if (i < 0) return;
  const [c] = coda.splice(i, 1);
  coda = [...coda];
  avvisa();
  c.fine(valore);
}

/** Chiude tutte le richieste aperte come annullate (per i test, fra uno e l'altro). */
export function svuotaCoda(): void {
  const tutte = coda;
  coda = [];
  avvisa();
  for (const c of tutte) {
    const t = c.richiesta.tipo;
    c.fine(t === "avviso" ? undefined : t === "conferma" ? false : null);
  }
}

// ── Le risposte automatiche, per i test ──────────────────────────────────────

type Risposta = unknown | ((r: Richiesta) => unknown);
let automatica: { risposta: Risposta; chiamate: Richiesta[] } | null = null;

/** Per vitest, al posto di `vi.spyOn(window, "confirm")`: da qui in poi ogni
 *  richiesta si chiude subito con `risposta` (o con quello che restituisce,
 *  se è una funzione), senza disegnare niente. `chiamate` le raccoglie, per
 *  controllarne il testo. `ferma()` torna al comportamento normale. */
export function rispondi(risposta: Risposta): { chiamate: Richiesta[]; ferma: () => void } {
  const chiamate: Richiesta[] = [];
  automatica = { risposta, chiamate };
  return { chiamate, ferma: () => { automatica = null; } };
}

// ── Il registro (07-11-2026) ────────────────────────────────────────────────

/** Una riga per il registro: cosa è comparso a video e, per le domande, cosa
 *  si è risposto. */
export interface RigaRegistro { livello: "info" | "errore"; testo: string; dove: string }
let registro: ((r: RigaRegistro) => void) | null = null;

/** Chi scrive nel registro i messaggi della finestra: lo registra `avvia()`
 *  (qui non si importa il client, che importa lo store, che importa questo
 *  modulo). `null` per smettere. */
export function registraNelLog(f: ((r: RigaRegistro) => void) | null): void {
  registro = f;
}

/** Il testo di una richiesta in una riga: titolo e testo, senza a capo. */
function inUnaRiga(r: OpzioniBase): string {
  return [r.titolo, r.testo].filter(Boolean).join(" — ").replace(/\s*\n\s*/g, " · ");
}

/** Cosa va nel registro e quando: l'avviso quando compare, la domanda quando
 *  ha una risposta. `chiedi` no — può essere una password — e `modulo` no. */
function registra(richiesta: Richiesta, p: Promise<unknown>): void {
  if (!registro) return;
  const scrivi = registro;
  if (richiesta.tipo === "avviso") {
    scrivi({ livello: richiesta.livello === "errore" ? "errore" : "info", testo: inUnaRiga(richiesta), dove: "avviso" });
  } else if (richiesta.tipo === "conferma") {
    void p.then((v) => scrivi({ livello: "info", testo: `${inUnaRiga(richiesta)} → ${i18n.t(v ? "logRemoto.rispostaSi" : "logRemoto.rispostaNo")}`, dove: "conferma" }));
  } else if (richiesta.tipo === "scegli") {
    void p.then((v) => {
      const scelta = richiesta.scelte.find((c) => c.valore === v)?.etichetta ?? i18n.t("logRemoto.rispostaAnnullata");
      scrivi({ livello: "info", testo: `${inUnaRiga(richiesta)} → ${scelta}`, dove: "scelta" });
    });
  }
}

function apri<T>(r: Omit<Richiesta, "id">): Promise<T> {
  const richiesta = { ...r, id: prossimoId++ } as Richiesta;
  const p = metti<T>(richiesta);
  registra(richiesta, p);
  return p;
}

function metti<T>(richiesta: Richiesta) {
  if (automatica) {
    automatica.chiamate.push(richiesta);
    const v = typeof automatica.risposta === "function"
      ? (automatica.risposta as (r: Richiesta) => unknown)(richiesta)
      : automatica.risposta;
    return Promise.resolve(v as T);
  }
  return new Promise<T>((risolvi) => {
    const voce = { richiesta, fine: risolvi as (v: unknown) => void };
    // Chiesta da dentro un modulo aperto: davanti a tutte, sopra di lui.
    const cima = coda[0]?.richiesta;
    if (cima?.tipo === "modulo") {
      richiesta.sopra = cima.id;
      coda = [voce, ...coda];
    } else {
      coda = [...coda, voce];
    }
    avvisa();
  });
}

// ── Le cinque funzioni ───────────────────────────────────────────────────────

/** Al posto di `alert`: un messaggio e un bottone. */
export function avviso(o: OpzioniAvviso | string): Promise<void> {
  return apri<void>({ tipo: "avviso", ...(typeof o === "string" ? { testo: o } : o) });
}

/** Al posto di `confirm`. Con `pericolo` il bottone dell'azione è rosso e il
 *  predefinito è Annulla: Invio non la esegue finché il fuoco non è su di lei. */
export function conferma(o: OpzioniConferma | string): Promise<boolean> {
  return apri<boolean>({ tipo: "conferma", ...(typeof o === "string" ? { testo: o } : o) });
}

/** Al posto di `prompt`: `null` se si annulla. */
export function chiedi(o: OpzioniChiedi | string): Promise<string | null> {
  return apri<string | null>({ tipo: "chiedi", ...(typeof o === "string" ? { testo: o } : o) });
}

/** Una scelta fra più di due strade: `null` se si annulla. */
export function scegli<K>(o: OpzioniScegli<K>): Promise<K | null> {
  return apri<K | null>({ tipo: "scegli", ...o } as Omit<Richiesta, "id">);
}

/** Un modulo qualsiasi dentro la stessa cornice: `corpo` riceve `fine`. */
export function modulo<T>(o: OpzioniModulo<T>): Promise<T | null> {
  return apri<T | null>({ tipo: "modulo", ...o } as Omit<Richiesta, "id">);
}
