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
import type { MsgIn, MsgOut } from "@/types/ai";

let rws: ReconnectingWs | null = null;
let conversazione = nuovoId();
/** L'ultimo «pronto» del socket di adesso. È uno stato (modello, chiave
 *  attiva), non un evento: chi si mette in ascolto dopo che è arrivato — il
 *  pannello che si rimonta dopo l'accesso, nella chat staccata — lo riceve
 *  subito invece di restare su «…» (10-11-2026). */
let ultimoPronto: Extract<MsgIn, { t: "pronto" }> | null = null;

const suNuova = new Set<() => void>();

/** Chi mostra la conversazione (il pannello della chat) e deve svuotarsi
 *  quando l'accesso ne sceglie una nuova: uscita o utente diverso. Restituisce
 *  la funzione che smette di ascoltare. */
export function suConversazioneNuova(fn: () => void): () => void {
  suNuova.add(fn);
  return () => { suNuova.delete(fn); };
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

// Un socket mai aperto non ha niente da rifare: il primo `aiStream()` legge il
// token di allora.
useAppStore.subscribe((st, pr) => {
  const cosa = cambioDiAccesso(
    { token: pr.authToken, utente: pr.authUser },
    { token: st.authToken, utente: st.authUser },
  );
  if (cosa === "niente") return;
  ultimoPronto = null;
  if (cosa === "nuova") {
    conversazione = nuovoId();
    for (const fn of suNuova) fn();
  }
  rws?.riapri();
});

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
  if (!rws) {
    // L'id si legge a ogni apertura: le riconnessioni portano quello di
    // adesso, e dopo `nuovaConversazione` quello nuovo.
    rws = new ReconnectingWs(() =>
      urlConConversazione(buildWsUrl("/ws/ai", "VITE_AI_WS_URL"), conversazione));
    rws.on("message", (ev: MessageEvent) => {
      const m = leggi(ev);
      if (m?.t === "pronto") ultimoPronto = m;
    });
  }
  return rws;
}

function leggi(ev: MessageEvent): MsgIn | null {
  try {
    return JSON.parse(ev.data as string) as MsgIn;
  } catch {
    // frame malformato: ignorato, come negli altri stream
    return null;
  }
}

export function chiudiAiStream(): void {
  rws?.destroy();
  rws = null;
  ultimoPronto = null;
}

/** Una conversazione nuova con la configurazione nuova (chiavi, scopi), senza
 *  staccare chi ascolta: il pannello della chat aperto riceve il «pronto» del
 *  socket nuovo. Senza un socket aperto non fa niente: il prossimo lo leggerà. */
export function riapriAiStream(): void {
  conversazione = nuovoId();
  ultimoPronto = null;
  rws?.riapri();
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
    const m = leggi(ev);
    if (m) fn(m);
  };
  // Il «pronto» già arrivato, come ripresa: per chi ascoltava già (il cassetto
  // richiuso e riaperto) i contatori restano dove sono.
  if (ultimoPronto) fn({ ...ultimoPronto, ripresa: true });
  stream.on("message", onMessage);
  return () => stream.off("message", onMessage);
}
