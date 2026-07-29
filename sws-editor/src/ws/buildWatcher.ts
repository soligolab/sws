import { useEffect, useRef } from "react";

/**
 * Sorveglia il **frontend servito** e segnala quando è stato distribuito un
 * bundle nuovo.
 *
 * Complementa `useProjectWatcher`, che copre i cambi di *progetto*: quello non
 * vede un aggiornamento della SPA, quindi dopo un deploy del frontend il
 * pannello resta sulla versione vecchia finché qualcuno non ricarica la pagina
 * a mano — cosa impossibile su un pannello senza tastiera, e già costata una
 * diagnosi sbagliata (dati aggiornati, interfaccia no).
 *
 * Segnale: i nomi dei bundle referenziati dall'HTML di entry. Vite li rinomina
 * per hash di contenuto a ogni build, e l'HTML è **l'unico file che cambia
 * sempre**: i chunk `react-vendor`/`i18n`/`codemirror` sono vendor stabili e
 * restano identici a fronte di modifiche applicative, quindi da soli non
 * sarebbero un segnale valido.
 *
 * Due dettagli non ovvi:
 *  - `cache: "no-store"` è obbligatorio. `ServeDir` non manda `Cache-Control`
 *    sull'HTML, quindi senza quello il browser può rispondere dalla cache e il
 *    watcher non vedrebbe mai nulla.
 *  - l'URL è relativo all'**origine della pagina**, non a `getBaseUrl()`: la
 *    SPA in esecuzione arriva da dove è stata caricata, non dal runtime remoto
 *    eventualmente configurato nell'IDE.
 *
 * @param onNewBuild invocato una sola volta, al primo cambio rilevato.
 * @param intervalMs default 30 s: la SPA cambia solo quando si distribuisce un
 *                   frontend nuovo, non a ogni salvataggio di progetto.
 *                   0/negativo disattiva il watcher.
 */
export function useBuildWatcher(onNewBuild: () => void, intervalMs = 30_000) {
  const baseline = useRef<string | null>(null);
  const fired = useRef(false);
  const cb = useRef(onNewBuild);
  cb.current = onNewBuild;

  useEffect(() => {
    if (intervalMs <= 0) return;
    let alive = true;

    const tick = async () => {
      let sig: string | null = null;
      try {
        // location.pathname invece di "/" così funziona anche se la SPA fosse
        // servita da un sottopercorso.
        const res = await fetch(window.location.pathname, { cache: "no-store" });
        if (!res.ok) return;                 // runtime in riavvio: si riprova
        const html = await res.text();
        const assets = html.match(/assets\/[A-Za-z0-9_.-]+\.js/g);
        if (!assets || assets.length === 0) return;   // niente da confrontare
        sig = [...new Set(assets)].sort().join("|");
      } catch {
        return;                              // rete giù: non è un cambio
      }
      if (!alive || sig === null) return;
      if (baseline.current === null) {
        baseline.current = sig;              // baseline, nessuna notifica
        return;
      }
      if (sig !== baseline.current && !fired.current) {
        fired.current = true;                // una volta sola: chi ascolta ricarica
        cb.current();
      }
    };

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
}
