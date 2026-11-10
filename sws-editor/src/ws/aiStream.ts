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

import { getAuthToken } from "@/api/client";
import { buildWsUrl } from "@/ws/wsUrl";
import { ReconnectingWs } from "@/ws/reconnectingWs";
import { nuovoId } from "@/ai/ponte";
import type { MsgIn, MsgOut } from "@/types/ai";

let rws: ReconnectingWs | null = null;
let currentToken: string | null = null;
let conversazione = nuovoId();

/** L'id della conversazione di adesso. */
export function idConversazione(): string {
  return conversazione;
}

/** L'indirizzo del socket con l'id della conversazione: `?` o `&` secondo se
 *  l'indirizzo ha già una query (il token, sul relay). */
export function urlConConversazione(url: string, id: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}conv=${encodeURIComponent(id)}`;
}

export function aiStream(): ReconnectingWs {
  const token = getAuthToken();
  if (rws && currentToken !== token) {
    rws.destroy();
    rws = null;
  }
  if (!rws) {
    currentToken = token;
    // L'id si legge a ogni apertura: le riconnessioni portano quello di
    // adesso, e dopo `nuovaConversazione` quello nuovo.
    rws = new ReconnectingWs(() =>
      urlConConversazione(buildWsUrl("/ws/ai", "VITE_AI_WS_URL"), conversazione));
  }
  return rws;
}

export function chiudiAiStream(): void {
  rws?.destroy();
  rws = null;
  currentToken = null;
}

/** Una conversazione nuova con la configurazione nuova (chiavi, scopi), senza
 *  staccare chi ascolta: il pannello della chat aperto riceve il «pronto» del
 *  socket nuovo. Senza un socket aperto non fa niente: il prossimo lo leggerà. */
export function riapriAiStream(): void {
  conversazione = nuovoId();
  if (rws && currentToken === getAuthToken()) rws.riapri();
  else chiudiAiStream();
}

/** «Svuota la conversazione»: un id nuovo, quindi storia, spesa e banco vuoti
 *  anche sul server. Stesso effetto di `riapriAiStream`, detto per chi lo usa. */
export function nuovaConversazione(): void {
  riapriAiStream();
}

/** `false` se il socket non è pronto: il chiamante lo dice all'utente invece
 *  di perdere il messaggio in silenzio. */
export function chiedi(testo: string): boolean {
  const msg: MsgOut = { t: "chiedi", testo };
  return aiStream().send(JSON.stringify(msg));
}

/** «Usa come base» sotto la miniatura di uno sfondo: l'approvazione la dà la
 *  persona, e il server la segna; senza, `varia_sfondo` rifiuta. */
export function approvaSfondo(id: string): boolean {
  const msg: MsgOut = { t: "approva_sfondo", id };
  return aiStream().send(JSON.stringify(msg));
}

/** La foto chiesta dal server (`fotografa`), o il motivo per cui non c'è. */
export function mandaFoto(id: string, esito: { png: string; avvisi: string[] } | { errore: string }): boolean {
  const msg: MsgOut = { t: "foto", id, ...esito };
  return aiStream().send(JSON.stringify(msg));
}

export function ascolta(fn: (m: MsgIn) => void): () => void {
  const stream = aiStream();
  const onMessage = (ev: MessageEvent) => {
    try {
      fn(JSON.parse(ev.data as string) as MsgIn);
    } catch {
      // frame malformato: ignorato, come negli altri stream
    }
  };
  stream.on("message", onMessage);
  return () => stream.off("message", onMessage);
}
