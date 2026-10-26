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

> **24-10-2026**: punti 1, 2 e 4 fatti — interstiziale, «Procedi» funziona, NSS scrivibile, e il certificato
> del dispositivo Pixsys in `/mnt/protected/ssl/`. Risultati e strade nel [piano C4](plans/2026-10-23-c4-tls-di-default.md).
> Punto 3 fatto: riavvio a freddo col TLS acceso, `active` con `NRestarts=0`. E con il certificato del
> dispositivo (HOWTO §29) lo schermo mostra il sinottico **senza avvisi**.

1. [x] Sul TC620, con un progetto **web** attivo, accendere il TLS: IDE → Configurazione →
       Istanza → Device → Stato → **Certificato TLS** → «Genera certificato self-signed».
       Il pannello riparte da solo.
2. [x] **Guardare lo schermo del pannello.** Cosa compare?
       - il sinottico, come prima → il browser accetta l'autofirmato su loopback: C4 è fattibile
         come sperato, e la risposta alla domanda 2 è «niente da fare»;
       - l'interstiziale «La connessione non è privata» → si può passare oltre **toccando**
         Avanzate → Procedi? Se sì, resta da decidere se è accettabile che lo faccia un operatore
         una volta; se no, serve la via «il pannello si fida del proprio certificato»;
       - pagina bianca o errore di rete → vuol dire che l'URL è ancora `http://` da qualche parte:
         annotare **esattamente** cosa dice la pagina.
3. [x] **Riavviare il pannello** (`reboot`) con il TLS ancora acceso. Il container deve tornare
       `healthy` e il servizio avviarsi. **Questo è il difetto corretto il 23-10-2026**: prima il
       controllo di salute chiedeva `/health` solo in chiaro e, con `Notify=healthy`, l'unità non
       sarebbe mai diventata sana — riavvio ogni cinque secondi. Verifica:
       `podman healthcheck run sws-runtime` e `systemctl --user status sws-runtime`.
       (Se il bus non si trova: `XDG_RUNTIME_DIR=/run/user/$(id -u)` davanti, HOWTO §27.)
4. [x] Annotare se chromium ha un archivio di fiducia scrivibile sul pannello
       (`/` è in sola lettura fuori da `/data`): serve solo se il punto 2 è andato male.

**Dove finisce il risultato**: `docs/archive/2026-10-23-c4-tls-di-default.md`, domanda 2.

---

## A-bis. La fiducia del browser del pannello (26-10-2026)

**Ha sostituito la proposta col certificato del dispositivo**, che era qui e non si collauda più:
quella strada è stata ritirata il 26-10, perché chi sviluppa PixsysOS ha detto che la chiave su
cui si reggeva è già un errore e potrebbe sparire. Il punto 4 di allora — «nel cloud la proposta
non compare mai» — è passato: oggi non compare da nessuna parte, perché non esiste più.

Serve un pannello Pixsys, **aggiornato all'immagine nuova** (l'installatore è cambiato, quindi
va rifatta anche la configurazione del servizio).

1. [ ] Dopo l'aggiornamento, sul pannello: `cat /data/user/sws/config/fiducia-browser` deve
       esistere, e `systemctl --user status sws-fiducia.path` deve essere attivo.
2. [ ] **Su un pannello che era in chiaro**: dopo il riavvio deve trovarsi in **HTTPS da solo**,
       e lo schermo deve mostrare il sinottico **senza** «La connessione non è privata».
3. [ ] Sicurezza → Certificati, colonna del pannello: la card dice che il browser si fida. Non
       deve esserci nessuna proposta da accettare né nessun comando da copiare.
4. [ ] **Il guardiano segue il cambio**: premere «Genera certificato self-signed». Dopo il
       riavvio lo schermo deve essere ancora senza avvisi — è il punto che l'installatore da solo
       non coprirebbe, ed è il motivo per cui esiste `sws-fiducia.path`.
5. [ ] **Rimuovi** il certificato: il pannello torna in chiaro, e
       `fiducia-browser.sh <config> --verifica` non deve più elencare «SWS pannello».
6. [ ] **Non misurato, da misurare qui**: dopo un cambio di certificato basta riavviare il solo
       kiosk, o serve tutto il pannello? Nella prova del 26-10 si era riavviato tutto.
7. [ ] Su un dispositivo **senza `certutil`** (o fingendolo): l'installatore deve dirlo, il
       pannello resta in chiaro, e la card deve spiegare perché invece di tacere.

