import { useEffect } from "react";
import i18n from "i18next";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { socketCondiviso } from "@/ws/singletonWs";
import { accoda, ricominciaMisura, segnaScollegato } from "@/ws/coalescenza";

const socket = socketCondiviso(() => buildWsUrl("/ws/tags", "VITE_RUNTIME_WS_URL"));
/** Il socket dei tag: cambia anche quando ci si collega/scollega da un runtime
 *  remoto, perché `buildWsUrl` lo dirotta nel relay. */
function getStream(remoteConnected: boolean) {
  return socket.prendi(remoteConnected ? "remoto" : "locale");
}

// Protocol v2 types
interface TagEntry {
  id: string;
  value: number | string | boolean;
  quality: string;
  ts: number;
}

interface SnapshotMsg {
  type: "snapshot";
  tags: TagEntry[];
  seq: number;
}

interface DeltaMsg {
  type: "delta";
  changed: TagEntry[];
  seq: number;
}

interface WriteAck {
  type: "ack";
  req_id?: string | null;
  tag: string;
  ok: boolean;
  error?: string;
}

type ServerMsg = SnapshotMsg | DeltaMsg | WriteAck;

let lastSeq: number = -1;

/** Le voci vanno allo store una volta per fotogramma, non una per una. */
function accodaVoci(voci: TagEntry[], origine: "delta" | "snapshot"): void {
  accoda(voci.map((e) => [e.id, {
    value: e.value,
    quality: e.quality as TagQuality,
    timestamp_ms: e.ts,
  }] as const), origine);
}

/** Il runtime ha risposto di nuovo dopo un fermo: il socket dei tag, se è giù,
 *  si riapre adesso invece che al prossimo giro dell'attesa (fino a 30 s). */
export function riprovaFlussoTag(): void {
  socket.riprova();
}

/**
 * Send a tag write through the live /ws/tags socket if it's open.
 */
export function tryTagWriteWs(
  tag: string,
  value: number | string | boolean,
): boolean {
  const rws = socket.corrente();
  if (!rws || rws.readyState !== WebSocket.OPEN) return false;
  rws.send(JSON.stringify({ type: "write", tag, value }));
  return true;
}

/** La sottoscrizione voluta, quella che si manda a ogni apertura del socket.
 *  Prima l'apertura mandava sempre `["*"]` e la lista della pagina partiva solo
 *  quando cambiava, scartata in silenzio se il socket non era ancora aperto:
 *  dopo l'avvio, un login o una riconnessione il viewer riceveva tutti i tag
 *  (piano «viewer leggero», passo 4). L'IDE non la cambia mai. */
let sottoscrizione: readonly string[] = ["*"];

/**
 * Send a subscription update to the server. Pass [] or ["*"] to subscribe to all tags.
 * Pass specific tag IDs to receive only those tags in delta frames.
 * La lista resta: se il socket non è aperto parte alla prossima apertura.
 * Una lista uguale a quella voluta non si rimanda: il server risponde a ogni
 * subscribe con uno snapshot intero, e un progetto ricaricato uguale rifà le
 * pagine, e con esse la lista (rilievo della revisione del 09-11-2026).
 */
export function sendSubscribe(tags: string[]): void {
  if (tags.length === sottoscrizione.length && tags.every((t, i) => t === sottoscrizione[i])) return;
  sottoscrizione = [...tags];
  socket.corrente()?.send(JSON.stringify({ type: "subscribe", tags }));
}

export function useTagStream(): void {
  const authToken         = useAppStore((s) => s.authToken);
  const remoteConnected   = useAppStore((s) => s.remoteConnected);

  useEffect(() => {
    if (!authToken) {
      socket.chiudi();
      lastSeq = -1;
      ricominciaMisura();
      return;
    }

    // getStream riapre il socket quando remoteConnected cambia (URL diversa).
    const stream = getStream(remoteConnected);

    // Both the local /ws/tags and the /ws/remote/* relay need a subscribe
    // frame to start (or resume) streaming data. Send it on every open,
    // including reconnects, and immediately if already open: quella voluta,
    // non `["*"]` fisso.
    const onOpen = () => stream.send(JSON.stringify({ type: "subscribe", tags: sottoscrizione }));
    stream.on("open", onOpen);
    if (stream.readyState === WebSocket.OPEN) onOpen();

    // «Dati in ritardo» (§5-bis): un socket chiuso o in riconnessione fa
    // invecchiare i valori a schermo; uno che si apre è una connessione nuova.
    // Solo dagli eventi veri: un secondo `useTagStream` montato più tardi sullo
    // stesso socket non deve far ripartire la misura. Funzioni proprie di
    // questo effetto: `off` toglie per riferimento, e la stessa funzione
    // registrata da due `useTagStream` sparirebbe per tutti e due.
    const onAperto = () => ricominciaMisura();
    const onChiuso = () => segnaScollegato();
    stream.on("open", onAperto);
    stream.on("close", onChiuso);
    if (stream.readyState !== WebSocket.OPEN) segnaScollegato();

    const onMessage = (ev: MessageEvent) => {
      const text = typeof ev.data === "string" ? ev.data : "";
      try {
        const parsed = JSON.parse(text) as ServerMsg;

        if (parsed.type === "ack") {
          const ack = parsed as WriteAck;
          if (!ack.ok) {
            console.warn(`[ws/tags] write ${ack.tag} failed: ${ack.error ?? "?"}`);
            // F3.7: la scrittura fallita non resta muta — RuntimeView ascolta
            // e mostra un toast (prima l'unico segnale era la console).
            window.dispatchEvent(new CustomEvent("sws:write-failed", {
              detail: { tag: ack.tag, error: ack.error ?? i18n.t("ws.scritturaRifiutata") },
            }));
          }
          return;
        }

        if (parsed.type === "snapshot") {
          const snap = parsed as SnapshotMsg;
          // Sul server snapshot e delta hanno contatori diversi (`seq` e
          // `batcher_seq` in `router.rs`): dopo un subscribe il confronto dava
          // falsi «seq gap». Dopo uno snapshot il conteggio dei delta riparte.
          lastSeq = -1;
          accodaVoci(snap.tags, "snapshot");
          return;
        }

        if (parsed.type === "delta") {
          const delta = parsed as DeltaMsg;
          if (lastSeq >= 0 && delta.seq > lastSeq + 1) {
            console.warn(`[ws/tags] seq gap: expected ${lastSeq + 1}, got ${delta.seq}`);
          }
          lastSeq = delta.seq;
          accodaVoci(delta.changed, "delta");
          return;
        }
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => {
      stream.off("open", onOpen);
      stream.off("open", onAperto);
      stream.off("close", onChiuso);
      stream.off("message", onMessage);
    };
  }, [authToken, remoteConnected]);
}
