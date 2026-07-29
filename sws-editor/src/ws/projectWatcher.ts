import { useEffect, useRef } from "react";
import { api } from "@/api/client";

/**
 * Sorveglia il progetto attivo sul runtime e segnala quando cambia.
 *
 * Serve perché il runtime ricarica tutto da solo quando un progetto viene
 * aperto o deployato (`open_project` ferma le sorgenti, svuota TagDb/allarmi e
 * riapplica il progetto), ma **nessuno lo dice ai client già connessi**: la SPA
 * tiene in memoria il progetto caricato all'avvio, quindi dopo un deploy
 * continua a mostrare la versione precedente finché qualcuno non ricarica la
 * pagina a mano. È il motivo per cui sembrava servire un riavvio.
 *
 * Il segnale è `GET /api/project/fingerprint` (SHA256 di project.yaml + tutti i
 * synoptic, T-24): un solo valore che copre tutti i casi che contano —
 * contenuto modificato, progetto sostituito, progetto chiuso (fingerprint
 * assente) e runtime che passa da "nessun progetto" a progetto attivo, che è
 * esattamente quello che succede a un deploy su un runtime vuoto.
 *
 * Volutamente polling e non push: non esiste un bus di eventi di progetto lato
 * server, e questo intercetta anche i cambi che non passano dalle API (pull
 * GitOps, modifica dei file sul dispositivo).
 *
 * @param onChange invocato ai cambi successivi al primo rilevamento, mai al
 *                 primo (che serve solo a fissare la baseline).
 * @param intervalMs periodo di polling (default 3 s, scelto dal maintainer:
 *                   dopo un deploy il pannello si aggiorna quasi subito e il
 *                   traffico — un hash per richiesta — resta trascurabile in LAN);
 *                   0/negativo disattiva il watcher.
 */
export function useProjectWatcher(
  onChange: (fingerprint: string | null) => void,
  intervalMs = 3_000,
) {
  // In una ref, non nello stato: cambiarlo non deve ri-renderizzare nulla.
  const lastFp = useRef<string | null | undefined>(undefined);
  // Così il timer non va ricreato quando il chiamante passa una closure nuova.
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (intervalMs <= 0) return;
    let alive = true;

    const tick = async () => {
      let fp: string | null;
      try {
        fp = (await api.getProjectFingerprint()).sha256 ?? null;
      } catch {
        // Nessun progetto attivo (503), runtime in riavvio o rete giù: si
        // normalizza a null, così anche "progetto chiuso" è un cambio.
        fp = null;
      }
      if (!alive) return;
      if (lastFp.current === undefined) {
        lastFp.current = fp;          // baseline, nessuna notifica
        return;
      }
      if (fp !== lastFp.current) {
        lastFp.current = fp;
        cb.current(fp);
      }
    };

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
}
