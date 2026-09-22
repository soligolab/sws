// La riconciliazione dei tag al salvataggio (Fase 0b del piano
// `docs/plans/2026-09-21-gestione-tag-oggetto-unico.md`).
//
// Fino al 22-09-2026 un tag nasceva per cinque strade diverse («+var» nelle
// card delle sorgenti, il modale rapido, i due wizard, la scheda Variabili), e
// quattro di esse riempivano una lista «in attesa» che viveva nello stato
// locale della scheda Sorgenti: cambiare scheda la perdeva, e Ctrl+S non la
// vedeva. Un id digitato a mano in un TagInput senza premere niente restava
// per sempre sconosciuto: il valore non arrivava e nessuno lo diceva.
//
// Ora la regola è una: **al salvataggio ogni id referenziato dal progetto e
// non dichiarato viene creato** (decisione del maintainer, 22-09-2026), con la
// definizione messa in attesa se c'è, altrimenti con il tipo dedotto dalla
// mappatura o dall'oggetto che lo usa, e storico spento. I riferimenti sono
// quelli **finali** — ciò che sta nello store al momento del salvataggio, non
// quel che si stava digitando — ed è questo che rendeva sbagliata la vecchia
// creazione automatica «per tasto». Nessun dialogo: il riepilogo compare dopo.
//
// Funzioni pure, provate da `tests/riconciliaTag.test.ts`; lo store le chiama
// da `riconciliaTag()` dentro `saveAll`.

import { buildTagUsage } from "@/search/tagUsage";
import { sourceTagIds } from "@/tagCatalog";
import { definizioneMetrica } from "@/config/sorgenteHost";
import type {
  EnIpDataType, FaceplateDef, HostMetric, ProjectInfo, S7DataType, SynopticObject, SynopticPage, TagDataType, TagDef,
} from "@/types";

/** Un segnaposto di faceplate (`{tag_prefix}.temp`) non è un tag: si risolve
 *  per istanza. Stesso criterio di `validate.rs::e_segnaposto`. */
export function eSegnaposto(id: string): boolean {
  return id.includes("{");
}

/** Tutti gli id di tag che il progetto cita: pagine (con i figli dei
 *  faceplate), allarmi, espressioni dei tag calcolati, script globali e le
 *  mappature di ogni sorgente. Niente stringhe vuote né segnaposto. */
export function riferimentiDelProgetto(
  project: ProjectInfo,
  pages: readonly SynopticPage[],
  faceplates: readonly FaceplateDef[] = [],
): Set<string> {
  const out = new Set<string>();
  const usi = buildTagUsage({
    pages: [...pages],
    faceplates: [...faceplates],
    alarms: project.alarms ?? [],
    tags: project.tags ?? [],
    globalScripts: project.global_scripts ?? [],
  });
  for (const id of usi.keys()) out.add(id);
  for (const id of sourceTagIds(project).keys()) out.add(id);
  for (const id of [...out]) {
    if (id.trim() === "" || eSegnaposto(id)) out.delete(id);
  }
  return out;
}

/** Da un tipo S7 al tipo **esatto** del tag (D5). Prima il «+var» della card
 *  S7 scriveva sempre `float`; poi `int`, e un `word` perdeva il «senza segno». */
export function tipoDaS7(t: S7DataType | undefined): TagDataType {
  switch (t) {
    case "bool": return "bool";
    case "byte": return "u8";
    case "int": return "i16";
    case "word": return "u16";
    case "dint": return "i32";
    default: return "f32";
  }
}

/** Da un tipo EtherNet/IP al tipo esatto del tag. */
export function tipoDaEnIp(t: EnIpDataType | undefined): TagDataType {
  switch (t) {
    case "bool": return "bool";
    case "sint": return "i8";
    case "int": return "i16";
    case "dint": return "i32";
    case "lint": return "i64";
    default: return "f32";
  }
}

/** Il tipo che un oggetto sinottico si aspetta dal suo tag primario. Non
 *  esiste una mappa nel modello (che è solo scalare): questa è la deduzione
 *  minima e prudente, e `float` è il ripiego perché è quello che un tag ha
 *  sempre avuto per default. */
