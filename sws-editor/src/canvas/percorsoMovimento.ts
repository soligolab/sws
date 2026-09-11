// Il percorso di movimento (F6.10) — le decisioni, senza React e senza SVG.
//
// `motion_path` è la polilinea lungo cui un oggetto trasla al variare di
// `motion_tag`, mappato da `motion_min`..`motion_max` a 0..1. Fino
// all'11-09-2026 si modificava solo da una tabella di coordinate nel pannello:
// T-53 la porta sul canvas, e le regole di «dove finisce un punto nuovo» e
// «che cosa cancella il tasto Canc» stanno qui perché sono decisioni, non
// righe di disegno — e perché così si provano senza montare un canvas.
//
// **L'ordine dell'array È l'ordine logico**: `punti[0]` è la posizione a
// `motion_min`, l'ultimo quella a `motion_max`. Non c'è un campo d'ordine, e
// per questo dividere un segmento è uno `splice` e non un `push`.
import type { PipePoint, SynopticObject } from "../types";

/** Il waypoint scelto sul canvas: quale oggetto, e quale indice del suo
 *  percorso. Effimero — vive nello store, non nel progetto. */
export interface WaypointScelto {
  objectId: string;
  index: number;
}

/** Il segmento scelto sul canvas: va da `index` a `index + 1`. `punto` è dove
 *  si è cliccato, in coordinate pagina, e serve a «Dividi qui»: senza, il
 *  punto nuovo finirebbe a metà segmento invece che dove lo si è chiesto. */
export interface SegmentoScelto {
  objectId: string;
  index: number;
  punto: PipePoint;
}

/** I punti del percorso, normalizzati.
 *
 *  Il viewer LVGL accetta **due forme** — `[{x,y},…]` e `[[x,y],…]` — e il
 *  commento di `punti_movimento` (`lvgl_render.rs`) dice perché: «è quello che
 *  si trova nei progetti veri». L'editor scrive sempre la forma a oggetti, ma
 *  un progetto disegnato tempo fa può contenere coppie. Senza questa lettura
 *  difensiva le maniglie uscirebbero a `NaN` proprio sui progetti vecchi, che
 *  sono quelli in cui un percorso di movimento ha più probabilità di esistere.
 *
 *  Tutto ciò che non è un punto leggibile si scarta: un waypoint a metà è
 *  peggio di un waypoint assente, perché lo si trascina e non si sa dove va. */
export function puntiMovimento(grezzo: unknown): PipePoint[] {
  if (!Array.isArray(grezzo)) return [];
  const out: PipePoint[] = [];
  for (const p of grezzo) {
    if (Array.isArray(p)) {
      const [x, y] = p;
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x: Number(x), y: Number(y) });
      continue;
    }
    if (p && typeof p === "object") {
      const { x, y } = p as { x?: unknown; y?: unknown };
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x: Number(x), y: Number(y) });
    }
  }
  return out;
}

/** Il percorso come lo si scrive nel progetto: vuoto significa **assente**.
 *
 *  È la regola che la tabella applica già oggi. Un `motion_path: []` salvato
 *  sarebbe rumore — il runtime lo scarta comunque, servono almeno due punti
 *  perché un movimento esista — e in `project.yaml` resterebbe una riga che
 *  non dice niente. */
export function percorsoDaSalvare(punti: PipePoint[]): PipePoint[] | undefined {
  return punti.length > 0 ? punti : undefined;
}

/** Inserisce un punto **dentro** il segmento `indice` → `indice + 1`.
 *
 *  Fuori range restituisce i punti com'erano invece di inventarsi una
 *  posizione: chi chiama sta rispondendo a un clic, e un clic su un segmento
 *  che non c'è più (percorso cambiato sotto le mani) non deve spostare nulla. */
export function dividiSegmento(punti: PipePoint[], indice: number, punto: PipePoint): PipePoint[] {
  if (!Number.isInteger(indice) || indice < 0 || indice >= punti.length - 1) return punti;
  const out = punti.slice();
  out.splice(indice + 1, 0, punto);
  return out;
}

/** Aggiunge un punto in coda, 50 unità a destra dell'ultimo.
 *
 *  Stessa regola del pulsante «+ Aggiungi punto» della tabella: il punto nuovo
 *  non nasce **sopra** l'ultimo, altrimenti bisognerebbe trascinarlo via alla
 *  cieca per scoprire che ce n'erano due sovrapposti. Con il percorso vuoto
 *  parte dall'angolo dell'oggetto, che è l'unica posizione nota. */
export function aggiungiInCoda(punti: PipePoint[], origine: PipePoint): PipePoint[] {
  const ultimo = punti[punti.length - 1] ?? origine;
  return [...punti, { x: ultimo.x + 50, y: ultimo.y }];
}

/** Toglie il waypoint `indice`. Un indice che non esiste lascia tutto com'è. */
export function eliminaWaypoint(punti: PipePoint[], indice: number): PipePoint[] {
  if (!Number.isInteger(indice) || indice < 0 || indice >= punti.length) return punti;
  return punti.filter((_, i) => i !== indice);
}

/** Che cosa cancella il tasto Canc.
 *
 *  Il guasto da evitare: con un waypoint scelto **l'oggetto è selezionato
 *  anche lui** — è il suo percorso — quindi l'handler di `EditorShell`, che
 *  guarda solo `selectedObjectIds`, si porterebbe via l'intero oggetto quando
 *  si voleva togliere un punto. Qui la precedenza è dichiarata una volta, e si
 *  può provare senza premere tasti.
 *
 *  Il waypoint vince **solo se appartiene a un oggetto selezionato**: una
 *  scelta rimasta in memoria da una selezione precedente non deve dirottare
 *  una cancellazione che l'utente intende su un altro oggetto. */
export function cosaCancella(
  waypoint: WaypointScelto | null,
  idsSelezionati: readonly string[],
): "waypoint" | "oggetti" | null {
  if (waypoint && idsSelezionati.includes(waypoint.objectId)) return "waypoint";
  return idsSelezionati.length > 0 ? "oggetti" : null;
}

/** Il tracciato si disegna per questo oggetto?
 *
 *  **Non** dipende da «Anteprima effetti»: quello accende il *movimento*, cioè
 *  l'effetto di runtime, mentre il tracciato è un ausilio di disegno — si
 *  modifica un percorso guardandolo fermo, non mentre l'oggetto ci scorre
 *  sopra. E **non** dipende da `motion_tag`: la geometria esiste prima del tag
 *  che la percorre, altrimenti non si potrebbe disegnare un percorso prima di
 *  aver scelto la variabile che lo comanda. */
export function tracciatoVisibile(
  obj: Pick<SynopticObject, "motion_path"> | undefined,
  mostraTracciato: boolean,
): boolean {
  if (!mostraTracciato || !obj) return false;
  return puntiMovimento(obj.motion_path).length > 0;
}
