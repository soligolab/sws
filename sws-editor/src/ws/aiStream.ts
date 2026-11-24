// La connessione alla chat dell'assistente.
//
// Singleton come logStream/tagStream/alarmStream: la conversazione vive nel
// socket lato runtime, quindi aprire un secondo socket vorrebbe dire ricominciare
// da capo — e montare/smontare il pannello non deve costare la conversazione.
//
// Differenza dagli altri stream: qui si scrive, non solo si legge.
//
// L'id della conversazione (10-11-2026). Il socket porta
// `?conv=<uuid>`, lo stesso a ogni riconnessione: il server ci lega
// storia, spesa e banco (basi e varianti degli sfondi, bozze di simboli), così
// una finestra che si ricollega dopo mezz'ora li ritrova. Prima vivevano
// quanto il socket, e «Usa come base» dopo una riconnessione finiva su una base
// che il server non aveva più (collaudo su sws.soligo.net, progetto Montagna).
// «Svuota la conversazione» e un cambio di configurazione scelgono un id nuovo.
//
// Il token (10-11-2026). L'indirizzo del socket porta il token, quindi quando
// cambia — accesso, rinnovo, uscita — il socket va rifatto. Prima lo rifaceva
// `aiStream()` alla chiamata successiva, distruggendo l'istanza e creandone
// una nuova **senza ascoltatori**: il pannello aperto restava attaccato a
// quella morta e mostrava «…» al posto del modello finché non si ricaricava
// la pagina. Ora si riapre la stessa istanza (`riapri`: stessi ascoltatori,
// token nuovo letto da `buildWsUrl`), appena il token cambia e non alla
// prossima domanda.
//
// L'utente (10-11-2026). Una conversazione non passa da una persona
// all'altra. Lo stesso utente che rinnova la sessione o rientra tiene l'id, e
// ritrova la conversazione; l'uscita, o un utente diverso, sceglie un id nuovo
// e svuota la chat (`suConversazioneNuova`). Il server fa la stessa regola dal
// suo lato: la conversazione è di chi l'ha aperta (`ai/conversazioni.rs`).

import { useAppStore } from "@/store";
import { buildWsUrl } from "@/ws/wsUrl";
import { ReconnectingWs } from "@/ws/reconnectingWs";
import { nuovoId } from "@/ai/ponte";
import type { AttachedPhoto, MsgIn, MsgOut, SymbolSheet } from "@/types/ai";
import type { DescrizioneSimbolo } from "@/types";

// One socket per conversation (23-11-2026). Until then the window had one
// conversation, the project's, and this module was its singleton. The symbol
// editor's assistant (plan 2026-11-23-assistente-dei-simboli) has a
// conversation of its own for each symbol, next to the project's: so the
// socket became a class, and the functions below speak to the project's
// instance as before.

/** What the chat panel needs from a conversation. */
/** What a question may carry besides its text. */
export interface QuestionExtras { photo?: AttachedPhoto; sheet?: SymbolSheet }

export interface AiChannelApi {
  chiedi(testo: string, symbol?: DescrizioneSimbolo, extras?: QuestionExtras): boolean;
  approvaSfondo(id: string): boolean;
  mandaFoto(id: string, esito: { png: string; avvisi: string[] } | { errore: string }): boolean;
  ascolta(fn: (m: MsgIn) => void): () => void;
  nuovaConversazione(): void;
  suConversazioneNuova(fn: () => void): () => void;
}

/** Cosa fare quando cambiano token o utente: la regola, separata dallo store
 *  per poterla leggere (e provare) da sola. */
export function cambioDiAccesso(
  prima: { token: string | null; utente: string | null },
  dopo: { token: string | null; utente: string | null },
): "niente" | "ricollega" | "nuova" {
  if (prima.token === dopo.token && prima.utente === dopo.utente) return "niente";
  // Uscita (X → nessuno) o persona diversa (X → Y). Da nessuno a qualcuno no:
  // l'uscita ha già scelto un id nuovo.
  if (prima.utente !== null && dopo.utente !== prima.utente) return "nuova";
  return "ricollega";
}

