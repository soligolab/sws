// La ricerca globale dell'IDE (richiesta del maintainer, 26-10-2026).
//
// **Perché.** Fino a oggi l'unica ricerca era il filtro dentro «Strumenti»,
// che conosce la sola palette. Una variabile si trovava aprendo la
// Configurazione, un oggetto scorrendo le pagine, un allarme ricordandosi in
// che scheda vive. Quattro mondi, quattro strade, nessuna che si incroci.
//
// Il campo sta **sopra** l'albero e non scorre con lui, perché la ricerca non
// è una sezione fra le altre: è il modo di arrivare alle sezioni.
//
// **Cosa fa questo file e cosa no.** Qui c'è solo il motore: da una stringa e
// dal progetto, un elenco di voci con dove stanno e cosa fare per aprirle.
// Niente React, niente DOM — così si prova senza disegnare, come
// `filtraStrumenti`, che infatti viene riusato tale e quale invece di
// riscrivere la ricerca degli strumenti una seconda volta.

import type { SynopticObject, SynopticPage, TagDef } from "@/types";
import type { PaletteGroup, RisultatoStrumento } from "@/editor/LeftPanel";
import { filtraStrumenti } from "@/editor/LeftPanel";
import type { SimboloLib } from "@/symbols/lib/manifest";

export type Categoria = "pagine" | "variabili" | "oggetti" | "strumenti" | "impostazioni";

/** L'ordine in cui i gruppi compaiono. Le variabili per prime perché sono la
 *  cosa che si cerca più spesso; gli strumenti per ultimi fra i «contenuti»
 *  perché si trovano anche scorrendo la palette. */
export const ORDINE: readonly Categoria[] = ["variabili", "pagine", "oggetti", "strumenti", "impostazioni"];

/** Cosa fare quando si apre una voce. Il motore non naviga: dice dove andare,
 *  e chi disegna decide come (`navigateToConfig`, apertura pagina, selezione). */
export type Esito =
  | { tipo: "pagina"; pageId: string }
  | { tipo: "variabile"; id: string }
  | { tipo: "oggetto"; pageId: string; objId: string }
  | { tipo: "strumento"; risultato: RisultatoStrumento }
  | { tipo: "impostazione"; scheda: string; elemento?: string };

export interface Voce {
  categoria: Categoria;
  /** Unica in tutto l'elenco: serve a React e alla navigazione da tastiera. */
  chiave: string;
  nome: string;
  /** La riga sotto il nome: **dove sta**. Senza, due variabili omonime in due
   *  sorgenti diverse sono indistinguibili, e il risultato non serve a niente. */
  dove: string;
  esito: Esito;
}

/** Quante voci al massimo per gruppo. Un elenco che non sta nella colonna non
 *  si legge: meglio dire «e altre 40» che stamparle tutte. */
export const MAX_PER_GRUPPO = 8;

export interface Gruppo {
  categoria: Categoria;
  voci: Voce[];
  /** Quante ne esistono in tutto, anche oltre il tetto. */
  totale: number;
}

export interface ContestoRicerca {
  pages: readonly SynopticPage[];
  tags: readonly TagDef[];
  /** I gruppi della palette già filtrati per contesto (boot, LVGL). */
  gruppiPalette: readonly PaletteGroup[];
  simboli: readonly SimboloLib[];
  /** Le schede di configurazione visibili a chi sta cercando. */
  schede: readonly { id: string }[];
  /** Gli elementi con un nome dentro le schede: allarmi, ricette, report,
   *  sorgenti, faceplate. Chi chiama li raccoglie, perché sa quali esistono. */
  elementi: readonly { scheda: string; id: string; nome?: string }[];
  t: (k: string, o?: Record<string, unknown>) => string;
}

/** Vero se una delle stringhe contiene `q`. Sottostringa e non prefisso: in
 *  `sandokan.pompa_pressione` la parte che uno ricorda sta spesso in mezzo. */
function passa(q: string, ...xs: (string | undefined)[]): boolean {
  return xs.some((x) => !!x && x.toLocaleLowerCase().includes(q));
}

/** Il nome con cui un oggetto si riconosce: la sua etichetta se ce l'ha,
 *  altrimenti il tag che mostra, altrimenti il tipo e l'id. Un id generato
 *  (`mvav2aagbjio9`) da solo non dice niente a nessuno. */
