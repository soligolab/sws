import { useEffect } from "react";
import { api } from "@/api/client";
import { applyBranding, getBrand, loadBranding } from "@/branding";

/**
 * Dopo l'accesso, il marchio diventa quello dell'**azienda** di chi è entrato.
 *
 * **Perché non basta `active.json`.** Quel file è uno per installazione e lo
 * si legge all'avvio, prima del login: a quel punto non si sa di chi sarà la
 * sessione. Finché l'IDE era di una ditta sola andava bene; con le aziende
 * no — il maintainer, entrato come utente di `pixsys`, non trovava i preset
 * dei dispositivi Pixsys, che stanno nel `brand.json` di quel marchio.
 *
 * Resta `active.json` per tutto ciò che si vede **prima** di entrare (la
 * schermata di accesso): lì un marchio d'azienda non si può conoscere, e
 * fingere il contrario vorrebbe dire mostrare il logo di un cliente a
 * chiunque apra l'indirizzo.
 *
 * Sta qui e non in due copie: IDE e console la chiamano entrambi, e due
 * risoluzioni dello stesso marchio sono due risposte che prima o poi
 * divergono.
 */
export function useMarchioDellAzienda(authToken: string | null): void {
  useEffect(() => {
    // Il sentinella `"no-auth"` non è una sessione: non c'è nessuna azienda
    // di cui chiedere il marchio.
    if (!authToken || authToken === "no-auth") return;
    let vivo = true;
    api
      .marchioMio()
      .then(async ({ marchio }) => {
        if (!vivo || !marchio || marchio === getBrand().id) return;
        applyBranding(await loadBranding(marchio));
      })
      .catch(() => {
        // Un'installazione senza aziende, o un runtime che non espone la
        // rotta: si resta sul marchio dell'installazione, che è il
        // comportamento di sempre.
      });
    return () => {
      vivo = false;
    };
  }, [authToken]);
}
