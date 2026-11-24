// Il protocollo di `/ws/ai`. Rispecchia i messaggi costruiti in
// `sws-web/src/ai/mod.rs`: se cambia lì, cambia qui — sono due elenchi che
// devono restare d'accordo, e non c'è una guardia che lo verifichi.

import type { AiErrorCode } from "@/ai/errorCodes";
import type { DescrizioneSimbolo, FaceplateDef, ProjectInfo, SynopticPage } from "@/types";
import type { RichiestaFoto } from "@/ai/fotoDalBrowser";
import type { ProposalImage } from "@/ai/proposalImages";
import type { Planimetria } from "@/planimetrie/modello";

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
/** The sheet of a symbol (`symbol_sheet.rs`): what the interview of the
 *  symbol editor's assistant decided, corrected and confirmed by the person. */
export interface SymbolSheet {
  name: string;
  category?: string;
  size: { w: number; h: number };
  style: "vector" | "photo" | "mixed";
  state_colors?: boolean;
  inputs: { id: string; type: "bool" | "number" | "states"; min?: number; max?: number; unit?: string; states?: string[] }[];
  photo?: {
    description: string;
    varies_with?: { input: string; mode: "on_off" | "states" | "steps"; steps?: { min: number; max: number; description: string }[] };
  };
  parts: { id: string; what: string; motion?: string; input?: string }[];
  ports: { id: string; side: "left" | "right" | "top" | "bottom" }[];
  effects: { kind: "flame" | "smoke" | "glow" | "bubbles"; part: string; input: string;
    when?: { op: string; value: number }; level?: { min: number; max: number }; color?: string }[];
}

/** A photo attached to a question: JPEG reduced to 1024 px, base64. */
export interface AttachedPhoto { media_type: string; data: string }

export type MsgIn =
  | { t: "pronto"; modello: string; attivo: boolean; motivo?: string | null;
      /** Lo stesso id della conversazione ritrovata sul server dopo una
       *  riconnessione (10-11-2026): storia, spesa e banco ci sono ancora. */
      ripresa?: boolean; speso?: number; tetto?: number | null;
      /** Who answers: `local` costs nothing, and its spending is not shown. */
      fornitore?: string }
  | { t: "testo"; delta: string }
  | { t: "pensiero"; delta: string }
  | { t: "strumento"; nome: string; stato: "inizio" | "scrivo" | "eseguo" | "fatto" | "errore"; messaggio?: string;
      /** Con `scrivo`: quanto input ha scritto finora il modello, e da quanti secondi. */
      byte?: number; secondi?: number }
  /** The symbol editor's assistant proposes a drawing for the open symbol
   *  (23-11-2026): the description, compiled, with «Apply». */
  | { t: "symbol_proposal"; id: string; reason: string; symbol: DescrizioneSimbolo; svg: string }
  /** The sheet the interview made, for the person to correct and confirm. */
  | { t: "symbol_sheet"; id: string; sheet: SymbolSheet }
  | { t: "proposta"; id: string; motivo: string;
      project?: ProjectInfo | null; pages?: SynopticPage[] | null;
      impronta?: string | null; giudizio: Giudizio;
      /** I simboli disegnati che la proposta porta nel progetto, già compilati:
       *  il diff ne mostra la miniatura. One drawn as free SVG (G3) is here
       *  too, with its `custom:` id. */
      simboli?: { slug: string; it: string; en: string; svg: string; symbol_id?: string }[];
      /** Gli sfondi generati che le pagine della proposta usano (F6): JPEG in
       *  base64, da scrivere in images/ del progetto quando si applica. Since
       *  G2 also the drawing of a floor plan, as SVG text. */
      sfondi?: ProposalImage[];
      /** The floor plans the proposed pages are drawn on (G2), whole: written
       *  in planimetrie/ at Save. */
      floor_plans?: Planimetria[];
      /** The ids of `floor_plans` that already have a file in the project:
       *  Save replaces it, and the diff says changed instead of new. */
      replaced_floor_plans?: string[];
      /** I faceplate nuovi o cambiati (06-11-2026), interi. */
      faceplates?: FaceplateDef[] | null }
  /** Una bozza di simbolo appena disegnata dall'assistente. */
  | { t: "simbolo"; slug: string; it: string; en: string; svg: string }
  /** Questions before working (`fai_domande`, 20-11-2026), and the steps the
   *  work would be split into. */
  | { t: "domande"; domande: { testo: string; scelte: string[] }[]; piano: string[] }
  /** A floor plan the assistant has just drawn (G2): the flat drawing. */
  | { t: "floor_plan"; id: string; name: string; svg: string }
  /** Un'istantanea del pannello che l'assistente ha scattato: la vede anche chi chatta. */
  | { t: "immagine"; png: string; testo?: string }
  /** Il server chiede la foto di una pagina di un progetto web (10-11-2026):
   *  la fa questo browser, e risponde con `foto`. */
  | ({ t: "fotografa"; id: string } & RichiestaFoto)
  /** Uno sfondo generato (F6): una base candidata, o una variante di luce. */
  /** Dal 20-11-2026 con la misura e il verso; `twin_of`: è la gemella (l'altro
   *  verso) di quella base o variante, e si sceglie con lei. */
  | { t: "sfondo"; id: string; base: boolean; luce?: string | null; approvata: boolean; jpg: string;
      w?: number; h?: number; facing?: "landscape" | "portrait"; twin_of?: string | null }
  | { t: "sfondo_approvato"; id: string; ok: boolean }
  /** La spesa di un altro modello (quello dei simboli) dentro la conversazione. */
  | { t: "risorse_extra"; costo: number; speso: number; chi: string }
  /** `codice`: an error the IDE says in its language (`ai/errorCodes.ts`). */
  | { t: "errore"; messaggio: string; codice?: AiErrorCode }
  | { t: "risorse"; input: number; output: number; cache_lettura: number; cache_scrittura: number;
      /** Dollari del giro, della conversazione finora, e il tetto. */
      costo?: number; speso?: number; tetto?: number; prezzi_noti?: boolean; fornitore?: string }
  | { t: "tetto"; speso: number; tetto: number }
  | { t: "saldo"; disponibile: number }
  | { t: "fine" };

