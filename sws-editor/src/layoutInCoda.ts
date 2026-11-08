// La coda delle scritture di `page_layout` (08-11-2026, piano dell'impostazione
// iniziale, sessione I2). Ogni `PUT /api/project/page-layout` è versionata, e il
// server sostituisce il `page_layout` intero: due scritture partite insieme dalla
// stessa versione davano un 409 alla seconda, o una cancellava l'altra. Erano
// cinque scrittori (il formato del progetto, la prima impostazione di una
// pagina, il boot abilitato, la cornice predefinita, l'albero delle pagine nel
// Salva), e solo il primo stava in coda.
//
// Un modulo foglia, senza store: lo usano sia lo store (il Salva) sia
// `formatoProgettoAzioni.ts`, che lo store lo importa.

let coda: Promise<unknown> = Promise.resolve();

/** Esegue `lavoro` dopo le scritture già in coda, anche se una è fallita. */
export function inCodaLayout<T>(lavoro: () => Promise<T>): Promise<T> {
  const giro = coda.catch(() => undefined).then(lavoro);
  coda = giro;
  return giro;
}
