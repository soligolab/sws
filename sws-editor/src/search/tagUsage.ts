// ── Dove è usato un tag (F8.3) ──────────────────────────────────────────────
//
// Logica estratta dal tab Variabili (ConfigView), dove serviva solo a
// evidenziare le variabili non usate: la stessa risposta serve anche alla
// ricerca dell'editor ("dove è usato questo tag" cross-pagina), quindi vive in
// un posto unico invece di essere riscritta due volte.
//
// Copertura dichiarata: oggetti delle pagine (compresi i figli dei faceplate,
// via collectTagIds), tag e inhibit_tag degli allarmi, espressioni dei tag
// calcolati, script globali. NON coperti: ricette e funzioni Python — il
// riferimento lì è dinamico e cercarlo per sottostringa darebbe falsi positivi.

import { collectTagIds } from "@/runtime-view/collectTagIds";
import { foglieDiTolleranti } from "@/tag/forma";
import type { AlarmDef, FaceplateDef, GlobalScriptDef, SynopticPage, TagDef, TypeDef } from "@/types";
import i18n from "i18next";

/** Dove vive un riferimento. Serve a raggruppare l'elenco invece di
 *  sciorinarlo: «Pagine (2)», «Allarmi (1)» dice a colpo d'occhio da dove
 *  arriva il grosso, un elenco piatto no (maintainer, 25-09-2026). */
export type CategoriaUso = "pagina" | "allarme" | "espressione" | "script";

/** Riferimenti trovati per un tag: dove, e (per le pagine) l'oggetto. */
export interface TagUse {
  /** Testo pronto da mostrare, es. `pagina "Impianto"`. */
  where: string;
  categoria: CategoriaUso;
  /** Id pagina, quando il riferimento è su una pagina (per navigarci). */
  pageId?: string;
  /** Il nome dell'oggetto che lo usa, quando si sa: «pagina Home» dice dove
   *  cercare, «Home › indicatore CPU» dice cosa si è trovato. */
  oggetto?: string;
}

/** Gli usi di un tag **comprese le sue foglie**, per un'istanza.
 *
 *  Un oggetto non si lega a `motore1`, che non è un valore: si lega a
 *  `motore1.velocita`. Chiedere gli usi della sola radice risponde «nessuno»,
 *  e il 22-09-2026 questo ha lasciato **cancellare** dalla scheda Variabili
 *  un'istanza che una pagina stava usando, senza un avviso: la pagina è
 *  rimasta legata a un percorso che non esiste più.
 *
 *  Per un tag piatto è la mappa di sempre, senza costi. */
export function usiDiUnTag(
  tag: TagDef,
  usi: ReadonlyMap<string, TagUse[]>,
  types: readonly TypeDef[] = [],
): TagUse[] {
  const diretti = usi.get(tag.id) ?? [];
  const foglie = foglieDiTolleranti(tag, types);
  if (foglie.length === 0) return diretti;
  const out = [...diretti];
  for (const f of foglie) {
    for (const u of usi.get(f.percorso) ?? []) {
      if (!out.some((x) => x.where === u.where)) out.push(u);
    }
  }
  return out;
}

export interface TagUsageInput {
  pages: SynopticPage[];
  faceplates?: FaceplateDef[];
  alarms?: AlarmDef[];
  tags?: TagDef[];
  globalScripts?: GlobalScriptDef[];
}

/** Riferimenti a `tags["..."]`/`tags['...']` (espressioni) e a
 *  `tags.read("...")`/`tags.write('...', …)` (script, l'API vera esposta agli
 *  script: `TagApi::read`/`write` in `sws-pyscript/src/lib.rs`, non un
 *  `__getitem__`). Prima catturava solo apici doppi sull'indicizzazione: gli
 *  script reali dei template (`demo-items-web/lvgl`) e le espressioni con
 *  apici singoli (`homeassistant-demo`, `enip-demo`) non risultavano usare
 *  nessun tag. Solo letterali fra apici: una variabile (`tags.read(tag)`) non
 *  combacia, e va bene — cercarla per sottostringa darebbe falsi positivi. */
const EXPR_RE = /tags\[(['"])([^'"]+)\1\]|tags\.(?:read|write)\(\s*(['"])([^'"]+)\3/g;

/** Costruisce la mappa tagId → elenco dei punti che lo usano. */
export function buildTagUsage({
  pages, faceplates = [], alarms = [], tags = [], globalScripts = [],
}: TagUsageInput): Map<string, TagUse[]> {
  const m = new Map<string, TagUse[]>();
  const add = (id: string, use: TagUse) => {
    if (!id) return;
    const arr = m.get(id) ?? [];
    // Tetto per riga: l'elenco serve a capire DOVE cercare, non a essere esaustivo.
    const uguale = (u: TagUse) => u.where === use.where && u.oggetto === use.oggetto;
    if (arr.length < 12 && !arr.some(uguale)) arr.push(use);
    m.set(id, arr);
  };

  // Oggetto per oggetto e non tutta la pagina in un colpo: così si sa **chi**
  // usa il tag, non solo dove cercarlo. Costa una scansione per oggetto, che
  // su una pagina vera sono decine, non migliaia.
  for (const pg of pages) {
    for (const obj of pg.objects) {
      // Il nome se c'è, altrimenti il **tipo**: l'id di un oggetto è generato
      // (`mub8v3dph67et`) e non dice niente a chi legge — misurato guardando
      // l'albero vero, 25-09-2026.
      const nome = obj.name || obj.type;
      for (const id of collectTagIds([obj], faceplates)) {
        add(id, {
          where: i18n.t("tagUsage.page", { name: pg.name }),
          categoria: "pagina", pageId: pg.id, oggetto: nome,
        });
      }
    }
  }
  for (const a of alarms) {
    add(a.tag, { where: i18n.t("tagUsage.alarm", { id: a.id }), categoria: "allarme" });
    if (a.inhibit_tag) {
      add(a.inhibit_tag, { where: i18n.t("tagUsage.alarmInhibit", { id: a.id }), categoria: "allarme" });
    }
  }
  for (const td of tags) {
    if (!td.expression) continue;
    for (const mm of td.expression.matchAll(EXPR_RE)) {
      add(mm[2] ?? mm[4] ?? "", {
        where: i18n.t("tagUsage.expression", { id: td.id }), categoria: "espressione",
      });
    }
  }
  for (const gs of globalScripts) {
    for (const mm of gs.code.matchAll(EXPR_RE)) {
      add(mm[2] ?? mm[4] ?? "", {
        where: i18n.t("tagUsage.script", { id: gs.id }), categoria: "script",
      });
    }
  }
  return m;
}
