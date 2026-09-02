// Il diff riga per riga di due blocchi di codice.
//
// # Perché serve, e perché non basta dire «modificata»
//
// Il diff della chat elenca *cosa* cambia: «tag `x`», «button `b` in «Pagina»».
// Per il codice Python quella granularità è inutile — «funzione `allarme_alto`
// modificata» non dice se è stata aggiunta una riga o riscritta da capo, e chi
// approva non ha modo di accorgersi che metà del corpo è sparita. Una proposta
// che nessuno rilegge davvero passa lo stesso, ed è il rischio vero di tutta
// questa funzione.
//
// # Perché un LCS e non un confronto di prefisso e suffisso
//
// Tagliare il prefisso e il suffisso comuni è cinque righe, ma su una modifica
// interna mostra come «cambiato» tutto il blocco fra la prima e l'ultima
// differenza: chi legge non distingue una riga aggiunta in mezzo da una
// riscrittura. Un LCS classico dà il diff vero, e su blocchi di codice — il
// tetto è 64 KiB, in pratica decine di righe — il costo quadratico non si sente.
//
// La guardia sul limite non è pessimismo: `code` può contenere un blob
// incollato, e una matrice 5000×5000 bloccherebbe la finestra mentre l'utente
// aspetta un diff. Oltre il limite si dice **quanto** cambia invece di come, che
// è meno utile ma resta vero.

/** Una riga del diff: `+` aggiunta, `-` togliuta, ` ` contesto. */
export interface RigaDiff {
  verso: "+" | "-" | " ";
  testo: string;
}

/** Oltre questo numero di righe per lato si rinuncia all'LCS. */
export const LIMITE_RIGHE = 400;

/** Quante righe di contesto attorno a ogni gruppo di modifiche. */
const CONTESTO = 2;

export function diffRighe(prima: string, dopo: string): {
  righe: RigaDiff[];
  /** `true` = elenco troncato o non calcolato; vedi `nota`. */
  parziale: boolean;
  nota?: string;
} {
  const a = prima.split("\n");
  const b = dopo.split("\n");

  if (a.length > LIMITE_RIGHE || b.length > LIMITE_RIGHE) {
    return {
      righe: [],
      parziale: true,
      nota: `${a.length} righe prima, ${b.length} dopo: troppo per un diff riga per riga`,
    };
  }

  // LCS su matrice di lunghezze.
  const n = a.length, m = b.length;
  const l: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      l[i][j] = a[i] === b[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
    }
  }

  const tutte: RigaDiff[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { tutte.push({ verso: " ", testo: a[i] }); i++; j++; }
    else if (l[i + 1][j] >= l[i][j + 1]) { tutte.push({ verso: "-", testo: a[i] }); i++; }
    else { tutte.push({ verso: "+", testo: b[j] }); j++; }
  }
  while (i < n) tutte.push({ verso: "-", testo: a[i++] });
  while (j < m) tutte.push({ verso: "+", testo: b[j++] });

  // Si mostra il contesto attorno alle modifiche, non il file intero: su una
  // funzione di ottanta righe con due cambiate, ottanta righe di diff sono un
  // altro modo di non farla rileggere.
  const tieni = new Set<number>();
  tutte.forEach((r, k) => {
    if (r.verso === " ") return;
    for (let d = -CONTESTO; d <= CONTESTO; d++) {
      const x = k + d;
      if (x >= 0 && x < tutte.length) tieni.add(x);
    }
  });

  const righe: RigaDiff[] = [];
  let salti = 0;
  tutte.forEach((r, k) => {
    if (tieni.has(k)) { righe.push(r); } else { salti++; }
  });

  return {
    righe,
    parziale: salti > 0,
    nota: salti > 0 ? `${salti} righe invariate non mostrate` : undefined,
  };
}