/** Quello che si manda. */
export type MsgOut =
  /** `symbol`: the symbol open in the symbol editor, with every question of
   *  its conversation (23-11-2026). */
  | { t: "chiedi"; testo: string; symbol?: DescrizioneSimbolo; photo?: AttachedPhoto; sheet?: SymbolSheet }
  | { t: "approva_sfondo"; id: string }
  /** La risposta a `fotografa`: il PNG in base64, o l'errore. */
  | { t: "foto"; id: string; png?: string; avvisi?: string[]; errore?: string };

/** Una voce del diff leggibile: `+` aggiunto, `-` tolto, `~` modificato. */
export interface VoceDiff {
  verso: "+" | "-" | "~";
  testo: string;
  /** Il diff riga per riga, quando la voce riguarda del **codice**.
   *
   *  Per un tag o un oggetto sapere *che* è cambiato basta: il pannello
   *  proprietà lo mostra. Per del Python no — «funzione modificata» non dice se
   *  è stata aggiunta una riga o riscritta da capo, e chi approva non ha modo di
   *  accorgersi che metà del corpo è sparita. */
  righe?: RigaDiff[];
  /** Nota sul diff delle righe (troncato, o non calcolato perché troppo grande). */
  righeNota?: string;
}

/** Una riga del diff di codice. Rispecchia `@/ai/diffRighe`. */
export interface RigaDiff { verso: "+" | "-" | " "; testo: string }

/** Una riga della conversazione, come la mostra il pannello. */
export type Riga =
  | { tipo: "utente"; testo: string; photo?: string }
  /** The sheet in the chat, editable until it is confirmed. */
  | { tipo: "symbol_sheet"; id: string; sheet: SymbolSheet; confirmed: boolean }
  /** The questions of the assistant, with the answers being written; `inviate`
   *  once sent, and then read only. */
  | { tipo: "domande"; domande: { testo: string; scelte: string[] }[]; piano: string[]; risposte: string[]; inviate: boolean }
  | { tipo: "assistente"; testo: string }
  | { tipo: "strumento"; nome: string; stato: string; messaggio?: string; byte?: number; secondi?: number }
  | { tipo: "sfondo"; id: string; base: boolean; luce?: string | null; approvata: boolean; jpg: string;
      w?: number; h?: number; facing?: "landscape" | "portrait"; twin_of?: string | null }
  | { tipo: "proposta"; msg: Extract<MsgIn, { t: "proposta" }>;
      /** Il diff calcolato quando la proposta è arrivata, e congelato lì:
       *  ricalcolarlo dopo l'applicazione lo farebbe sparire.
       *
       *  `null` = **non ancora noto**, e va tenuto distinto da `[]`, che
       *  significa «nessuna modifica». Da quando la chat può vivere in una
       *  finestra separata il calcolo è asincrono (lo fa l'editor, via ponte) e
       *  può anche fallire: mostrare «questa proposta non cambia niente» davanti
       *  a una proposta che cambia il progetto è il difetto più pericoloso di
       *  tutto il pezzo. */
      diff: VoceDiff[] | null;
      /** Perché il diff non c'è. Presente solo con `diff === null` a calcolo
       *  concluso; finché è assente e `diff` è `null`, si sta calcolando. */
      diffErrore?: string;
      esito?: "applicata" | "scartata" | "rifiutata"; nota?: string;
      /** Il motivo del rifiuto, non tradotto: con `storeErr.projectChanged` si
       *  offre «Applica comunque». */
      motivoRifiuto?: string }
  | { tipo: "errore"; testo: string }
  | { tipo: "simbolo"; slug: string; nome: string; svg: string }
  /** A drawing proposed for the open symbol, and what became of it. */
  | { tipo: "symbol_proposal"; msg: Extract<MsgIn, { t: "symbol_proposal" }>;
      esito?: "applicata" | "scartata" | "rifiutata"; nota?: string }
  | { tipo: "floor_plan"; id: string; name: string; svg: string }
  | { tipo: "immagine"; png: string; testo?: string };
