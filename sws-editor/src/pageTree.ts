// L'albero delle pagine di progetto (`page_layout.page_tree`): gerarchia e
// ordine. Funzioni pure, gemelle di `sws-core/src/page_tree.rs`: i casi stanno
// in `tests/fixtures/albero-pagine.json` e li leggono entrambe.
//
// Fino al 20-09-2026 l'ordine delle pagine non era un dato: `reorderPage`
// toccava l'array in memoria e a ogni ricarica tornava l'ordine alfabetico dei
// nomi di file. L'albero lo rende esplicito, e con la gerarchia permette un
// menù a livelli.

import type { PageTreeNode } from "@/types";

const nodo = (id: string, children: PageTreeNode[]): PageTreeNode =>
  children.length > 0 ? { id, children } : { id };

/** L'albero coerente con le pagine che esistono: scarta id inesistenti e
 *  duplicati (vince la prima occorrenza; i figli di un nodo scartato salgono al
 *  suo posto) e appende in coda alla radice le pagine che l'albero non nomina,
 *  nell'ordine in cui arrivano. Un albero assente è un elenco piatto. */
export function riconcilia(albero: readonly PageTreeNode[] | null | undefined, ids: readonly string[]): PageTreeNode[] {
  const esistenti = new Set(ids);
  const visti = new Set<string>();
  const visita = (nodi: readonly PageTreeNode[]): PageTreeNode[] => {
    const out: PageTreeNode[] = [];
    for (const n of nodi) {
      if (!esistenti.has(n.id) || visti.has(n.id)) {
        out.push(...visita(n.children ?? []));
        continue;
      }
      visti.add(n.id);
      out.push(nodo(n.id, visita(n.children ?? [])));
    }
    return out;
  };
  const out = visita(albero ?? []);
  for (const id of ids) {
    if (!visti.has(id)) {
      visti.add(id);
      out.push({ id });
    }
  }
  return out;
}

/** Gli id in ordine di visita in profondità. */
export function appiattisci(albero: readonly PageTreeNode[]): string[] {
  return albero.flatMap((n) => [n.id, ...appiattisci(n.children ?? [])]);
}

const contiene = (nodi: readonly PageTreeNode[], id: string): boolean =>
  nodi.some((n) => n.id === id || contiene(n.children ?? [], id));

/** Sposta un nodo (con i suoi figli) sotto `genitore` (`null` = radice) alla
 *  posizione `indice`, contata **dopo** l'estrazione e limitata alla coda.
 *  `null` se l'id o il genitore non esistono, o se lo spostamento farebbe un
 *  ciclo (un nodo dentro se stesso o dentro un suo discendente). */
export function sposta(
  albero: readonly PageTreeNode[], id: string, genitore: string | null, indice: number,
): PageTreeNode[] | null {
  let estratto: PageTreeNode | null = null;
  const senza = (nodi: readonly PageTreeNode[]): PageTreeNode[] => {
    const out: PageTreeNode[] = [];
    for (const n of nodi) {
      if (n.id === id) { estratto = n; continue; }
      out.push(nodo(n.id, senza(n.children ?? [])));
    }
    return out;
  };
  const resto = senza(albero);
  const sotto = estratto as PageTreeNode | null;
  if (!sotto) return null;
  if (genitore === null) {
    const i = Math.max(0, Math.min(indice, resto.length));
    return [...resto.slice(0, i), sotto, ...resto.slice(i)];
  }
  if (genitore === id || contiene(sotto.children ?? [], genitore)) return null;
  let trovato = false;
  const dentro = (nodi: readonly PageTreeNode[]): PageTreeNode[] =>
    nodi.map((n) => {
      if (n.id === genitore) {
        trovato = true;
        const figli = n.children ?? [];
        const i = Math.max(0, Math.min(indice, figli.length));
        return { id: n.id, children: [...figli.slice(0, i), sotto, ...figli.slice(i)] };
      }
      return nodo(n.id, dentro(n.children ?? []));
    });
  const out = dentro(resto);
  return trovato ? out : null;
}

/** Toglie un nodo: i suoi figli salgono al suo posto, nello stesso ordine. */
export function rimuovi(albero: readonly PageTreeNode[], id: string): PageTreeNode[] {
  return albero.flatMap((n) =>
    n.id === id ? [...(n.children ?? [])] : [nodo(n.id, rimuovi(n.children ?? [], id))]);
}

/** Inserisce una pagina nuova sotto `genitore` (`null` = radice), in coda. Se
 *  il genitore non esiste va in radice. */
export function aggiungi(albero: readonly PageTreeNode[], id: string, genitore: string | null): PageTreeNode[] {
  if (genitore !== null && contiene(albero, genitore)) {
    const dentro = (nodi: readonly PageTreeNode[]): PageTreeNode[] =>
      nodi.map((n) => n.id === genitore
        ? { id: n.id, children: [...(n.children ?? []), { id }] }
        : nodo(n.id, dentro(n.children ?? [])));
    return dentro(albero);
  }
  return [...albero, { id }];
}

