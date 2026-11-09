// ── Raccolta dei tag referenziati da una pagina (F0.1, piano SCADA-widgets) ──
//
// Il filtro di sottoscrizione del canale /ws/tags è ESATTO: il server invia i
// delta solo per gli id sottoscritti (router.rs, `sub.contains(id)`). La
// vecchia raccolta in RuntimeView guardava solo `o.tag` più campi legacy
// inesistenti (`value_tag`, `min_tag`, `max_tag`, `pens`): tutti i tag usati
// SOLO da binding, visibilità, stati, serie dei grafici, celle grid e figli
// faceplate ricevevano lo snapshot iniziale e poi si CONGELAVANO.
//
// Questa è la fonte di verità unica su "quali tag usa un oggetto". Quando un
// campo tag-bearing nuovo entra nello schema, va aggiunto QUI (oltre che nel
// rendering) — altrimenti il sintomo è subdolo: valore fermo, nessun errore.
// La F2 (binding a espressioni) registrerà qui le dipendenze estratte dal parse.
//
// Dal 09-11-2026 (piano «viewer leggero», passo 4) la fonte è
// `dipendenzeOggetto`, una per oggetto: la usano il filtro di pagina e il
// ridisegno mirato, così i due non possono divergere. `collectTagIds` ne è
// l'unione, più i figli dei popup. La guardia è `tests/dipendenzeComplete`:
// monta ogni oggetto dei template e controlla che legga solo quello che dichiara.

import type { FaceplateDef, GridCell, SubCellEntry, SynopticObject, SynopticPage } from "@/types";
import { figliDelFaceplate } from "@/canvas/parametriFaceplate";
import { extractDeps } from "@/expr/engine";

/** Campi scalari il cui valore è direttamente un tag id. Specchio di
 *  `CAMPI_TAG` in `sws-web/src/validate.rs` — i due elenchi divergevano
 *  (`motion_tag`, `pipe_flow_tag`, `symbol_spin_tag`, `gauge_sp_tag` mancavano
 *  qui): un oggetto legato a uno di quei campi riceveva lo snapshot iniziale e
 *  poi si congelava, in silenzio. `check_tag_refs.sh` tiene i due allineati. */
export const TAG_FIELDS = [
  "tag",
  "visible_tag",
  "state_tag",
  "alarm_tag",
  "fill_level_tag",
  "command_tag",
  "pipe_label_tag",
  "y_tag",
  "pie_center_tag",
  "blink_tag",
  "motion_tag",
  "pipe_flow_tag",
  "symbol_spin_tag",
  "gauge_sp_tag",
  "slider_pv_tag",
] as const;

/** I campi che decidono **quali** tag l'oggetto legge. Un legame su uno di
 *  questi (lo schema lo permette: `bindings` accetta qualunque chiave) fa
 *  scegliere il tag al valore di un altro tag, e prima non si può sapere
 *  quale sarà: l'oggetto dichiara `tutti`. */
const CAMPI_CHE_SCELGONO_I_TAG = new Set<string>([
  ...TAG_FIELDS,
  "extra_tags", "trend_tags", "xy_series", "table_rows", "table_columns", "bar_series", "pie_slices",
  "grid_cells", "assegnazioni", "symbol_parts",
  "faceplate_id", "faceplate_params", "faceplate_overrides",
  "from_obj_id", "to_obj_id",
]);

/** Quello che un oggetto legge dalla mappa dei valori mentre si disegna. */
export interface DipendenzeOggetto {
  /** I tag letti, figli di griglie e faceplate compresi; per un tubo anche i
   *  legami e il moto degli oggetti a cui è agganciato. */
  ids: ReadonlySet<string>;
  /** Conta anche il timestamp, non solo valore e qualità: una tabella con la
   *  colonna «time». Lo stale non c'entra: lo calcola l'involucro di pagina. */
  conTempo: boolean;
  /** Un legame riscrive un campo-tag: i tag letti dipendono dai valori, e
   *  l'oggetto va confrontato con tutta la mappa. */
  tutti: boolean;
  /** Legge gli oggetti della pagina: è, o contiene, un tubo agganciato. Per
   *  gli altri `objects` non conta, e in edit, dove cambia a ogni passo di
   *  trascinamento, griglie e faceplate senza tubi non si ridisegnano. */
  usaOggetti: boolean;
}

