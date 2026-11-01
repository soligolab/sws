// I tag di un oggetto, tipo per tipo (01-11-2026, piano
// docs/archive/2026-11-01-pannello-proprieta-per-frequenza.md, fase 2).
//
// Prima i campi tag stavano sparsi in tre rami e cinque sezioni: sul simbolo
// lo stato in testa a «Parametri», la rotazione più in basso fra i colori, il
// tag di stato nella qualità, la visibilità in Layer, il movimento in
// «Animazione». Il maintainer: «vorrei che i campi dei tag associati a funzioni
// (dati in ingresso e uscita) fossero tutti vicini». Questa tabella è **la sola
// fonte** dei tag di un oggetto: la sezione «Collegamenti» li disegna tutti da
// qui, e nessun'altra sezione ne scrive uno (regola UI n. 2, provata in
// `collegamenti.test.tsx`).
//
// Restano fuori, di proposito, i tag **in lista** (linee del trend, serie,
// righe di tabella, parti del simbolo, assegnazioni): vanno con la loro
// etichetta e il loro colore, e Collegamenti ne mostra un riepilogo che porta
// lì. E i parametri delle funzioni negli eventi, che senza la funzione accanto
// non si capiscono.
import type { SynopticObject } from "@/types";
import { trovaSimboloLib } from "@/symbols/lib/libreria";

/** ← il tag si legge; → si scrive; ⇄ si legge e si scrive (un comando che
 *  mostra lo stato del suo tag). */
export type Verso = "in" | "out" | "inout";

/** I campi di `SynopticObject` che tengono un tag. */
export type CampoTag =
  | "tag" | "state_tag" | "alarm_tag" | "command_tag" | "blink_tag" | "visible_tag" | "motion_tag"
  | "symbol_spin_tag" | "pipe_flow_tag" | "gauge_sp_tag" | "slider_pv_tag" | "fill_level_tag"
  | "pipe_label_tag" | "pie_center_tag";

export interface SlotTag {
  campo: CampoTag;
  /** Cosa fa il tag, scritto: la chiave sotto `props.slot.`. */
  effetto: string;
  verso: Verso;
  /** Si mostra sempre, anche vuoto: è il tag che il tipo esiste per mostrare
   *  o comandare. Gli altri si vedono solo collegati, o col «+ Collega…». */
  principale?: boolean;
  /** Lo slot ha senso su questo oggetto (un simbolo senza rotore non gira). */
  disponibile?: (o: SynopticObject) => boolean;
  /** Si mostra anche senza tag: la modalità che lo aspetta è già accesa
   *  (lampeggio «da tag» senza il tag). */
  mostraSe?: (o: SynopticObject) => boolean;
  /** Collegando, si scrive anche questo: la modalità che rende vivo il tag. */
  alCollegare?: Partial<SynopticObject>;
  /** Scollegando, si scrive questo invece del solo campo vuoto. */
  alloScollegare?: (o: SynopticObject) => Partial<SynopticObject>;
  /** Il campo vale anche vuoto (`""`): `command_tag` presente è «il simbolo
   *  comanda», e il tag si sceglie dopo. */
  vuotoConta?: boolean;
}

/** Il simbolo di libreria ha questa parte viva? Un builtin che la libreria
 *  non sostituisce le ha tutte (vale anche per un alias, Fase 6). */
export function simboloLibHa(obj: SynopticObject, kind: "level" | "rotor"): boolean {
  const sim = obj.symbol_id ? trovaSimboloLib(obj.symbol_id) : undefined;
  return !sim || sim.parts.some((p) => p.kind === kind);
}

// ── Gli slot comuni a ogni tipo ─────────────────────────────────────────────
const VISIBILITA: SlotTag = { campo: "visible_tag", effetto: "visibilita", verso: "in" };
const MOVIMENTO: SlotTag = { campo: "motion_tag", effetto: "movimento", verso: "in" };
const LAMPEGGIO: SlotTag = {
  campo: "blink_tag", effetto: "lampeggio", verso: "in",
  mostraSe: (o) => o.blink_mode === "tag",
  alCollegare: { blink_mode: "tag" },
  alloScollegare: (o) => ({ blink_tag: undefined, blink_mode: o.blink_mode === "tag" ? undefined : o.blink_mode }),
};
const COMUNI: readonly SlotTag[] = [LAMPEGGIO, VISIBILITA, MOVIMENTO];

// ── Il tag principale, per come il tipo lo usa ──────────────────────────────
/** Il tag è il valore mostrato. */
const VALORE: SlotTag = { campo: "tag", effetto: "valore", verso: "in", principale: true };
/** Il tag è il valore mostrato **e** quello che l'operatore scrive. */
const VALORE_COMANDO: SlotTag = { campo: "tag", effetto: "valoreComando", verso: "inout", principale: true };
/** Il tag che il bottone scrive. */
const COMANDO: SlotTag = { campo: "tag", effetto: "comando", verso: "out", principale: true };
/** Dove il tag non è il dato (serie, figli, elenchi propri): alimenta solo
 *  bordo d'allarme, stale e qualità. Era il «Tag di stato» della qualità. */
