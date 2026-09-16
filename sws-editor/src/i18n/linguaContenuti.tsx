// La lingua dei CONTENUTI di progetto, per il sottoalbero che sta disegnando.
//
// Perché un contesto e non un parametro: fino al 15-09-2026 la localizzazione
// si faceva **sull'array di primo livello della pagina** (`RuntimeView` e
// `EditorShell` chiamavano `localizeObjects` e passavano oggetti già risolti).
// Funzionava per gli oggetti in cima, e **non** per i figli di una `grid` né
// per quelli di un `faceplate`: quelli nascono dentro `SvgObject`, che riceveva
// l'oggetto grezzo dal proprio genitore. Sul pannello LVGL gli stessi token si
// risolvevano — lì la localizzazione è sempre stata nell'imbuto unico
// (`dispatch_render`). Due motori, lo stesso progetto, due risultati diversi:
// una griglia tradotta sul pannello e piena di `{{chiave}}` nel browser.
//
// Passare la lingua come prop avrebbe richiesto di ricordarsene a ogni
// annidamento nuovo — cioè avrebbe ricreato il difetto al prossimo widget
// contenitore. Il contesto arriva dove arriva React, senza che nessuno debba
// ricordarsene.

import { createContext, useContext } from "react";
import type { LanguageTable } from "@/types";

export type LinguaContenuti = {
  /** Codice lingua in cui risolvere i token; stringa vuota = non risolvere. */
  lang: string;
  table?: LanguageTable | null;
};

/** Default deliberatamente inerte: senza Provider non si traduce e non si
 *  rompe niente — un test che monta un singolo oggetto continua a funzionare. */
const Contesto = createContext<LinguaContenuti>({ lang: "", table: null });

export const LinguaContenutiProvider = Contesto.Provider;

export function useLinguaContenuti(): LinguaContenuti {
  return useContext(Contesto);
}
