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
// `target` prefixed by the **device label** (18-10-2026: «nel log devo poter
// vedere anche il device con un tag apposito») — il nome con cui è registrato in
// Dispositivi, altrimenti l'host. La casella del filtro per target le isola
// scrivendo quel nome; finiscono anche nell'esportazione del log, che è lo
// stesso elenco. Il dispositivo manda solo da INFO in su (`ws_logs_dispositivo`).

import { useEffect } from "react";
import { api, getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";
import { ReconnectingWs } from "@/ws/reconnectingWs";

let rws: ReconnectingWs | null = null;

/** L'etichetta delle righe del dispositivo: il nome registrato in Dispositivi
 *  per quell'indirizzo, altrimenti il pannello di un indirizzo del cloud
 *  (`…/dev/<pannello>`), altrimenti l'host. */
export function etichettaDispositivo(url: string | null, registrati: { label?: string; url: string }[]): string {
  if (!url) return "remote";
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const reg = registrati.find((d) => norm(d.url) === norm(url) && d.label?.trim());
  if (reg?.label) return reg.label.trim();
  try {
    const u = new URL(url);
    const dev = u.pathname.split("/").filter(Boolean);
    const i = dev.indexOf("dev");
    if (i >= 0 && dev[i + 1]) return decodeURIComponent(dev[i + 1]);
    return u.hostname || "remote";
  } catch {
    return "remote";
  }
}

function buildRemoteLogsUrl(debug: boolean): string {
  const scheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host   = typeof window !== "undefined" ? window.location.host : "localhost";
  const token  = getAuthToken();
  const q = new URLSearchParams();
  if (token) q.set("token", token);
  // Il relay lo rispetta solo per un amministratore di piattaforma.
  if (debug) q.set("livello", "debug");
  const qs = q.toString();
  return `${scheme}://${host}/ws/remote/logs${qs ? `?${qs}` : ""}`;
}

export function useRemoteLogStream(): void {
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl        = useAppStore((s) => s.remoteUrl);
  const debug            = useAppStore((s) => s.logDispositivoDebug);
  const appendLog        = useAppStore((s) => s.appendLog);

  useEffect(() => {
    if (!remoteConnected) {
      rws?.destroy();
      rws = null;
      return;
    }

    rws = new ReconnectingWs(() => buildRemoteLogsUrl(debug));
    const stream = rws;
    let etichetta = etichettaDispositivo(remoteUrl, []);
    api.listDevices()
      .then((l) => { etichetta = etichettaDispositivo(remoteUrl, l as { label?: string; url: string }[]); })
      .catch(() => { /* resta l'host */ });

    const onMessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as LogEvent;
        if (event?.ts_ms === undefined || !event?.level) return;
        // Il dispositivo filtra già; un pannello di prima manderebbe tutto.
        if (!debug && /^(TRACE|DEBUG)$/i.test(event.level)) return;
        appendLog({ ...event, target: `${etichetta}:${event.target}` });
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
  }, [remoteConnected, remoteUrl, debug, appendLog]);
}
