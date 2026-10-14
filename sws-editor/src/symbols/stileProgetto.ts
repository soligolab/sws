// Lo stile dei simboli del progetto (`project.symbol_style`, Fase 4 del piano
// docs/plans/2026-10-14-motore-simboli-lib.md) e la regola che lo combina con
// l'oggetto e col disegno: **oggetto → progetto → disegno**. La stessa regola è
// in `sws-core/src/stile_simboli.rs` per il pannello; i casi stanno in
// `tests/fixtures/stile-effettivo.json`.
//
// Lo stile del progetto vive anche qui, fuori dallo store, perché lo legge
// `coloreEffettivo`, che è una funzione pura chiamata da ovunque (canvas,
// pannello proprietà, creazione): lo store lo aggiorna a ogni progetto letto.

import { useSyncExternalStore } from "react";
import type { StileSimbolo } from "./lib/applicaStile";
import type { SynopticObject } from "@/types";

export interface StileSimboliProgetto {
  state_off_color?: string;
  state_on_color?: string;
  state_alarm_color?: string;
  /** Materiale della libreria → `#rrggbb`: solo quelli cambiati. */
  materials?: Record<string, string>;
  volume?: number;
  outline_color?: string;
  outline_width?: number;
  spin_s?: number;
  blink_ms?: number;
  level_transition_ms?: number;
}

export const CONTORNO_DISEGNO = "#1c2329";

let corrente: StileSimboliProgetto | undefined;
const ascoltatori = new Set<() => void>();
let giro = 0;

export function impostaStileProgetto(s: StileSimboliProgetto | undefined) {
  if (s === corrente) return;
  corrente = s;
  giro += 1;
  for (const a of ascoltatori) a();
}

export function stileProgetto(): StileSimboliProgetto | undefined {
  return corrente;
}

export function useStileProgetto(): StileSimboliProgetto | undefined {
  useSyncExternalStore((a) => { ascoltatori.add(a); return () => { ascoltatori.delete(a); }; }, () => giro, () => giro);
  return corrente;
}

/** Le sovrascritture che un oggetto può fare (M7). */
export type SovrascrittureSimbolo = Pick<SynopticObject,
  "symbol_body_color" | "symbol_content_color" | "symbol_volume" | "symbol_outline_color" | "symbol_outline_width">;

/** Il materiale che `symbol_content_color` ritinge: il contenuto dei serbatoi. */
export const MATERIALE_CONTENUTO = "liquid";

export function stileEffettivo(
  materialiDisegno: Record<string, string>,
  materialeCorpo: string,
  progetto: StileSimboliProgetto | undefined,
  oggetto: SovrascrittureSimbolo,
  corpoStato: string | null,
): StileSimbolo {
  const materials = { ...materialiDisegno, ...(progetto?.materials ?? {}) };
  if (oggetto.symbol_body_color) materials[materialeCorpo] = oggetto.symbol_body_color;
  if (oggetto.symbol_content_color) materials[MATERIALE_CONTENUTO] = oggetto.symbol_content_color;
  const volume = Math.min(100, Math.max(0, oggetto.symbol_volume ?? progetto?.volume ?? 100));
  return {
    materials,
    volume,
    outline: {
      color: oggetto.symbol_outline_color ?? progetto?.outline_color ?? CONTORNO_DISEGNO,
      width: oggetto.symbol_outline_width ?? progetto?.outline_width ?? 1,
    },
    body: corpoStato,
  };
}

/** I tempi delle animazioni: oggetto → progetto → predefinito. */
export function animazioniEffettive(obj: SynopticObject, progetto: StileSimboliProgetto | undefined) {
  return {
    spinS: obj.symbol_spin_s ?? progetto?.spin_s ?? 2,
    blinkMs: obj.symbol_blink_ms ?? progetto?.blink_ms ?? 800,
    livelloMs: obj.symbol_level_transition_ms ?? progetto?.level_transition_ms ?? 0,
  };
}
