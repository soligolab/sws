/** Il secondo livello dell'albero ⚙, visto dalle schede (24-09-2026).
 *
 *  Due metà: la scheda **pubblica** i suoi elementi (dalla bozza, così una
 *  sorgente appena aggiunta compare subito nell'albero) e **legge** il focus,
 *  cioè l'elemento scelto nell'albero. Il focus vale solo mentre la scheda è
 *  quella aperta: tornando alla scheda dal primo livello si rivede l'elenco
 *  intero.
 */
import { useEffect } from "react";
import { useAppStore, type VoceElencoConfig } from "@/store";
import type { AppConfigTab } from "@/config/schede";

export function usePubblicaElenco(tab: AppConfigTab, voci: VoceElencoConfig[]): void {
  const pubblica = useAppStore((s) => s.pubblicaElencoConfig);
  // Senza dipendenze di proposito: `voci` è un array nuovo a ogni disegno, e
  // lo store scarta da sé le pubblicazioni identiche.
  useEffect(() => { pubblica(tab, voci); });
}

/** L'id scelto nell'albero per questa scheda, o `null`. Un id che non c'è più
 *  (elemento cancellato) vale `null`: si rivede tutto invece del vuoto. */
export function useFocus(tab: AppConfigTab, idPresenti: readonly string[]): string | null {
  const focus = useAppStore((s) => (s.configTab === tab ? s.configFocus : null));
  return focus !== null && idPresenti.includes(focus) ? focus : null;
}