interface Raccolta {
  ids: Set<string>;
  conTempo: boolean;
  tutti: boolean;
  /** Il risultato dipende dalla lista dei faceplate (un'istanza, anche dentro una cella). */
  usaFaceplate: boolean;
  /** Il risultato dipende dagli oggetti della pagina (un tubo, anche annidato). */
  usaOggetti: boolean;
}

function addIf(ids: Set<string>, v: unknown): void {
  if (typeof v === "string" && v.trim() !== "") ids.add(v);
}

/** I tag dei legami: stringa (tag id), `{tag,+scaling}` o `{expr}` — per
 *  l'espressione le dipendenze escono dal parser (F2). Vero se un legame
 *  riscrive un campo che sceglie i tag. */
function legami(ids: Set<string>, obj: SynopticObject): boolean {
  if (!obj.bindings) return false;
  let sceglie = false;
  for (const [campo, v] of Object.entries(obj.bindings)) {
    if (CAMPI_CHE_SCELGONO_I_TAG.has(campo)) sceglie = true;
    if (typeof v === "string") addIf(ids, v);
    else if (v.expr) for (const dep of extractDeps(v.expr)) ids.add(dep);
    else addIf(ids, v.tag);
  }
  return sceglie;
}

function visitSubCell(ids: Set<string>, entry: SubCellEntry | undefined, visit: (o: SynopticObject) => void): void {
  if (!entry) return;
  addIf(ids, entry.visible_tag);
  if (entry.child) visit(entry.child);
  if (entry.sub) {
    visitSubCell(ids, entry.sub.a, visit);
    visitSubCell(ids, entry.sub.b, visit);
  }
}

function visitCell(ids: Set<string>, cell: GridCell, visit: (o: SynopticObject) => void): void {
  addIf(ids, cell.visible_tag);
  if (cell.child) visit(cell.child);
  if (cell.sub) {
    visitSubCell(ids, cell.sub.a, visit);
    visitSubCell(ids, cell.sub.b, visit);
  }
}