const QUALITA: SlotTag = { campo: "tag", effetto: "statoQualita", verso: "in" };

const STATO: SlotTag = { campo: "state_tag", effetto: "stato", verso: "in" };
const ALLARME: SlotTag = { campo: "alarm_tag", effetto: "allarme", verso: "in" };
const LIVELLO: SlotTag = { campo: "fill_level_tag", effetto: "livello", verso: "in" };

/** Gli slot propri di ogni tipo, il principale per primo. Un tipo che manca
 *  qui ha solo quelli comuni (l'orologio, i bottoni di navigazione). */
const PROPRI: Readonly<Record<string, readonly SlotTag[]>> = {
  rect: [VALORE], ellipse: [VALORE], line: [VALORE], polyline: [VALORE], polygon: [VALORE],
  text: [VALORE],
  button: [COMANDO],
  checkbox: [VALORE_COMANDO], radio: [VALORE_COMANDO], setpoint: [VALORE_COMANDO],
  slider: [VALORE_COMANDO, { campo: "slider_pv_tag", effetto: "pv", verso: "in" }],
  gauge: [VALORE, { campo: "gauge_sp_tag", effetto: "setpoint", verso: "in" }],
  led: [VALORE], progress_bar: [VALORE], text_list: [VALORE], state_lamp: [VALORE],
  kpi_tile: [VALORE], data_log: [VALORE], sparkline: [VALORE],
  pie_chart: [QUALITA, {
    campo: "pie_center_tag", effetto: "centro", verso: "in",
    disponibile: (o) => (o.pie_mode ?? "pie") === "donut",
  }],
  bar_chart: [QUALITA], table: [QUALITA], grid: [QUALITA], faceplate: [QUALITA], image: [QUALITA],
  alarm_viewer: [QUALITA], alarm_bell: [QUALITA], alarm_banner: [QUALITA], alarm_history: [QUALITA],
  recipe_panel: [QUALITA], lang_button: [QUALITA], lang_selector: [QUALITA],
  symbol: [
    { ...STATO, principale: true },
    ALLARME,
    {
      // «Il simbolo comanda» (14-10-2026): scrive `command_tag`, non `tag` né
      // `state_tag` — un pulsante di marcia scrive START e mostra RUNNING. Si
      // parte dal tag di stato, come faceva la spunta che questo slot sostituisce.
      campo: "command_tag", effetto: "comando", verso: "out", vuotoConta: true,
      alloScollegare: () => ({
        command_tag: undefined, assegnazioni: undefined, button_mode: undefined, write_value: undefined, release_value: undefined,
      }),
    },
    {
      campo: "symbol_spin_tag", effetto: "rotazione", verso: "in",
      disponibile: (o) => simboloLibHa(o, "rotor"),
      mostraSe: (o) => o.symbol_spin === "tag",
      alCollegare: { symbol_spin: "tag" },
      alloScollegare: (o) => ({ symbol_spin_tag: undefined, symbol_spin: o.symbol_spin === "tag" ? undefined : o.symbol_spin }),
    },
    { ...LIVELLO, disponibile: (o) => simboloLibHa(o, "level") },
    QUALITA,
  ],
  pipe: [
    { ...STATO, principale: true },
    ALLARME,
    LIVELLO,
    { campo: "pipe_label_tag", effetto: "etichetta", verso: "in" },
    { campo: "pipe_flow_tag", effetto: "flusso", verso: "in", alCollegare: { pipe_flow: true } },
  ],
};

/** Tutti gli slot di un oggetto: i suoi, poi quelli comuni. */
export function slotDi(o: SynopticObject): SlotTag[] {
  return [...(PROPRI[o.type] ?? []), ...COMUNI].filter((s) => !s.disponibile || s.disponibile(o));
}

/** Lo slot è collegato (o va mostrato comunque)? */
export function slotPresente(s: SlotTag, o: SynopticObject): boolean {
  const v = o[s.campo];
  if (s.vuotoConta ? v !== undefined : !!v) return true;
  return !!s.mostraSe?.(o);
}

/** I tag in lista di un oggetto, per il riepilogo: il campo che li tiene (è
 *  anche il `data-field` dove porta il clic) e quanti tag ci sono. */
export function listeDiTag(o: SynopticObject): { campo: string; effetto: string; n: number }[] {
  const conta = (xs: { tag?: string }[] | undefined) => (xs ?? []).filter((x) => !!x.tag).length;
  const out: { campo: string; effetto: string; n: number }[] = [];
  const metti = (campo: string, effetto: string, n: number) => { if (n > 0) out.push({ campo, effetto, n }); };
  metti("trend_tags", "tracce", conta(o.trend_tags));
  metti("xy_series", "serieXy", (o.xy_series ?? []).reduce((n, s) => n + (s.tag ? 1 : 0) + (s.y_tag ? 1 : 0), 0));
  metti("bar_series", "serie", conta(o.bar_series));
  metti("pie_slices", "spicchi", conta(o.pie_slices));
  metti("table_rows", "righe", conta(o.table_rows));
  metti("symbol_parts", "parti", conta(Object.values(o.symbol_parts ?? {})));
  metti("assegnazioni", "assegnazioni", conta(o.assegnazioni));
  return out;
}
