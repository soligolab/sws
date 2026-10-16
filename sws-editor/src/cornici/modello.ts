// Le cornici di pagina (15-10-2026, piano docs/plans/2026-10-15-cornici-di-pagina.md).
//
// Nell'IDE una cornice si modifica sul canvas come una pagina: è una pagina dello
// store con `kind: "cornice"`, come quelle di boot hanno `kind: "boot"`. Su disco
// vive in `cornici/<id>.yaml` con la sua forma (`Cornice`): queste funzioni passano
// dall'una all'altra. La composizione che vedono i viewer la fa il runtime
// (`sws-web/src/cornici.rs`); qui c'è il suo gemello per il sottofondo
// attenuato che l'editor disegna sotto una pagina.

import type { Cornice, FasciaCornice, SynopticObject, SynopticPage } from "@/types";
import { genId } from "@/id";

/** Prefisso degli id composti: lo stesso di `PREFISSO_ID` in `cornici.rs`. */
export const PREFISSO_ID = "cornice:";
/** Prefisso dell'id della pagina-cornice nello store, per non collidere con le pagine. */
const PREFISSO_PAGINA = "cornice:";

export const eCornice = (p: { kind?: string } | undefined | null): boolean => p?.kind === "cornice";

export function pagineCornice<T extends { kind?: string }>(pages: readonly T[]): T[] {
  return pages.filter((p) => eCornice(p));
}

/** L'id della cornice di una pagina-cornice dello store. */
export function idCornice(p: Pick<SynopticPage, "id">): string {
  return p.id.startsWith(PREFISSO_PAGINA) ? p.id.slice(PREFISSO_PAGINA.length) : p.id;
}

export function idPaginaDiCornice(id: string): string {
  return PREFISSO_PAGINA + id;
}

const FASCIA_VUOTA: FasciaCornice = { altezza: 0 };

export function corniceAPagina(c: Cornice): SynopticPage {
  return {
    id: idPaginaDiCornice(c.id),
    name: c.nome,
    kind: "cornice",
    width: c.larghezza,
    height: c.altezza,
    objects: c.oggetti ?? [],
    cornice_testata: c.testata ?? FASCIA_VUOTA,
    cornice_piede: c.piede ?? FASCIA_VUOTA,
  };
}

export function paginaACornice(p: SynopticPage): Cornice {
  return {
    id: idCornice(p),
    nome: p.name,
    larghezza: p.width ?? 1280,
    altezza: p.height ?? 800,
    testata: p.cornice_testata ?? FASCIA_VUOTA,
    piede: p.cornice_piede ?? FASCIA_VUOTA,
    oggetti: p.objects.filter((o) => !o.id.startsWith(PREFISSO_ID)),
  };
}

/** L'id della cornice che una pagina mostra, o `null` se nessuna: gemello di
 *  `cornice_della_pagina` in `cornici.rs`. */
export function corniceDellaPagina(p: SynopticPage, predefinita: string | undefined): string | null {
  if (p.kind === "boot" || p.kind === "cornice") return null;
  if (p.cornice === undefined) return predefinita || null;
  return p.cornice || null;
}

export interface Segnaposti {
  paginaNome: string;
  paginaId: string;
  progettoNome: string;
}

/** I segnaposti che una cornice può usare nei suoi testi (gli stessi di `cornici.rs`). */
export const SEGNAPOSTI = {
  paginaNome: "{{pagina.nome}}",
  paginaId: "{{pagina.id}}",
  progettoNome: "{{progetto.nome}}",
} as const;

function sostituisci(s: string, sp: Segnaposti): string {
  if (!s.includes("{{")) return s;
  return s
    .split(SEGNAPOSTI.paginaNome).join(sp.paginaNome)
    .split(SEGNAPOSTI.paginaId).join(sp.paginaId)
    .split(SEGNAPOSTI.progettoNome).join(sp.progettoNome);
}

