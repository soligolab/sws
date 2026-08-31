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

/** `false` se il socket non è pronto: il chiamante lo dice all'utente invece
 *  di perdere il messaggio in silenzio. */
export function chiedi(testo: string): boolean {
  const msg: MsgOut = { t: "chiedi", testo };
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
