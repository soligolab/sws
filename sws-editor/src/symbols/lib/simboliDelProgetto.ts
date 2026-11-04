// I simboli disegnati nel progetto, tenuti allineati fra lo store e la libreria.
//
// Lo store ha le **descrizioni** (`project.simboli`); il canvas, la palette, le
// bocche dei tubi e Collegamenti leggono la libreria (`libreria.ts`). Ogni volta
// che le descrizioni cambiano — un progetto aperto, una proposta dell'assistente
// applicata, un annulla — il runtime le ricompila e lo strato del progetto della
// libreria si aggiorna. Così una proposta si disegna prima di essere salvata.
//
// Piano: docs/plans/2026-11-03-assistente-genera-simboli-e-sinottici.md (F2).

import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo } from "@/types";
import { impostaSimboliProgetto, ricaricaSimboliProgetto } from "./libreria";

let ultime: DescrizioneSimbolo[] | undefined;
let giro = 0;

/** Ricompila e pubblica nella libreria. Se la compilazione non è permessa
 *  (un viewer anonimo), ricade sul manifesto servito dal runtime. */
export async function sincronizzaSimboli(simboli: DescrizioneSimbolo[] | undefined): Promise<void> {
  const mio = ++giro;
  if (!simboli?.length) {
    impostaSimboliProgetto([]);
    return;
  }
  try {
    const esiti = await api.compilaSimboli(simboli);
    if (mio !== giro) return;
    impostaSimboliProgetto(
      esiti.filter((e) => e.ok && e.voce && e.svg).map((e) => ({ voce: e.voce!, svg: e.svg! })),
    );
  } catch {
    if (mio === giro) ricaricaSimboliProgetto();
  }
}

/** Avvia l'ascolto dello store: da chiamare una volta all'avvio dell'app. */
export function avviaSincroniaSimboli(): () => void {
  const guarda = (simboli: DescrizioneSimbolo[] | undefined) => {
    if (simboli === ultime) return;
    ultime = simboli;
    void sincronizzaSimboli(simboli);
  };
  guarda(useAppStore.getState().project?.simboli);
  return useAppStore.subscribe((s) => guarda(s.project?.simboli));
}
