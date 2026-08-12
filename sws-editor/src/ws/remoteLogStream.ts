// Remote runtime log feed: proxies through the local backend's
// /ws/remote/logs relay (remote_relay.rs) — never a direct browser
// connection to the remote target, for the same reasons the Live tag panel
// in ConfigView.tsx already uses that relay (self-signed TLS certs the
// browser can't be told to accept, credentials that stay server-side).
//
// Deliberately a *separate* singleton from logStream.ts's local /ws/logs
// stream: `buildWsUrl` already redirects /ws/logs through this same relay
// once `remoteConnected` flips true, but only on the *next* reconnect of
// that socket — ReconnectingWs only re-resolves its URL on close/reconnect,
// not proactively when remoteConnected changes while the local socket is
// still healthy. This hook instead opens its own connection explicitly the
// moment a remote is connected, so remote log lines start flowing
// immediately rather than whenever the local stream happens to drop.
//
// Events land in the same `logs` store (LogPanel.tsx) as local ones, with
// `target` prefixed `remote:` so the existing target-filter box isolates
// them — no new UI needed.

import { useEffect } from "react";
import { getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";
import { ReconnectingWs } from "@/ws/reconnectingWs";

let rws: ReconnectingWs | null = null;

function buildRemoteLogsUrl(): string {
  const scheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host   = typeof window !== "undefined" ? window.location.host : "localhost";
  const token  = getAuthToken();
  return `${scheme}://${host}/ws/remote/logs${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

export function useRemoteLogStream(): void {
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const appendLog        = useAppStore((s) => s.appendLog);

  useEffect(() => {
    if (!remoteConnected) {
      rws?.destroy();
      rws = null;
      return;
    }

    rws = new ReconnectingWs(buildRemoteLogsUrl);
    const stream = rws;

    const onMessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as LogEvent;
        if (event?.ts_ms === undefined || !event?.level) return;
        appendLog({ ...event, target: `remote:${event.target}` });
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => {
      stream.off("message", onMessage);
      stream.destroy();
      if (rws === stream) rws = null;
    };
  }, [remoteConnected, appendLog]);
}
