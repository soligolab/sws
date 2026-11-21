// Il manifesto della libreria di simboli (`public/symbols/lib/manifest.json`).
//
// Lo scrive `scripts/simboli/genera.py`, insieme agli SVG: qui c'è solo la sua
// forma. La stessa forma è in Rust (`sws-core/src/simboli_lib.rs`), che la usano
// il validatore e il pannello LVGL. Piano: docs/archive/2026-10-14-motore-simboli-lib.md.

export type FamigliaLib = "controls" | "process" | "electrical" | "machines" | "building" | "project";

/** Una parte viva: la geometria è in unità del viewBox del simbolo. */
export type ParteLib =
  /** Finestra del contenuto: il disegno è pieno, il motore ne mostra la parte bassa.
   *  `dir` (19-11-2026): the side the content grows from, `up` by default. */
  | { id: string; kind: "level"; x: number; y: number; w: number; h: number; dir?: FillDir }
  /** Gira attorno a (cx, cy); `symmetry` = gradi dopo cui il disegno si ripete.
   *  `ccw`: counter-clockwise (19-11-2026). */
  | { id: string; kind: "rotor"; cx: number; cy: number; symmetry: number; ccw?: boolean }
  /** Disegnata a metà scala; ruota da a0 (minimo) a a1 (massimo), in gradi orari. */
  | { id: string; kind: "needle"; cx: number; cy: number; a0: number; a1: number }
  /** Disegnata nella posizione `open`; `closed` è la rotazione della posizione chiusa.
   *
   *  `angoli` (21-10-2026) estende la leva a **N posizioni**: l'elenco degli
   *  angoli, il primo dei quali è la posizione in cui il disegno sta fermo.
   *  Assente o con meno di tre voci = leva booleana di sempre, che legge
   *  `open`/`closed` e si comporta identica. `open`/`closed` restano emessi
   *  **sempre**, anche per una leva a N: un pannello con un binario più
   *  vecchio del runtime scarica questo stesso manifesto, e un campo mancante
   *  glielo renderebbe illeggibile per intero — non «una leva in meno», ma
   *  tutti i simboli `lib:` spariti, bocche delle tubazioni comprese. */
  | { id: string; kind: "lever"; cx: number; cy: number; open: number; closed: number; angoli?: number[] }
  /** Accesa = visibile; spenta, sotto c'è la lente spenta disegnata nello strato statico. */
  | { id: string; kind: "lamp" }
  // The animated pieces (plan docs/archive/2026-11-19-animazioni-dei-simboli.md);
  // twins of `ParteLib` in `sws-core/src/simboli_lib.rs`, with the same defaults.
  /** Moves by (dx, dy) times the fraction of its input. */
  | { id: string; kind: "slide"; dx: number; dy: number; transition_ms?: number }
  /** Shakes along `axis` while its input is true: 0, +a, 0, −a. */
  | { id: string; kind: "vibrate"; amplitude?: number; axis?: "x" | "y"; period_ms?: number }
  /** Breathes (opacity down by `depth` and back) while its input is true. */
  | { id: string; kind: "pulse"; depth?: number; period_ms?: number }
  /** The colour, blink and visibility of the first entry its input matches. */
  | { id: string; kind: "signal"; color?: string; entries?: SignalEntry[] }
  /** A glow (plan 2026-11-21-simboli-fase-8-effetti): while its input is true,
   *  a blurred halo of the part's shapes, in `color` or in theirs. */
  | { id: string; kind: "glow"; color?: string; radius?: number };

export type FillDir = "up" | "down" | "left" | "right";

/** An entry of a signal: an exact `value`, or a half-open range. */
export interface SignalEntry {
  value?: boolean | number | string;
  value_min?: number;
  value_max?: number;
  color?: string;
  blink?: boolean;
  hidden?: boolean;
  /** The photo the part's images show while this entry matches (plan
   *  2026-11-21-simboli-fase-3-foto): a name in the project's `images/`. */
  image?: string;
}

/** Una bocca del disegno, dove si aggancia una tubazione (15-10-2026): in unità
 *  del viewBox, `(x, y)` è la faccia esterna della flangia, `side` il lato da cui
 *  esce il tubo, `d` il diametro del tronchetto. Gemello: `PortaLib` in
 *  `sws-core/src/simboli_lib.rs`. */
export interface PortaLib {
  id: string;
  x: number;
  y: number;
  side: "left" | "top" | "right" | "bottom";
  d: number;
}

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
  /** Le bocche; assente per i simboli senza tubi (gli elettrici). */
  ports?: PortaLib[];
  /** Il builtin che questo disegno sostituisce (alias, fase 6 del piano). */
  replaces?: string;
  /** Solo i simboli del progetto (`prj:`): le etichette, che non sono in it.json. */
  labels?: { it: string; en: string };
  /** A project symbol that is a variant of this library symbol: it is drawn
   *  in its place. Twin of `SimboloLib::overrides` in `sws-core`. */
  overrides?: string;
  /** The photos of a project symbol, as names in the project's `images/`
   *  (plan 2026-11-21-simboli-fase-3-foto). Twin of `SimboloLib::images`. */
  images?: string[];
}

export interface ManifestLib {
  /** Impronta del contenuto: va negli URL (`?v=`) perché `/symbols` non ha Cache-Control. */
  version: string;
  materials: Record<string, string>;
  symbols: SimboloLib[];
}
