// Il ponte fra la finestra dell'editor e la chat staccata.
//
// # Il fatto che decide tutto il disegno
//
// `applyAiProposal` (`store/index.ts`) deve girare **nella finestra
// dell'editor**: scrive `pages`, `project`, `currentPageId`, azzera la selezione
// del canvas, fa `pushHistoryUnconditional` per l'undo in un passo, e registra
// le `pendingSections` che rendono l'IDE «sporco». Quelle sezioni sono
// **closure** — non serializzabili, non attraversano nessun canale, nemmeno
// volendo. Quindi la finestra staccata tiene socket, conversazione e rendering;
// l'editor tiene stato, applicazione e annullamento.
//
// **Regola d'oro**: sul ponte passa solo ciò che `structuredClone` accetta. È la
// ragione per cui le `pendingSections` non lo attraversano e non devono.
//
// # Perché `BroadcastChannel` e non `window.opener`
//
// `opener` è `null` in due dei casi che il ciclo di vita deve coprire — finestra
// riaperta da un segnalibro dopo la chiusura dell'editor, ed editor chiuso e
// riaperto — e obbligherebbe ad aprire senza `noopener` **e** a validare
// l'origin a mano: più codice, non meno.
//
// Il prezzo di `BroadcastChannel` è che è un broadcast: con due schede dell'IDE
// aperte, entrambe applicherebbero la stessa proposta. Si paga con
// l'**indirizzamento** — ogni messaggio porta `da`, ogni risposta porta `a`, e
// chi riceve scarta ciò che non è per sé. Senza quelle righe il difetto sarebbe
// silenzioso, quindi vive nel protocollo e non in un commento.
//
// # La versione sta nel nome del canale
//
// Dopo un deploy, un editor v2 e una chat v1 non si sentono **affatto** invece
// di fraintendersi: il fallimento arriva dalla via rumorosa già prevista
// («l'editor non risponde») invece che da un messaggio interpretato male.

import type { AiProposta } from "@/store";
import type { VoceDiff } from "@/types/ai";

export const CANALE = "sws.chat.ponte.v1";

/** Chiave dell'id dell'editor in `sessionStorage`.
 *
 *  `sessionStorage` e non `localStorage`, e non un id in memoria, per una
 *  ragione precisa: sopravvive a un **ricarico** della pagina ma è **per
 *  scheda**. Così l'`#e=<id>` nell'URL della chat resta valido quando l'editor
 *  viene ricaricato (altrimenti la chat resterebbe legata a un id morto e
 *  dovrebbe ri-agganciarsi al primo `editore-pronto` che passa — cioè a
 *  qualunque scheda, buttando via l'indirizzamento), e due schede dell'IDE
 *  restano due editor distinti. */
const CHIAVE_ID_EDITORE = "sws.editore.id";

export function idEditore(): string {
  try {
    const v = sessionStorage.getItem(CHIAVE_ID_EDITORE);
    if (v) return v;
    const nuovo = nuovoId();
    sessionStorage.setItem(CHIAVE_ID_EDITORE, nuovo);
    return nuovo;
  } catch {
    // sessionStorage negato (modalità privata rigida): si degrada a un id
    // volatile. Il ponte funziona finché nessuno ricarica.
    return nuovoId();
  }
}

export function nuovoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ── Il protocollo ────────────────────────────────────────────────────────────

/** Dalla chat verso l'editor. */
export type DaChat =
  /** «Sono qui, e sono legata a te». Mandato all'apertura e a ogni
   *  `editore-pronto`: è ciò che fa sapere all'editor che una chat è staccata,
   *  così non riapre il pannello (che sarebbe una seconda conversazione). */
  | { t: "ciao"; da: string; a: string }
  | { t: "diff"; da: string; a: string; rid: string; proposta: AiProposta }
  | { t: "applica"; da: string; a: string; rid: string; proposta: AiProposta }
  /** La finestra staccata si sta chiudendo: l'editor riabilita il pannello. */
  | { t: "chat-chiusa"; da: string; a: string };

