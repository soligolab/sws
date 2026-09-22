// Rinominare una variabile in tutto il progetto (Fase 0c del piano
// `docs/plans/2026-09-21-gestione-tag-oggetto-unico.md`).
//
// Un tag è citato in una ventina di posti diversi — campi degli oggetti,
// binding, celle di griglia, figli dei faceplate, mappature di ogni
// protocollo, allarmi, ricette, trigger e codice degli script, espressioni dei
// tag calcolati — e fino al 22-09-2026 rinominarlo voleva dire cercarli a
// mano. Qui c'è **un walker solo** che li riscrive tutti e dice dove: la
// stessa lista fa da anteprima prima della conferma e da riepilogo dopo.
//
// Funzioni pure: ricevono lo stato e ritornano copie nuove; lo store le
// applica e scrive (`rinominaTag`). Ciò che il walker NON può rinominare — un
// id che nasce dalla composizione di un parametro di faceplate (`{p}.temp` con
// `p = zona1`) — viene segnalato, non taciuto.

import i18n from "i18next";
import { TAG_FIELDS, collectTagIds } from "@/runtime-view/collectTagIds";
import type {
  AlarmDef, FaceplateDef, GlobalScriptDef, RecipeDef, SourceDef, SynopticPage, TagDef,
} from "@/types";

export type TipoPunto = "pagina" | "faceplate" | "sorgente" | "allarme" | "espressione" | "script" | "ricetta";

/** Un posto in cui il tag compare: dove, e quante occorrenze lì. */
export interface Punto {
  tipo: TipoPunto;
  dove: string;
  n: number;
  pageId?: string;
}

export interface StatoRinomina {
  pages: readonly SynopticPage[];
  faceplates: readonly FaceplateDef[];
  tags: readonly TagDef[];
  sources: readonly SourceDef[];
  alarms: readonly AlarmDef[];
  globalScripts: readonly GlobalScriptDef[];
  recipes: readonly RecipeDef[];
}

export interface EsitoRinomina extends StatoRinomina {
  pages: SynopticPage[];
  faceplates: FaceplateDef[];
  tags: TagDef[];
  sources: SourceDef[];
  alarms: AlarmDef[];
  globalScripts: GlobalScriptDef[];
  recipes: RecipeDef[];
  /** Dove il tag è stato rinominato. */
  punti: Punto[];
  /** Dove il tag compare ma il walker non ha potuto cambiarlo: parametri di
   *  faceplate composti. Da fare a mano, e la finestra lo dice. */
  nonRinominabili: Punto[];
  pagineCambiate: Set<string>;
  faceplateCambiati: Set<string>;
  ricetteCambiate: Set<string>;
  tagsCambiati: boolean;
  sourcesCambiate: boolean;
  alarmsCambiati: boolean;
  scriptCambiati: boolean;
}

/** L'id nuovo di un riferimento, o `null` se il riferimento non è a questo tag.
 *
 *  Con `eRadice` cambiano anche i **percorsi**: rinominando l'istanza
 *  `motore1` in `pompa1`, `motore1.velocita` diventa `pompa1.velocita` e
 *  `motore1[2].stato` diventa `pompa1[2].stato`. Senza, la rinomina
 *  lascerebbe ogni pagina legata a un percorso che non esiste più — lo stesso
 *  buco per cui il ✕ della scheda Variabili cancellava in silenzio.
 *
 *  `motore1bis` **non** cambia: un prefisso vale solo se finisce dove finisce
 *  l'id, cioè su un punto o su una parentesi. */
export function nuovoRiferimento(
  valore: string,
  vecchio: string,
  nuovo: string,
  eRadice: boolean,
): string | null {
  if (valore === vecchio) return nuovo;
  if (!eRadice || !valore.startsWith(vecchio)) return null;
  const resto = valore.slice(vecchio.length);
  return resto.startsWith(".") || resto.startsWith("[") ? nuovo + resto : null;
}