**Da ripulire sui pannelli di prova**: il TC620 ha ancora la copia della chiave del dispositivo
fatta il 24-10. Va tolta — era un'eccezione a una strada che non esiste più.

## A-ter. Il configuratore dei moduli (25-10-2026) — l'MCM260X-5AD sul TC620

1. [ ] Il dispositivo 5AD del progetto di prova, card del dispositivo: la sezione «Configurazione del modulo» mostra i
       quattro tipi di sonda, l'unità, le due uscite e la compatibilità — **non** indirizzo, baud, parità.
2. [ ] Fissare AI1 = 12 (PTC1K), AI2-AI4 = 11 (NTC10K) come al collaudo del 04-10; salvare. Nel log del pannello:
       «setup del modulo — … da X a Y» solo per quelli diversi, poi «setup del modulo applicato».
3. [ ] Spegnere e riaccendere il pannello: al ricollegamento il log **non** riscrive niente (tutti uguali).
4. [ ] Cambiare a mano un parametro sul modulo (script Modbus o software Pixsys), riavviare il runtime: torna al
       valore del progetto. Gli AI leggono i valori giusti.

## A-quater. I report programmati (26-10-2026)

1. [ ] Dal cloud, con il TC620 collegato: Configurazione → Progetto → Report → «+ Nuovo report», periodo «turno», due o
       tre tag con lo storico acceso, salvare.
2. [ ] «▶ Genera ora»: compaiono un PDF e un Excel; scaricarli. Il PDF ha riepilogo, andamento e allarmi con i valori
       veri; l'Excel si apre e i numeri si sommano.
3. [ ] Con un destinatario email e l'SMTP delle Notifiche configurato: la mail arriva con i due allegati.
4. [ ] Lasciare il pannello acceso oltre l'ora del cron (es. `*/15 * * * *` per provare): i file nascono da soli; con
       «File da tenere» = 2 restano solo le ultime due generazioni.

## A-quinquies. SMS, voce e reperibilità (26-10-2026)

Serve un account Twilio (anche di prova: chiama e scrive solo ai numeri verificati) e il TC620 collegato al cloud.

1. [ ] Configurazione → Progetto → Notifiche → Telefono: Account SID, token, numero Twilio; salvare; «Invia SMS di
       prova» al proprio cellulare → arriva.
2. [ ] Due reperibili di turno adesso (il proprio numero e un secondo), attesa 2 minuti; in **Cosa e dove** spuntare
       Voce sullo scatto. Far scattare un allarme: squilla il primo, si sente il messaggio.
3. [ ] Non rispondere: dopo 2 minuti tocca al secondo. Premere 1: l'allarme risulta riconosciuto da «telefono: …»
       nel registro e la catena si ferma.
4. [ ] SMS: impostare nella console di Twilio il webhook `https://<gateway>/telefono/<pannello>/sms`, spuntare SMS
       sullo scatto, far scattare un allarme e rispondere «OK» → riconosciuto.
5. [ ] Togliere i reperibili di turno (fascia diversa da adesso): l'allarme non chiama nessuno e il log lo dice.

## A-sexies. Il tunnel: vivo, spento o perso (26-10-2026)

1. [ ] Console → Pannelli con il TC620 collegato: pallino verde. `sudo systemctl --user stop sws-runtime` sul
       pannello (o spegnerlo dal pulsante): il pallino diventa **giallo** con l'ora, e il log del gateway dice
       «spegnimento annunciato».
2. [ ] Staccare il cavo di rete del pannello (half-open): entro circa un minuto e mezzo il log del gateway dice
       «tunnel muto» e il pallino diventa grigio.
3. [ ] «Sposta azienda» su un pannello collegato: si ricollega da sé in pochi secondi.

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

16. [x] Su un pannello **LVGL** con un aggiornamento disponibile, premere «Aggiorna ora».
        Deve comparire il **form di accesso**, non il rifiuto secco. **Passa** (26-10-2026, WP630
        sulla 2.22.0).
17. [x] La **tastiera a schermo** deve vedersi (contrasto vero, non testo su fondo dello stesso
        colore), deve **scrivere** nei campi, e il tasto di chiusura deve farla sparire.
        **Passa** (26-10-2026).
