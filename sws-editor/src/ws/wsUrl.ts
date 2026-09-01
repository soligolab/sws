// Shared helper for building authenticated WebSocket URLs.
//
// Resolution order:
//   1. Per-stream override (`VITE_RUNTIME_WS_URL`, etc.) — full URL, takes
//      precedence so power users can pin individual streams.
//   2. localStorage runtime override (ARCH-004) — when the user has connected
//      to a remote runtime via the WelcomeScreen modal, `api.getRuntimeBaseUrl()`
//      returns its origin and we swap http→ws to derive the WS scheme.
//   3. `VITE_RUNTIME_URL` env var — build-time default (handled inside
//      `getRuntimeBaseUrl` already).
//   4. `window.location` — same-origin (Vite proxy in dev, single-binary in
//      production where the runtime itself serves the SPA).
//
// The session token is appended as `?token=...` because browsers can't set
// Authorization headers on the WebSocket upgrade handshake. The runtime's
// auth middleware accepts the token from either the header or the query
// string.

import { getAuthToken, getRuntimeBaseUrl } from "@/api/client";
import { useAppStore } from "@/store";

/**
 * I canali che, con un runtime remoto collegato, vanno **dirottati** su di esso.
 *
 * Sono i tre che mostrano lo stato *del dispositivo*: valori dei tag, allarmi,
 * log. Coincidono con la whitelist del relay lato server
 * (`remote_relay.rs`), e non è una coincidenza da rompere: se un canale
 * arrivasse qui senza essere là, il socket riceverebbe un 404 e riproverebbe
 * all'infinito.
 *
 * `/ws/ai` **non è in questo elenco, e non deve entrarci** — è Q31, e la
 * ragione non è tecnica:
 *
 * Con un runtime remoto collegato, il progetto che l'utente modifica resta
 * **quello locale**: `remote_deploy` esporta il progetto locale attivo e lo
 * carica sul device (`remote.rs`), il pull fa il verso opposto importandolo in
 * locale, e le chiamate HTTP del progetto non sanno nemmeno che esista un
 * remoto. L'assistente propone modifiche a quel progetto, quindi deve leggere
 * quello — cioè il locale. Dirottarlo sul dispositivo gli farebbe leggere una
 * copia che nessuno sta editando, e le sue proposte sarebbero contro il
 * progetto sbagliato: un difetto peggiore del 404, perché sembrerebbe
 * funzionare.
 */
const CANALI_DEL_DISPOSITIVO = ["tags", "alarms", "logs"];

export function buildWsUrl(path: string, overrideEnvKey?: string): string {
  // When a remote runtime is connected via the relay bridge, proxy the
  // device-state WS connections through the local runtime's /ws/remote/* relay.
  // This avoids CORS and self-signed cert issues on cross-origin WS upgrades.
  const remoteConnected = useAppStore.getState().remoteConnected;
  const sottocanale = path.replace(/^\/ws\//, "");
  if (remoteConnected && CANALI_DEL_DISPOSITIVO.includes(sottocanale)) {
    const sub = sottocanale;
    const scheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const host = typeof window !== "undefined" ? window.location.host : "localhost";
    const relayBase = `${scheme}://${host}/ws/remote/${sub}`;
    const token = getAuthToken();
    return token ? `${relayBase}?token=${encodeURIComponent(token)}` : relayBase;
  }

  let base: string;
  const override = overrideEnvKey
    ? (import.meta.env as Record<string, string | undefined>)[overrideEnvKey]
    : undefined;
  if (override) {
    base = override;
  } else {
    const runtimeBase = getRuntimeBaseUrl();
    if (runtimeBase) {
      base = `${runtimeBase.replace(/^http/, "ws")}${path}`;
    } else if (typeof window === "undefined") {
      base = `ws://localhost${path}`;
    } else {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      base = `${scheme}://${window.location.host}${path}`;
    }
  }
  const token = getAuthToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
