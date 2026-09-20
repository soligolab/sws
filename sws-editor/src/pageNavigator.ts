// Le voci di un navigatore di pagine (`page_navigator`): quali pagine, in che
// ordine, con che etichetta, quale è la corrente. Pura, gemella di
// `voci_navigatore` in `sws-core/src/page_tree.rs`: i casi stanno in
// `tests/fixtures/navigatore-pagine.json` e li leggono entrambe — se web e LVGL
// divergessero, lo stesso progetto mostrerebbe due menù diversi.

import type { LanguageTable, NavItem, PageTreeNode, SynopticObject } from "@/types";
import { resolveMsg } from "@/i18n/projectI18n";
import { appiattisci, figliDi, percorsoFinoA, posizioneDi, riconcilia } from "@/pageTree";

export interface VoceNavigatore {
  id: string;
  label: string;
  /** È la pagina in cui ci si trova adesso. */
  attiva: boolean;
  /** Viene dal percorso (briciole), non dalle voci vere e proprie. */
  percorso: boolean;
}

export type ConfigNavigatore = Pick<SynopticObject, "nav_source" | "nav_node" | "nav_breadcrumb" | "nav_items">;

export function vociNavigatore(
  pagine: readonly { id: string; name: string }[],
  albero: readonly PageTreeNode[] | null | undefined,
  corrente: string,
  cfg: ConfigNavigatore,
  lang: string,
  table: LanguageTable | null | undefined,
): VoceNavigatore[] {
  const alb = riconcilia(albero, pagine.map((p) => p.id));
  const nome = new Map(pagine.map((p) => [p.id, p.name]));

  // Quali pagine, e di quale genitore sono figlie (per il percorso).
  let elenco: string[] = [];
  let contenitore: string | null = null;
  switch (cfg.nav_source ?? "all") {
    case "roots":
      elenco = figliDi(alb, null);
      break;
    case "children_of":
      if (cfg.nav_node && posizioneDi(alb, cfg.nav_node)) {
        elenco = figliDi(alb, cfg.nav_node);
        contenitore = cfg.nav_node;
      }
      break;
    case "children_of_current": {
      const figli = figliDi(alb, corrente);
      if (figli.length > 0) {
        elenco = figli;
        contenitore = corrente;
      } else {
        const pos = posizioneDi(alb, corrente);
        if (pos) {
          elenco = figliDi(alb, pos.genitore);
          contenitore = pos.genitore;
        }
      }
      break;
    }
    default:
      elenco = appiattisci(alb);
  }

  const eccezioni = new Map<string, NavItem>();
  for (const it of cfg.nav_items ?? []) {
    if (nome.has(it.page_id) && !eccezioni.has(it.page_id)) eccezioni.set(it.page_id, it);
  }
  const visibile = (id: string) => !eccezioni.get(id)?.hidden;

  // Le voci con una posizione propria vanno al loro posto (1 = prima) fra le
  // visibili; le altre restano nell'ordine dell'albero.
  const base = elenco.filter((id) => visibile(id) && eccezioni.get(id)?.order === undefined);
  const conPosto = elenco
    .map((id, i) => ({ id, i, ordine: eccezioni.get(id)?.order }))
    .filter((x): x is { id: string; i: number; ordine: number } =>
      visibile(x.id) && typeof x.ordine === "number" && Number.isFinite(x.ordine))
    .sort((a, b) => a.ordine - b.ordine || a.i - b.i);
  for (const x of conPosto) {
    base.splice(Math.max(0, Math.min(Math.floor(x.ordine) - 1, base.length)), 0, x.id);
  }

  const percorso = cfg.nav_breadcrumb && contenitore !== null
    ? percorsoFinoA(alb, contenitore).filter(visibile)
    : [];

  const voce = (id: string, dalPercorso: boolean): VoceNavigatore => {
    const propria = eccezioni.get(id)?.label?.trim();
    return {
      id,
      label: resolveMsg(propria ? propria : nome.get(id) ?? id, lang, table),
      attiva: id === corrente,
      percorso: dalPercorso,
    };
  };
  return [...percorso.map((id) => voce(id, true)), ...base.map((id) => voce(id, false))];
}

export interface RettangoloBottone { x: number; y: number; w: number; h: number }

export interface ConfigGeometria {
  orientation?: "horizontal" | "vertical";
  fill?: boolean;
  size?: number;
  gap?: number;
  align?: "start" | "center" | "end";
}

/** Dove cade ogni bottone, relativo all'origine dell'oggetto, in pixel interi.
 *  Gemella di `geometria_navigatore` (`sws-core/src/page_tree.rs`): stessa fixture
 *  (`tests/fixtures/geometria-navigatore.json`), così i bottoni cadono negli stessi
 *  pixel sul web e su LVGL. Sull'asse trasversale i bottoni riempiono l'oggetto. */
export function geometriaNavigatore(w: number, h: number, n: number, cfg: ConfigGeometria): RettangoloBottone[] {
  if (n <= 0) return [];
  const verticale = cfg.orientation === "vertical";
  const principale = verticale ? h : w;
  const trasversale = verticale ? w : h;
  const gap = Math.max(0, cfg.gap ?? 4);
  const disponibile = Math.max(0, principale - gap * (n - 1));
  const uno = disponibile / n;
  const esatto = cfg.fill === false ? Math.min(Math.max(1, cfg.size ?? 120), uno) : uno;
  const totale = esatto * n + gap * (n - 1);
  const inizio = cfg.fill === false
    ? (cfg.align === "center" ? (principale - totale) / 2 : cfg.align === "end" ? principale - totale : 0)
    : 0;
  return Array.from({ length: n }, (_, i) => {
    const pos = Math.round(inizio + i * (esatto + gap));
    const len = Math.round(esatto);
    return verticale
      ? { x: 0, y: pos, w: Math.round(trasversale), h: len }
      : { x: pos, y: 0, w: len, h: Math.round(trasversale) };
  });
}
