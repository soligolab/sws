import { ProjectChangedError } from "@/api/client";
import { useAppStore } from "@/store";

/**
 * Un salvataggio che fallisce deve dirlo.
 *
 * **Perché esiste.** Le schede della configurazione salvavano dentro un
 * `try { … } finally { setSaving(false) }` — **senza `catch`**. Se la
 * chiamata veniva rifiutata non compariva niente: nessun messaggio, nessun
 * segno, solo il pulsante che smetteva di girare. Il campo continuava a
 * mostrare il valore appena scritto e il runtime restava com'era, cioè
 * l'interfaccia diceva una cosa e il sistema ne faceva un'altra.
 *
 * Trovato l'08-10-2026 cercando perché il `Period` di un generatore sembrasse
 * ignorato nell'IDE mentre sul dispositivo era corretto: il sintomo di un
 * salvataggio rifiutato in silenzio è esattamente quello. Lo stesso `try`
 * senza `catch` stava in **cinque** schede — variabili, allarmi, protocolli,
 * ricette, tipi.
 *
 * Non inventa un posto nuovo dove mostrarlo: usa i due che ci sono già —
 * `saveStatus`/`saveError`, che l'intestazione mostra accanto al pulsante di
 * salvataggio, e `saveConflict`, che ha il suo banner in `App.tsx` e dice la
 * cosa giusta («qualcun altro ha modificato il progetto»), che è diversa da
 * un errore qualunque.
 *
 * Ritorna sempre `false`, così chi la chiama può scrivere
 * `catch (e) { salvato = segnalaSalvataggioFallito(e); }`.
 */
export function segnalaSalvataggioFallito(e: unknown): false {
  const store = useAppStore.getState();
  if (e instanceof ProjectChangedError) {
    store.setSaveConflict(true);
  }
  const messaggio = e instanceof Error ? e.message : String(e);
  store.setSaveStatus("error", messaggio);
  console.warn("salvataggio rifiutato:", e);
  return false;
}