18. [x] «Annulla» deve riportare al sinottico, non lasciare il pannello bloccato. **Passa**
        (26-10-2026).

    > **Chiusa il 26-10-2026**, con la 2.22.0 sul WP630. Parole del maintainer: «il menù di login
    > per diventare admin ora funziona come mi aspettavo». La schermata e cambiata nel frattempo:
    > i due campi stanno insieme in una colonna centrata, e ci sono «Annulla» e «Accedi» — prima
    > si confermava solo col ✓ della tastiera. Guardia `check_accesso_lvgl.sh`.

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
        browse di un client terzo (UaExpert, o il nostro) la radice deve essere una **variabile**
        con un `DataType` struttura (dalla 4d, 23-10-2026: prima era una cartella), con un nodo
        figlio per foglia che ha l'identificatore del percorso (`motore1.velocita`). UaExpert deve
        mostrare il valore della radice coi suoi campi, non un `ExtensionObject` illeggibile.
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
30. [ ] **Il nostro client contro un server di terzi con strutture** (4d, passi 10-12, 25-10-2026):
        una sorgente OPC-UA con un tag composito mappato su un nodo struttura di un altro server
        (`node-opcua-server-example` ne ha). Le foglie del tag devono avere i valori del server,
        con qualità buona, e seguirne i cambi. Se restano `Bad`, nel log della sorgente c'è
        «albero dei tipi non costruito» col motivo — oppure il tipo è una union (non si legge, ed
        è dichiarato) o è annidato (fuori portata, dichiarato).

---

## G-ter. I tag compositi nell'editor (Fase 2 del piano dei tag, mai collaudata a schermo)

Si fa sul PC, nell'IDE.

31. [x] Configurazione → Variabili → **Tipi**: creare un tipo `Motore` con due membri, poi un tag
        istanza di `Motore`. Nell'albero il tag deve mostrare le foglie (`motore1.velocita`…).
        **Passa** (26-10-2026).
32. [x] Un oggetto del sinottico legato a una **foglia** (`motore1.velocita`): il completamento del
        percorso deve proporla, e il valore deve arrivare. **Passa** (26-10-2026).
33. [ ] **Rinominare** il tag radice: i riferimenti alle foglie nei sinottici devono seguire.

    > **NON PASSA — 26-10-2026.** Rinominando `motore1` in `Pompa2` la variabile si è sdoppiata:
    > nell'elenco è comparso un tag piatto `motore1.velocita` di tipo `f64`, accanto a `Pompa2`.
    >
    > Misurato in `CasaDomotica` sul VPS, non dedotto. In `project.yaml` ci sono **tutti e due**:
    > `- id: Pompa2 … type_ref: motore` e `- id: 'motore1.velocita '`. In `synoptics/Home.yaml`
    > l'oggetto punta **ancora** a `'motore1.velocita '`, cioè **al nome vecchio**.
    >
    > I due meccanismi che servirebbero **esistono già** e funzionano: `rinomina()`
    > (`tag/rinominaTag.ts:205`) segue anche i percorsi delle foglie quando la radice è
    > composita, e `ePercorsoDiUnaRadice` (`tag/riconciliaTag.ts:148`) impedisce di creare un
    > tag piatto dentro una radice. Non sono stati eseguiti perché la rinomina non è passata di
    > lì: `TagsTab.tsx:142` offre la rinomina-ovunque (l'icona ✎, riga 607) **solo per gli id già
    > salvati su disco**, e scrivere direttamente nel campo del nome rinomina solo quella riga.
    > Poi, al salvataggio, la riconciliazione ha visto il sinottico citare `motore1.velocita `
    > senza più una radice `motore1`, e l'ha creato — facendo esattamente il suo mestiere.
    >
    > Quindi il difetto è nell'interfaccia, non nelle due funzioni: **il campo del nome è
    > modificabile e la modifica non trascina niente**, mentre la rinomina sicura sta dietro
    > un'icona. Da decidere come chiuderlo — vietare la scrittura diretta, o farla passare
    > sempre da `rinomina()`.
    >
    > **Secondo rilievo, minore ma suo**: il membro del tipo è stato accettato come `velocita `
    > **con uno spazio in coda**, e lo spazio è finito nel percorso della foglia. Un id così non
    > lo ridigita giusto nessuno. I nomi dei membri vanno ripuliti in ingresso.
    >
    > **Da ripulire**: la prova è stata fatta dentro `CasaDomotica`, il progetto di riferimento.
    > Vanno tolti il tipo `motore`, il tag `Pompa2`, il tag orfano `'motore1.velocita '` e
    > l'oggetto in `Home.yaml:79`.
34. [ ] Un faceplate con parametro `istanza(Motore)`: scegliendo l'istanza, i campi si legano da soli.

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