function raccogli(
  obj: SynopticObject,
  faceplates: readonly FaceplateDef[],
  objects: readonly SynopticObject[] | undefined,
): Raccolta {
  const r: Raccolta = { ids: new Set(), conTempo: false, tutti: false, usaFaceplate: false, usaOggetti: false };
  const { ids } = r;
  // Guardia anti-cicli: un faceplate che (direttamente o via annidamento)
  // referenzia sé stesso non deve mandare in loop la raccolta.
  const faceplateStack: string[] = [];

  const visit = (o: SynopticObject): void => {
    for (const f of TAG_FIELDS) addIf(ids, o[f]);
    if (legami(ids, o)) r.tutti = true;
    for (const t of o.extra_tags ?? []) addIf(ids, t); // legacy pre-migrazione
    for (const tr of o.trend_tags ?? []) addIf(ids, tr.tag);
    // F5.3x/T-70: ogni coppia porta due tag, non uno — `y_tag` in TAG_FIELDS
    // sopra copre solo il formato legacy (una coppia, pre-migrazione).
    for (const xy of o.xy_series ?? []) { addIf(ids, xy.tag); addIf(ids, xy.y_tag); }
    for (const row of o.table_rows ?? []) addIf(ids, row.tag);
    for (const s of o.bar_series ?? []) addIf(ids, s.tag);
    for (const s of o.pie_slices ?? []) addIf(ids, s.tag);
    for (const c of o.grid_cells ?? []) visitCell(ids, c, visit);
    // Le assegnazioni di un bottone (11-10-2026): le variabili che scrive
    // sono usi veri — l'IDE le crea al salvataggio e la ricerca le trova.
    for (const a of o.assegnazioni ?? []) addIf(ids, a.tag);
    // Le parti vive dei simboli di libreria (lancetta, leva, spie): senza, il
    // tag arriverebbe col primo snapshot e poi la parte resterebbe ferma.
    for (const p of Object.values(o.symbol_parts ?? {})) addIf(ids, p?.tag);

    // Il tempo del valore lo mostra solo la colonna «time» di una tabella. Lo
    // stale (`stale_after_s`) no: la ⌛ e il grigio li mette l'involucro di
    // pagina, nel ciclo della radice, con la mappa intera e il suo orologio;
    // dentro l'oggetto il tempo non si legge, e un valore ritrasmesso uguale
    // non deve ridisegnarlo (rilievo della revisione del 09-11-2026).
    if (o.type === "table" && o.table_columns?.includes("time")) r.conTempo = true;

    // Un tubo si disegna sulla posizione degli oggetti a cui è agganciato,
    // risolta coi loro legami (`resolveObject`), e li rincorre mentre si
    // muovono su un percorso (`motoVivo.ts`): legge i loro tag.
    if (o.type === "pipe" && (o.from_obj_id || o.to_obj_id)) {
      r.usaOggetti = true;
      for (const id of [o.from_obj_id, o.to_obj_id]) {
        const ancora = id ? objects?.find((x) => x.id === id) : undefined;
        if (!ancora) continue;
        legami(ids, ancora);
        addIf(ids, ancora.motion_tag);
      }
    }

    // I figli di un faceplate come li disegna il canvas: parametri effettivi
    // (default compresi) e override per figlio, a ogni livello. Prima si
    // usavano i parametri grezzi: un'istanza col valore predefinito chiedeva
    // `{p}.x` e il figlio, che legge `default.x`, restava fermo.
    if (o.type === "faceplate" && o.faceplate_id) {
      r.usaFaceplate = true;
      if (!faceplateStack.includes(o.faceplate_id)) {
        const def = faceplates.find((f) => f.id === o.faceplate_id);
        if (def) {
          faceplateStack.push(o.faceplate_id);
          for (const child of figliDelFaceplate(o, def)) visit(child);
          faceplateStack.pop();
        }
      }
    }
  };

  visit(obj);
  return r;
}

const NESSUN_FACEPLATE: readonly FaceplateDef[] = [];

/** Il risultato per oggetto, finché l'oggetto è lo stesso. Gli oggetti dello
 *  store non si modificano: si sostituiscono. Faceplate e oggetti della
 *  pagina contano solo se il risultato li ha usati. */
const memoria = new WeakMap<SynopticObject, {
  faceplates: readonly FaceplateDef[];
  objects: readonly SynopticObject[] | undefined;
  usaFaceplate: boolean;
  usaOggetti: boolean;
  dip: DipendenzeOggetto;
}>();

/**
 * I tag che un oggetto legge mentre si disegna, figli compresi. Una funzione
 * sola per il filtro di pagina (`collectTagIds`) e per il ridisegno mirato:
 * un tag che manca qui l'oggetto lo legge lo stesso, e resta fermo.
 * `objects` sono gli oggetti della pagina, dove un tubo trova i suoi capi.
 */
export function dipendenzeOggetto(
  obj: SynopticObject,
  faceplates: readonly FaceplateDef[] = NESSUN_FACEPLATE,
  objects?: readonly SynopticObject[],
): DipendenzeOggetto {
  const m = memoria.get(obj);
  if (m && (!m.usaFaceplate || m.faceplates === faceplates) && (!m.usaOggetti || m.objects === objects)) {
    return m.dip;
  }
  const r = raccogli(obj, faceplates, objects);
  const dip: DipendenzeOggetto = { ids: r.ids, conTempo: r.conTempo, tutti: r.tutti, usaOggetti: r.usaOggetti };
  memoria.set(obj, { faceplates, objects, usaFaceplate: r.usaFaceplate, usaOggetti: r.usaOggetti, dip });
  return dip;
}