export function nomeOggetto(o: SynopticObject, t: ContestoRicerca["t"]): string {
  const etichetta = (o as { label?: string }).label?.trim();
  if (etichetta) return etichetta;
  const tipo = t(`editor.palette.item.${o.type}`);
  const tag = o.tag?.trim() || (o as { command_tag?: string }).command_tag?.trim();
  return tag ? `${tipo} · ${tag}` : `${tipo} ${o.id ?? ""}`.trim();
}

/** **La ricerca.** Vuota = nessun gruppo, e chi disegna rimette l'albero. */
export function cercaOvunque(testo: string, ctx: ContestoRicerca): Gruppo[] {
  const q = testo.trim().toLocaleLowerCase();
  if (!q) return [];
  const { t } = ctx;
  const per = new Map<Categoria, Voce[]>();
  const metti = (v: Voce) => {
    const a = per.get(v.categoria) ?? [];
    a.push(v);
    per.set(v.categoria, a);
  };

  for (const p of ctx.pages) {
    if (passa(q, p.name, p.id)) {
      metti({
        categoria: "pagine", chiave: `pagina:${p.id}`, nome: p.name || p.id,
        dove: t("ricerca.dovePagina", { n: p.objects?.length ?? 0 }),
        esito: { tipo: "pagina", pageId: p.id },
      });
    }
  }

  for (const tg of ctx.tags) {
    if (passa(q, tg.id, tg.description)) {
      const pezzi = [tg.type_ref ? t("ricerca.istanzaDi", { tipo: tg.type_ref }) : tg.data_type, tg.description]
        .filter(Boolean) as string[];
      metti({
        categoria: "variabili", chiave: `tag:${tg.id}`, nome: tg.id,
        dove: pezzi.join(" · "), esito: { tipo: "variabile", id: tg.id },
      });
    }
  }

  for (const p of ctx.pages) {
    for (const o of p.objects ?? []) {
      if (!o.id) continue;
      const nome = nomeOggetto(o, t);
      if (passa(q, nome, o.id, o.tag, (o as { label?: string }).label)) {
        metti({
          categoria: "oggetti", chiave: `oggetto:${p.id}:${o.id}`, nome,
          dove: t("ricerca.dovePagina2", { pagina: p.name || p.id }),
          esito: { tipo: "oggetto", pageId: p.id, objId: o.id },
        });
      }
    }
  }

  // Gli strumenti li sa già cercare il filtro della palette: stessa funzione,
  // stessi nomi tradotti, nessuna seconda regola che diverga dalla prima.
  for (const r of filtraStrumenti(testo, ctx.gruppiPalette, ctx.simboli, t as (k: string) => string)) {
    metti({
      categoria: "strumenti",
      chiave: r.kind === "tipo" ? `tipo:${r.type}` : `simbolo:${r.sim.id}`,
      nome: r.nome, dove: r.gruppo, esito: { tipo: "strumento", risultato: r },
    });
  }

  for (const s of ctx.schede) {
    const nome = t(`config.tabs.${s.id}`);
    if (passa(q, nome, s.id)) {
      metti({
        categoria: "impostazioni", chiave: `scheda:${s.id}`, nome,
        dove: t("ricerca.doveImpostazione"), esito: { tipo: "impostazione", scheda: s.id },
      });
    }
  }
  for (const e of ctx.elementi) {
    const nome = e.nome?.trim() || e.id;
    if (passa(q, nome, e.id)) {
      metti({
        categoria: "impostazioni", chiave: `elemento:${e.scheda}:${e.id}`, nome,
        dove: t(`config.tabs.${e.scheda}`),
        esito: { tipo: "impostazione", scheda: e.scheda, elemento: e.id },
      });
    }
  }

  return ORDINE.filter((c) => per.has(c)).map((categoria) => {
    const tutte = per.get(categoria)!;
    return { categoria, voci: tutte.slice(0, MAX_PER_GRUPPO), totale: tutte.length };
  });
}

/** Tutte le voci mostrate, in fila: è l'ordine con cui le frecce le
 *  attraversano, e l'elenco su cui Invio sceglie. */
export function inFila(gruppi: readonly Gruppo[]): Voce[] {
  return gruppi.flatMap((g) => g.voci);
}
