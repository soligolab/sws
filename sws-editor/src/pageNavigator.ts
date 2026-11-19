// Le voci di un navigatore di pagine (`page_navigator`): quali pagine, in che
// ordine, con che etichetta, quale è la corrente. Pura, gemella di
// `voci_navigatore` in `sws-core/src/page_tree.rs`: i casi stanno in
// `tests/fixtures/navigatore-pagine.json` e li leggono entrambe — se web e LVGL
// divergessero, lo stesso progetto mostrerebbe due menù diversi.

import type { LanguageTable, NavItem, NavLink, PageTreeNode, SynopticObject } from "@/types";
import { resolveMsg } from "@/i18n/projectI18n";
import { appiattisci, figliDi, percorsoFinoA, posizioneDi, riconcilia } from "@/pageTree";

export interface VoceNavigatore {
  id: string;
  label: string;
  /** È la pagina in cui ci si trova adesso. */
  attiva: boolean;
  /** Viene dal percorso (briciole), non dalle voci vere e proprie. */
  percorso: boolean;
  /** An extra button (`nav_links`), not a page of the tree. Present only when true. */
  extra?: true;
}

export type ConfigNavigatore = Pick<SynopticObject, "nav_source" | "nav_node" | "nav_breadcrumb" | "nav_items" | "nav_links">;

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

  // The extra buttons go among the entries after them: the ones with a position
  // at their place (same rule as the exceptions), the others at the end, in the
  // order they were written. One towards a page that isn't here is dropped.
  type Slot = { page: string } | { link: NavLink };
  const voci: Slot[] = base.map((id) => ({ page: id }));
  const links = (cfg.nav_links ?? []).map((link, i) => ({ link, i })).filter((x) => nome.has(x.link.page_id));
  const conPostoLink = links
    .filter((x) => typeof x.link.order === "number" && Number.isFinite(x.link.order))
    .sort((a, b) => (a.link.order as number) - (b.link.order as number) || a.i - b.i);
  // Two buttons asking for the same place keep the order they were written in.
  let last: number | null = null;
  for (const x of conPostoLink) {
    const wanted = Math.floor(x.link.order as number) - 1;
    const pos = Math.max(0, Math.min(last === null ? wanted : Math.max(wanted, last + 1), voci.length));
    voci.splice(pos, 0, { link: x.link });
    last = pos;
  }
  for (const x of links) {
    if (!(typeof x.link.order === "number" && Number.isFinite(x.link.order))) voci.push({ link: x.link });
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
  // An extra button is lit on its page and on the pages next to it (same
  // parent): «Idro» towards the first page of a sub-menu stays lit on every page
  // of that sub-menu. Towards a top-level page, only on that page.
  const genitore = (id: string) => posizioneDi(alb, id)?.genitore ?? null;
  const voceLink = (l: NavLink): VoceNavigatore => {
    const propria = l.label?.trim();
    const g = genitore(l.page_id);
    return {
      id: l.page_id,
      label: resolveMsg(propria ? propria : nome.get(l.page_id) ?? l.page_id, lang, table),
      attiva: l.page_id === corrente || (g !== null && genitore(corrente) === g),
      percorso: false,
      extra: true,
    };
  };
  return [
    ...percorso.map((id) => voce(id, true)),
    ...voci.map((s) => ("page" in s ? voce(s.page, false) : voceLink(s.link))),
  ];
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