/** Dove sta un nodo: il suo genitore (`null` = radice) e la posizione fra i fratelli. */
export function posizioneDi(
  albero: readonly PageTreeNode[], id: string, genitore: string | null = null,
): { genitore: string | null; indice: number } | null {
  const i = albero.findIndex((n) => n.id === id);
  if (i >= 0) return { genitore, indice: i };
  for (const n of albero) {
    const r = posizioneDi(n.children ?? [], id, n.id);
    if (r) return r;
  }
  return null;
}

export interface RigaAlbero {
  id: string;
  livello: number;
  haFigli: boolean;
  aperto: boolean;
}

/** Le righe da disegnare: profondità e stato, saltando i figli dei nodi chiusi.
 *  `chiusi` è l'insieme degli id compressi (di default tutto è aperto). */
export function righe(albero: readonly PageTreeNode[], chiusi: ReadonlySet<string>, livello = 0): RigaAlbero[] {
  return albero.flatMap((n) => {
    const haFigli = (n.children?.length ?? 0) > 0;
    const aperto = haFigli && !chiusi.has(n.id);
    return [
      { id: n.id, livello, haFigli, aperto },
      ...(aperto ? righe(n.children ?? [], chiusi, livello + 1) : []),
    ];
  });
}

/** Le pagine nell'ordine dell'albero riconciliato. Non tocca le pagine che non
 *  sono sinottiche: chi chiama passa solo quelle. */
export function ordinaPagine<T extends { id: string }>(
  pagine: readonly T[], albero: readonly PageTreeNode[] | null | undefined,
): T[] {
  const perId = new Map(pagine.map((p) => [p.id, p]));
  const ordine = appiattisci(riconcilia(albero, pagine.map((p) => p.id)));
  return ordine.map((id) => perId.get(id)!).filter(Boolean);
}

/** Gli id sotto un nodo (figli, nipoti…), senza il nodo stesso. */
export function discendentiDi(albero: readonly PageTreeNode[], id: string): string[] {
  for (const n of albero) {
    if (n.id === id) return appiattisci(n.children ?? []);
    const r = discendentiDi(n.children ?? [], id);
    if (r.length > 0) return r;
  }
  return [];
}

export type ZonaRilascio = "prima" | "dopo" | "dentro";

/** Sposta `id` rispetto a un'altra riga: prima, dopo, o dentro (in coda ai suoi
 *  figli). L'indice si conta sull'albero **senza** il nodo trascinato, così
 *  spostare un fratello più in basso non sbaglia di uno. `null` se `bersaglio`
 *  è il nodo stesso o sta nel suo sottoalbero (un ciclo), o se un id non esiste. */
export function spostaRispettoA(
  albero: readonly PageTreeNode[], id: string, bersaglio: string, zona: ZonaRilascio,
): PageTreeNode[] | null {
  if (bersaglio === id) return null;
  const senza = sposta(albero, id, null, Number.MAX_SAFE_INTEGER);
  if (!senza) return null;
  // `senza` ha il nodo in coda alla radice; il bersaglio dentro il suo sottoalbero
  // lo troverebbe lì, ed è proprio il ciclo da rifiutare.
  if (discendentiDi(senza, id).includes(bersaglio)) return null;
  const resto = rimuoviSottoalbero(senza, id);
  if (zona === "dentro") {
    const b = trova(resto, bersaglio);
    if (!b) return null;
    return sposta(albero, id, bersaglio, b.children?.length ?? 0);
  }
  const pos = posizioneDi(resto, bersaglio);
  if (!pos) return null;
  return sposta(albero, id, pos.genitore, zona === "prima" ? pos.indice : pos.indice + 1);
}

function rimuoviSottoalbero(albero: readonly PageTreeNode[], id: string): PageTreeNode[] {
  return albero.filter((n) => n.id !== id).map((n) => nodo(n.id, rimuoviSottoalbero(n.children ?? [], id)));
}

function trova(albero: readonly PageTreeNode[], id: string): PageTreeNode | null {
  for (const n of albero) {
    if (n.id === id) return n;
    const r = trova(n.children ?? [], id);
    if (r) return r;
  }
  return null;
}

/** I figli diretti di un nodo, in ordine; `null` = i nodi di primo livello.
 *  Un id che non c'è nell'albero non ha figli. */
export function figliDi(albero: readonly PageTreeNode[], id: string | null): string[] {
  if (id === null) return albero.map((n) => n.id);
  const n = trova(albero, id);
  return n ? (n.children ?? []).map((c) => c.id) : [];
}

/** Gli id dalla radice fino a `id` compreso, o `[]` se non c'è. */
export function percorsoFinoA(albero: readonly PageTreeNode[], id: string): string[] {
  for (const n of albero) {
    if (n.id === id) return [n.id];
    const sotto = percorsoFinoA(n.children ?? [], id);
    if (sotto.length > 0) return [n.id, ...sotto];
  }
  return [];
}
