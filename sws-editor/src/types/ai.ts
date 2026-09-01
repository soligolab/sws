// Il protocollo di `/ws/ai`. Rispecchia i messaggi costruiti in
// `sws-web/src/ai/mod.rs`: se cambia lì, cambia qui — sono due elenchi che
// devono restare d'accordo, e non c'è una guardia che lo verifichi.

import type { ProjectInfo, SynopticPage } from "@/types";

/** Un rilievo della validazione, come lo produce `sws-web/src/validate.rs`. */
export interface Rilievo {
  severity: "error" | "warning";
  /** Percorso puntato, es. `pages[Indicatori].objects[btn].write_value`. */
  path: string;
  message: string;
  hint?: string;
  /** C'era già prima della proposta: non è colpa di questa modifica. */
  preesistente?: boolean;
}

export interface Giudizio {
  ok: boolean;
  errori_nuovi: number;
  rilievi_nuovi: number;
  rilievi: Rilievo[];
}

/** Quello che arriva dal runtime. */
export type MsgIn =
  | { t: "pronto"; modello: string; attivo: boolean; motivo?: string | null }
  | { t: "testo"; delta: string }
  | { t: "pensiero"; delta: string }
  | { t: "strumento"; nome: string; stato: "inizio" | "eseguo" | "fatto" | "errore"; messaggio?: string }
  | { t: "proposta"; id: string; motivo: string;
      project?: ProjectInfo | null; pages?: SynopticPage[] | null;
      impronta?: string | null; giudizio: Giudizio }
  | { t: "errore"; messaggio: string }
  | { t: "fine" };

/** Quello che si manda. */
export type MsgOut = { t: "chiedi"; testo: string };

/** Una voce del diff leggibile: `+` aggiunto, `-` tolto, `~` modificato. */
export interface VoceDiff { verso: "+" | "-" | "~"; testo: string }

/** Una riga della conversazione, come la mostra il pannello. */
export type Riga =
  | { tipo: "utente"; testo: string }
  | { tipo: "assistente"; testo: string }
  | { tipo: "strumento"; nome: string; stato: string; messaggio?: string }
  | { tipo: "proposta"; msg: Extract<MsgIn, { t: "proposta" }>;
      /** Il diff calcolato quando la proposta è arrivata, e congelato lì:
       *  ricalcolarlo dopo l'applicazione lo farebbe sparire. */
      diff: VoceDiff[];
      esito?: "applicata" | "scartata" | "rifiutata"; nota?: string }
  | { tipo: "errore"; testo: string };
