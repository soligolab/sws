// C'è un pannello collegato? (25-10-2026, piano 2026-10-25-impianto-dal-dispositivo)
//
// Lo legge `suImpianto` in `api/client` e lo tiene allineato lo store
// (`remoteConnected`). Sta in un modulo suo, senza dipendenze, perché lo store
// importa il client e il contrario sarebbe un ciclo — e perché i test che
// sostituiscono `@/api/client` con un mock parziale non devono perderlo.
let collegato = false;

export function segnaPannelloCollegato(v: boolean): void {
  collegato = v;
}

export function pannelloCollegato(): boolean {
  return collegato;
}
