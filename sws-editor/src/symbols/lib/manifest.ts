// Il manifesto della libreria di simboli (`public/symbols/lib/manifest.json`).
//
// Lo scrive `scripts/simboli/genera.py`, insieme agli SVG: qui c'è solo la sua
// forma. La stessa forma è in Rust (`sws-core/src/simboli_lib.rs`), che la usano
// il validatore e il pannello LVGL. Piano: docs/plans/2026-10-14-motore-simboli-lib.md.

export type FamigliaLib = "process" | "electrical" | "machines" | "building";

/** Una parte viva: la geometria è in unità del viewBox del simbolo. */
export type ParteLib =
  /** Finestra del contenuto: il disegno è pieno, il motore ne mostra la parte bassa. */
  | { id: string; kind: "level"; x: number; y: number; w: number; h: number }
  /** Gira attorno a (cx, cy); `symmetry` = gradi dopo cui il disegno si ripete. */
  | { id: string; kind: "rotor"; cx: number; cy: number; symmetry: number }
  /** Disegnata a metà scala; ruota da a0 (minimo) a a1 (massimo), in gradi orari. */
  | { id: string; kind: "needle"; cx: number; cy: number; a0: number; a1: number }
  /** Disegnata nella posizione `open`; `closed` è la rotazione della posizione chiusa. */
  | { id: string; kind: "lever"; cx: number; cy: number; open: number; closed: number }
  /** Accesa = visibile; spenta, sotto c'è la lente spenta disegnata nello strato statico. */
  | { id: string; kind: "lamp" };

export interface SimboloLib {
  /** `lib:<famiglia>/<slug>` — è il `symbol_id` dell'oggetto. */
  id: string;
  /** Percorso relativo a `/symbols/lib/`. */
  file: string;
  family: FamigliaLib;
  /** Tipologia (pumps, valves, tanks…): il gruppo nel picker. */
  kind: string;
  /** Chiave i18n dell'etichetta. */
  label: string;
  viewBox: [number, number];
  /** Materiale del corpo, cioè del gruppo `body`. */
  body: string;
  materials: string[];
  parts: ParteLib[];
  /** Il builtin che questo disegno sostituisce (alias, fase 6 del piano). */
  replaces?: string;
}

export interface ManifestLib {
  /** Impronta del contenuto: va negli URL (`?v=`) perché `/symbols` non ha Cache-Control. */
  version: string;
  materials: Record<string, string>;
  symbols: SimboloLib[];
}
