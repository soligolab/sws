# Residui trovati rifacendo il manuale — seme

> Nato il 20-10-2026, durante il ramo 2 del [piano del manuale](2026-10-19-manuale-rifatto.md): rileggendo i capitoli
> contro il codice sono emerse cose **del codice**, che in un ramo di documentazione non si toccano. Il manuale
> descrive il codice com'è; qui c'è quello che forse va cambiato.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per decidere ogni punto:
> due sono decisioni del maintainer, gli altri piccole correzioni da raggruppare in un ramo solo.

## Da decidere

1. **FATTA il 20-10-2026: era una svista, il pull git passa ad Admin.** Decisione del
   maintainer: tirare dentro una versione nuova del progetto cambia l'impianto quanto un
   rollback. `POST /api/project/deploy` è stato spostato nel gruppo `require_admin`, e i capitoli
   12 e 13 del manuale aggiornati. *(Testo originale:)* **Il pull git basta un Operator.** `POST /api/project/deploy` (`git pull --ff-only` e ricarica del progetto) sta
   nel gruppo `require_operator` (`sws-web/src/router.rs:627`), mentre Rollback, prova e fork vogliono l'Admin
   (`router.rs:440-448`, gruppo `require_admin`). Il pull cambia il progetto quanto un rollback. Svista o scelta?
   Il capitolo 12 lo descrive com'è.
2. **DECISA il 20-10-2026, da fare: la ritenzione dei datastore diventa automatica.** Quattro
   scelte del maintainer, prese con le misure in mano:
   - **quando**: ogni notte a un'ora fissa, configurabile. Un pannello spento di notte recupera
     il giro al primo avvio utile.
   - **VACUUM**: non dopo ogni pulizia e non mai, ma **quando la pulizia ha cancellato tanto**
     (soglia, es. il 10% delle righe). Su SQLite un `DELETE` non restituisce un byte di disco, e
     nel cloud lo spazio dell'azienda si misura sui byte: senza `VACUUM` la quota non si
     sbloccherebbe. Va nella stessa finestra notturna, perché riscrive il database e blocca le
     scritture.
   - **il primo giro**: alla prima apertura dopo l'aggiornamento, l'IDE dice **quante righe e
     quanti byte** sta per cancellare e chiede conferma **una volta**; dopo il sì è automatica
     per sempre. CasaDomotica ha 540 MB di storico e un `retention_days` che non ha mai
     cancellato niente: il primo giro, senza avviso, sarebbe irreversibile.
   - **cloud**: stesso codice ovunque, e il limite si **dichiara** nel manuale e nella card —
     nel cloud il container di progetto è spento quando nessuno lavora, quindi la pulizia segue
     chi lavora e non l'orologio.

   Da misurare all'inizio del ramo: `purge` esiste già completa su tutti e tre i backend
   (`sqlite_backend.rs:70`, `postgres_backend.rs:247`, `odbc_backend.rs:94`) e `purge_backend`
   nel registro (`registry.rs:261`); manca solo chi la chiami. Il modello da copiare è il task
   dei backup automatici in `sws-runtime/src/main.rs:741`, che batte ogni minuto, rilegge la
   configurazione del progetto attivo a ogni giro e tiene il tempo per progetto.

   *(Testo originale della domanda:)* **La ritenzione dei datastore non è automatica.** `retention_rows` e `retention_days` si applicano solo con
   `POST /api/datastores/:id/purge` (Admin); non c'è una pulizia programmata (`sws-core/src/project.rs`,
   `DatastoreConfig`; `sws-historian/src/backend.rs`). Un `retention_days: 365` scritto nel progetto, da solo, non
   cancella niente. Renderla automatica (quando, con quale finestra, sul pannello e nel cloud) è una decisione.

## Da correggere

3. **`SWS_IP_ALLOWLIST` e `X-Forwarded-For`.** L'allowlist vale solo per il login, e se manca l'indirizzo della
   connessione ripiega su `X-Forwarded-For`, che chiunque può scrivere (`router.rs:2475-2490`). Da verificare se il
   caso «manca l'indirizzo» capita davvero; se sì, non fidarsi dell'intestazione (vedi anche il seme
   [indirizzo vero dietro Traefik](2026-10-18-indirizzo-vero-dietro-traefik.md)).
4. **FATTI il 20-10-2026.** Il consiglio della card OPC UA («abilita temporaneamente *Accetta
   qualsiasi*») è stato sostituito: con la fiducia al primo contatto non serve, e spingeva ad
   abbassare una protezione per niente. Corretti anche i tre commenti. Quello delle policy OPC UA
   è finito in un commento normale e non nel doc: il doc viene raccolto nello schema che legge
   l'assistente IA, e `check_synoptic_schema` è diventata rossa per ricordarlo.
   *(Testo originale:)* **Testi rimasti indietro nel codice**:
   - `sws-runtime/crates/sws-runtime/src/main.rs:533-536`: il commento parla di «no-auth mode, all routes are open»,
     che non esiste dall'11-10-2026;
   - `sws-core/src/project.rs:949`: il commento di `security_policy` dice «only "None" is wired end-to-end», ma le
     sei policy sono collegate (`parse_security_policy`, `sws-plugin-opcua/src/lib.rs`);
   - `cfgUi.noCertificatesInTheTrust` (card OPC UA, `it.json`/`en.json`) consiglia di «abilitare temporaneamente
     "Accetta qualsiasi"» per la prima connessione: con la fiducia al primo contatto non serve, e il consiglio va
     nella direzione sbagliata;
   - `sws-editor/src/types/index.ts`, `critical`: «saltato in no-auth mode».