function risolvi(v: unknown, sp: Segnaposti): unknown {
  if (typeof v === "string") return sostituisci(v, sp);
  if (Array.isArray(v)) return v.map((x) => risolvi(x, sp));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, risolvi(x, sp)]));
  }
  return v;
}

const idComposto = (cornice: string, oggetto: string) => `${PREFISSO_ID}${cornice}:${oggetto}`;

/** Gli oggetti che la cornice aggiunge sotto una pagina, nell'ordine in cui si
 *  disegnano: fondi delle fasce, poi gli oggetti. Gemello di `componi`. */
export function oggettiComposti(c: Cornice, sp: Segnaposti): SynopticObject[] {
  const out: SynopticObject[] = [];
  const fondo = (quale: string, f: FasciaCornice, y: number) => {
    if (!f.sfondo || !(f.altezza > 0)) return;
    out.push({ id: idComposto(c.id, `_${quale}`), type: "rect", x: 0, y, width: c.larghezza, height: f.altezza, fill: f.sfondo });
  };
  fondo("testata", c.testata, 0);
  fondo("piede", c.piede, c.altezza - c.piede.altezza);
  const propri = new Set(c.oggetti.map((o) => o.id));
  for (const o0 of c.oggetti) {
    const o = risolvi(o0, sp) as SynopticObject;
    if (o.from_obj_id && propri.has(o.from_obj_id)) o.from_obj_id = idComposto(c.id, o.from_obj_id);
    if (o.to_obj_id && propri.has(o.to_obj_id)) o.to_obj_id = idComposto(c.id, o.to_obj_id);
    out.push({ ...o, id: idComposto(c.id, o.id) });
  }
  return out;
}

/** Un id libero per una cornice nuova, ricavato dal nome. */
export function idLibero(nome: string, usati: ReadonlySet<string>): string {
  const base = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cornice";
  if (!usati.has(base)) return base;
  let n = 2;
  while (usati.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Un nome libero: «Cornice», poi «Cornice 2»… */
export function nomeLibero(usati: readonly string[], base: string): string {
  const u = new Set(usati);
  if (!u.has(base)) return base;
  let n = 2;
  while (u.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** I modelli da cui nasce una cornice. */
export const MODELLI_CORNICE = ["testata_piede", "solo_piede", "solo_testata", "vuota"] as const;
export type ModelloCornice = (typeof MODELLI_CORNICE)[number];

const ALTEZZA_TESTATA = 56;
const ALTEZZA_PIEDE = 60;
const FONDO_FASCE = "#1e293b";

/** Una cornice nuova da un modello, per pagine `w`×`h`. */
export function daModello(modello: ModelloCornice, id: string, nome: string, w: number, h: number): Cornice {
  const testata = modello === "testata_piede" || modello === "solo_testata";
  const piede = modello === "testata_piede" || modello === "solo_piede";
  const oggetti: SynopticObject[] = [];
  if (testata) {
    oggetti.push(
      { id: genId("titolo"), type: "text", x: 20, y: 36, text: SEGNAPOSTI.paginaNome, font_size: 22, font_weight: "bold", text_anchor: "start", color: "#e2e8f0" },
      { id: genId("data_ora"), type: "clock", x: w - 220, y: 10, width: 200, height: 36, clock_formato: "data_ora", font_size: 18, text_anchor: "end", color: "#e2e8f0" },
    );
  }
  if (piede) {
    oggetti.push({
      id: genId("navigatore"), type: "page_navigator", x: 10, y: h - ALTEZZA_PIEDE + 8, width: w - 20, height: ALTEZZA_PIEDE - 16,
      nav_orientation: "horizontal", nav_fill: true, nav_gap: 4,
    });
  }
  return {
    id, nome, larghezza: w, altezza: h,
    testata: testata ? { altezza: ALTEZZA_TESTATA, sfondo: FONDO_FASCE } : { altezza: 0 },
    piede: piede ? { altezza: ALTEZZA_PIEDE, sfondo: FONDO_FASCE } : { altezza: 0 },
    oggetti,
  };
}
