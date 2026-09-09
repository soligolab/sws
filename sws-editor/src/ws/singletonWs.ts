// Un socket per canale, per tutta l'applicazione.
//
// I tre flussi (tag, allarmi, log) avevano ciascuno la stessa dozzina di righe:
// un `ReconnectingWs` a livello di modulo, ricreato quando cambia il token — la
// URL porta il token, quindi un socket aperto con quello vecchio va chiuso — e
// distrutto al logout. Tre copie di un ciclo di vita sottile sono tre posti in
// cui la stessa correzione va fatta tre volte (revisione 2026-09-09).
//
// La `chiave` è ciò che rende diverso il socket da aprire: sempre il token,
// più quello che il canale aggiunge (per i tag: se si è collegati a un runtime
// remoto, perché l'URL cambia).

import { getAuthToken } from "@/api/client";
import { ReconnectingWs } from "@/ws/reconnectingWs";

export interface SocketCondiviso {
  /** Il socket per la chiave corrente; ne apre uno nuovo se la chiave è cambiata. */
  prendi(chiaveExtra?: string): ReconnectingWs;
  /** Il socket aperto adesso, se c'è — per chi vuole scrivere senza aprirne uno. */
  corrente(): ReconnectingWs | null;
  /** Chiude e dimentica: al logout, o quando il canale non serve più. */
  chiudi(): void;
}

export function socketCondiviso(costruisciUrl: () => string): SocketCondiviso {
  let rws: ReconnectingWs | null = null;
  let chiave: string | null = null;

  return {
    prendi(chiaveExtra = "") {
      const k = `${getAuthToken() ?? ""}|${chiaveExtra}`;
      if (rws && chiave !== k) {
        rws.destroy();
        rws = null;
      }
      if (!rws) {
        chiave = k;
        rws = new ReconnectingWs(costruisciUrl);
      }
      return rws;
    },
    corrente() {
      return rws;
    },
    chiudi() {
      rws?.destroy();
      rws = null;
      chiave = null;
    },
  };
}
