import { useEffect, useRef } from "react";
import { getBaseUrl } from "@/api/client";

/**
 * Sorveglia il **runtime remoto irraggiungibile** e segnala quando torna a
 * rispondere — il caso concreto: la SPA punta a un runtime HTTPS self-signed
 * il cui certificato non è ancora stato accettato in questo browser. Ogni
 * fetch fallisce (`RuntimeUnavailableError`), l'IDE "sembra rotto", e anche
 * DOPO che l'utente accetta/importa il certificato la pagina già aperta
 * continua a fallire finché non viene ricaricata (stato TLS/socket pool della
 * sessione). Successo dal vivo solo dopo un reload manuale che nessuno
 * suggeriva — da qui questo watcher.
 *
 * Meccanica (gemella di `useBuildWatcher`):
 *  - dorme finché non arriva il primo evento `sws:runtime-unreachable`
 *    (emesso dal costruttore di `RuntimeUnavailableError` in client.ts);
 *  - da lì polla `${getBaseUrl()}/health` ogni `intervalMs` con
 *    `cache: "no-store"`;
 *  - alla prima risposta ok invoca `onReachable` UNA volta (chi ascolta
 *    mostra il banner "ricarica la pagina") e si spegne.
 *
 * Mai armato quando `getBaseUrl()` è same-origin: se il runtime locale non
 * risponde la pagina stessa non si sarebbe caricata, e il problema del
 * certificato non esiste per definizione.
 */
export function useCertWatcher(onReachable: () => void, intervalMs = 3_000) {
  const fired = useRef(false);
  const cb = useRef(onReachable);
  cb.current = onReachable;

  useEffect(() => {
    if (intervalMs <= 0) return;
    const base = getBaseUrl();
    // Same-origin (stringa vuota o l'origin della pagina): niente da sorvegliare.
    if (!base || base === window.location.origin) return;

    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        if (!res.ok) return; // raggiungibile ma non sano: non è il segnale che cerchiamo
      } catch {
        return; // ancora irraggiungibile: si riprova al prossimo giro
      }
      if (!alive || fired.current) return;
      fired.current = true;
      if (timer) { clearInterval(timer); timer = null; }
      cb.current();
    };

    const arm = () => {
      if (timer || fired.current) return; // già armato o già scattato
      timer = setInterval(tick, intervalMs);
    };

    window.addEventListener("sws:runtime-unreachable", arm);
    return () => {
      alive = false;
      window.removeEventListener("sws:runtime-unreachable", arm);
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);
}