/** Dall'editor verso la chat. */
export type DaEditore =
  /** Broadcast senza destinatario: l'editor è (ri)partito. */
  | { t: "editore-pronto"; da: string }
  /** Risposta a `ciao`: dice se c'è un progetto aperto e quale. */
  | { t: "stato"; da: string; a: string; progetto: string | null }
  | { t: "diff-ok"; da: string; a: string; rid: string; diff: VoceDiff[] }
  | { t: "diff-no"; da: string; a: string; rid: string; errore: string }
  | { t: "applicato"; da: string; a: string; rid: string; ok: boolean; motivo?: string; avviso?: string }
  /** Broadcast: la finestra dell'editor sta andando via. */
  | { t: "editore-chiuso"; da: string };

export type Messaggio = DaChat | DaEditore;

/** Un messaggio senza `da`, che lo mette `Ponte.manda`.
 *
 *  Distributivo (`T extends any ? … : never`) e non un `Omit<Messaggio, "da">`
 *  liscio: `Omit` su un'unione la collassa alle sole chiavi **comuni**, quindi
 *  `a`, `rid` e `proposta` sparirebbero dal tipo e ogni chiamata verrebbe
 *  rifiutata. */
export type SenzaDa<T> = T extends unknown ? Omit<T, "da"> : never;

// ── Il trasporto ─────────────────────────────────────────────────────────────

/**
 * Un capo del ponte.
 *
 * `mio` è l'id di questo capo; `manda` marca `da` da sé, così nessun chiamante
 * può dimenticarlo. `ascolta` consegna **solo** i messaggi il cui `a` è il mio,
 * più i broadcast (quelli senza `a`) — è l'indirizzamento, e sta qui e non nei
 * chiamanti perché dimenticarlo in uno dei due punti basta a far applicare una
 * proposta due volte.
 */
export class Ponte {
  private ch: BroadcastChannel | null = null;

  constructor(readonly mio: string) {
    try {
      this.ch = new BroadcastChannel(CANALE);
    } catch {
      // Browser senza BroadcastChannel: il ponte resta muto e chi lo usa
      // ricade sulla via rumorosa («l'editor non risponde»). Non si finge che
      // funzioni.
      this.ch = null;
    }
  }

  get vivo(): boolean {
    return this.ch !== null;
  }

  manda(m: SenzaDa<Messaggio>): boolean {
    if (!this.ch) return false;
    try {
      this.ch.postMessage({ ...m, da: this.mio });
      return true;
    } catch {
      // `structuredClone` ha rifiutato qualcosa: è la regola d'oro violata, e
      // va vista in sviluppo invece di sparire.
      console.error("[ponte] messaggio non clonabile", m);
      return false;
    }
  }

  /** Registra un handler; il valore restituito lo annulla. */
  ascolta(fn: (m: Messaggio) => void): () => void {
    const ch = this.ch;
    if (!ch) return () => {};
    const h = (ev: MessageEvent) => {
      const m = ev.data as Messaggio | null;
      if (!m || typeof m !== "object" || typeof (m as Messaggio).t !== "string") return;
      // Un broadcast non ha `a`: passa. Un messaggio indirizzato passa solo se
      // è per me. È la riga che impedisce alla seconda scheda dell'IDE di
      // applicare la stessa proposta.
      const a = (m as { a?: string }).a;
      if (a !== undefined && a !== this.mio) return;
      // Chi manda non riceve sé stesso in `BroadcastChannel`, ma la guardia
      // costa niente e rende il modulo provabile con due capi nello stesso
      // processo (che è come lo provano i test).
      if (m.da === this.mio) return;
      fn(m);
    };
    ch.addEventListener("message", h);
    return () => ch.removeEventListener("message", h);
  }

  chiudi(): void {
    try { this.ch?.close(); } catch { /* già chiuso */ }
    this.ch = null;
  }
}