/** I riferimenti letterali nel codice Python degli script e nelle espressioni
 *  dei tag calcolati: `tags["x"]`, `tags['x']`, `tags.read("x")`,
 *  `tags.write('x', …)`. Stesso perimetro di `EXPR_RE` in tagUsage.ts.
 *  Con `eRadice` prende anche i percorsi (`tags["motore1.velocita"]`). */
export function sostituisciNelCodice(
  codice: string,
  vecchio: string,
  nuovo: string,
  eRadice = false,
): { testo: string; n: number } {
  let n = 0;
  const esc = vecchio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const coda = eRadice ? "((?:\\.[\\w-]+|\\[\\d+\\])*)" : "()";
  const re = new RegExp(`(tags\\[|tags\\.(?:read|write)\\(\\s*)(['"])${esc}${coda}\\2`, "g");
  const testo = codice.replace(re, (_m, pre: string, q: string, resto: string) => {
    n++;
    return `${pre}${q}${nuovo}${resto ?? ""}${q}`;
  });
  return { testo, n };
}

/** Il riferimento `{x}` di un'espressione di binding (sintassi di
 *  `expr/engine.ts`), spazi interni compresi. */
function sostituisciNellaEspressioneBinding(
  expr: string,
  vecchio: string,
  nuovo: string,
  eRadice: boolean,
): { testo: string; n: number } {
  let n = 0;
  const esc = vecchio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const coda = eRadice ? "((?:\\.[\\w-]+|\\[\\d+\\])*)" : "()";
  const re = new RegExp(`\\{\\s*${esc}${coda}\\s*\\}`, "g");
  const testo = expr.replace(re, (_m, resto: string) => { n++; return `{${nuovo}${resto ?? ""}}`; });
  return { testo, n };
}

// Calcolato alla prima chiamata, non all'import: collectTagIds passa da
// SvgCanvas, che passa dallo store, che importa questo modulo — al momento
// dell'import `TAG_FIELDS` può non essere ancora inizializzato (ciclo).
let campiTag: ReadonlySet<string> | null = null;
function CAMPI(): ReadonlySet<string> {
  campiTag ??= new Set<string>([...TAG_FIELDS, "tag", "y_tag", "visible_tag"]);
  return campiTag;
}

/** Riscrive ricorsivamente un oggetto sinottico (o una sua parte: cella,
 *  figlio, riga di tabella). Ritorna lo stesso riferimento se non cambia
 *  niente. I `faceplate_params` non si toccano: sono valori dei parametri,
 *  non riferimenti — se compongono l'id, è il caso «non rinominabile». */
function riscriviOggetto<T>(v: T, vecchio: string, nuovo: string, eRadice: boolean, conta: { n: number }, chiave?: string): T {
  if (Array.isArray(v)) {
    let cambiato = false;
    const out = v.map((x) => { const y = riscriviOggetto(x, vecchio, nuovo, eRadice, conta); if (y !== x) cambiato = true; return y; });
    return (cambiato ? out : v) as T;
  }
  if (v && typeof v === "object") {
    let cambiato = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      let y: unknown = x;
      if (k === "faceplate_params") {
        y = x;
      } else if (CAMPI().has(k) && typeof x === "string") {
        const n2 = nuovoRiferimento(x, vecchio, nuovo, eRadice);
        if (n2 !== null) { y = n2; conta.n++; }
      } else if (k === "extra_tags" && Array.isArray(x)) {
        let c = false;
        const arr = x.map((t) => {
          const n2 = typeof t === "string" ? nuovoRiferimento(t, vecchio, nuovo, eRadice) : null;
          if (n2 !== null) { c = true; conta.n++; return n2; }
          return t;
        });
        y = c ? arr : x;
      } else if (k === "bindings" && x && typeof x === "object") {
        let c = false;
        const b: Record<string, unknown> = {};
        for (const [prop, spec] of Object.entries(x as Record<string, unknown>)) {
          if (typeof spec === "string") {
            const n2 = nuovoRiferimento(spec, vecchio, nuovo, eRadice);
            if (n2 !== null) { b[prop] = n2; c = true; conta.n++; } else b[prop] = spec;
          } else if (spec && typeof spec === "object") {
            const sp = spec as { tag?: string; expr?: string };
            let ns: { tag?: string; expr?: string } = sp;
            const nt = typeof sp.tag === "string" ? nuovoRiferimento(sp.tag, vecchio, nuovo, eRadice) : null;
            if (nt !== null) { ns = { ...ns, tag: nt }; conta.n++; }
            if (typeof sp.expr === "string") {
              const r = sostituisciNellaEspressioneBinding(sp.expr, vecchio, nuovo, eRadice);
              if (r.n > 0) { ns = { ...ns, expr: r.testo }; conta.n += r.n; }
            }
            if (ns !== sp) c = true;
            b[prop] = ns;
          } else b[prop] = spec;
        }
        y = c ? b : x;
      } else if (x && typeof x === "object") {
        y = riscriviOggetto(x, vecchio, nuovo, eRadice, conta, k);
      }
      if (y !== x) cambiato = true;
      out[k] = y;
    }
    return (cambiato ? out : v) as T;
  }
  void chiave;
  return v;
}

