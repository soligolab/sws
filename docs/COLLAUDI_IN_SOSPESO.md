# Collaudi in sospeso — da fare da casa, prima di rilasciare l'immagine

> **Per chi è**: il maintainer, davanti ai dispositivi di casa (TC620), prima di decidere che è
> ora di costruire e taggare l'immagine nuova.
>
> **Perché esiste**: la *definition of done* di `CLAUDE.md` chiede la conferma del maintainer che
> la funzione funzioni, e questa è l'unica delle cinque voci che nessuno script può dare. Le altre
> quattro — `cargo check`, `pnpm build`, `check_static.sh`, `cargo test` + `vitest` — sono verdi su
> `main` al 23-10-2026.
>
> **Come si usa**: si spunta quello che passa, si annota quello che non passa. Una voce che non
> passa non blocca le altre: sono indipendenti, e ognuna dice cosa vuol dire se fallisce.
>
> Quando l'elenco è vuoto (o quello che resta è dichiarato accettabile), si costruisce l'immagine
> e **solo allora** si tagga — regola «si tagga quando si costruisce», `CLAUDE.md`.

## Dove si fa cosa

| serve | dove | note |
|---|---|---|
| un pannello Pixsys con schermo | **TC620** di casa (`tc620-a-p3-c6-07aff9.local`), dal PC `ufficio` | TC620 e WP630 sono la stessa famiglia: fanno girare sia il viewer web sia quello LVGL |
| un server OPC-UA di prova | il PC, `npx node-opcua-server-example` o Prosys | niente hardware |
| un simulatore Modbus | il PC, `pymodbus` | solo se si vuole ricontrollare la Fase 3 |
| nient'altro che l'IDE | il PC | la maggior parte delle voci «IDE» |

---

## A. La misura che blocca C4 — il browser del pannello davanti al proprio certificato

**È la più importante, ed è una misura, non un sì/no.** Da lei dipende se il TLS si può accendere
di default sul pannello (voce C4 del piano CRA). Finché non è fatta, le altre tre risposte già date
— solo il ruolo «pannello», marcatore in `config/`, impronta mostrata — non si possono mettere in
codice: seminare un certificato su un pannello il cui browser poi non lo accetta vuol dire **un
interstiziale al posto del sinottico**.

Il launcher è di PixsysOS e riceve **solo un URL via D-Bus**: in tutto il repo non c'è un flag di
chromium. Quindi la via «gli passiamo un argomento» va verificata prima di prometterla.

1. [ ] Sul TC620, con un progetto **web** attivo, accendere il TLS: IDE → Configurazione →
       Istanza → Device → Stato → **Certificato TLS** → «Genera certificato self-signed».
       Il pannello riparte da solo.
2. [ ] **Guardare lo schermo del pannello.** Cosa compare?
       - il sinottico, come prima → il browser accetta l'autofirmato su loopback: C4 è fattibile
         come sperato, e la risposta alla domanda 2 è «niente da fare»;
       - l'interstiziale «La connessione non è privata» → si può passare oltre **toccando**
         Avanzate → Procedi? Se sì, resta da decidere se è accettabile che lo faccia un operatore
         una volta; se no, serve la via «il pannello si fida del proprio certificato»;
       - pagina bianca o errore di rete → vuol dire che l'URL è ancora `http://` da qualche parte:
         annotare **esattamente** cosa dice la pagina.
3. [ ] **Riavviare il pannello** (`reboot`) con il TLS ancora acceso. Il container deve tornare
       `healthy` e il servizio avviarsi. **Questo è il difetto corretto il 23-10-2026**: prima il
       controllo di salute chiedeva `/health` solo in chiaro e, con `Notify=healthy`, l'unità non
       sarebbe mai diventata sana — riavvio ogni cinque secondi. Verifica:
       `podman healthcheck run sws-runtime` e `systemctl --user status sws-runtime`.
       (Se il bus non si trova: `XDG_RUNTIME_DIR=/run/user/$(id -u)` davanti, HOWTO §27.)
4. [ ] Annotare se chromium ha un archivio di fiducia scrivibile sul pannello
       (`/` è in sola lettura fuori da `/data`): serve solo se il punto 2 è andato male.

**Dove finisce il risultato**: `docs/plans/2026-10-23-c4-tls-di-default.md`, domanda 2.

---

## B. Lo schema `http`/`https` non è più scritto a mano

Quattro punti che prima non rileggevano il certificato. **Nessuno cambia il comportamento di un
pannello in chiaro**: se il TLS è spento, tutto deve funzionare esattamente come prima.

5. [ ] **Pannello in chiaro, com'è adesso**: installare/aggiornare e verificare che l'installer
       stampi `viewer : http://…:7443` e `IDE : http://…:7444`, che il browser parta, e che il
       codice di abbinamento compaia nel riquadro.
