// Un contenitore che, una volta mostrato, non smonta più il figlio: lo
// nasconde. Serve alle schede di Configurazione dal 22-09-2026, quando il
// salvataggio è diventato uno solo: una scheda con una bozza (una sorgente
// appena aggiunta, uno script cambiato) veniva **smontata** al cambio di
// scheda e la bozza spariva con lei — e con lei la registrazione fra le
// sezioni pendenti, quindi nemmeno Ctrl+S la vedeva più.
//
// Non è un cambio di architettura (le bozze restano nello stato delle
// schede), è il modo più piccolo per farle sopravvivere alla navigazione.
// `display: contents` quando attiva: il contenitore è trasparente al layout,
// così le schede che si allargano col flex del genitore non cambiano.
//
// Chi sta dentro sa se è in vista (`useInVista`, 08-11-2026): una scheda
// nascosta resta montata, e la scheda Prestazioni continuava a interrogare il
// pannello ogni 2 s anche dall'editor — il pannello non smetteva mai di
// misurare. Le Tenute annidate si sommano: nascosta una, nascosto tutto.

import { createContext, useContext, useEffect, useState } from "react";

const InVista = createContext(true);

/** `false` quando una `Tenuta` che contiene il chiamante è nascosta. */
export function useInVista(): boolean {
  return useContext(InVista);
}

export function Tenuta({ attiva, children }: { attiva: boolean; children: React.ReactNode }) {
  const [vista, setVista] = useState(attiva);
  const sopra = useContext(InVista);
  useEffect(() => { if (attiva) setVista(true); }, [attiva]);
  if (!vista) return null;
  return (
    <InVista.Provider value={sopra && attiva}>
      <div style={{ display: attiva ? "contents" : "none" }}>{children}</div>
    </InVista.Provider>
  );
}
