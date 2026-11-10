# Il cron degli script in ora locale (seme)

> **Chiuso e archiviato il 10-11-2026: deciso e fatto lo stesso giorno** (ramo `feat/cron-ora-locale`). La decisione
> del maintainer è la seconda strada: **il cron gira nell'ora del pannello**. Cosa è stato fatto:
>
> - `cron.rs` legge l'espressione sul quadrante di `chrono::Local` (il fuso del sistema; nel container lo passa
>   `Timezone=local`, già nel quadlet dal 28-09-2026: niente da cambiare lì). Nessuna dipendenza nuova: `chrono`
>   c'era già, e il cambio d'ora lo sa fare da sé.
> - Cambio d'ora: un'ora che non esiste (le 2:30 di fine marzo) si **salta**; un'ora ripetuta (le 2:30 di fine ottobre)
>   parte **una volta sola**, la prima. Un cron a tutte le ore (`*/5 * * * *`) conta il tempo vero e gira anche
>   nell'ora ripetuta, come Vixie cron: altrimenti «ogni cinque minuti» resterebbe fermo un'ora.
> - Il ciclo degli script non dorme più di 60 s e ricalcola: un orologio che salta (NTP all'avvio) non fa partire uno
>   script all'ora sbagliata, e un'esecuzione mancata da più di due minuti si salta invece di recuperarla.
> - I **report programmati** erano già nell'ora locale, ma sommando lo scarto del fuso: nell'ora ripetuta di ottobre un
>   report delle 2:30 partiva due volte. Ora usano la stessa regola degli script (`Cron::scatta`).
> - La **finestra dell'aggiornamento** era già nell'ora del pannello (decisione 47) e resta com'è: lì un'ora che non
>   esiste si sposta alla prima valida dopo, perché un aggiornamento approvato non deve sparire.
> - `GET /api/cron/prossime` (e `/api/remote/cron/prossime` per il dispositivo connesso) dà fuso e prossime tre
>   esecuzioni; l'editor della Logica le mostra sotto il campo (`logica/ProssimeCron.tsx`). Il nome del fuso viene da
>   `TZ`, dal collegamento `/etc/localtime` o da `/etc/timezone`: se podman copia il file invece di collegarlo, il nome
>   manca e si vede solo lo scostamento.
> - I modelli «Comando a orario» e «Azzeramento a mezzanotte» dicono «le 7 di casa tutto l'anno».
>
> Il testo qui sotto è il seme com'era.

> **Stato: seme — decisione.** Nato il 10-11-2026 facendo i modelli di «Nuovo da modello» (sessione L3 del piano
> archiviato [la logica in un posto solo](2026-11-04-logica-unificata.md)). **Quando questo lavoro
> comincerà, il primo passo è una sessione di plan approfondita e dedicata, per sviscerarne tutti i dettagli.**

## Il fatto

Il trigger cron degli script globali gira in **UTC** (`sws-runtime/crates/sws-web/src/cron.rs`, intorno alla riga 300) e
nell'IDE niente lo dice. Chi scrive `0 7 * * *` pensando alle 7 italiane accende l'uscita alle 8 d'inverno e alle 9
d'estate. I tre modelli col cron (comando a orario: `0 7 * * *` e `0 22 * * *`; azzeramento a mezzanotte: `0 0 * * *`)
lo scrivono solo in un commento.

## Le strade

- dirlo nel campo del trigger («ora UTC: le 7 italiane sono `0 6` d'inverno e `0 5` d'estate»);
- far girare il cron nel **fuso del pannello** (quello che `finestra.orologio` già mostra nell'IDE), con le due ore
  ambigue del cambio d'ora da decidere (saltare, ripetere);
- un fuso per progetto, accanto al formato e alla lingua.

Tocca anche i report programmati e la finestra di aggiornamento, che hanno già fatto la loro scelta sul fuso: da
allineare.