6. [ ] **Pannello con TLS acceso**: rilanciare `install-container.sh` e verificare che adesso
       stampi `https://`, che punti il browser su `https://127.0.0.1:7443` e che il codice di
       abbinamento lo legga lo stesso (prima due sonde su tre erano mute).
7. [ ] **Pannello LVGL con TLS acceso e quadlet vecchio**: il viewer deve ripartire lo stesso. Nel
       log (`journalctl --user -u sws-lvgl-viewer`) deve comparire
       `[base-url] http://… non risponde, https://… sì: uso quello` e lo schermo deve mostrare il
       sinottico. Se resta nero, il ripiego di schema non ha funzionato.

---

## C. Il certificato: nome vero, e governo da remoto

8. [ ] **Rigenerare** il certificato sul pannello e guardarne il soggetto:
       `openssl s_client -connect <pannello>:7443 </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
       Deve dire `CN = <nome del pannello>` (non più `rcgen self signed cert`) e i SAN devono
       contenere `localhost`, `<nome>` e `<nome>.local` oltre agli IP.
9. [ ] **La card «Certificato TLS» con un pannello connesso** (Configurazione → Istanza → Device):
       in testa deve dire «Dispositivo connesso — `<host:porta>`», non «Questa istanza», e deve
       mostrare le tre righe gialle (riavvio, impronta che cambia, schema che cambia).
       **Prima questa card governava il PC su cui gira l'IDE.**
10. [ ] Premere «Genera certificato self-signed» **da lì**: deve agire sul **pannello**. Il PC
       dell'IDE non deve cambiare stato TLS.
11. [ ] Dopo il punto 10, riconnettersi: deve comparire l'errore «certificato cambiato» e il
       pulsante **«Dimentica certificato»** — e dopo averlo premuto la connessione deve riuscire.
       (Il «dimentica» non è e non deve essere automatico.)

## D. L'impronta mostrata al collegamento

12. [ ] **Primo collegamento** a un pannello mai visto (o dopo «dimentica»): sotto lo stato di
        Connessione deve comparire **Impronta del certificato** con il valore, e la riga gialla
        «Memorizzata adesso, al primo contatto…».
13. [ ] **Secondo collegamento** allo stesso pannello: la stessa impronta, ma la riga grigia «Già
        memorizzata da un collegamento precedente».
14. [ ] **Collegamento in `http://`**: **nessuna** riga dell'impronta. Se compare, è un difetto:
        non c'è nessuna identità da verificare.
