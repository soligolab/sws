# Il deploy di un progetto con un altro nome: lo stesso progetto o uno nuovo — piano da rivedere

> **Stato: piano da rivedere col maintainer, come prima cosa della prossima sessione.** Nato dal collaudo della 2.27.0
> sul TC620 (27-11-2026). Il maintainer: «Dobbiamo poi aprire un plan per gestire queste situazioni compreso il
> database, è normale cambiare nome al progetto e in quel caso possono aprirsi due strade:
> A. Il progetto cambia nome/impostazioni ma continua a essere lo stesso
> B. Cambio nome perché ne faccio una nuova implementazione
> Nel primo caso utenti e database posso volerli mantenere».
>
> Qui ci sono i fatti del collaudo, quello che fa il codice oggi e le domande da decidere. Il disegno si fissa nella
> revisione, non prima.

## Cosa è successo il 27-11-2026

Sul TC620 girava il progetto `CasaDomotica`, con 1,6 GB di storico (37,9 milioni di campioni, 67 tag) e un
`users.yaml` con l'utente `admin`. Il maintainer ha fatto il deploy della copia `CasaDomotica (TC620_Verticale)`,
lo stesso impianto in verticale. Tre difetti:

1. **Lo storico si perde.** La finestra dice «Deploying … deletes from the panel: CasaDomotica, with 1638.3 MB of
   history». Non c'è un modo di tenerlo. Il maintainer ha chiesto un backup prima; lo storico è stato ripristinato a
   mano nel progetto nuovo (runtime fermo circa 2 minuti).
2. **Gli utenti si perdono, e il registro del deploy dice il contrario.** Il deploy scrive «Utenti: non toccati
   («Sostituisci anche gli utenti» è spenta)», ma cancella la cartella del progetto vecchio, che conteneva
   `users.yaml`. Il progetto nuovo arriva senza utenti: il pannello resta chiuso verso la rete locale («paired to the
   cloud and without users»). Rimedio a mano: `users.yaml` copiato dal backup.
3. **La rotazione non viene chiesta.** La copia verticale ha le misure 800×1280 ma non `page_layout.orientation:
   portrait`, che è il campo che il deploy legge. Il menu «Orientamento» dell'IDE non la corregge: scambierebbe di nuovo
   misure e pagine. Rimedio a mano: la riga aggiunta sul VPS.

Il backup è in `tmp/test-changes/2026-11-27/` della macchina `ufficio` (copia completa e `historian.db` pulito).

## Cosa fa il codice oggi (misurato il 27-11-2026)

- `sws-web/src/remote.rs`, deploy verso il dispositivo: il runtime ha un solo progetto, quindi il deploy cancella
  **tutti** i progetti sul pannello. Con lo **stesso nome** la cancellazione usa `?preserve_state=true` («pagine
  sostituite, database e backup conservati»); con un **nome diverso** cancella tutto, storico compreso («Nome diverso
  = lo stai sostituendo con un altro progetto, e preservarne lo storico non ha senso»).
- `sws-web/src/projects.rs`, l'import dello ZIP: con «Sostituisci anche gli utenti» spenta, il `users.yaml` dello ZIP
  si ignora e «gli account del dispositivo restano intatti». Ma gli account stanno nella cartella del progetto: con un
  nome diverso la cartella vecchia è già stata cancellata, quindi non resta niente da tenere.
- `rotation_to_confirm` (`remote.rs`) chiede la rotazione solo se il progetto ha `orientation: portrait`.

## Da decidere nella revisione

1. **La scelta A / B nel deploy.** Quando il nome sul pannello è diverso, l'IDE chiede: «È lo stesso impianto con un
   nome nuovo» (A) o «È un progetto nuovo» (B). Domande:
   - con A, cosa passa al progetto nuovo: lo storico, la ritenzione, `users.yaml`, i backup del progetto, altro dello
     stato del pannello? Il progetto vecchio sparisce o resta da parte?
   - con B, il comportamento di oggi, più un backup automatico dello storico sul pannello o da scaricare prima di
     cancellarlo?
   - la scelta si ricorda (per esempio un legame «questa copia discende da CasaDomotica» nel progetto), o si chiede
     ogni volta?
2. **Gli utenti detti onestamente.** Il registro del deploy deve dire cosa succede davvero agli account, anche con un
   nome diverso. E un pannello abbinato che resta senza utenti per un deploy merita un avviso prima, non dopo.
3. **Lo storico e i nomi dei tag.** Lo storico si aggancia ai tag per nome (`tag_storico.nome`). Con A e tag
   rinominati, lo storico di quei tag resta invisibile: si dice, si propone una corrispondenza, o si lascia?
4. **L'orientamento delle copie.** Chi rende un progetto verticale con le misure («Cambia risoluzione», «Salva
   come», il formato a mano) deve impostare anche `orientation`. Oppure il deploy lo deduce dalle misure. E il menu
   «Orientamento» su un progetto già 800×1280 non deve scambiare di nuovo le misure.
5. **CasaDomotica.** La copia verticale ora è coerente (storico, utenti, orientamento). Niente da adeguare, salvo
   quello che decide il punto 1.

## Verifica (quando ci sarà il lavoro)

Sul TC620 con una copia di prova (mai l'impianto): deploy con un nome diverso, strada A e strada B. Con A, storico e
utenti restano. Con B, il registro del deploy dice cosa si perde e il backup esiste. Una copia verticale fatta con le
misure chiede la rotazione al deploy.