/** Le dipendenze di una lista di oggetti: l'unione degli id, e se qualcuno
 *  dichiara `tutti`. Comprende i figli del popup che un bottone apre con
 *  `open_faceplate`, coi parametri del bottone: il popup lo apre solo un
 *  oggetto della pagina (il gesto sta nel suo ciclo, in `SvgCanvas`), quindi
 *  si guardano solo gli oggetti dati, non i figli. */
function raccoltaDegliOggetti(
  objects: readonly SynopticObject[],
  faceplates: readonly FaceplateDef[],
): { ids: Set<string>; tutti: boolean } {
  const ids = new Set<string>();
  let tutti = false;
  const aggiungi = (o: SynopticObject) => {
    const dip = dipendenzeOggetto(o, faceplates, objects);
    for (const id of dip.ids) ids.add(id);
    if (dip.tutti) tutti = true;
  };
  for (const obj of objects) {
    aggiungi(obj);
    const azione = obj.button_action;
    if (azione?.type === "open_faceplate") {
      const def = faceplates.find((f) => f.id === azione.faceplate_id);
      if (def) for (const child of figliDelFaceplate({ faceplate_params: azione.params }, def)) aggiungi(child);
    }
  }
  return { ids, tutti };
}

/**
 * Tutti i tag id referenziati dagli oggetti dati: l'unione delle loro
 * dipendenze (celle grid ricorsive, figli faceplate coi parametri effettivi —
 * un faceplate con `tag: "{p}.temp"` e param `p=zona1` sottoscrive
 * `zona1.temp`), più i figli del popup che un bottone apre con
 * `open_faceplate`. Sono i tag **scritti** nel progetto, mai `*`: la usano
 * anche la ricerca, `findObjects` e la rinomina.
 */
export function collectTagIds(
  objects: readonly SynopticObject[],
  faceplates: readonly FaceplateDef[] = NESSUN_FACEPLATE,
): string[] {
  return [...raccoltaDegliOggetti(objects, faceplates).ids];
}

/**
 * I tag che la vista del pannello deve ricevere: la pagina, il suo sfondo da
 * variabile, e la pagina-finestra aperta con i suoi oggetti (parametri già
 * sostituiti) e il **suo** sfondo da variabile, che prima mancava e restava
 * fermo al primo snapshot.
 *
 * `["*"]`, cioè tutto, se un oggetto dichiara `tutti`: un legame che sceglie
 * il tag (`bindings.tag`) legge il tag che il valore di un altro tag gli
 * indica, e prima non si sa quale. Il memo per quello lo ridisegna sempre;
 * il filtro deve fare lo stesso, o il tag scelto arriva col primo snapshot e
 * poi resta fermo, senza avvisi (rilievo della revisione del 09-11-2026).
 */
export function tagDellaVista(
  pagina: Pick<SynopticPage, "objects" | "background_tag"> | undefined,
  faceplates: readonly FaceplateDef[],
  finestra?: { pagina: Pick<SynopticPage, "background_tag">; oggetti: readonly SynopticObject[] },
): string[] {
  const dellaPagina = raccoltaDegliOggetti(pagina?.objects ?? [], faceplates);
  const dellaFinestra = finestra ? raccoltaDegliOggetti(finestra.oggetti, faceplates) : undefined;
  if (dellaPagina.tutti || dellaFinestra?.tutti) return ["*"];
  const { ids } = dellaPagina;
  // Lo sfondo da variabile (11-10-2026) è un uso della pagina, non di un
  // oggetto. Senza spazi, come lo legge `sfondoPagina`.
  addIf(ids, pagina?.background_tag?.trim());
  if (finestra && dellaFinestra) {
    for (const id of dellaFinestra.ids) ids.add(id);
    addIf(ids, finestra.pagina.background_tag?.trim());
  }
  return [...ids];
}
