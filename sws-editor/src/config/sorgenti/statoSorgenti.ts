/** Lo stato delle sorgenti e dei loro dispositivi, per i pallini dell'albero
 *  della Configurazione e delle card (04-10-2026).
 *
 *  Un solo polling di `GET /api/sources/stato` (ogni 5 s) finché almeno un
 *  componente lo guarda: l'albero e la card aperta non ne fanno due. È lo
 *  stato del runtime con cui l'IDE parla. Una sorgente assente dalla risposta
 *  non è avviata (ferma, disarmata, o mai salvata): «non attiva».
 */
import { useSyncExternalStore } from "react";
import { api } from "@/api/client";
import type { StatoCollegamento, StatoSorgente } from "@/types";

const INTERVALLO_MS = 5000;

let istantanea: Record<string, StatoSorgente> = {};
const ascoltatori = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function leggi() {
  try {
    istantanea = await api.statoSorgenti();
  } catch {
    // Nessun progetto aperto, o un runtime di prima che non ha l'endpoint:
    // niente pallini, nessun errore a schermo.
    istantanea = {};
  }
  ascoltatori.forEach((f) => f());
}

function iscrivi(f: () => void): () => void {
  ascoltatori.add(f);
  if (timer === null) {
    void leggi();
    timer = setInterval(() => void leggi(), INTERVALLO_MS);
  }
  return () => {
    ascoltatori.delete(f);
    if (ascoltatori.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useStatoSorgenti(): Record<string, StatoSorgente> {
  return useSyncExternalStore(iscrivi, () => istantanea, () => istantanea);
}

/** Il colore di un pallino: risponde (con o senza errori parziali), non
 *  risponde, non attivo. */
export type ColoreStato = "ok" | "parziale" | "errore" | "spento";

export function coloreStato(s: StatoCollegamento | undefined): ColoreStato {
  if (!s || s.stato === "mai_connesso") return "spento";
  if (s.stato === "non_risponde") return "errore";
  return s.errore ? "parziale" : "ok";
}

export const COLORI_STATO: Record<ColoreStato, string> = {
  ok: "var(--brand-success, #22c55e)",
  parziale: "var(--brand-warning, #f59e0b)",
  errore: "var(--brand-danger, #ef4444)",
  spento: "var(--brand-text-subtle, #64748b)",
};

/** Lo stato di un dispositivo dentro lo stato del suo bus. */
export function statoDispositivo(s: StatoSorgente | undefined, unit: number): StatoCollegamento | undefined {
  return s?.dispositivi?.[String(unit)];
}