15. [ ] Confrontare l'impronta con quella che il pannello dice di sé —
        `openssl x509 -in /data/user/sws/config/tls.crt -noout -fingerprint -sha256`. Devono
        coincidere. *(È la cosa che rende utile tutta la funzione: se non coincidono, il confronto
        che l'IDE propone è teatro.)*

---

## E. Accesso dal pannello LVGL — la tastiera

Il difetto segnalato il 23-10-2026: «se premo *Aggiorna ora* mi compare direttamente *Per
aggiornare serve un amministratore del pannello* col solo bottone annulla, non c'è modo di fare il
login».

16. [ ] Su un pannello **LVGL** con un aggiornamento disponibile, premere «Aggiorna ora».
        Deve comparire il **form di accesso**, non il rifiuto secco.
17. [ ] La **tastiera a schermo** deve vedersi (contrasto vero, non testo su fondo dello stesso
        colore), deve **scrivere** nei campi, e il tasto di chiusura deve farla sparire.
18. [ ] «Annulla» deve riportare al sinottico, non lasciare il pannello bloccato.

---

## F. OpenPLC sul pannello (opzionale)

19. [ ] Installare **senza** `--con-openplc`: l'unità `openplc-runtime` **non deve esistere**, e
        il pannello non deve dichiarare di avere una versione più vecchia di quella che ha
        (era il difetto del conteggio delle unità).
20. [ ] Installare **con** `--con-openplc`: l'unità c'è ma **non parte da sola**. Si avvia a mano
        con `systemctl --user enable --now openplc-runtime`.
21. [ ] L'Editor di OpenPLC raggiunge `https://127.0.0.1:8443` sul pannello, e la cartella della
        logica è `<progetto>/openplc/`.
22. [ ] La logica viaggia col progetto: backup, export e deploy la portano; `git` la prende da sé.
23. [ ] Modbus di OpenPLC risponde su `127.0.0.1:1502` (non 502: in rootless sotto la 1024 non si
        pubblica) e una sorgente Modbus di SWS puntata lì legge.

---

## F-bis. Il tubo che segue un oggetto mosso da una variabile

Uscito nella 2.19.0, mai visto su uno schermo vero.

37. [ ] Su un pannello **LVGL**, un tubo agganciato alla bocca di un simbolo che una variabile
        sposta: il tubo deve seguirlo **dal vivo**, non restare dov'era. Sul web funzionava già
        perché le posizioni risolte dai binding ci sono; su LVGL andava ricalcolato al cambio.
38. [ ] E non deve staccarsi al **primo fotogramma** (la Fase 1 del piano): all'apertura della
        pagina il tubo deve essere già attaccato, non attaccarsi dopo il primo aggiornamento.

---

## G. OPC-UA — strutture, dai due lati

Si può fare sul PC, senza pannello.

24. [ ] **Il nostro server**: un progetto con un tag **composito** (istanza di un tipo). Nel
        browse di un client terzo (UaExpert, o il nostro) la radice deve essere una **cartella**
        con un nodo figlio per foglia, e il nodo figlio deve avere l'identificatore del percorso
        (`motore1.velocita`). **Prima non compariva affatto.**
25. [ ] I valori dei nodi figli devono **aggiornarsi** (il `TagDb` trasmette la radice: senza
        l'espansione in foglie resterebbero fermi per sempre).
26. [ ] Scrivere su un nodo figlio da un client terzo: deve arrivare sulla foglia giusta, con la
        scala applicata.
27. [ ] **Il nostro client** contro un server con strutture: scrivere su una foglia deve usare il
        **nodo figlio**. Se il server i figli non li espone, il rifiuto deve dire **perché**, non
        «non ancora supportata».
28. [ ] **Trust store**: aggiungere una sorgente OPC-UA nuova, collegarsi a un server mai visto.
        La tabella del trust store non deve più essere vuota, «Fidati» deve spostare davvero il
        certificato, «Elimina» non deve rispondere 404.
29. [ ] Una sorgente OPC-UA **vecchia** (che non dichiara la policy) deve continuare a collegarsi
        **come prima**. Se si stacca, la regola di compatibilità non ha funzionato ed è un difetto
        grave: sarebbe un aggiornamento che stacca impianti funzionanti.

---

## G-bis. Sparkplug B — serve un nodo vero (o un simulatore)

Il difetto corretto il 23-10-2026 è provato da dodici test che si costruiscono i byte a mano dai
numeri della specifica, quindi la decodifica è verificata. **Quello che i test non possono dire è
se un impianto vero parla come la specifica dice.**

32. [ ] Puntare una sorgente Sparkplug B a un nodo vero, o a un simulatore (Ignition, o
        `tahu`/`pysparkplug`). I valori devono arrivare — prima **non arrivavano affatto**: una
        metrica intera faceva rifiutare l'intero payload.
33. [ ] Verificare che arrivino anche i dati che usano **solo l'alias**: NBIRTH col nome, poi
        NDATA col solo numero. È il modo normale di Sparkplug e prima lo scartavamo in silenzio.
34. [ ] Un intero **negativo** (Int16 o Int32) deve arrivare negativo, non come un numero enorme.
35. [ ] Una metrica dichiarata **nulla** deve lasciare il valore precedente e marcare il tag
        Uncertain, non scrivere uno zero.
36. [ ] Se la sorgente ha una metrica scrivibile: un comando (NCMD) deve essere **accettato** dal
        nodo. Prima il payload che spedivamo non era leggibile, e non portava il tipo dichiarato.

---

## H. Ruoli e registro

30. [ ] Entrare come **Supervisore** e aprire una sorgente OPC-UA: al posto del trust store deve
        comparire una riga che dice che è riservato all'Amministratore. **Non** un errore 403.
31. [ ] Generare, caricare e togliere un certificato, e fidarsi/eliminare un certificato OPC-UA:
        ognuna delle operazioni deve lasciare una voce nel **registro di audit**, **con il nome**
        di chi l'ha fatta.

---

## Non è un collaudo, ma è dovuto

- **CasaDomotica.** La regola di `CLAUDE.md` del 16-10-2026 dice che quando una funzione visibile
  entra in `main` va messa anche nel progetto di riferimento. Di questo giro le candidate sono: una
  sorgente **OPC-UA con una struttura** (oggi CasaDomotica non ne ha), e il **TLS acceso** sul
  pannello di casa. OpenPLC in un impianto domestico probabilmente non ha un posto sensato — e se
  è così **vale la pena annotarlo**, perché è un indizio su chi sia il destinatario di quella
  funzione.
- **`NOVITA.yaml`.** Il blocco `Unreleased` porta sei voci. Vanno rilette prima del rilascio: una
  voce aggiunta **dopo** che l'immagine è stata costruita non è nella sua etichetta, quindi non è
  vera.
