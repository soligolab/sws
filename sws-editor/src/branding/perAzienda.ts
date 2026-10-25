import { useEffect } from "react";
import { api } from "@/api/client";
import { applicaCampiPrivati, applyBranding, getBrand, loadBranding } from "@/branding";

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
    if (!authToken) return;
    let vivo = true;
    void (async () => {
      // Il sentinella `"no-auth"` non è una sessione: non c'è nessuna azienda
      // di cui chiedere il marchio.
      if (authToken !== "no-auth") {
        try {
          const { marchio } = await api.marchioMio();
          if (vivo && marchio && marchio !== getBrand().id) applyBranding(await loadBranding(marchio));
        } catch {
          // Un'installazione senza aziende, o un runtime che non espone la
          // rotta: si resta sul marchio dell'installazione.
        }
      }
      // I campi privati (25-10-2026): **anche** con `"no-auth"`, cioè
      // nell'IDE locale — è lì che i preset Pixsys di `start_editor.sh`
      // devono continuare ad arrivare, dal marchio dell'installazione.
      try {
        const { marchio, campi } = await api.marchioPrivato();
        if (vivo) applicaCampiPrivati(marchio, campi);
      } catch {
        // Un runtime precedente: i preset restano vuoti, come prima di entrare.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [authToken]);
}
