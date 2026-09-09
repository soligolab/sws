// Tenere una sezione del pannello di configurazione allineata al progetto
// **senza buttare via quello che l'utente sta scrivendo**.
//
// PERCHÉ ESISTE
//
// Il pannello variabili faceva così:
//
//     useEffect(() => {
//       if (storeProject?.tags) { setTags(storeProject.tags); setTouched(false); }
//     }, [storeProject]);
//
// `storeProject` cambia **identità ogni volta che si salva una qualunque altra
// sezione** — sorgenti, allarmi, lingue, funzioni, simboli sono tutti
// `{ ...s.project, … }`. Quindi salvare le sorgenti cancellava la riga che
// stavi scrivendo fra le variabili, e `setTouched(false)` spegneva pure
// l'indicatore di «non salvato»: niente avvisava. Poi «Salva» scriveva
// onestamente la lista vuota e diceva «Salvato» — che era vero, ed è il motivo
// per cui non sembrava un errore.
//
// Segnalato dal maintainer il 2026-09-08: «creo una variabile pippo, dice di
// aver salvato, cambio tab e non c'è più».
//
// LA REGOLA, decisa dal maintainer
//
// Il progetto può sovrascrivere la sezione, **ma lo deve chiedere**. Quindi:
//
// - niente da salvare  → si allinea in silenzio, com'è sempre stato;
// - modifiche in corso → non si tocca niente e si alza un conflitto, che il
//   pannello mostra con due pulsanti: tieni le mie, oppure ricarica;
// - progetto DIVERSO   → si allinea sempre, senza chiedere: le modifiche
//   riguardavano un altro progetto e tenerle sarebbe peggio che perderle.
//
// Finché non si risponde vincono le modifiche locali: un avviso che aspetta è
// recuperabile, una riga cancellata no.

import { useEffect, useRef, useState } from "react";

export interface SezioneSincronizzata {
  /** Il progetto è cambiato mentre c'erano modifiche non salvate. */
  conflitto: boolean;
  /** Tieni quello che hai scritto e smetti di chiedere per questo valore. */
  mantieni: () => void;
  /** Butta le modifiche e prendi la versione del progetto. */
  ricarica: () => void;
}

export function useSezioneSincronizzata<T>(opts: {
  /** Il valore che arriva dal progetto. Confrontato **per riferimento**: è così
   *  che lo store segnala un cambiamento, e un confronto profondo qui costerebbe
   *  a ogni render senza dire niente di più. */
  remoto: T | undefined;
  /** Come si applica alla sezione. */
  applica: (v: T) => void;
  /** C'è qualcosa di non salvato in questa sezione. */
  modificato: boolean;
  /** Nome del progetto aperto: se cambia, è un altro progetto e non si chiede. */
  progetto: string | undefined;
}): SezioneSincronizzata {
  const { remoto, applica, modificato, progetto } = opts;

  // Ultimo valore effettivamente applicato (o esplicitamente rifiutato con
  // «mantieni»): serve a non richiedere due volte per lo stesso cambiamento.
  const visto = useRef<T | undefined>(undefined);
  const progettoPrec = useRef<string | undefined>(undefined);
  const [inSospeso, setInSospeso] = useState<{ v: T } | null>(null);

  // `applica` è quasi sempre una funzione nuova a ogni render (un setter di
  // stato avvolto in una closure): tenerla nelle dipendenze farebbe girare
  // l'effetto in continuazione. Si legge da una ref, che è il modo di usare
  // sempre l'ultima senza dipenderne.
  const applicaRef = useRef(applica);
  applicaRef.current = applica;
  const modificatoRef = useRef(modificato);
  modificatoRef.current = modificato;

  useEffect(() => {
    if (remoto === undefined) return;

    const cambioProgetto = progettoPrec.current !== progetto;
    progettoPrec.current = progetto;

    if (cambioProgetto) {
      // Un altro progetto: si allinea e basta. Chiedere se tenere modifiche
      // che appartengono a un progetto che non è più aperto non aiuterebbe
      // nessuno.
      visto.current = remoto;
      setInSospeso(null);
      applicaRef.current(remoto);
      return;
    }

    if (remoto === visto.current) return;

    if (!modificatoRef.current) {
      visto.current = remoto;
      setInSospeso(null);
      applicaRef.current(remoto);
      return;
    }

    // Modifiche in corso: non si tocca niente, si chiede.
    setInSospeso({ v: remoto });
  }, [remoto, progetto]);

  return {
    conflitto: inSospeso !== null,
    mantieni: () => {
      // Il valore si segna come «visto» senza applicarlo: così lo stesso
      // cambiamento non ripropone la domanda a ogni render.
      if (inSospeso) visto.current = inSospeso.v;
      setInSospeso(null);
    },
    ricarica: () => {
      if (inSospeso) {
        visto.current = inSospeso.v;
        applicaRef.current(inSospeso.v);
      }
      setInSospeso(null);
    },
  };
}
