/** Il runtime gira da un checkout del repo? (Q51)
 *
 *  Una domanda sola, la prima volta che serve, e la risposta finisce nello
 *  store perché la leggono in due: la scheda «Pacchetto runtime», che senza
 *  repo sarebbe un pulsante che fallisce sempre, e l'**albero**, che senza
 *  repo non deve nemmeno mostrare il sotto-ramo «Sviluppatore».
 *
 *  Un runtime che non ha la rotta (404) o non risponde conta come «nessun
 *  repo»: la UI di sviluppo è quella che deve guadagnarsi il diritto di
 *  comparire, non il contrario.
 */
import { useEffect } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

/** Vero solo quando la risposta è arrivata ed è sì. `null` — cioè «non si sa
 *  ancora» — vale come no, così niente lampeggia in attesa. */
export function useRepoDisponibile(): boolean {
  const valore = useAppStore((s) => s.repoDisponibile);
  const imposta = useAppStore((s) => s.setRepoDisponibile);

  useEffect(() => {
    if (valore !== null) return;          // già chiesto: una volta basta
    let vivo = true;
    void (async () => {
      let r = false;
      try { r = (await api.buildStato()).repo; } catch { /* runtime vecchio o irraggiungibile */ }
      if (vivo) imposta(r);
    })();
    return () => { vivo = false; };
  }, [valore, imposta]);

  return valore === true;
}
