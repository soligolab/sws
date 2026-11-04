// Aprire la chat dell'assistente da fuori da App (04-11-2026).
//
// Lo stato della chat — pannello aperto, finestra staccata — vive in `App.tsx`,
// che fino a oggi lo passava solo al menu ☰. Il menù IA del pannello laterale
// ha i due comandi («Apri l'assistente», «Chat in una finestra») e il menu ☰ non
// li ha più: App li registra qui, e chi li vuole li chiama senza sapere dove
// sta lo stato.

import { useSyncExternalStore } from "react";

export interface ComandiChat {
  apri: () => void;
  stacca: () => void;
  aperta: boolean;
  staccata: boolean;
}

let comandi: ComandiChat | null = null;
const ascoltatori = new Set<() => void>();

export function registraComandiChat(c: ComandiChat | null) {
  comandi = c;
  ascoltatori.forEach((f) => f());
}

export const apriChat = () => comandi?.apri();
export const staccaChat = () => comandi?.stacca();

/** Lo stato della chat, per chi disegna i comandi. `null` = nessuna App (test). */
export function useComandiChat(): ComandiChat | null {
  return useSyncExternalStore(
    (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    () => comandi,
  );
}