const dove = (chiave: string, opz?: Record<string, string>) => i18n.t(chiave, opz);

/** La rinomina, in copia.
 *
 *  Se `vecchio` è la **radice** di una variabile composita (una struttura o un
 *  array: `type_ref` o `array` nella sua dichiarazione), la rinomina segue
 *  anche i percorsi delle foglie — `motore1.velocita` diventa
 *  `pompa1.velocita`. Un oggetto sinottico non si lega quasi mai alla radice:
 *  si lega a una foglia, e senza questo la rinomina avrebbe lasciato ogni
 *  pagina appesa a un percorso inesistente, in silenzio. `radice` forza la
 *  scelta quando la dichiarazione non è a portata di mano. */
export function rinomina(vecchio: string, nuovo: string, s: StatoRinomina, radice?: boolean): EsitoRinomina {
  const punti: Punto[] = [];
  const nonRinominabili: Punto[] = [];
  const decl = s.tags.find((t) => t.id === vecchio);
  const eRadice = radice ?? (!!decl?.type_ref || (decl?.array?.length ?? 0) > 0);
  /** Il vecchio id compare ancora, come tale o come radice di un percorso? */
  const restaUnUso = (id: string) => nuovoRiferimento(id, vecchio, nuovo, eRadice) !== null;

  // ── Faceplate: prima, perché le pagine li istanziano ─────────────────────
  const faceplateCambiati = new Set<string>();
  const faceplates = s.faceplates.map((fp) => {
    const conta = { n: 0 };
    const objects = riscriviOggetto(fp.objects, vecchio, nuovo, eRadice, conta);
    if (conta.n === 0) return fp;
    faceplateCambiati.add(fp.id);
    punti.push({ tipo: "faceplate", dove: dove("tagUsage.faceplate", { label: fp.label }), n: conta.n });
    return { ...fp, objects };
  });

  // ── Pagine ──────────────────────────────────────────────────────────────
  const pagineCambiate = new Set<string>();
  const pages = s.pages.map((pg) => {
    const conta = { n: 0 };
    const objects = riscriviOggetto(pg.objects, vecchio, nuovo, eRadice, conta);
    const out = conta.n === 0 ? pg : { ...pg, objects };
    if (conta.n > 0) {
      pagineCambiate.add(pg.id);
      punti.push({ tipo: "pagina", dove: dove("tagUsage.page", { name: pg.name }), n: conta.n, pageId: pg.id });
    }
    // Se, DOPO la riscrittura, il vecchio id compare ancora fra i tag che la
    // pagina sottoscrive, nasce dalla composizione di un parametro di
    // faceplate: il walker non lo può cambiare, e lo dice.
    if (collectTagIds(out.objects, faceplates).some(restaUnUso)) {
      nonRinominabili.push({ tipo: "pagina", dove: dove("tagUsage.pageParam", { name: pg.name }), n: 1, pageId: pg.id });
    }
    return out;
  });

  // ── Sorgenti: ogni mappatura ha `tag` ─────────────────────────────────────
  let sourcesCambiate = false;
  const sources = s.sources.map((src) => {
    const conta = { n: 0 };
    const out = riscriviOggetto(src, vecchio, nuovo, eRadice, conta);
    if (conta.n === 0) return src;
    sourcesCambiate = true;
    const sd = src as unknown as { id?: string; name?: string; kind: string };
    punti.push({ tipo: "sorgente", dove: dove("tagUsage.source", { name: sd.name ?? sd.id ?? sd.kind }), n: conta.n });
    return out;
  });

  // ── Allarmi ─────────────────────────────────────────────────────────────
  let alarmsCambiati = false;
  const alarms = s.alarms.map((a) => {
    let n = 0;
    let out = a;
    const na = nuovoRiferimento(a.tag, vecchio, nuovo, eRadice);
    if (na !== null) { out = { ...out, tag: na }; n++; }
    const ni = a.inhibit_tag ? nuovoRiferimento(a.inhibit_tag, vecchio, nuovo, eRadice) : null;
    if (ni !== null) { out = { ...out, inhibit_tag: ni }; n++; }
    if (n === 0) return a;
    alarmsCambiati = true;
    punti.push({ tipo: "allarme", dove: dove("tagUsage.alarm", { id: a.id }), n });
    return out;
  });

  // ── Tag: l'id stesso e le espressioni degli altri ─────────────────────────
  let tagsCambiati = false;
  const tags = s.tags.map((td) => {
    let out = td;
    if (td.id === vecchio) { out = { ...out, id: nuovo }; tagsCambiati = true; }
    if (td.expression) {
      const r = sostituisciNelCodice(td.expression, vecchio, nuovo, eRadice);
      if (r.n > 0) {
        out = { ...out, expression: r.testo };
        tagsCambiati = true;
        punti.push({ tipo: "espressione", dove: dove("tagUsage.expression", { id: td.id }), n: r.n });
      }
    }
    return out;
  });

  // ── Script globali: trigger e codice ──────────────────────────────────────
  let scriptCambiati = false;
  const globalScripts = s.globalScripts.map((gs) => {
    let n = 0;
    let out = gs;
    if (gs.trigger.kind === "tag_change") {
      const nt = nuovoRiferimento(gs.trigger.tag, vecchio, nuovo, eRadice);
      if (nt !== null) { out = { ...out, trigger: { ...gs.trigger, tag: nt } }; n++; }
    }
    const r = sostituisciNelCodice(gs.code, vecchio, nuovo, eRadice);
    if (r.n > 0) { out = { ...out, code: r.testo }; n += r.n; }
    if (n === 0) return gs;
    scriptCambiati = true;
    punti.push({ tipo: "script", dove: dove("tagUsage.script", { id: gs.id }), n });
    return out;
  });

  // ── Ricette ─────────────────────────────────────────────────────────────
  const ricetteCambiate = new Set<string>();
  const recipes = s.recipes.map((r) => {
    let n = 0;
    const setpoints = r.setpoints.map((sp) => {
      const nt = nuovoRiferimento(sp.tag, vecchio, nuovo, eRadice);
      if (nt !== null) { n++; return { ...sp, tag: nt }; }
      return sp;
    });
    if (n === 0) return r;
    ricetteCambiate.add(r.id);
    punti.push({ tipo: "ricetta", dove: dove("tagUsage.recipe", { name: r.name }), n });
    return { ...r, setpoints };
  });

  return {
    pages, faceplates, tags, sources, alarms, globalScripts, recipes,
    punti, nonRinominabili, pagineCambiate, faceplateCambiati, ricetteCambiate,
    tagsCambiati, sourcesCambiate, alarmsCambiati, scriptCambiati,
  };
}

/** Perché un nuovo id non va: vuoto, con un segnaposto, o già preso. */
export function motivoIdNonValido(nuovo: string, esistenti: ReadonlySet<string>, vecchio: string): string | null {
  const t = nuovo.trim();
  if (t === "") return i18n.t("rinomina.idVuoto");
  if (t.includes("{") || t.includes("}")) return i18n.t("rinomina.idSegnaposto");
  if (t === vecchio) return i18n.t("rinomina.idUguale");
  if (esistenti.has(t)) return i18n.t("rinomina.idEsiste");
  return null;
}
