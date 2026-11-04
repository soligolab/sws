// La connessione alla chat dell'assistente.
//
// Singleton come logStream/tagStream/alarmStream: la conversazione vive nel
// socket lato runtime, quindi aprire un secondo socket vorrebbe dire ricominciare
// da capo — e montare/smontare il pannello non deve costare la conversazione.
//
// Differenza dagli altri stream: qui si scrive, non solo si legge. Un socket
// caduto e riaperto riparte da zero e il pannello lo dice, invece di far
// sembrare che l'assistente abbia dimenticato.

import { getAuthToken } from "@/api/client";
import { buildWsUrl } from "@/ws/wsUrl";
import { ReconnectingWs } from "@/ws/reconnectingWs";
import type { MsgIn, MsgOut } from "@/types/ai";

let rws: ReconnectingWs | null = null;
let currentToken: string | null = null;

export function aiStream(): ReconnectingWs {
  const token = getAuthToken();
  if (rws && currentToken !== token) {
    rws.destroy();
    rws = null;
  }
  if (!rws) {
    currentToken = token;
    rws = new ReconnectingWs(() => buildWsUrl("/ws/ai", "VITE_AI_WS_URL"));
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
  if (rws && currentToken === getAuthToken()) rws.riapri();
  else chiudiAiStream();
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
