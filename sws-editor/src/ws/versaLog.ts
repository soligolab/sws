// Le righe del log arrivano una per frame, e alla connessione il pannello ne
// manda mille di fila (l'anello del suo `LogBus`). Versarle nello store una
// alla volta voleva dire mille copie dell'elenco e mille ridisegni del
// pannello del log: il «download dei log precedenti» lento del collaudo del
// 07-11-2026 era tutto qui, non nella rete. Il versatore le raccoglie e le
// versa a blocchi, una volta ogni `OGNI_MS`.

import type { LogEvent } from "@/types";

/** Ogni quanto si versa. 100 ms: abbastanza per mille righe in un colpo, poco
 *  abbastanza perché la coda dal vivo sembri dal vivo. `setTimeout` e non
 *  `requestAnimationFrame`, che in una scheda in secondo piano si ferma — e la
 *  finestra staccata del log ci sta spesso. */
export const OGNI_MS = 100;

/** La riga con cui un runtime dice di aver aperto un progetto e svuotato il
 *  suo registro (`projects.rs`, campo `registro_riparte`): da lì in poi le
 *  righe sono dell'applicativo nuovo. */
export function riparte(ev: LogEvent): boolean {
  return ev.fields?.registro_riparte === true;
}

/** Una riga in una chiave, per riconoscerla se torna. */
function chiave(ev: LogEvent): string {
  return `${ev.level}|${ev.target}|${ev.message}`;
}

export interface Versatore {
  metti: (ev: LogEvent) => void;
  /** Versa subito quello che c'è, e smette. */
  ferma: () => void;
}

/** `versa` riceve i blocchi; `azzera` è chiamato prima di un blocco che
 *  contiene una riga `riparte`, e il blocco riparte da quella riga.
 *
 *  **Le righe già viste si scartano.** A ogni riapertura del socket il server
 *  rimanda tutto il suo anello prima della coda dal vivo (`handle_logs_ws`):
 *  un pannello che si riavvia, un tunnel che cade, e l'elenco si riempiva
 *  delle stesse mille righe un'altra volta. Si tiene l'istante dell'ultima
 *  riga versata e le chiavi delle righe di quell'istante: quello che viene
 *  prima, o è una di quelle, è già nell'elenco. */
export function creaVersatore(versa: (evs: LogEvent[]) => void, azzera: () => void): Versatore {
  let coda: LogEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ultimoTs = -Infinity;
  let viste = new Set<string>();

  const nuova = (ev: LogEvent): boolean => {
    if (riparte(ev)) {
      ultimoTs = -Infinity;
      viste = new Set();
    }
    if (ev.ts_ms < ultimoTs) return false;
    const k = chiave(ev);
    if (ev.ts_ms === ultimoTs) {
      if (viste.has(k)) return false;
    } else {
      ultimoTs = ev.ts_ms;
      viste = new Set();
    }
    viste.add(k);
    return true;
  };

  const svuota = () => {
    timer = null;
    if (coda.length === 0) return;
    let blocco = coda;
    coda = [];
    // L'ultima ripartenza vince: quello che c'era prima è del progetto vecchio.
    let i = -1;
    for (let k = blocco.length - 1; k >= 0; k--) {
      if (riparte(blocco[k])) { i = k; break; }
    }
    if (i >= 0) {
      azzera();
      blocco = blocco.slice(i);
    }
    versa(blocco);
  };

  return {
    metti: (ev) => {
      if (!nuova(ev)) return;
      coda.push(ev);
      if (timer === null) timer = setTimeout(svuota, OGNI_MS);
    },
    ferma: () => {
      if (timer !== null) clearTimeout(timer);
      svuota();
    },
  };
}