export function tipoDaOggetto(type: SynopticObject["type"]): TagDataType {
  switch (type) {
    case "led": case "checkbox": case "radio": case "lang_button": return "bool";
    case "text_list": case "state_lamp": return "i64";
    default: return "f64";
  }
}

/** Il tipo dedotto per un id: prima dalla mappatura che lo alimenta (che sa
 *  cosa arriva dal dispositivo), poi dal primo oggetto che lo usa come tag
 *  primario, altrimenti `float`. */
export function deduciTipo(id: string, project: ProjectInfo, pages: readonly SynopticPage[]): TagDataType {
  for (const src of project.sources ?? []) {
    const s = src as unknown as Record<string, unknown>;
    if (s.kind === "s7") {
      const m = (s.tags as { tag: string; data_type?: S7DataType }[] | undefined)?.find((x) => x.tag === id);
      if (m) return tipoDaS7(m.data_type);
    }
    if (s.kind === "enip") {
      const m = (s.tags as { tag: string; data_type?: EnIpDataType }[] | undefined)?.find((x) => x.tag === id);
      if (m) return tipoDaEnIp(m.data_type);
    }
    if (s.kind === "host") {
      const m = (s.metrics as { tag: string; metric: HostMetric }[] | undefined)?.find((x) => x.tag === id);
      if (m) return definizioneMetrica(m.metric)?.testo ? "string" : "f64";
    }
  }
  for (const pg of pages) {
    const o = pg.objects.find((x) => x.tag === id);
    if (o) return tipoDaOggetto(o.type);
  }
  return "f64";
}

export interface IngressoRiconciliazione {
  project: ProjectInfo;
  pages: readonly SynopticPage[];
  /** Le definizioni dei faceplate (stanno nello store, non in `project`). */
  faceplates?: readonly FaceplateDef[];
  /** Le definizioni messe in attesa da «+var», modale e wizard: valgono solo
   *  se il loro id è ancora referenziato — le altre erano intenzioni cambiate. */
  tagInAttesa: readonly TagDef[];
}

/** Le radici composite del progetto: i tag che dichiarano `type_ref` o
 *  `array` (Fase 1b). */
function radiciComposite(project: ProjectInfo): string[] {
  return (project.tags ?? []).filter((t) => t.type_ref || t.array).map((t) => t.id);
}

/** Vero se `id` è un percorso dentro una radice composita.
 *
 *  Serve a non creare un tag **piatto** `motore1.velocita` accanto
 *  all'istanza `motore1`: sarebbe una collisione, e il validatore la rifiuta
 *  perché uno dei due non si raggiungerebbe più. Guarda il **prefisso**, non
 *  la forma: una foglia scritta male (`motore1.velocit`) non va creata lo
 *  stesso, e resta un riferimento rotto che il validatore dice — mentre
 *  crearla la trasformerebbe in una collisione silenziosa. Chi vuole sapere
 *  se la foglia esiste davvero usa `foglieDi` (`tag/forma.ts`). */
export function ePercorsoDiUnaRadice(id: string, radici: readonly string[]): boolean {
  return radici.some((r) => id.startsWith(`${r}.`) || id.startsWith(`${r}[`));
}

/** I tag da creare al salvataggio: ogni id referenziato e non dichiarato,
 *  con la definizione in attesa se c'è, altrimenti dedotta. Ordinati per id,
 *  senza doppioni. Vuoto = niente da fare, niente PUT. */
export function pianoCreazione({ project, pages, faceplates = [], tagInAttesa }: IngressoRiconciliazione): TagDef[] {
  const dichiarati = new Set((project.tags ?? []).map((t) => t.id));
  const radici = radiciComposite(project);
  const inAttesa = new Map(tagInAttesa.map((t) => [t.id, t]));
  const nuovi: TagDef[] = [];
  for (const id of [...riferimentiDelProgetto(project, pages, faceplates)].sort()) {
    if (dichiarati.has(id)) continue;
    if (ePercorsoDiUnaRadice(id, radici)) continue;
    const attesa = inAttesa.get(id);
    nuovi.push(attesa
      ? { ...attesa, id, history: attesa.history ?? false }
      : { id, description: "", data_type: deduciTipo(id, project, pages), history: false });
  }
  return nuovi;
}
