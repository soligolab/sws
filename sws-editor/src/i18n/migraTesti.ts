// Migrazione dei testi letterali di un progetto esistente alla tabella lingue.
//
// I progetti nati prima del sistema di lingue hanno il testo scritto dentro gli
// oggetti («Potenza (W)»); il sistema nuovo lo vuole come `{{tNNNN}}` con il
// testo nella colonna della lingua principale. L'editor lo fa da solo solo per
// ciò che si digita da adesso: qui si recupera il pregresso.
//
// Pura, senza React né rete: prende lo stato, restituisce lo stato nuovo e un
// riepilogo. Le regole di cosa si traduce sono **le stesse** dell'editor
// (`traducibile`, `TEXT_FIELDS`): un campo che la migrazione toccherebbe e la
// digitazione no sarebbe un secondo elenco che mente.

import type { AlarmDef, FaceplateDef, LanguageTable, SynopticObject, SynopticPage } from "@/types";
import { TEXT_FIELDS } from "@/i18n/projectI18n";
import { prossimaChiave, traducibile } from "@/i18n/chiaviAutomatiche";

export interface RiepilogoMigrazione {
  /** Campi di testo riscritti come token. */
  campi: number;
  /** Voci nuove create nella tabella. */
  vociNuove: number;
  /** Campi che hanno riusato una voce già esistente (stesso testo). */
  riusi: number;
  pagineToccate: string[];
  faceplateToccati: string[];
  allarmi: number;
}

export interface EsitoMigrazione {
  pages: SynopticPage[];
  faceplates: FaceplateDef[];
  alarms: AlarmDef[];
  tabella: LanguageTable;
  riepilogo: RiepilogoMigrazione;
}

export function migraTestiProgetto(
  input: {
    pages: SynopticPage[];
    faceplates: FaceplateDef[];
    alarms: AlarmDef[];
    tabella?: LanguageTable | null;
  },
): EsitoMigrazione {
  const tabella: LanguageTable = input.tabella
    ? { ...input.tabella, entries: [...input.tabella.entries] }
    : { default: "it", langs: ["it"], entries: [] };
  if (!tabella.default) tabella.default = tabella.langs[0] ?? "it";
  if (!tabella.langs.includes(tabella.default)) tabella.langs = [...tabella.langs, tabella.default];

  const principale = tabella.default;
  const perTesto = new Map<string, string>();
  for (const e of tabella.entries) {
    const v = (e.values[principale] ?? "").trim();
    if (v && !perTesto.has(v)) perTesto.set(v, e.key);
  }
  const r: RiepilogoMigrazione = {
    campi: 0, vociNuove: 0, riusi: 0, pagineToccate: [], faceplateToccati: [], allarmi: 0,
  };

  const token = (testo: string): string => {
    const atteso = testo.trim();
    let key = perTesto.get(atteso);
    if (key) {
      r.riusi++;
    } else {
      key = prossimaChiave(tabella);
      tabella.entries.push({ key, values: { [principale]: testo } });
      perTesto.set(atteso, key);
      r.vociNuove++;
    }
    r.campi++;
    return `{{${key}}}`;
  };

  const oggetti = (objs: SynopticObject[]): { objs: SynopticObject[]; toccato: boolean } => {
    let toccato = false;
    const out = objs.map((o) => {
      let copia: SynopticObject | null = null;
      for (const k of TEXT_FIELDS) {
        const v = o[k];
        if (typeof v !== "string" || !traducibile(v)) continue;
        copia ??= { ...o };
        (copia as unknown as Record<string, unknown>)[k] = token(v);
      }
      if (copia) toccato = true;
      return copia ?? o;
    });
    return { objs: out, toccato };
  };

  const pages = input.pages.map((p) => {
    const { objs, toccato } = oggetti(p.objects);
    if (!toccato) return p;
    r.pagineToccate.push(p.id);
    return { ...p, objects: objs };
  });
  const faceplates = input.faceplates.map((f) => {
    const { objs, toccato } = oggetti(f.objects);
    if (!toccato) return f;
    r.faceplateToccati.push(f.id);
    return { ...f, objects: objs };
  });
  const alarms = input.alarms.map((a) => {
    if (typeof a.message !== "string" || !traducibile(a.message)) return a;
    r.allarmi++;
    return { ...a, message: token(a.message) };
  });

  return { pages, faceplates, alarms, tabella, riepilogo: r };
}
