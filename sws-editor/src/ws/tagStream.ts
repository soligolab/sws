import { useEffect } from "react";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { socketCondiviso } from "@/ws/singletonWs";

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

/**
 * Send a subscription update to the server. Pass [] or ["*"] to subscribe to all tags.
 * Pass specific tag IDs to receive only those tags in delta frames.
 */
export function sendSubscribe(tags: string[]): void {
  socket.corrente()?.send(JSON.stringify({ type: "subscribe", tags }));
}

export function useTagStream(): void {
  const updateTagValue    = useAppStore((s) => s.updateTagValue);
  const authToken         = useAppStore((s) => s.authToken);
  const remoteConnected   = useAppStore((s) => s.remoteConnected);

  useEffect(() => {
    if (!authToken) {
      socket.chiudi();
      lastSeq = -1;
      return;
    }

    // getStream riapre il socket quando remoteConnected cambia (URL diversa).
    const stream = getStream(remoteConnected);

    // Both the local /ws/tags and the /ws/remote/* relay need a subscribe
    // frame to start (or resume) streaming data. Send it on every open,
    // including reconnects, and immediately if already open.
    const onOpen = () => stream.send(JSON.stringify({ type: "subscribe", tags: ["*"] }));
    stream.on("open", onOpen);
    if (stream.readyState === WebSocket.OPEN) onOpen();

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
              detail: { tag: ack.tag, error: ack.error ?? "scrittura rifiutata" },
            }));
          }
          return;
        }

        if (parsed.type === "snapshot") {
          const snap = parsed as SnapshotMsg;
          lastSeq = snap.seq;
          for (const entry of snap.tags) {
            updateTagValue(entry.id, {
              value: entry.value,
              quality: entry.quality as TagQuality,
              timestamp_ms: entry.ts,
            });
          }
          return;
        }

        if (parsed.type === "delta") {
          const delta = parsed as DeltaMsg;
          if (lastSeq >= 0 && delta.seq > lastSeq + 1) {
            console.warn(`[ws/tags] seq gap: expected ${lastSeq + 1}, got ${delta.seq}`);
          }
          lastSeq = delta.seq;
          for (const entry of delta.changed) {
            updateTagValue(entry.id, {
              value: entry.value,
              quality: entry.quality as TagQuality,
              timestamp_ms: entry.ts,
            });
          }
          return;
        }
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => {
      stream.off("open", onOpen);
      stream.off("message", onMessage);
    };
  }, [updateTagValue, authToken, remoteConnected]);
}
