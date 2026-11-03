// Lo stesso oggetto `{ __html }` per la stessa stringa (03-11-2026).
//
// React 19 riscrive l'`innerHTML` di un elemento con `dangerouslySetInnerHTML`
// ogni volta che l'oggetto passato è nuovo, anche se la stringa è identica. Nel
// canvas questi elementi si ridisegnano a ogni aggiornamento dei tag: con un
// oggetto nuovo per render il loro contenuto veniva buttato e ricreato decine di
// volte al secondo (misurato col tutorial T08). Qui non si può usare un hook — i
// punti che servono sono funzioni di disegno — quindi una cache di modulo,
// limitata perché le stringhe sono disegni interi.

const MAX = 400;
const cache = new Map<string, { __html: string }>();

export function htmlStabile(html: string): { __html: string } {
  let o = cache.get(html);
  if (o) return o;
  o = { __html: html };
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(html, o);
  return o;
}
