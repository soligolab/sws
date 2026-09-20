import { useEffect, useRef } from "react";
import { api, AuthError, PasswordChangeRequiredError } from "@/api/client";

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
 * La baseline si rifissa anche quando **noi** cambiamo progetto (aperto, creato,
 * importato, chiuso): il client API emette `sws:project-switched` e qui si
 * riparte da capo, senza notificare. Senza, l'azione piu' tua che esista —
 * creare un progetto — veniva letta come un deploy esterno e faceva comparire
 * l'avviso appena si entrava nel progetto nuovo.
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
  // Generazione della baseline: un tick partito **prima** di un nostro cambio e
  // finito dopo vedrebbe l'impronta vecchia, la fisserebbe come baseline e al
  // tick successivo scambierebbe il nostro salvataggio per un cambio esterno.
  const generazione = useRef(0);

  useEffect(() => {
    if (intervalMs <= 0) return;
    let alive = true;

    const tick = async () => {
      const gen = generazione.current;
      let fp: string | null;
      try {
        fp = (await api.getProjectFingerprint()).sha256 ?? null;
      } catch (e) {
        // Non autenticati (login da fare, o password da cambiare): **non è un
        // fatto sul progetto**, è che non si può ancora guardarlo. Se la baseline
        // diventasse `null` qui, il primo tick dopo il login vedrebbe comparire
        // un'impronta e la scambierebbe per un deploy esterno — l'avviso «il
        // progetto sul runtime è cambiato» compariva dopo **ogni** accesso a un
        // runtime con utenti (visto nelle schermate del manuale, 20-09-2026). Si
        // rimette la baseline a «da fissare»: il primo tick autenticato la fissa
        // in silenzio.
        if (e instanceof AuthError || e instanceof PasswordChangeRequiredError) {
          if (gen === generazione.current) lastFp.current = undefined;
          return;
        }
        // Nessun progetto attivo (503), runtime in riavvio o rete giù: si
        // normalizza a null, così anche "progetto chiuso" è un cambio.
        fp = null;
      }
      if (!alive || gen !== generazione.current) return;
      if (lastFp.current === undefined) {
        lastFp.current = fp;          // baseline, nessuna notifica
        return;
      }
      if (fp !== lastFp.current) {
        lastFp.current = fp;
        cb.current(fp);
      }
    };

    // Cambio di progetto voluto da noi: si riparte dalla baseline invece di
    // segnalarlo. `undefined` fa si' che il prossimo tick la rifissi in
    // silenzio, esattamente come al montaggio.
    //
    // La finestra scoperta e' il periodo di polling (3 s): un deploy esterno
    // che cadesse fra il nostro cambio e il tick successivo verrebbe assorbito
    // nella nuova baseline. E' un caso molto piu' raro del falso positivo che
    // questo ripara, e la finestra e' un settimo di quella (20 s) che la
    // guardia dei salvataggi in App.tsx accetta gia' per la stessa ragione.
    const riparti = () => { generazione.current += 1; lastFp.current = undefined; };
    window.addEventListener("sws:project-switched", riparti);

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("sws:project-switched", riparti);
    };
  }, [intervalMs]);
}