/** L'indirizzo del socket con l'id della conversazione: `?` o `&` secondo se
 *  l'indirizzo ha già una query (il token, sul relay). */
export function urlConConversazione(url: string, id: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}conv=${encodeURIComponent(id)}`;
}

function leggi(ev: MessageEvent): MsgIn | null {
  try {
    return JSON.parse(ev.data as string) as MsgIn;
  } catch {
    // frame malformato: ignorato, come negli altri stream
    return null;
  }
}

/** The conversations of this window that have a socket or may get one: the
 *  access change below reaches all of them. */
const live = new Set<AiChannel>();

/** One conversation with the assistant and its socket. `scope` "symbol" is
 *  the symbol editor's (`/ws/ai?scope=symbol`). `onNewId` hears every id it
 *  takes after the first, to remember it. */
export class AiChannel implements AiChannelApi {
  private rws: ReconnectingWs | null = null;
  private conv: string;
  /** L'ultimo «pronto» del socket di adesso. È uno stato (modello, chiave
   *  attiva), non un evento: chi si mette in ascolto dopo che è arrivato — il
   *  pannello che si rimonta dopo l'accesso, nella chat staccata — lo riceve
   *  subito invece di restare su «…» (10-11-2026). */
  private ultimoPronto: Extract<MsgIn, { t: "pronto" }> | null = null;
  private readonly suNuova = new Set<() => void>();

  constructor(
    private readonly scope: "project" | "symbol" = "project",
    conv: string = nuovoId(),
    private readonly onNewId?: (id: string) => void,
  ) {
    this.conv = conv;
    live.add(this);
  }

  /** L'id della conversazione di adesso. */
  id(): string {
    return this.conv;
  }

  private nuovoId(): void {
    this.conv = nuovoId();
    this.onNewId?.(this.conv);
  }

  socket(): ReconnectingWs {
    if (!this.rws) {
      // L'id si legge a ogni apertura: le riconnessioni portano quello di
      // adesso, e dopo `nuovaConversazione` quello nuovo.
      this.rws = new ReconnectingWs(() => {
        const url = urlConConversazione(buildWsUrl("/ws/ai", "VITE_AI_WS_URL"), this.conv);
        return this.scope === "symbol" ? `${url}&scope=symbol` : url;
      });
      this.rws.on("message", (ev: MessageEvent) => {
        const m = leggi(ev);
        if (m?.t === "pronto") this.ultimoPronto = m;
      });
    }
    return this.rws;
  }

  /** Closes the socket; the id stays, so the server finds the conversation
   *  again at the next one. */
  close(): void {
    this.rws?.destroy();
    this.rws = null;
    this.ultimoPronto = null;
  }

  /** Not used any more: closed, and out of the access changes. */
  dispose(): void {
    this.close();
    live.delete(this);
  }

  /** Una conversazione nuova con la configurazione nuova (chiavi, scopi), senza
   *  staccare chi ascolta: il pannello della chat aperto riceve il «pronto» del
   *  socket nuovo. Senza un socket aperto non fa niente: il prossimo lo leggerà. */
  riapri(): void {
    this.nuovoId();
    this.ultimoPronto = null;
    this.rws?.riapri();
  }

  /** The token or the user changed (see `cambioDiAccesso`). */
  accesso(cosa: "ricollega" | "nuova"): void {
    this.ultimoPronto = null;
    if (cosa === "nuova") {
      this.nuovoId();
      for (const fn of this.suNuova) fn();
    }
    this.rws?.riapri();
  }

  /** «Svuota la conversazione»: un id nuovo, quindi storia, spesa e banco vuoti
   *  anche sul server. */
  nuovaConversazione(): void {
    this.riapri();
  }

  /** Chi mostra la conversazione (il pannello della chat) e deve svuotarsi
   *  quando l'accesso ne sceglie una nuova: uscita o utente diverso. */
  suConversazioneNuova(fn: () => void): () => void {
    this.suNuova.add(fn);
    return () => { this.suNuova.delete(fn); };
  }

  private send(msg: MsgOut): boolean {
    return this.socket().send(JSON.stringify(msg));
  }

  /** `false` se il socket non è pronto: il chiamante lo dice all'utente invece
   *  di perdere il messaggio in silenzio. The symbol editor sends the symbol
   *  as it is with every question. */
  chiedi(testo: string, symbol?: DescrizioneSimbolo, extras?: QuestionExtras): boolean {
    return this.send({ t: "chiedi", testo, ...(symbol ? { symbol } : {}), ...extras });
  }

  /** «Usa come base» sotto la miniatura di uno sfondo: l'approvazione la dà la
   *  persona, e il server la segna; senza, `varia_sfondo` rifiuta. */
  approvaSfondo(id: string): boolean {
    return this.send({ t: "approva_sfondo", id });
  }

  /** La foto chiesta dal server (`fotografa`), o il motivo per cui non c'è. */
  mandaFoto(id: string, esito: { png: string; avvisi: string[] } | { errore: string }): boolean {
    return this.send({ t: "foto", id, ...esito });
  }

  ascolta(fn: (m: MsgIn) => void): () => void {
    const stream = this.socket();
    const onMessage = (ev: MessageEvent) => {
      const m = leggi(ev);
      if (m) fn(m);
    };
    // Il «pronto» già arrivato, come ripresa: per chi ascoltava già (il cassetto
    // richiuso e riaperto) i contatori restano dove sono.
    if (this.ultimoPronto) fn({ ...this.ultimoPronto, ripresa: true });
    stream.on("message", onMessage);
    return () => stream.off("message", onMessage);
  }
}

// Un socket mai aperto non ha niente da rifare: il primo `socket()` legge il
// token di allora.
useAppStore.subscribe((st, pr) => {
  const cosa = cambioDiAccesso(
    { token: pr.authToken, utente: pr.authUser },
    { token: st.authToken, utente: st.authUser },
  );
  if (cosa === "niente") return;
  for (const c of live) c.accesso(cosa);
});

// ── the project's conversation: the functions of before ────────────────────

const progetto = new AiChannel("project");

export function suConversazioneNuova(fn: () => void): () => void {
  return progetto.suConversazioneNuova(fn);
}

/** L'id della conversazione di adesso. */
export function idConversazione(): string {
  return progetto.id();
}

export function aiStream(): ReconnectingWs {
  return progetto.socket();
}

export function chiudiAiStream(): void {
  progetto.close();
}

export function riapriAiStream(): void {
  progetto.riapri();
}

export function nuovaConversazione(): void {
  progetto.nuovaConversazione();
}

export function chiedi(testo: string, extras?: QuestionExtras): boolean {
  return progetto.chiedi(testo, undefined, extras);
}

export function approvaSfondo(id: string): boolean {
  return progetto.approvaSfondo(id);
}

export function mandaFoto(id: string, esito: { png: string; avvisi: string[] } | { errore: string }): boolean {
  return progetto.mandaFoto(id, esito);
}

export function ascolta(fn: (m: MsgIn) => void): () => void {
  return progetto.ascolta(fn);
}

// ── the symbol editor's conversations ───────────────────────────────────────

const symbolChannels = new Map<string, AiChannel>();
const SYMBOL_CONV_KEY = "sws.ai.symbolConversation.";

/** The conversation of the symbol `slug`: one per symbol, found again when
 *  the same symbol is opened again in this browser session (decision of the
 *  maintainer, 23-11-2026). */
export function symbolChannel(slug: string): AiChannel {
  let c = symbolChannels.get(slug);
  if (!c) {
    let conv: string | null = null;
    try { conv = sessionStorage.getItem(SYMBOL_CONV_KEY + slug); } catch { /* not remembered */ }
    const remember = (id: string) => {
      try { sessionStorage.setItem(SYMBOL_CONV_KEY + slug, id); } catch { /* not remembered */ }
    };
    c = new AiChannel("symbol", conv ?? nuovoId(), remember);
    if (!conv) remember(c.id());
    symbolChannels.set(slug, c);
  }
  return c;
}

/** The symbol editor closed: its socket goes, the conversation stays on the
 *  server under its id. */
export function releaseSymbolChannel(slug: string): void {
  symbolChannels.get(slug)?.dispose();
  symbolChannels.delete(slug);
}
