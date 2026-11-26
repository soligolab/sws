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
> Il collaudo si fa con la skill **`/test-changes`** (dal 05-11-2026): propone le voci una alla
> volta e, a fine sessione, le spunta qui con la data.
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

## Collaudo 2.28.0-dev.1 sul WP630 (26-11-2026) — il firewall dei dispositivi

Piano [`docs/archive/2026-11-26-firewall-dei-dispositivi.md`](archive/2026-11-26-firewall-dei-dispositivi.md). Pannello
`wp630-a-p3-07a077.local` su Pixsys OS 2.2.0 (firewalld 1.3.2), canale Sviluppo; gateway di sws.soligo.net sulla
`2.28.0-dev.1`. Letture via ssh dal portatile, azioni dall'IDE del cloud e dai pannelli di controllo.

1. [x] Al primo avvio della dev.1 il runtime apre 7443/tcp e 7444/tcp nella zona `public`, runtime e permanente, e
       scrive `sws_ports_opened` in `config/firewall.json`. Dalla LAN 7443 e 7444 rispondono 200. Confermato dal
       maintainer il 26-11-2026.
2. [x] IDE → Device → Firewall: «+ porta» 4840/tcp, conferma: la porta è nella configurazione permanente. Confermato dal
       maintainer il 26-11-2026.
3. [x] 7444 spenta senza conferma: riepilogo rosso; dalla LAN chiusa dalle 14:29:18 alle 14:30:17, poi torna da sola.
       Confermato dal maintainer il 26-11-2026.
4. [x] atvise, finder e cockpit spenti in una modifica sola e confermati: spariscono dalla configurazione, restano nella
       scheda come interruttori spenti; cockpit riacceso e confermato. Confermato dal maintainer il 26-11-2026.
5. [x] 4840 → 4841 con «Modifica», senza conferma: una barra con due righe; dopo 60 s torna 4840, la configurazione
       permanente non cambia mai. Confermato dal maintainer il 26-11-2026.
6. [x] Regola per sorgente `192.168.1.0/24` su 7444/tcp, accept: il testo composto dal modulo è in
       `--permanent --list-rich-rules`. Confermato dal maintainer il 26-11-2026.
7. [x] Pannello di controllo LVGL (codesys spento e confermato, attore `control-panel:screen`) e web (la regola del
       test 6 spenta e confermata, attore `control-panel:network 192.168.0.225`). Confermato dal maintainer il
       26-11-2026.
8. [ ] `install-container.sh --uninstall` toglie le porte di SWS: non provato sul WP630 (smonterebbe SWS); coperto da
       `tests/shell/firewall.sh`.
9. [ ] **Anomalia**: alla scadenza dei 60 s il registro delle azioni (`audit.jsonl`) non scrive niente; c'è solo il
       WARN nel log del runtime. Corretto in `main` (`baa98062`, `firewall.expired`): si collauda nella prossima dev.

## Collaudo 2.27.0 (release del 25-11-2026) — il canale degli aggiornamenti dall'IDE

La 2.27.0 sposta `latest-*`, `rc-*` e `dev-*`: tutti e tre i canali portano alla 2.27.0. Piano
[`docs/plans/2026-11-25-cambio-di-canale-dal-cloud.md`](plans/2026-11-25-cambio-di-canale-dal-cloud.md). La 2.27.0
contiene anche le correzioni della dev.4: le loro voci sono nel piano
[`docs/plans/2026-11-25-correzioni-collaudo-dev3.md`](plans/2026-11-25-correzioni-collaudo-dev3.md), sezione «Verifica».

1. [ ] **TC620** (2.26.0-rc.29, canale di prova), dall'IDE del cloud: «Aggiorna ora» propone la 2.27.0, con le 7 voci di
       compatibilità in cima e le 15 Novità. Dopo il riavvio lo stato dice 2.27.0. Se fallisce: il tag `rc-arm64` non
       è stato spostato (`scripts/registro.py tags`).
       26-11-2026: il maintainer ha aggiornato il TC620 alla 2.27.0 la mattina. Da guardare stasera: lo stato e le
       Novità che il pannello ha mostrato.
2. [ ] **TC620** sulla 2.27.0: un deploy di CasaDomotica (TC620_Verticale) mostra le pagine Clima, Luci, Piano terra e
       Piano superiore coi faceplate `fit`. Se fallisce: il runtime non legge `fit`.
3. [x] **TC620**: il menu «Canale» nella riga di «Aggiornamento del runtime» → Sviluppo → conferma con l'avviso rosso.
       Il canale di sviluppo ha la stessa 2.27.0: il pannello non si riavvia, e la riga gialla dice che resta sulla
       2.27.0 finché Sviluppo non ha una versione più alta. Alla prima 2.28.0-dev.N, «Aggiorna ora» fa il cambio.
       Confermato dal maintainer il 26-11-2026 sul **WP630** e non sul TC620: dal canale di prova (2.27.0) a Sviluppo, con
       la 2.28.0-dev.1 già pubblicata; il pannello è passato da solo a `dev-arm64` e alla dev.1.
4. [ ] **PLX800** (2.27.0-dev.3, versione fissata): Canale → Stabile. La 2.27.0 è più alta: istantanea dei dati, poi il
       pannello riparte in circa un minuto sulla 2.27.0, e lo stato dice «canale stabile». Sul pannello
       `grep -E '^(Image|AutoUpdate)|SWS_IMAGE' ~/.config/containers/systemd/sws-runtime.container` mostra
       `latest-arm64` e `AutoUpdate=registry`. Se il pannello torna sulla dev.3 da solo: l'installer ha visto la 2.27.0
       non sana; il log è in `journalctl --user -u 'sws-quadlet-aggiorna-*'`.
5. [ ] **PLX800** dopo la voce 4 (facoltativa, perde i dati scritti dopo il cambio): «Torna alla 2.27.0-dev.3» riporta
       l'immagine fissata `2.27.0-dev.3-arm64` nel quadlet, non `latest-arm64`.
6. [ ] Un pannello fissato con un canale in attesa: «Questa versione (fissata)» toglie la scelta, la riga gialla sparisce,
       il pannello non si riavvia.

## Collaudo 2.27.0-dev.3 sul PLX800 (25-11-2026)

PLX800 `user@plx800-a-p3-l2-a2-0891bc.local` reinstallato da ghcr con la `2.27.0-dev.3-arm64` (versione fissata), con
un monitor HDMI 1920×1080. Gateway del cloud sulla dev.3, IDE locale 8460 da `main` (codice uguale alla dev.3).
Progetti `PLX800`, poi `PLX800_Verticale` (rinominato nel cloud). Le voci passate:

1. [x] Dopo l'aggiornamento il servizio parte, il progetto si apre, sorgente e tunnel partono; le uscite comandano i
       loopback — confermato dal maintainer il 25-11-2026 (prima serviva l'alimentazione della sezione I/O, che è
       separata da quella del sistema).
2. [x] Le scritture dal viewer nel registro (rc.30, voce 7): una riga `tag.write` con `via: ws` per scrittura, le
       scritture entro 1 s raggruppate (`coalesced`) — confermato dal maintainer il 25-11-2026.
3. [x] La pagina Utenti salva da sé (rc.30, voce 4) — confermato dal maintainer il 25-11-2026 nell'IDE del cloud
       (progetto `tiny-ty`). Il segnale «Salvato» si vede poco: piano
       [Save nella testata](plans/2026-11-25-save-nella-testata.md).
4. [x] Il deploy dalla rete locale con un utente del progetto, su un pannello abbinato dal cloud prima della 2.27, si
       ferma prima di toccare il pannello (rc.30, voce 3) — confermato dal maintainer il 25-11-2026.
5. [x] All'avvio il log dice `user store empty` col percorso, non più «no-auth mode» (rc.30, voce 5) — letto il
       25-11-2026.
6. [x] La rotazione si chiede prima del deploy (rc.30, voce 1): «No» non riavvia; «Sì» riavvia una volta, in verticale
       e poi in orizzontale — confermato dal maintainer il 25-11-2026.
7. [x] Anomalia 6 della rc.30 (i PLC fermi dopo il riavvio da rotazione): **non riprodotta** su due riavvii (10:02 e
       11:29). `pixsys-launcher` esce con 0, `plc.target`, LogicLab, il bridge e atvise partono — 25-11-2026.

Le voci non provate:

8. [ ] Pagina Utenti: Zone scritto un carattere alla volta con la virgola, e il Tab dopo il nome (residuo A2): non
       confermati.
9. [ ] Il socket dei tag rifiuta le scritture sui tag calcolati (residuo A3): il progetto PLX800 non ha tag calcolati.
       Da provare su un progetto che li ha.
10. [ ] Il tetto di 20 righe al secondo per socket nel registro: non si raggiunge a mano.
11. [ ] Un secondo deploy entro 10 minuti non chiede di nuovo la rotazione in attesa (residuo A1): con «Sì» il
        riavvio parte subito, quindi non resta una rotazione in attesa da osservare.
12. [ ] Il testo della conferma «senza utenti» (`cfg.deployNoUsersConfirm`, rc.30 voce 5): non è comparso.
13. [ ] L'abbinamento dal cloud crea l'Admin del dispositivo (residuo B1): il PLX800 era già abbinato.

Le anomalie (la patch, in `STATUS.md`):

14. [ ] 25-11-2026: non passa — dopo «Eliminare solo il progetto, restando nel cloud» e un deploy, la pagina del
        monitor resta ferma (valori fermi, comandi che non partono, fascia «Dati in ritardo» che conta). Un riavvio del
        browser la sblocca. Correzione indicata dal maintainer: dopo «Elimina» si chiude il pannello di controllo e il
        browser riparte.
15. [ ] 25-11-2026: non passa — rinominare nel cloud il progetto aperto dà un errore rosso e mostra il progetto vuoto:
        l'IDE rilegge dal prefisso `/p/-/<nome vecchio>/`.
16. [ ] 25-11-2026: non passa — «Cambia risoluzione» mette `faceplate_scale` e il contenuto dei faceplate si stira sul
        riquadro: i testi si allargano o si schiacciano (sul PLX800 `fresh` 1,54 × 1,35). Le proporzioni degli oggetti
        vanno tenute.
17. [ ] 25-11-2026: da guardare — dopo il reset che tiene il cloud il log dice «in attesa di abbinamento» con un codice,
        ma il pannello è abbinato. Da verificare se quel codice permette un secondo abbinamento dalla rete locale.
18. [ ] 25-11-2026: da guardare — tre conferme di fila in un deploy (utenti, cancellazione, rotazione), la prima con un
        altro stile; due login falliti dal cloud dopo un deploy che sostituisce gli utenti, poi il 429.

Fuori da SWS: il monitor del PLX800 non gira l'immagine con la rotazione di PixsysOS (da segnalare a chi fa PixsysOS).

## Collaudo 2.27.0-dev.0 sul PLX800 (23-11-2026) — la sorgente `plx800_io`

Ramo `feat/plx800-io` (squashato in `main` il 23-11-2026 sera, `ae62396f`), immagine costruita in locale e installata da
archivio sul PLX800 `pixsys@plx800-a-p3-l2-a2-0891bc.local` (PixsysOS 2.1.3, LogicLab acceso, nessuno schermo),
abbinato dal cloud. Gateway 2.26.0-rc.29, IDE locale 8460 dal ramo. Progetto `PLX800` dal template `plx800-io`.

1. [x] Installazione da archivio, abbinamento al cloud, primo deploy dal cloud — confermato dal maintainer il 23-11-2026
       (col riavvio da rotazione non annunciato: anomalia 1 della rc.30).
2. [x] Il progetto dal template si apre e la sorgente parte — confermato dal maintainer il 23-11-2026.
3. [x] Sorgente `host` sul PLX800: nome, modello, seriale, temperature (uguali a sysfs), `ethernet0`, disco, uptime —
       confermato dal maintainer il 23-11-2026.
4. [x] DIP, tensioni e temperatura della scheda vivi e Good — confermato dal maintainer il 23-11-2026.
5. [x] Con `writes: true` le uscite e i LED si comandano; gli ingressi in loopback seguono — confermato dal maintainer il
       23-11-2026.
6. [x] Stop del servizio: uscite a riposo, PoE e coil 15 intatti, RUN LED com'era; al riavvio il lock si riprende —
       confermato dal maintainer il 23-11-2026.
7. [x] Un altro scrittore tiene il lock: sorgente in sola lettura, card dell'IDE «lock occupato», OUT0 bloccato nel
       viewer; il lock si riprende 2,9 s dopo il rilascio — confermato dal maintainer il 23-11-2026.
8. [x] Fermando il bridge (`qmb800-shm-bridge.service`) i punti vanno Bad entro un secondo e la pagina diventa rossa;
       alla ripartenza tornano Good. Il 23-11 il ritorno durava 24 s; corretto (il segmento si ricerca ogni 500 ms e un
       segmento ricreato si riconosce dall'inode) — confermato dal maintainer il 25-11-2026 sulla 2.27.0-dev.3: Bad
       entro 0,35 s dallo stop, Good 0,33 s dopo lo start.

## Collaudo 2.26.0-rc.29 sul WP630 (23-11-2026) — fermo al test 7/12

`user@wp630-a-p3-07a077.local`, progetto `tiny-ty`, IDE nel cloud. Test 1-6 superati; dal test 5 e dal 6 le anomalie
A-E, corrette nella rc.30 ([piano](plans/2026-11-23-correzioni-collaudo-rc30.md), registro del collaudo in
[allegati](plans/allegati/2026-11-23-collaudo-rc29-wp630-anomalie.md)). La registrazione voce per voce la fa la
sessione del WP630 col sì del maintainer.

1. [ ] Sulla rc.30: ricollaudo di A (tag calcolato Bad da un ingresso Bad), B (trend con «Dato non valido» e linea
       interrotta, web e LVGL), C (niente barra «progetto cambiato» salvando dalla finestra dei simboli), D (un ingresso
       nuovo chiede il nome, gli effetti non si scambiano gli ingressi), E («Togli ritaglio» e poi selezionare la forma).
2. [ ] Test 7-12: deploy con un simbolo aggiornato senza ricaricare, benvenuto `{{user.name}}`, PIN e cambio password,
       ruolo minimo di una funzione, LDAP, libreria aziendale.

## Collaudo 2.26.0-rc.23 (22-11-2026) — i sedici rami del 20-22-11

Squash in `main` prima del collaudo (regola «rc prima del collaudo»), tag `2.26.0-rc.23`, immagini `3e9e1d6c-*` e
`rc-*`, gateway del VPS sulla rc.23. Il TC620 si aggiorna dall'IDE: Configurazione → Istanza → Device → Connessione →
«Aggiorna ora» (canale rc) — è anche la prova dell'aggiornamento. Le misure degli effetti: TC620 ora, TY570 da lunedì.

### L'editor dei simboli e la chiusura
1. [ ] Modifica un simbolo → «Chiudi»: Annulla (resta), «Esci senza salvare», «Salva e chiudi»; Esc → «Esci senza
       salvare»; con errori nel simbolo niente «Salva».

### Il progetto e il suo pannello
2. [ ] IDE locale: progetto A → Connessione al TC620 → chiudi → apri B: scollegato; riapri A: «Ricollegarsi a …?» →
       Sì. Deploy di B sul pannello di A: la conferma «sostituisce progetti».

### L'IA sui campi
3. [ ] Un tag calcolato → λ → scintilla → «la RAM in MB con due decimali»: la domanda, poi espressione, unità,
       decimali → «Applica», Salva. Lo stesso col «Formato» di un testo legato a un tag.

### NOVITA
4. [ ] Le voci della 2.26.0 nel pannello prima dell'aggiornamento (ora sono una quarantina, in rc senza limite):
       si leggono, nessuna doppia, nessuna sbagliata. La sintesi in 15 si fa insieme prima della 2.26.0.

### La sandbox degli script
5. [ ] Una costante in cima usata in un `def`; `f(*lista)` e `f(**diz)` sul pannello; un `print` prima di un errore
       arriva nel registro; un parametro chiamato `state` rifiutato al salvataggio.

### Le sorgenti
6. [ ] «Attiva» tolto su una sorgente → «spenta» in testata, tag Bad, `<id>.disponibile` falso; riattivata riparte.
7. [ ] Modbus con «Giri di tolleranza» 3 (CasaDomotica, Solarman): una risposta persa lascia l'ultimo valore,
       incerto; staccando il dispositivo, Bad dopo tre giri.

### «Salva come…» col repository
8. [ ] Su un progetto con repository: la domanda; «ramo nuovo» → scheda Git sul ramo, Push che lo pubblica;
       «repository nuovo» → nessun remoto; «nessuno» → niente scheda Git. Il ⧉ dell'elenco non chiede.

### Il lock del progetto
9. [ ] Due schede (o due browser) sullo stesso progetto: la seconda vede «aperto da … da N minuti» → sola lettura:
       barra in alto, Salva non salva → «Prendi il controllo» → la prima, entro 15 s, avvisa e passa in sola lettura.
10. [ ] Chiusa la scheda che lo tiene, dopo un minuto il progetto è libero; una ricarica della stessa scheda non è
        «un'altra scheda». Anche nel cloud, due browser su CasaDomotica.

### Le foto nei simboli (fase 3)
11. [x] Editor dei simboli → «Foto…» → una foto del progetto: sotto a tutto, alle proporzioni giuste; sposta,
        ridimensiona, opacità; dentro una parte rotore gira con lei (scheda Prova) — confermato dal maintainer il
        25-11-2026 sulla 2.27.0-dev.3, nel runtime web del PLX800 (simbolo `prj:pixsys`, opacità compresa).
12. [ ] Un segnale con due voci e una foto ciascuna: in Prova, in pagina legato a un tag, e sul TC620 la foto cambia
        col valore.
13. [ ] «Genera foto» nella scheda IA (modello per «Sfondi»): OpenAI trasparente, FLUX grigio; la foto è fra le
        immagini del progetto.
14. [ ] «Importa SVG» con una foto dentro; «Esporta» → `.swsym` zip → importato altrove con le foto (`sym-…`).
15. [ ] Risorse → Immagini: «nel simbolo …» fra gli usi; rinominarla → il simbolo la segue; cancellarla → avviso.
16. [ ] Deploy verso un pannello ancora sulla rc.22: si ferma col messaggio, senza mandare niente.

### La libreria aziendale (fase 7)
17. [ ] «In libreria» dall'editor → «Libreria aziendale» nella galleria → in un altro progetto un clic la copia (con le
        foto) e la mette in pagina.
18. [ ] Modificata e rimessa in libreria → aprendo l'altro progetto, la barra «versioni più nuove» → «Aggiorna»:
        l'oggetto cambia aspetto e resta legato al tag. Una variante di una pompa di SWS: «sostituirla?».
19. [ ] Nel cloud: un membro di un'altra azienda non la vede; due della stessa la condividono; ✕ la toglie, le
        copie restano.

### L'autenticazione a due fattori
20. [ ] Menu 👤 → «Autenticazione a due fattori» → Attiva → QR con l'app → codice → i dieci codici di recupero.
21. [ ] Esci e rientra: password, poi il codice; un codice di recupero vale una volta; «Sessione scaduta» e PIN per
        posta chiedono il codice anche loro.
22. [ ] Console → Aziende → «Richiedi l'autenticazione a due fattori»: un membro senza viene disconnesso e al login
        deve attivarla; non la può spegnere. Console → Persone → «Azzera» → rientra con la sola password.
23. [ ] Cinque codici sbagliati → «troppi tentativi»; nel registro `auth.second_factor_failed`, `auth.login_blocked`.

### LDAP
24. [ ] Configurazione → Utenti → «Collega un dominio…» → «Prova» (anche con un utente: il ruolo) → Salva; la
        password in `secrets.yaml`, non in `project.yaml`.
25. [ ] Sul pannello (viewer e LVGL) l'utente di dominio entra col ruolo e le zone del gruppo; password sbagliata no;
        un nome che è anche utente locale entra solo con la password locale; server spento: l'Admin locale entra,
        `auth.ldap_unreachable` nel registro. Per la prova in casa: OpenLDAP in `podman` come nel test
        `a_real_directory` (`STATUS.md`).

### Gli effetti (fase 8)
26. [ ] «Anima…» → «Effetti»: bagliore su una spia, bollicine in un serbatoio, fumo su un camino, fiamma in una
        caldaia; in Prova con «Anima» si muovono, spenti spariscono.
27. [ ] In pagina legati a un tag booleano: nel browser con «Anteprima effetti» e nel viewer; sul TC620 dopo il deploy.
28. [ ] Le misure sul TC620 (SSH chiedendo): `SWS_MISURA_SIMBOLI=1`, `SWS_TEMPI_LOG=1`, `VmRSS` con i quattro effetti
        accesi in una pagina; lunedì le stesse sul TY570.

---

## Gli sfondi alla misura della pagina e il pulsante «Assistente IA» (20-11-2026)

Dal piano [sfondi alla misura della pagina](plans/2026-11-20-sfondi-alla-misura-della-pagina.md), ramo
`feat/backgrounds-page-size`. Gli sfondi costano: le prove con il fornitore vero le fa il maintainer, sull'IDE 8462 e
sul progetto TY570 verticale.

1. [ ] **Il pulsante**: barra dell'editor, in fondo a destra, «Assistente IA» → la chat si apre in una finestra a
       parte; un secondo clic la porta davanti. Con un utente non Admin il pulsante non c'è.
2. [ ] **L'intervista**: in chat «fammi uno sfondo per la pagina Energia» → la scheda «Prima di cominciare» chiede la
       misura (esatta 600×930 o una volta e mezza 900×1395) e se servirà col progetto girato. Senza risposte non
       genera niente.
3. [ ] **La misura**: esatta, un verso → la miniatura dice «600×930 · verticale», e in pagina lo sfondo si vede per
       intero, senza le parti tagliate di prima.
4. [ ] **I due versi**: «sì» → sotto la base la gemella «La stessa, per il progetto girato», 1024×506 orizzontale, con
       la stessa scena; «Usa come base» approva tutte e due; una luce (sera) arriva per tutte e due.
5. [ ] **Il progetto girato**: Applica, Salva; poi Impostazioni progetto → Formato → Orientamento orizzontale → la
       pagina usa la gemella, e le foto della dissolvenza coprono l'area nuova. Tornando verticale si torna a prima.

## L'editor dei simboli, fase 2, sessione 1 (19-11-2026)

Dal piano [fase 2](archive/2026-11-19-editor-dei-simboli-fase-2.md), su `main` (`b99855ddf`), sui pannelli dalla rc.22.
IDE 8460. Già provati dal maintainer nell'IDE il 19-11, dopo due giri di correzioni: vista esplosa, calamita, strati
raggruppati, trascinamento con l'aggancio («ora funziona come mi aspettavo»). Restano soprattutto le bocche coi tubi.

1. [ ] **Bocche di una pompa**: «Modifica simbolo» su una pompa con un tubo agganciato: le bocche si vedono col nome di
       prima (`n-left`…), «Attacchi dei tubi» dice 1 tubo; salvando, il tubo resta agganciato.
2. [ ] **Bocca nuova**: strumento «Bocca» su un simbolo nuovo, poi in pagina un tubo agganciato lì, sul web e sul TY570;
       spostare la bocca nell'editor sposta il capo del tubo.
3. [ ] **Rinomina e cancella**: rinominare una bocca con un tubo chiede conferma e il tubo la segue; cancellarla dice che
       il tubo finirà al centro.
4. [ ] **Misura**: cambiare la larghezza con «scala il disegno» acceso scala tutto, bocche comprese.
5. [ ] **Strumenti**: zoom con la rotella, riquadro, Ctrl+A, copia/incolla fra due simboli, griglia con aggancio,
       calamita con le guide, ruota/specchia, allinea/distribuisci, cerchio, polilinea chiusa e aperta, contorno, nessun
       riempimento, opacità, tratteggio, `d` a mano.
6. [ ] **Vista esplosa**: le forme di una pompa si allontanano; una si sceglie, si sposta, e uscendo è al suo posto
       (spostata della stessa quantità).
7. [ ] **Strato raggruppato**: ⧉ sullo strato della girante; nella vista esplosa le sue forme restano unite, un clic su
       una le sceglie tutte e si spostano insieme; dall'elenco degli strati se ne sceglie ancora una sola.
8. [ ] **Prova**: stato acceso/allarme, livello, girante che gira, leva, spia.
9. [ ] **«+ Nuovo simbolo»** in cima a Strumenti ▸ Simboli, senza aprire famiglie.

## Importa SVG e il file del simbolo (20-11-2026)

Dal piano [importa SVG e il file del simbolo](archive/2026-11-20-importa-svg-e-file-del-simbolo.md), ramo
`feat/symbol-import` (annidato sull'assistente IA). IDE di prova dal worktree. Le decisioni prese senza il maintainer
sono in fondo al piano: si confermano qui.

1. [x] **Importa SVG… in un simbolo nuovo**: «+ Nuovo simbolo», «Importa SVG…», un disegno vero (un'icona, un
       disegno fatto con Inkscape o Illustrator) → al posto del riquadro, con le proporzioni del disegno, forme scelte;
       la finestra dice cosa è stato lasciato fuori. Ctrl+Z torna al riquadro. — confermato dal maintainer il 20-11-2026 sull'IDE 8462.
2. [ ] **In un simbolo che ha già un disegno**: trascinare un `.svg` sul disegno → uno strato fermo nuovo in cima, le
       forme scelte si spostano e si scalano insieme; ogni forma si modifica da sola.
3. [ ] **Ctrl+V**: copiare il codice di un SVG da un editor di testo e incollarlo nell'editor → importato; Ctrl+C e
       Ctrl+V di forme dell'editor funzionano come prima.
4. [x] **Esporta / Importa un simbolo…**: «Esporta» scarica `<slug>.swsym`; in un altro progetto, Strumenti ▸ Simboli
       ▸ «Importa un simbolo…» lo apre come simbolo nuovo; «Salva», poi in pagina e sul pannello come gli altri. — confermato dal maintainer il 20-11-2026 sull'IDE 8462.
5. [ ] **Sul pannello**: un simbolo importato da SVG messo in una pagina e mandato al TY570 si vede come nell'IDE.
6. [x] **Invio nei campi dell'editor**: il nome di una bocca si conferma con Invio; nella scheda «IA» Ctrl+Invio
       manda la richiesta. Canc e Backspace in un campo non tolgono né forme né oggetti della pagina. — confermato dal maintainer il 20-11-2026 sull'IDE 8462 (con Ctrl+Z dopo «Duplica», che bloccava l'editor).
7. [x] **Le richieste nate al collaudo**: «Nuovo strato fisso» in «Sposta nello strato», ▲ ▼ sugli strati, cerchi e
       rettangoli scritti come tracciati riconosciuti all'import (l'SVG del sistema robotico) — confermato dal maintainer il 20-11-2026 sull'IDE 8462.

## L'assistente IA nell'editor dei simboli (20-11-2026)

Dal piano [assistente IA dei simboli](archive/2026-11-19-assistente-ia-simboli.md), ramo `feat/symbol-ai` (annidato
sulla libreria immagini). IDE di prova dal worktree; lo scopo «Disegno dei simboli» su un modello che sappia
disegnare (vedi le misure nel piano: qwen3.5:9b locale non ci riesce quasi mai).

1. [x] **Disegna nuovo**: un simbolo nuovo, scheda «IA», una frase → la proposta accanto al disegno di adesso, con
       modello, tentativi e costo; «Accetta» la mette nell'editor, Ctrl+Z la toglie. — confermato dal maintainer il 20-11-2026 sull'IDE 8462 (con Opus; il 9b locale disegna male).
2. [ ] **Modifica questo**: una pompa della libreria aperta come variante, «aggiungi una targa sopra» → la proposta
       tiene le bocche; «Accetta», poi un ritocco che parte dalla proposta; «Scarta».
3. [ ] **Da una foto**: «Aggiungi una foto» di una macchina vera → il disegno nello stile della libreria. Con un
       modello che non vede le immagini, il messaggio che lo dice, senza attese.
4. [ ] **Errori**: senza nessun modello configurato, il rimando a Configurazione → IA; un disegno non valido dopo tre
       tentativi mostra gli errori.
5. [ ] **Il resto dell'editor non si blocca** mentre l'IA disegna; «Interrompi» ferma l'attesa.
6. [x] **L'intervista prima del disegno**: una richiesta vaga → le domande con le risposte da cliccare, poi la scheda
       da correggere e «Disegna» — confermato dal maintainer il 20-11-2026 sull'IDE 8462 (con Opus il simbolo è venuto giusto al primo colpo).

## La chat chiede prima di lavorare, e si legge meglio (20-11-2026)

Dal collaudo del 20-11-2026, ramo `feat/symbol-ai-interview` (in `main` dal 20-11). IDE 8462.

1. [ ] **L'intervista**: in chat una richiesta vaga («fammi una pagina per la pompa del pozzo») → la scheda «Prima di
       cominciare» con al più quattro domande e le risposte da cliccare; per un lavoro grande, i passi in cui lo
       spezzerebbe e «Come procedo?». «Rispondi» manda le risposte, e l'assistente riparte da lì.
2. [ ] **Una richiesta chiara parte subito**, senza domande.
3. [ ] **Il testo formattato**: titoli, grassetto, codice, elenchi e tabelle dell'assistente si vedono formattati, a
       sinistra con la barra; i messaggi della persona a destra, nella bolla del colore del marchio.

## La libreria immagini (19-11-2026)

Dal piano [libreria immagini](archive/2026-11-19-libreria-immagini.md), ramo `feat/image-library` (annidato sulle
animazioni). IDE 8462 dal worktree.

1. [x] **Carica e piazza**: Strumenti ▸ Immagine apre «Del progetto» con «+ Carica immagine…» per primo; una foto del
       telefono (4000 px, qualche MB) → la scheda propone l'ottimizzazione già spuntata, con la misura dopo; caricata è
       già scelta, «Inserisci» la mette al centro con le sue proporzioni. — confermato dal maintainer il 20-11-2026 sull'IDE 8462 (corretta lungo la strada: selezionare il nome trascinando fuori dalla scheda chiudeva la libreria).
2. [ ] **Nome già usato**: ricaricare lo stesso file → sostituisci ovunque / tieni tutte e due / annulla.
3. [x] **Scorciatoie**: un file trascinato sul canvas finisce dove cade; una schermata incollata con Ctrl+V finisce al
       centro; con oggetti copiati nell'editor (senza passare da un altro programma) Ctrl+V incolla gli oggetti. — confermato dal maintainer il 20-11-2026 sull'IDE 8462.
4. [ ] **Gestione**: rinomina (la pagina la mostra ancora), sostituisci, elimina con il conteggio, «non usata», il
       totale contro gli 8 MB; Configurazione ▸ Risorse ▸ «Apri la libreria immagini».
5. [ ] **Proprietà**: miniatura, nome, «Cambia…»; sull'oggetto Immagine niente immagine di sfondo.
6. [ ] **Pannello**: deploy con una foto ottimizzata che passa, e l'immagine sul WP630/TY570.

## Le animazioni dei simboli (19-11-2026)

Dal piano [animazioni dei simboli](archive/2026-11-19-animazioni-dei-simboli.md), ramo `feat/symbol-anim` (annidato sulle
due correzioni LVGL). IDE 8462 dal worktree; pannello con un pacchetto di prova o con la rc che le porta.

1. [x] **«Anima…»**: nell'editor dei simboli, su una pompa: la girante «gira mentre l'ingresso è vero»; un tondo
       diventa un segnale (verde a 1, rosso che lampeggia da 2 a 9, nascosto a 0); un rettangolo «si sposta» verso
       l'alto, con la sagoma tratteggiata trascinata dove deve arrivare. «Prova» con «Anima» li mostra tutti. — confermato dal maintainer il 20-11-2026 sull'IDE 8462.
2. [x] **In pagina**: «Collegamenti ▸ Parti» ha una riga per pezzo, con Tag | Valore fisso; legati al simulatore si
       muovono, a canvas fermo con «Anteprima effetti» spento movimento e colore si vedono, rotazione e lampeggio no. — confermato dal maintainer il 20-11-2026 sull'IDE 8462 (corretto lungo la strada: «Valore fisso» su un segnale non faceva niente).
3. [ ] **Rinomina**: rinominare nell'editor un pezzo collegato chiede conferma, e l'oggetto della pagina segue.
4. [ ] **Pannello (WP630 o TY570)**: gli stessi pezzi, uguali al web; la riga `animations: … KB of … KB` nel log.
5. [ ] **Misure sul TY570** (con SSH chiesto): i quattro scenari del piano, i numeri annotati nel piano, il budget
       fissato da quei numeri.

## La tastiera a 5 righe e il grigio sui simboli, sul pannello LVGL (19-11-2026)

Rami `fix/lvgl-stale-lib-layers` e, annidato, `fix/lvgl-keyboard-5-rows`; sui pannelli con la rc che li porta.

1. [x] **TY570 in verticale, accesso**: la tastiera ha «A-Z» nell'ultima riga; toccato, cinque righe da sette con le
       lettere in ordine; «ABC» maiuscole, «1#» simboli, «QWE» torna indietro. Si scrive utente e password. — confermato dal maintainer il 20-11-2026 sull'IDE 8462: «ora si vede bene».
2. [ ] **La scelta ricordata**: dopo un riavvio del viewer la tastiera si riapre a 5 righe. Anche sulle celle di una
       tabella e sul motivo di un comando critico.
3. [ ] **Il grigio sui simboli**: una pompa `lib:` con `stale_after_s` e un tag che smette di aggiornarsi diventa
       grigia anche negli strati (prima restava a colori pieni); col lampeggio sfumato, respira.

## Il QR della schermata d'abbinamento (19-11-2026)

Su `main` (`e068ebd23`), sui pannelli dalla rc.22. Segnalato dal maintainer sul WP630 reinstallato.

1. [ ] **WP630 senza abbinamento**: il QR è grande (circa 200 px), sopra la spiegazione e centrato; il codice sta su una
       riga sola. Lo stesso sul TY570 e nel pannello di controllo.

## La galleria dei simboli solo dello stesso tipo (19-11-2026)

Dal piano [galleria dei simboli](archive/2026-11-19-galleria-simboli-stesso-tipo.md), ramo `feat/symbol-gallery-kind`.

1. [ ] Selezionata una pompa, «Parametri → Simbolo» mostra solo le pompe; un serbatoio solo i serbatoi; un pulsante solo i
       pulsanti.
2. [ ] «Modifica simbolo» su una pompa e salvataggio: la tessera di quella pompa mostra il disegno modificato col ✎.
3. [ ] «Salva come…» da una pompa: la copia compare in testa fra le pompe.
4. [ ] «+ Nuovo simbolo» con Categoria «Pompe» (dall'elenco): il simbolo nuovo compare fra le pompe; «Altro…» lascia
       scrivere una categoria propria.
5. [ ] Inserendo un simbolo nuovo dalla barra, il selettore mostra ancora tutta la libreria.

## Il setpoint sul pannello LVGL come sul web (19-11-2026)

Dal piano [setpoint LVGL come il web](archive/2026-11-19-setpoint-lvgl-come-il-web.md), ramo `fix/setpoint-lvgl`. Sul TY570,
pagina «Idrico - Parametri» di `DemoTY570_fiera`.

1. [ ] **La riga**: etichetta, «Attuale: … bar», il campo largo fino ai pulsanti, ✓ arancio attenuato e ⌨ grigio, come nel
       browser; «—» e campo vuoto quando il valore non c'è.
2. [ ] **Il tastierino sopra tutto**: toccando il campo o il ⌨ la scheda sta sopra la colonna «COMANDI IMPIANTO» e il
       pulsante in basso a destra, e i tasti rispondono tutti, compresi ✓ e «Annulla».
3. [ ] **min/max**: un valore fuori (per esempio 1 su «Pressione alta», min 3) mostra «Sotto il minimo (3)» e non scrive;
       un valore buono scrive e chiude la scheda.
4. [ ] **La conferma**: un setpoint con «chiedi conferma» apre la finestra prima di scrivere; uno critico chiede la password.
5. [ ] **Il colore del ✓**: cambiato nel pannello proprietà, cambia nella riga e nel tastierino, sul web e sul pannello.
6. [ ] **Cambiando pagina** con la scheda aperta (da un altro pannello o dal cloud), la scheda si chiude.

## Il navigatore di pagine: i pulsanti in più (19-11-2026)

Dal piano [navigatore, pulsanti in più](archive/2026-11-19-navigatore-pulsanti-in-piu.md), ramo `feat/nav-links`. Si prova
sul progetto della fiera (`DemoTY570_fiera`), dopo averlo aggiornato come dice il piano.

1. [ ] **L'ingresso**: nella cornice, «Idro» in seconda posizione apre «Idrico - Sinottico»; se le pagine Idro hanno la
       cornice, «Idro» resta acceso su tutte e sei.
2. [ ] **L'uscita**: nelle pagine Idro il navigatore verticale mostra le sei pagine e in fondo «← Sistema», che riporta a
       Sistema; la pagina corrente è accesa, «← Sistema» no.
3. [ ] **Web e LVGL uguali**: la stessa pagina sul TY570 e nel browser, pulsanti negli stessi posti.
4. [ ] **Il pannello proprietà**: «+ Pulsante», cambio della pagina, etichetta tradotta (`{{token}}`), posizione, «×».

## L'assistente: faceplate e sfondi (dal piano archiviato il 10-11-2026)

Dal piano [l'assistente disegna i simboli e compone il sinottico](archive/2026-11-03-assistente-genera-simboli-e-sinottici.md),
sezione «Code annotate il 10-11-2026». Nell'IDE (cloud o 8460), con una chiave vera.

1. [x] **Faceplate proposti** **Confermato dal maintainer il 10-11-2026** (rc.11). Nel cloud, Montagna, kimi-k3: pagina «Vallone — stazione di pompaggio» con `fp_pompa` e tre istanze.  (fatto il 06-11, `630a0f30`): in una chat, chiedere una pagina con tre macchine uguali. La
       proposta porta un faceplate e tre istanze, il diff li elenca, dopo «Salva» c'è `faceplates/<id>.yaml`.
2. [x] **Confermato dal maintainer l'11-11-2026** (rc.12, cloud, Montagna, pagina «Impianto di risalita»): istantanea della pagina nel cloud senza timeout, quattro sfondi generati, applicati e salvati, visibili prima e dopo il Salva, in `images/`, sfondo esattamente nell'area interna, nessun oggetto nelle fasce. Le anomalie nuove viste lì sono nella sezione «Collaudo 2.26.0-rc.12». **10-11-2026, in parte**: «Usa come base» reagisce, `genera_sfondo` e `varia_sfondo` vanno, foto e dissolvenza sul pannello dopo il deploy. Non passa: il banco perso alla riconnessione della chat, l'istantanea che nel cloud non c'è, lo sfondo invisibile nell'IDE prima e dopo il Salva, gli oggetti nelle fasce della cornice — corretti per la rc.12, da ricollaudare lì. **La conversazione intera con gli sfondi** (non passata il 05-11, corretta il 06-11): `genera_sfondo` → «Usa come
       base» → `varia_sfondo` → proposta → Applica → Salva → le foto in `images/`, in una chat sola. «Usa come base»
       reagisce al primo clic o dice che è in coda; nessuna istantanea in timeout.
3. [ ] **Il banco dei tubi** (F5): un giudizio da 1 a 5 sulle due pagine del 04-11 (`tmp/ai-misure/`, solo su
       theobroma). È l'ingresso del piano «secondo giro».
4. [ ] **Mistral sul banco dei tubi** (G4, 16-11-2026; finora provato solo con risposte finte). Con una chiave di
       console.mistral.ai in «Le mie chiavi IA» o nella scheda IA: «Prova la chiave» elenca i modelli; poi una
       conversazione vera sul banco, a mano nell'IDE o con `mistral.key` in una cartella:
       `SWS_AI_CHIAVI=<cartella> SWS_AI_FORNITORE=mistral ./scripts/banco_tubi.sh --vero`.
       Da guardare: arriva a una proposta validata, la domanda **dopo** la proposta non dà errore 400, un'istantanea
       torna e viene capita, costo e tetto si muovono. Annotare minuti, costo e voto da 1 a 5.
5. [ ] **Uno sfondo con FLUX.2 e la spesa del mese** (G5, serve una chiave di Black Forest Labs): in IA → Fornitori e
       chiavi si salva la chiave e «Prova la chiave» dice che funziona; in IA → Un modello per scopo gli Sfondi usano
       Black Forest Labs. In chat: una base, «Usa come base», una variante «sera». Le due foto arrivano e la variante
       ha la stessa scena. Poi IA → Spesa: nel mese in corso c'è la riga Sfondi · Black Forest Labs con due chiamate,
       e la riga dell'assistente. Se la variante fallisce, annotare il messaggio (vedi lo scostamento sul base64 nel
       piano «secondo giro», G5).

## L'assistente, secondo giro: la casa e l'SVG libero (16-11-2026)

Dal piano [l'assistente, secondo giro](archive/2026-11-10-assistente-secondo-giro.md), fasi G2 e G3. Nell'IDE (cloud o
8460) con una chiave vera, poi sul TC620.

1. [ ] **Una casa sulla sua pianta** (G2): in una chat, chiedere la pagina di una casa con luci e tapparelle.
       L'assistente disegna la pianta (`floor_plan`) e propone la pagina. Dopo Applica e Salva: la pianta è lo sfondo,
       luci e tapparelle stanno nella loro stanza, c'è `planimetrie/<id>.yaml`. La stessa pagina si vede uguale nel
       viewer web e su LVGL (muri, porte con l'arco, finestre).
2. [ ] **Un simbolo SVG libero agganciato a un tubo** (G3): chiedere una macchina che la libreria non ha e che una
       descrizione non sa fare (un ciclone, una tramoggia), collegata con un tubo a una pompa. La bozza compare in
       chat, la proposta porta un simbolo `custom:`. Dopo Applica e Salva il tubo finisce sulla bocca del simbolo, non
       al centro del riquadro: nell'editor, nel viewer web e su LVGL. Spostando il simbolo nell'editor il tubo lo segue.
3. [ ] **Le prove a pagamento di G2 e G3**, come quella di G1 (Opus 5.5 sul banco dei tubi: 1,26 $, 5,5 minuti, voto
       4 su 5). G2: `./scripts/bench_house.sh --real`. G3: sul banco dei tubi (`./scripts/banco_tubi.sh --vero`)
       chiedere anche una macchina che la libreria non ha. Annotare minuti, costo, voto da 1 a 5, e se il modello
       scrive entità o `\` negli attributi dell'SVG (oggi sono rifiutati).
4. [ ] **CasaDomotica** (regola del progetto di riferimento): una pagina disegnata sulla sua pianta, un simbolo SVG
       libero agganciato a un tubo e, quando c'è la chiave di Black Forest Labs, uno sfondo fatto con FLUX.2.

## Lo stile sobrio, sessioni 2 e 3 (16-11-2026)

Dal piano [stile sobrio](archive/2026-11-14-stile-sobrio.md), archiviato prima della rc.20. Nell'IDE (8460 o cloud),
Configurazione → IDE → stile.

1. [ ] **Le icone a linea** nello stile sobrio: albero di Configurazione, colonna di sinistra, menu, barra degli
       strumenti, pannello delle proprietà, schede. Guardare allineamento e misura delle icone nelle righe e nei
       bottoni; nei bottoni pieni l'icona ha il colore del testo. Nessun agente ha visto l'IDE vero in questo stile.
2. [ ] **Il colorato resta com'era**: le stesse schermate nello stile colorato, con le emoji di sempre.
3. [ ] **Le altre finestre seguono**: con la chat staccata aperta, cambiare stile nella finestra principale. La chat
       cambia colori **e** icone.
4. [ ] **Il testo d'accento sul fondo di selezione** nel sobrio scuro coi colori predefiniti (contrasto 4,2:1, sotto il
       4,5 del testo normale): si legge bene o va scurito il fondo?
5. [ ] **I quattro bottoni pieni** nel sobrio: «Unisci celle», «Abbina» spento, «Cambia password» e «Crea» il primo
       amministratore mentre la richiesta è in corso. Il testo si legge.

## Le chiavi IA dell'account, complete (16-11-2026)

Dal piano [chiavi IA dell'account complete](archive/2026-11-16-chiavi-ia-account-complete.md). Nel cloud, dopo
l'immagine della rc.20 e il gateway aggiornato, con chiavi vere.

1. [ ] **Cinque fornitori** in 👤 → Le mie chiavi IA: Anthropic, Kimi, Mistral, OpenAI e Black Forest Labs.
2. [ ] **«Prova la chiave»** elenca i modelli (per Black Forest Labs dice il saldo dei crediti).
3. [ ] **«Modello preferito»** è un menù a tendina: «Predefinito del fornitore» in cima, poi i modelli in ordine
       alfabetico. Un modello scelto lì lo usa l'assistente di un progetto che non ne sceglie uno suo.
4. [ ] **Negli Scopi del progetto** (IA → Un modello per scopo) il modello è lo stesso menù a tendina, riempito dalla
       chiave del progetto o da quella dell'account.
5. [ ] **Uno sfondo con la chiave OpenAI dell'account**, in un progetto che non ha una chiave sua.

## CRA, sessione 3: accesso al pannello di controllo, credenziali di fabbrica, OpenPLC (18-11-2026)

Dalla [sessione 3](archive/2026-11-18-cra-3-accesso-pannello-di-controllo.md), ramo `fix/cra-3-control-panel-access`,
annidato sulla 2. Tutte dopo il rilascio delle tre sessioni.

1. [ ] **Dal PC, su un pannello senza PIN del progetto** (per esempio il TY570): `curl -k -X POST
       https://<pannello>:7443/api/control-panel/session -H 'Content-Type: application/json' -d '{"pin":"<ultime 6
       cifre del MAC>"}'` risponde **401**; il viewer web aperto dal PC dice «Da qui serve il PIN del progetto».
2. [ ] **Dallo schermo dello stesso pannello**: il gesto nell'angolo apre il pannello di controllo col PIN del MAC,
       come prima; WP630 (kiosk), TC620 (LVGL), TY570 (LVGL).
3. [ ] **Cinque PIN sbagliati dal PC**: il PC aspetta 60 s, lo schermo del pannello no. Nel registro di audit ci sono
       `control_panel.pin_wrong` e `control_panel.locked`, con l'indirizzo del PC.
4. [ ] **Dallo schermo remoto del cloud**, su un pannello con PIN del progetto: il pannello di controllo si apre col
       PIN del progetto e non con quello del MAC; nella sezione Dispositivo c'è solo «Eliminare solo il progetto,
       restando nel cloud», e una riga dice perché. Nell'audit la sessione porta `cloud:<utente>`.
5. [ ] **Un pannello appena installato, aperto dal PC**: la pagina non mostra il codice di abbinamento, dice di
       leggerlo sullo schermo e ha un campo per scriverlo; scritto lì, l'abbinamento riesce. Sullo schermo del pannello
       il codice c'è come prima, e l'installer lo stampa.
6. [ ] **Un operatore col cambio password obbligatorio, sul viewer LVGL** (TC620 o TY570): dopo l'accesso il pannello
       chiede la password nuova e la ripetizione; «Cambia» la cambia e poi si entra; «Più tardi» lascia entrare per
       questa sessione. Prima di cambiarla o rimandarla, un tocco su un comando non scrive niente.
7. [ ] **Lo stesso sul viewer web** del WP630: senza cambio, un tag non si scrive (prima si scriveva).
8. [ ] **Linux generico da tarball** (una macchina di prova con systemd): l'installer crea l'utente `sws`, il servizio
       gira come `sws`, stampa il codice di abbinamento; dal pannello di controllo il cambio d'ora e il riavvio
       funzionano (regola polkit). Un aggiornamento da un'installazione di prima spegne `SWS_ADMIN_PASSWORD=admin` e
       il runtime riapre i suoi progetti.
9. [ ] **Un progetto con `admin`/`admin`** (per esempio da un dispositivo Yocto dell'ufficio): al primo accesso SWS
       chiede di cambiare la password.
10. [ ] **OpenPLC installato da zero sul WP630**: l'installer dice che l'utente dell'Editor è creato; il pannello di
       controllo ha la sezione OpenPLC con versione v4.3.1, porte, utente `admin` e la password; l'Editor dal PC si
       collega con quelle.
11. [ ] **OpenPLC già installato prima** (WP630 dell'ufficio, che ha un utente): la sezione dice che la password non è
       nota qui, e niente è cambiato in OpenPLC.
12. [ ] **Nel cloud**: un progetto con uno script in un ciclo infinito usa al massimo un core (`podman stats`), e il
       gateway e gli altri progetti rispondono. `podman inspect <container> --format '{{.HostConfig.CpuQuota}}'` dà
       `100000`.
13. [ ] **Un `admin`/`admin` rimasto** (punto 9): «Più tardi» non lo lascia passare, e lo dice; sul viewer LVGL resta
       la pagina del cambio col motivo.
14. [ ] **Dallo stesso cloud, col tunnel generico** (`/dev/<pannello>/api/control-panel/reset` dall'IDE nel cloud,
       oppure con `curl` e un token): il reset completo è rifiutato, quello che tiene il cloud no.
15. [ ] **Il viewer LVGL col cambio password aperto, e il runtime riavviato nel frattempo**: «Cambia» o «Più tardi»
       riportano all'accesso, con la riga «La sessione è finita».
17. [ ] **Un dispositivo Yocto dell'ufficio, nativo** (`scripts/yocto/deploy.sh`): il runtime gira come `user`
       (`ps -o user= -C sws-runtime`), apre i progetti che c'erano, e dal pannello di controllo cambio d'ora, rete e
       riavvio funzionano; il viewer LVGL, come `user`, disegna e risponde al tocco.
18. [ ] **Nel cloud, dopo il drop-in del VPS**: `cpu.max` del ramo dei progetti dà `150000 100000`, e con due progetti
       in un ciclo infinito il gateway risponde.
16. [ ] **Un'installazione `--bridge`** (se ce n'è una di prova): l'installer avvisa; dallo schermo il PIN del
       dispositivo funziona o no? Annotare cosa succede, è il caso che non si è potuto misurare.

## CRA, sessione 2: isolamento nel cloud e sandbox delle espressioni (18-11-2026)

Dalla [sessione 2](archive/2026-11-18-cra-2-isolamento-cloud-e-sandbox.md), ramo `fix/cra-2-cloud-isolation-sandbox`.

1. [x] **Prima del rilascio**: le espressioni dei tag e gli script dei progetti del cloud passano le regole nuove.
       Misurato sul VPS il 18-11: 37 espressioni e 13 script e funzioni in 16 progetti, nessun problema.
2. [ ] **TY570, pagina degli 8 LED**: i LED contano ancora, e la CPU di `sws-runtime` resta vicina al 6 % del 17-11.
3. [ ] **Nel cloud, dopo il rilascio**: un progetto si apre e lavora come prima (i container si rifanno col gateway
       nuovo); `https://sws.soligo.net/api/control-panel` non dà più il JSON del pannello di controllo (dà la pagina
       dell'IDE, come ogni rotta che non c'è) e `POST /api/control-panel/session` risponde 405. Così è già sull'IDE
       8460 di theobroma, provato il 18-11.
4. [ ] **Nel cloud, dopo il rilascio**: il segreto che un container ha nell'ambiente non apre il container di un altro
       progetto.
5. [ ] **Un progetto con un'espressione vietata** (per esempio un `import`): il tag diventa «Bad» con l'ultimo valore,
       e il registro dice cosa non è ammesso **una volta sola**, non a ogni cambio.
6. [ ] **Il rilascio con il segreto nuovo** (D10, deciso dal maintainer il 18-11), con la procedura del piano della
       sessione 2, «Il rilascio»: **prima** il backup del database del TC620 di casa, poi il gateway col segreto nuovo,
       poi `tc620-garage`, `ty570-1ad-p1-06e990` e `wp630-ufficio` riabbinati e di nuovo raggiungibili dal cloud.
       *18-11 sera*: backup fatto (1,3 GB), gateway sulla rc.21 col segreto nuovo. Il TC620 si riabbina togliendo il
       token; WP630 e TY570 con un factory reset e un'installazione pulita (decisione del maintainer del 18-11).
7. [ ] **Nel cloud, dopo il rilascio**: nella configurazione del gateway c'è il file `container_key` (*c'è dal 18-11,
       19:52*), e `podman ps
       --format '{{.Labels}}'` mostra l'etichetta `net.soligo.sws.key` sui container di progetto.
8. [ ] **Import di un progetto vero con molte immagini** (CasaDomotica): passa sotto i tetti degli zip (D11).
9. [ ] **Export di un progetto oltre gli 8 MB** (per esempio una copia di CasaDomotica con qualche immagine grande in
       più): il file si salva, e il menu dice che un import o un deploy lo rifiuterebbe; un deploy dello stesso progetto
       si ferma prima di partire, col motivo.
10. [ ] **Il modello «Avviso Telegram»** (Logica → Nuovo da modello): il messaggio dice da quanti minuti l'allarme è
       attivo, con un decimale (f-string, D8).

## CRA, sessione 1: testi veri e bozza della valutazione del rischio (17/18-11-2026)

Dalla [sessione 1](archive/2026-11-17-cra-1-testi-veri.md) delle sessioni CRA, ramo `docs/cra-1-true-statements`. Solo
documenti e commenti: qui si verifica che le frasi nuove siano vere sui dispositivi.

1. [ ] **WP630 o TC620 appena installato**: parte in HTTPS da sé, e `http://<pannello>:8080` non risponde.
2. [ ] **Un pannello installato dove manca `certutil`**: parte in chiaro.
3. [ ] **TY570 appena installato**: in chiaro, nessun avviso di versione nuova.
4. [ ] **Dopo «Eliminare progetto e abbinamento»**: in `config/` restano `tls.key`, `audit.jsonl` e, con un
       aggiornamento non confermato, `istantanea/` (lo dice il capitolo 17).
5. [ ] **Con OpenPLC installato**: la 1502 risponde da un altro PC della rete.
6. [ ] **Dal maintainer**: il nome dello CSIRT sull'elenco di ENISA; se il repository GitHub è pubblico; il recapito
       postale; la validazione delle decisioni D1-D5; ripubblicare il sito del manuale dopo il merge.

## L'IA a scelta del cliente (17-11-2026)

Dal piano [l'IA a scelta del cliente](archive/2026-11-17-ia-a-scelta-del-cliente.md), ramo `feat/ai-free-choice`.
**Il modello in casa si prova solo in ufficio**: la GPU è sul PC del maintainer, Ollama su
`http://192.168.0.225:11434/v1` (`qwen3.5:9b` con visione e strumenti, `qwen3:8b` senza visione e con contesto massimo
40k). theobroma lo raggiunge: basta l'IDE 8460.

**Voci 1-5 validate dal maintainer il 17-11-2026** («considera validato il giro IA locale»). Provate a mano la 1, la 2
e la 5: l'assistente ha creato i tag e la pagina degli 8 LED, che contano in binario. La 3 e la 4 le coprono i test
automatici (`tests_no_snapshot`, `local_http`), non sono state provate a mano. Dalla prova sono nate sei correzioni
(turno muto, panico del turno, errori che dicono dove, `schema_tag` col generatore, proposta vuota, annuncio senza
chiamata). Restano le voci del cloud, dopo il rilascio.

1. [x] **IDE 8460 → IA → Fornitori e chiavi → Modello in casa**: indirizzo, «Prova» elenca i due modelli, scelta di
       `qwen3.5:9b` con «vede le immagini», Salva.
2. [x] **Un turno vero dell'assistente** col modello in casa: la riga in alto mostra i token e non la spesa; la foto
       della pagina funziona (la casella è spuntata).
3. [x] **Senza la casella**: l'assistente non offre la foto della pagina.
4. [x] **Il contesto troppo piccolo**: con un modello caricato a 4k (per esempio Ollama senza
       `OLLAMA_CONTEXT_LENGTH`) la chat dice «contesto troppo piccolo» e la richiesta non parte.
5. [x] **Il listino**: sull'IDE 8460 compare `.run-editor/config/ai-prices.json` con origine models.dev, dopo il primo
       giro (5 minuti dall'avvio).
6. [ ] **Nel cloud, dopo il rilascio**: console → Prezzi IA (amministratore della piattaforma) mostra i prezzi e
       «Aggiorna ora»; una riga a mano arriva in un progetto aperto (la chat la usa al giro dopo).
7. [ ] **Nel cloud, la preferenza**: 👤 → Le mie chiavi IA, chiavi Anthropic e Mistral e preferenza Mistral per il
       testo. In un progetto senza scelta la chat usa Mistral e il menù IA lo dice; con una scelta nel progetto vince
       il progetto.
8. [ ] **Nel cloud, un indirizzo privato** (`http://192.168.x.x:11434/v1`) nel modello in casa è rifiutato con un
       messaggio in italiano.

## Dai piani archiviati il 16-11-2026

Le prove rimaste da dodici piani chiusi lo stesso giorno e spostati in `docs/archive/`. Ogni gruppo dice dove si fa.

**Il QR di abbinamento** (rc.17, [piano](archive/2026-11-13-qr-di-abbinamento.md)). Nel cloud, col telefono e un
pannello non abbinato (il TY570, o un pannello col progetto e l'abbinamento eliminati):
1. [ ] **QR dal telefono**: si inquadra il QR accanto al codice, si apre `sws.soligo.net/#pair=…`, login se serve, si
       conferma. Il pannello compare come `…/dev/<nome>`; poi «Connetti» da un progetto e deploy.
2. [ ] **«Abbina un pannello…» dal menu utente** (solo nel cloud): senza progetto aperto, col codice scritto a mano.
3. [ ] **Un utente con due aziende**: la finestra fa scegliere l'azienda. Con un'azienda sola la prende da sé.

**L'aggiornamento sui pannelli lenti** (quadlet 8, `2a461fdf`, rc.17, [piano](archive/2026-11-13-aggiornamento-timeout-avvio.md)).
Sul TC620, come utente `user`:
4. [ ] «Configurazione del servizio» → Aggiorna (quadlet 8). Poi `systemctl --user show sws-runtime -p TimeoutStartUSec`
       dice `10min`.
5. [ ] Togliere il drop-in messo a mano il 12-11: `rm ~/.config/systemd/user/sws-runtime.service.d/avvio-lento.conf`
       e `systemctl --user daemon-reload`. `TimeoutStartUSec` resta `10min`.

**CasaDomotica, punto 3** ([piano](archive/2026-11-10-casadomotica-col-maintainer.md)). Sul TC620, dopo il deploy:
6. [ ] Le pagine **«Luci»** e **«Clima»**: schede a interruttore, piastra in sola lettura con l'icona, termostato con il
       PV (il triangolino sulla traccia e «· PV» accanto al valore). Uguali al web.

**Il pannello di controllo sui TC/WP** ([piano](archive/2026-11-13-pannello-di-controllo.md), fase 4). Sul TC620 o sul WP630:
7. [ ] **Luce**: la slitta della sezione Schermo cambia la luce dal vivo (passa da `net.pixsys.Config1.Display.SetBrightness`).
       Annotare la scala di Pixsys: come si vedono il 5 % e il 100 %. La luce resta dopo un deploy; «come dice il
       progetto» la riporta indietro.
8. [ ] **«Calibra»**: avvia `touch-calibration.service` di Pixsys. Si guarda se prende lo schermo e se, alla fine, il
       viewer torna e il tocco è giusto.
9. [ ] **Touch resistivo** (TY750 o TY770, quando ce n'è uno): calibrazione a cinque croci nella sezione Schermo del
       pannello LVGL, prova «tocca qui», «Salva» e «Rifai». Senza un tocco per 30 s torna la calibrazione di prima.
       Senza la calibrazione di SWS il viewer usa `/usr/local/etc/pointercal` di Pixsys, e il log dice quale ha preso.

**Le verifiche di manutenzione** ([piano](archive/2026-11-10-manutenzione-e-verifiche-rimandate.md), §6-§8):
10. [ ] **Email e Telegram in `es`**: un progetto con un destinatario email e uno Telegram in `es`, un allarme di prova.
        Oggetto e intestazione arrivano in spagnolo.
11. [ ] **La chiave Google** della traduzione automatica: fornitore Google con la chiave, si ricarica la pagina dell'IDE,
        la chiave c'è ancora.
12. [ ] **La CI di GitHub**: pagina Actions del repository, le esecuzioni recenti. Se «Rust lint» è rosso, leggere il log
        e confrontare clippy del job (toolchain 1.94) con quello locale. Se è verde, dirlo in `STATUS.md`.
13. [ ] **Twilio dal vero**, appena l'account è a pagamento (quello di prova manda solo i messaggi predefiniti e
        risponde 572006). Serve un pannello collegato al cloud. Nell'ordine: «Invia SMS di prova» con Account SID e
        token; lo stesso con una chiave API «Standard», riscrivendo una volta il segreto; due reperibili di turno con
        2 minuti di attesa e Voce sullo scatto (squilla il primo, poi il secondo; il tasto 1 riconosce l'allarme, il
        registro dice «telefono: …» e la catena si ferma); il webhook SMS `https://<gateway>/telefono/<pannello>/sms`
        (la risposta «OK» riconosce l'allarme); senza reperibili di turno nessuno viene chiamato, e il log lo dice.

## Collaudo 2.26.0-rc.19 (15-11-2026) — il Tiny TY, la rotazione, le chiavi IA

Il lavoro del 15-11. Le voci confermate dal maintainer il giorno stesso sono in `STATUS.md`; qui quello che resta.

**Sul TY570** (pacchetto dell'rc.19, dal sito: `curl` dalla guida «Installa su dispositivo»):
1. [ ] **Diagnostica su chiavetta**: con una chiavetta FAT32/exFAT appena inserita il pannello aspetta il montaggio e scrive il file; con
       una NTFS dice «usa FAT32 o exFAT»; senza chiavetta dice che non c'è.
2. [ ] **Tastiera**: «?123» e «abc» non rimbalzano (server NTP a mano, Wi-Fi).
3. [ ] **Angoli**: un secondo di attesa prima che compaia l'anello e che inizi il conto.
4. [ ] **Progetto verticale**: Impostazioni progetto → Orientamento → Verticale, deploy, pannello girato di 90° in senso orario:
       pagine dritte, tocco giusto, angoli giusti, pannello di controllo con le schede in alto, immagine di avvio.
5. [ ] **Voce divisa**: gesto spento + pulsante acceso (e viceversa) in Impostazioni progetto; e «Il dispositivo può avere un angolo che lo riavvia».
6. [ ] **Elimina progetto e abbinamento**: PIN sbagliato rifiutato, PIN giusto: il runtime riparte senza progetto e col codice di abbinamento.
7. [ ] **UPS** a corrente staccata, **chiavetta Wi-Fi dopo il riavvio**; un collegamento Wi-Fi senza IPv4 mostra l'IPv6 e la riga che lo dice.
**Sul TC620**:
8. [ ] **Rotazione**: progetto verticale → un riavvio e poi dritto; stesso progetto di nuovo → nessun riavvio; di nuovo orizzontale → un riavvio.
**Nel cloud (VPS)**:
9. [ ] **Chiavi IA**: un utente senza chiave di progetto aggiunge la sua in 👤 → Le mie chiavi IA e la chat dell'assistente parte; la toglie e dice «nessuna chiave»; un progetto con chiave sua usa quella
       (la riga «Questo progetto usa…» in Fornitori e chiavi); un secondo utente senza chiave non ne ha.
10. [ ] **Pagina di installazione**: «Installa su dispositivo» → «Tiny TY (pacchetto)» dà i passi, e `curl` + `sha256sum -c` dal sito funzionano.
11. [ ] **«Container»** non compare nel cloud, e il titolo di una scheda porta il nome del menù («Device ›», non «Instance ›»).

## Collaudo 2.26.0-rc.15 (12-11-2026) — la rc.14 è solo un tag, il suo contenuto è qui dentro

Costruita senza collaudo, su richiesta del maintainer («le rc possono permettere questa eccezione»): il collaudo
si fa su questa immagine, e le anomalie diventano la rc successiva. **Sul TC620** dalla rc.13, oppure con un
progetto LVGL. Le foto di confronto della sera sono in `tmp/parita-lvgl/` (solo `ufficio`).

1. [ ] **«Aggiorna ora» e progetto chiuso**: avviare l'aggiornamento dall'IDE nel cloud, chiudere subito il progetto,
       riaprirlo. Il pannello si aggiorna lo stesso, e la scheda dice «in corso» fino all'esito. Nella rc.13
       l'aggiornamento si perdeva. La prova vale dalla rc.14 alla versione dopo, perché la protezione gira sul
       pannello che si aggiorna.
2. [ ] **Testi liberi su LVGL**: un `text` senza riquadro poggia sulla sua `y` come sul web. Su un progetto LVGL
       esistente i testi liberi salgono di circa un corpo, e l'avviso compare fra le Novità prima di aggiornare.
3. [ ] **Disegno LVGL**: celle colorate senza bordo bianco, valore della kpi chiaro, led spento grigio e non nero,
       gauge con l'arco grigio, campanella con icona e scritta centrate, freccia del selettore lingua, pannello
       ricette leggibile con «Applica» intero (`demo-items-lvgl`, `grid-playground`).
4. [ ] **Bottone con funzione su LVGL**: un bottone con `on_press_fn` la esegue (registro del runtime); una
       funzione che fallisce apre «Comando non eseguito». Questo avviso non si poteva fotografare.
5. [ ] **Finestra con parametri**: la «Finestra pompa» dei gemelli, aperta dal bottone, dice «Pompa P-101» e
       «Dettaglio di P-101», sul web e su LVGL.
6. [ ] **Mini tendenza ferma**: una kpi con valore fermo ha la linea a metà, sui due motori.
7. [ ] **`zip` 9**: un backup del progetto esportato e reimportato, un report xlsx aperto, un deploy dal cloud di
       un progetto con logica PLC, una pagina di boot caricata.
8. [ ] **Nebulizzatore Sandokan**, se lo si usa: «Accendi» e «Spegni» comandano la presa.
9. [ ] **Comando critico su LVGL**: su un pannello con utenti, un bottone `critical` chiede la password (sbagliata:
       «Comando non eseguito: password errata»); con `require_reason` anche il motivo, che compare nell'audit; un
       momentaneo critico scrive l'impulso. Senza `require_confirm` niente domanda sì/no prima.
10. [ ] **Disegno LVGL, secondo giro**: griglia con un bordo per cella, `radio` a cerchi, selettore lingua scuro, il
       logo SVG con le scritte, `faceplate_scale`, velo «Dati in ritardo» dentro una finestra aperta.
11. [ ] **Allarmi nella lingua dei contenuti**: «Allarmi» e «Nessun allarme attivo» cambiano col selettore della lingua.
12. [ ] **«Disabilita TLS»**: il pannello riparte davvero in chiaro e ci resta; «Genera certificato» lo riporta in HTTPS
       con la fiducia del browser.
13. [ ] **CasaDomotica (deploy dopo aver aggiornato il runtime)**: la pagina «Tapparelle e finestre» col riepilogo e le
       due finestre per piano, «Apri/Chiudi tutto» (salta le portafinestre aperte), il report settimanale, le regole IA.

## Collaudo 2.26.0-rc.12 (11-11-2026)

Sul WP630 dalla rc.11, dal cloud e via ssh, progetto Montagna. Le voci passate sono spuntate nelle loro sezioni
(«Aggiorna ora» 1 e 3, viewer leggero 2, 3 e 5 web, assistente 2). Le anomalie, da correggere insieme nella rc.13:

1. [ ] **L'assistente non conosce le finestre.** Chiesta una «pagina popup» coi dettagli della cabinovia, ha fatto una
       pagina normale con un `navbutton`, che compare nei pulsanti di navigazione della cornice. Il prodotto ha
       `finestra: {modale, titolo}` sulla pagina e il bottone `open_popup`, ma né `ai/prompt.rs` né `ai/tools.rs` li
       nominano, e `schema_oggetto` non li fa scoprire (il campo è della pagina).
2. [ ] **Viewer web: il pallino di qualità di un testo senza riquadro copre il testo** quando è allineato a destra o al
       centro. `QDot` sta sempre a `x - 10` (`SvgCanvas.tsx`, ramo del testo a una riga), e con `text_anchor: end` `x`
       è la fine del testo. Visto sui valori dei faceplate meteo e cabinovia.
3. [ ] **L'assistente tratta il testo senza riquadro come un riquadro.** Scrive `x: 150, width: 134, text_anchor: end`
       (voleva il bordo destro a 284) e prende `y` per il bordo alto: senza `text_wrap` il web ignora `width` e `y` è la
       linea di base, quindi i valori finiscono a metà del faceplate e il titolo sopra la temperatura. Il prompt non
       spiega la geometria del testo (stesso tema del piano «parità LVGL», visto dal lato dell'assistente).
4. [ ] **La chat staccata resta su «No project open in the editor» dopo uscita, rientro e riapertura del progetto**,
       col compositore disabilitato, finché non si ricarica la sua finestra. L'editor manda `stato` solo in risposta al
       `ciao` della chat (`App.tsx`), non quando il progetto cambia. C'era già prima; si vede dalla rc.12 perché la chat
       ora sopravvive all'uscita. La conversazione vuota dopo l'uscita invece è voluta (regola di `aiStream.ts`).

## «Aggiorna ora» non parte due volte (10-11-2026)

Fatto a casa il 10-11 (`fix/aggiornamento-in-corso`, squash `80114595`), nella **2.26.0-rc.11**. Si vede per intero solo
da un pannello **già sulla rc.11** che sale alla versione dopo: fra il clic e `in_corso` c'è l'istantanea dei dati
(minuti con lo storico di CasaDomotica), e prima la card tornava «disponibile» con il pulsante attivo.

1. [x] **Confermato dal maintainer l'11-11-2026** sul WP630, rc.11 → rc.12 dal cloud, con Montagna (istantanea 2,8 MB): un solo avvio nel journal, un minuto di fermo, la card «in corso» anche cambiando scheda. Da un pannello sulla rc.11, «Aggiorna ora» verso la rc successiva, con CasaDomotica (storico grande). Durante la
       copia dei dati: cambia pagina e torna, ricarica il viewer, apri l'IDE nel cloud. Ovunque la card dice che
       l'aggiornamento è **in corso** e il pulsante resta spento; nessun secondo aggiornamento parte. Nell'IDE resta
       solo la riga dell'attesa, riletta ogni 15 s, finché il pannello non riparte.
2. [ ] 11-11-2026: non provata — nessun secondo `POST` è arrivato al pannello, quindi il 409 non si è visto; resta per il prossimo salto. Un secondo `POST` dell'aggiornamento mentre il primo è prenotato risponde **409** (si vede nel journal del pannello
       o con `curl`); dopo il riavvio lo stato torna normale e la conferma «Dopo l'aggiornamento» compare come sempre.

**Visto il 10-11-2026 sul WP630, dalla rc.10 alla rc.11 (dall'IDE nel cloud):** istantanea 1,1 MB alle 11:13:57, runtime
nuovo alle 11:14:56, «Aggiornamento completato» alle 11:16:56. Cambiando scheda e tornando, l'IDE diceva «aggiornamento in
corso» (bene); **durante il riavvio** diceva in rosso «Il dispositivo ha risposto 503 Service Unavailable: il pannello
«wp630-ufficio» non è collegato» e «Configurazione del servizio: non applicabile» — formalmente vero, ma allarma il
cliente (parole del maintainer). Corretto sul ramo `fix/collaudo-rc11`: per dieci minuti dal clic l'IDE dice «si sta
riavviando» in giallo e rilegge ogni 15 s; da collaudare al salto rc.11 → rc.12 (voce 3).

3. [x] **Confermato dal maintainer l'11-11-2026** (WP630, rc.11 → rc.12): scritta gialla «si sta riavviando», «Pannello non raggiungibile», niente righe rosse, esito al ritorno. Dal cloud, aggiornando un pannello sulla rc.11 alla rc.12: durante il riavvio, riaprendo Connessione, la sezione
       «Aggiornamento del runtime» dice in giallo «Il pannello si sta riavviando per l'aggiornamento…» e «Configurazione
       del servizio» dice «Pannello non raggiungibile»; niente righe rosse. Al ritorno del pannello compare l'esito.

## Il viewer leggero (09-11-2026)

Rami A e B del piano `docs/archive/2026-11-09-viewer-leggero.md` (§10): `fix/mini-tendenze-leggere` e, annidato sopra,
`fix/ridisegno-mirato`, con le correzioni delle revisioni del 09-11. Vanno nella 2.26.0-rc.10 insieme all'occhio sulle
password: le voci del pannello vogliono quell'immagine. Il WP630 si aggiorna dal viewer e tiene Montagna a 10 Hz come
prova di carico (il template ora è a 1 Hz).

**Montagna sul WP630, viewer web** (progetto ancora a 10 Hz)
1. [ ] 11-11-2026 (rc.12): i 30 minuti fatti, CPU piatta (voce 2); il login con «Marcia» e il confronto dei valori con l'IDE non riportati. 30 minuti sulla pagina iniziale di Montagna. Il login si apre subito. I valori sono freschi: si confrontano con
       l'IDE. Le mini tendenze scorrono anche a valore fermo.
2. [x] **Confermato l'11-11-2026** (rc.12, WP630, Montagna a 10 Hz, 11:16–11:46, un campione al minuto): renderer 4-5 %, processo GPU 1 %, runtime 12-13 % di un core, piatti dal primo all'ultimo minuto (il 10-11 renderer ~93 % e GPU ~100 %). Misure in `tmp/test-changes/2026-11-11/` su theobroma. CPU del renderer con `top` (prima si chiede l'accesso SSH). Resta piatta fra il minuto 5 e il minuto 30. La base
       era il 96%.
3. [x] **Confermato l'11-11-2026** (rc.12): zero «lagged» nei 35 minuti. Journal del runtime: non c'è «ws/tags subscriber lagged». Se c'è, si apre il passo facoltativo del §8 del piano.
4. [x] IDE 8460, Montagna in modifica: le kpi mostrano **Confermato dal maintainer il 10-11-2026** (rc.11).  mini tendenza e variazione.

**I segnali decisi il 09-11**
5. [ ] 11-11-2026 (rc.12, WP630): **passa sul viewer web**, confermato dal maintainer — fascia gialla col contatore e oggetti grigi a runtime fermo, spariti al ritorno; ricaricando a runtime fermo (renderer chiuso, «Reload» sulla pagina di Chromium) «The panel is restarting…» e la pagina torna da sola. Resta il viewer LVGL (il WP630 non lo ha): sul TC620. Dati in ritardo, **socket giù**: si ferma il runtime per 10 s (sul pannello serve SSH: chiederlo prima). Il socket
       si chiude. Dopo 5 s compaiono la fascia «Dati in ritardo di N s» e gli oggetti grigi, e il numero sale di 1 al
       secondo. Al riavvio del runtime spariscono. Sul viewer web e sul viewer LVGL. *Non* staccando la rete: il socket
       resta aperto per minuti, nessuno dei due motori ha un battito, e un socket vivo e muto vale come impianto fermo
       (il battito è nel seme `docs/plans/semi/2026-11-10-viewer-prestazioni-e-protocollo.md`).
       10-11-2026: non passa — durante lo stop il viewer ha mostrato "No active project"; corretto in
       `fix/viewer-runtime-fermo`, da ricollaudare sulla rc.12. Da guardare anche: al ritorno la fascia sparisce entro
       ~3 s dal riavvio (prima restava fino al giro del socket, fino a 16 s dopo); ricaricando la pagina (F5 o
       `systemctl --user stop sws-runtime` e poi aprire `https://127.0.0.1:7443`) col runtime fermo compare «Il
       pannello si sta riavviando, riprovo…» e la pagina arriva da sola. Sul LVGL: riavviando il viewer col runtime
       fermo compare la stessa frase, e il viewer riparte da sé quando il runtime risponde.
6. [ ] Dati in ritardo, **aspetto** sul LVGL: `--ritardo-di-prova 8`. La fascia sta in alto, sopra la card
       dell'aggiornamento e sotto la schermata d'accesso; gli oggetti sono grigi.
7. [ ] Dati in ritardo, **età vera**, sul banco (`tmp/viewer-leggero/banco`, solo su theobroma): con una SPA ricostruita
       dopo la revisione e la copia a 10 Hz a ×6, la fascia non compare mai (le tre corse del 09-11 col ramo A: mai
       comparsa). Il §10 chiede anche che compaia con la SPA di base: non si può fare così, perché `www-base` (rc.9) la
       fascia non ce l'ha.
8. [ ] Login lento, viewer web: dopo 10 s il pulsante dice «Il pannello risponde lentamente…»; a 60 s compare «Nessuna
       risposta, riprova» e il pulsante torna attivo. Si vede solo con un pannello lento. Sull'IDE lo stesso testo dice
       «Il server risponde lentamente…». Sul LVGL le stesse attese sono la voce 14.
9. [ ] «Aggiorna ora» dal viewer, web e LVGL, aggiornando il WP630 alla rc.11: dal tocco fino alla partenza si legge
       «Aggiornamento in avvio…», anche quando in mezzo chiede l'accesso. Con un aggiornamento già in corso il pulsante
       è spento. Sul LVGL, dopo l'accesso chiesto per aggiornare, la card non torna con «Aggiorna ora» attivo.
10. [ ] LVGL: Montagna sul viewer LVGL per 30 minuti. CPU del viewer **e del runtime** piatte (fino alla revisione la
        mini tendenza LVGL chiedeva l'ora intera ogni 2 s, e il costo cadeva sul runtime). Le mini tendenze scorrono a
        valore fermo e tengono i picchi; linea ed etichetta stanno nel riquadro (i margini ora sono di 2 px come sul
        web, e su uno schermo non li ha ancora guardati nessuno).

**Ramo B, il ridisegno mirato e il filtro di pagina** (viewer web sul WP630; dove serve un faceplate o un tubo si usa
`demo-items-web`, perché CasaDomotica non ne ha)
11. [ ] Popup di un faceplate (bottone `open_faceplate`) e pagina-finestra con lo sfondo da variabile: i valori dentro
        al popup e alla finestra si muovono, e lo sfondo segue il suo tag. Anche dopo un cambio di pagina e ritorno, e
        dopo una riconnessione del socket (runtime riavviato: SSH da chiedere prima).
12. [ ] Il tubo segue la pompa (`demo-items-web`, il tubo agganciato all'oggetto che si muove). Toggle con conferma,
        incremento e checkbox partono dal valore attuale e scrivono quello giusto. Il badge ⌛ dello stale compare quando
        il tag sta fermo oltre `stale_after_s`, e non compare finché il tag si rinfresca.
13. [ ] IDE 8460 su CasaDomotica: il trascinamento è fluido, il pannello proprietà non è in ritardo, nessun valore resta
        fermo (in modifica i valori sono vivi). Su `demo-items-web`, trascinando un oggetto, griglie e faceplate non
        scattano.
14. [ ] LVGL, login lento: dopo «Accedi», entro 10 s la card dice che il pannello è lento; a 60 s compare «Nessuna
        risposta, riprova» e «Accedi» torna premibile. «Annulla» a metà attesa: una risposta arrivata dopo non fa
        entrare, e un toggle premuto subito dopo scrive subito, senza aspettare il login abbandonato. Si vede solo con un
        pannello lento, oppure congelando il runtime per qualche secondo (`kill -STOP`, poi `kill -CONT`; SSH da
        chiedere prima): un runtime fermo del tutto rifiuta la connessione, e quello non è il caso lento.

## L'occhio sulle password (09-11-2026)

> **Piano approvato dal maintainer il 10-11-2026**, dopo la prova sul WP630. Le voci qui sotto restano come controlli da fare
> quando capita (IDE, console, LVGL); non tengono aperto niente.

Piano `docs/archive/2026-11-09-occhio-sulle-password.md`, ramo `feat/occhio-password` annidato su `fix/ridisegno-mirato`,
con le correzioni delle due revisioni del 09-11. Va nella 2.26.0-rc.10 insieme al viewer leggero: le voci del pannello
vogliono quell'immagine. Regola unica su tutti gli ambienti: la password parte nascosta, l'occhio la mostra, un secondo
tocco la nasconde, chiusa la finestra riparte nascosta. L'icona è la stessa su web e LVGL: aperta quando la password è
nascosta («toccami per vederla»), barrata quando si legge.

**IDE 8460**
1. [x] Login: l'occhio a destra dentro il campo **Confermato dal maintainer il 10-11-2026** (rc.11). , parte nascosta, un clic mostra e uno nasconde, il fuoco resta nel campo
       e Invio entra ancora. Un login sbagliato lascia la password nascosta anche se era in chiaro.
2. [ ] Cambio password (tre campi) e Registrazione: occhi indipendenti, mostrarne uno non mostra gli altri; il testo si
       ferma prima dell'occhio.
3. [ ] Configurazione → Utenti: la password iniziale del nuovo utente in chiaro, poi «Crea»: il campo si svuota e torna
       nascosto, e la password del prossimo utente parte nascosta. La password per riga nel reset ha l'occhio anche sui
       campi bassi (sporge sopra e sotto, senza fondo).
4. [x] Configurazione → Istanza → Device → Connessione, e Dispositivi: l'occhio **Confermato dal maintainer il 10-11-2026** (rc.11).  c'è anche sui campi a larghezza fissa
       (150-160 px) e il campo non esce più largo dei vicini. Notifiche → Twilio: «Auth token» salvato e mascherato dal
       server ha l'occhio spento; scrivendo un token nuovo si accende.

**Viewer web sul pannello (TC620/WP630, touch e tastiera a schermo)**
5. [x] **Confermato dal maintainer il 10-11-2026 sul WP630 (rc.11)**, col login chiesto dal pulsante «Marcia» di Montagna: l'occhio mostra la password. Login per l'aggiornamento: l'occhio è da dito (40×40), il tocco mostra la password senza chiudere la tastiera a
       schermo, Invio dalla tastiera entra. Dopo l'invio la password torna nascosta.
6. [ ] Password di un comando critico su CasaDomotica (`chiedi({ password: true })`): la stessa cosa nella Finestra di
       avviso; la volta dopo riparte nascosta.

**LVGL sul pannello**
7. [ ] Login LVGL: l'occhio a destra nel campo password, stessa icona e stesso grigio del web, un fondo scuro mentre il
       dito preme; il tocco mostra il testo in chiaro, un secondo lo nasconde; «Annulla» e un login riuscito la rimettono
       nascosta, alla prossima apertura parte nascosta. Aprire e chiudere il login dieci volte non fa crescere la
       memoria del viewer (dalla revisione i raster dell'occhio sono condivisi).
8. [x] Tastiera LVGL in modalità password: oggi nessuna schermata la apre con `password = true`, quindi l'occhio della
       tastiera dal pannello non si vede. **Deciso dal maintainer il 10-11-2026: si tiene, pronto** per il primo campo password
       LVGL (es. i comandi critici, piano della parità). Niente da collaudare.

## La serie L0 → F2 → F3 (05-11-2026) — la sandbox Python e la Finestra di avviso dappertutto

In `main` dal 06-11-2026 (2.26.0-rc.2). *(08-11: il piano della Finestra di avviso è archiviato; restano qui L0.1 e L0.3
sul pannello, F2.4–5 sul WP630 e il residuo della 15.)*
L0 cambia il runtime e F3 il viewer: le voci del pannello vogliono l'immagine nuova. Le voci IDE si provano sull'IDE
locale (8460) o sul VPS dopo il rilascio.

**L0 — la sandbox Python** (su un pannello, in un progetto di prova: `grid-playground` non ha più funzioni)
1. [ ] Uno script globale con `print('ciao')` e un `for i in range(3): tot += i`: gira senza `NameError`, e nel
       registro del runtime compare la riga `print` col nome dello script e il testo. **Passata sull'IDE 8460 il
       06-11-2026**; resta da provare sul pannello.
2. [x] Una funzione con un parametro col predefinito (`chi`, predefinito `operatore`) chiamata da un bottone senza
       argomenti: usa il predefinito. «Prova» della funzione mostra il testo dei `print`. **Passata il 07-11-2026 sul
       TC620** (rc.2, CasaDomotica): «ciao operatore» e «ciao Mauro», righe `print` nel registro del pannello. Il log
       non arrivava all'IDE del cloud: difetto del canale, corretto nella rc.3 (banco `r3-log`).
3. [ ] `min`, `max`, `sum`, `sorted`, `enumerate` in uno script: girano sul pannello. **Passata sull'IDE 8460 il
       06-11-2026** (`ciao 3 1 3 3 [1, 2] [(0, 'a'), (1, 'b')]` nel registro); resta da provare sul pannello.

**F2 — deploy ed editor** (IDE; il deploy vuole un pannello raggiungibile)
4. [ ] Deploy verso un pannello con un altro progetto: la conferma «cancella dal pannello…» è una finestra rossa con
       Annulla predefinito; Annulla non tocca niente, Conferma procede. Lo stesso da Connessione e da Dispositivi.
5. [ ] «Utenti e segreti» in testata: la conferma, e poi (progetto senza utenti) «Questo progetto non ha utenti».
6. [x] Eliminare una pagina, una cornice, un faceplate usato, una planimetria; separare un gruppo; «Ruolo minimo» sotto
       la soglia della variabile (la tendina torna com'era se si annulla). Confermato il 06-11-2026 sull'8460.
7. [x] Un testo tradotto usato in due punti, cambiato in uno: «Cambia solo qui» / «Cambia dappertutto»; **Esc o
       Annulla lascia il testo com'era** (prima cambiava dappertutto). Esc nel campo butta quello che si è scritto.
       **Non passata il 06-11-2026**: confermando il campo con Invio la domanda si apriva e si richiudeva da sola
       (il `keypress` dello stesso Invio premeva Annulla, il predefinito di `scegli`). Corretto in
       `FinestraAvviso.tsx` (il fuoco va al predefinito solo quando Invio si alza) e provato col browser
       sull'IDE di prova, anche dentro un faceplate. **Riprovata e passata il 06-11-2026 sera.**
8. [x] Storico: «Carica database» chiede prima e poi apre il selettore di file — **in Chrome e in Firefox**.
       Confermato il 06-11-2026 sull'8460.

**F3 — viewer, console, finestre** (viewer sul pannello, kiosk WebKit: WP630 o TC620)
9. [x] Un bottone con `require_confirm`: la finestra con Annulla/Conferma nella lingua dei contenuti; Annulla non scrive.
10. [x] Un comando `critical`: la password in una finestra (campo nascosto), sbagliata dà errore e non scrive; con
       `require_reason` il motivo vuoto tiene aperta la finestra. **07-11 (rc.2): «403 forbidden»** — premuto prima
       di fare l'accesso, e il viewer mandava la scrittura senza credenziali. Nella rc.3 dice di accedere (`r3-critico`). **Passata l'08-11-2026 sul TC620** (rc.4/rc.5).
11. [x] Un bottone momentaneo con `require_confirm`: non chiede più niente e si tiene premuto. **07-11 (rc.2) non
       passa sul touch del TC620**: la pressione lunga non mandava niente (solo eventi del mouse). Rc.3: eventi pointer
       (`r3-momentaneo`). **Passata l'08-11-2026 sul TC620** (`r4-momentaneo`).
12. [x] Un toggle con conferma: scrive l'inverso del valore **al momento della conferma**.
13. [x] Allarmi: «Conferma» con motivo obbligatorio, «Conferma tutti», «Metti a tacere». **07-11 (rc.2)**: la conferma
       col motivo passa; «Conferma tutti» e «Metti a tacere» non c'erano nella modalità elenco. Rc.3 (`r3-allarmi`). **Passata l'08-11-2026 sul TC620**.
14. [x] Uno slider con `require_confirm`: una domanda sola al rilascio, e il cursore resta dove l'ha lasciato.
15. [ ] IDE. **Già passati il 05-11-2026 sull'8460**: chiudere il progetto con modifiche non salvate (Salva e chiudi /
       Chiudi senza salvare / Annulla) e la console (abbandonare le modifiche in Aziende e Persone); **il 06-11**
       «Crea variabile», «Rinomina tag» (da Progetto → Variabili, «Tags» con l'IDE in inglese) e «Cambia risoluzione».
       Restano: il pull dal dispositivo nella finestra nuova, sessione scaduta, chiusura dell'account: stessa cornice,
       Esc, Tab che resta dentro.
16. [x] L'avviso di aggiornamento sul pannello (versione nuova, conferma dopo l'aggiornamento) con il login per Admin
       che gli si apre sopra: si scrive nel login. **Passata il 07-11-2026 sul TC620** (2.25.1 → rc.2 dal viewer). Dall'IDE
       del cloud falliva dopo 60 s (l'istantanea dei dati): corretto nella rc.3 (`r3-agg`). **Dall'IDE del cloud passata l'08-11-2026** (rc.4 → rc.5, `r5-agg`).

## La 2.25.1 (05-11-2026) — anomalie del collaudo 2.25.0, regole dei template, lucchetto

Sul WP630 (`pixsys@wp630-a-p3-07a077.local`, canale `rc-arm64`) e su `sws.soligo.net`. Le correzioni trovate
collaudando stanno sul ramo `fix/collaudo-2-25-1` e vanno nella **2.25.2**; le voci 4–8 sono state provate il 05-11
con la SPA del ramo copiata nel container del pannello (prova sola, sparisce col container), quindi vanno ricontrollate
sull'immagine 2.25.2.

1. [ ] **Chat e registro in una finestra, nel cloud** (C0): sulla 2.25.1 danno **HTTP 401** — il gateway serviva in
       chiaro solo la radice del progetto. Corretto sul ramo (`guscio_di`, prova `prove_finestre_staccate`): da
       ricontrollare sulla 2.25.2 sul VPS.
2. [x] **Le scelte di pagina mostrano il nome** e non `{{t0001}}` (C0) — confermato dal maintainer il 05-11-2026.
3. [x] **«Montagna» sul WP630 non rallenta** (C0) — «va molto meglio», 05-11-2026; misurato: a riposo Chromium sotto
       lo 0,5% di un core (prima ~1,2 core).
4. [x] **Lo slider del lago non cambia pagina** trascinandolo — confermato il 05-11 (SPA del ramo).
5. [x] **Niente riquadro semitrasparente al tocco** — confermato il 05-11 (SPA del ramo).
6. [x] **La foto non lampeggia** passando da giorno a notte — confermato il 05-11 (SPA del ramo).
7. [x] **Il pallino segue il dito** fino in fondo — confermato il 05-11 (SPA del ramo): prima si muoveva di pochi pixel
       e perdeva il dito.
8. [x] **La dissolvenza segue lo slider senza scatti** — «ora funziona benissimo tutto», 05-11 (SPA del ramo).
9. [ ] **Aggiornamento dall'IDE**: prima di confermare compaiono le novità della versione, e il pannello si ricollega.
10. [ ] **Il lucchetto** (T1): `homeassistant-pro` senza accesso, pagina Sicurezza — «🔒 Operator» sul cancelletto,
        «🔒 Supervisor» sulla tapparella del garage, sul web e sul pannello; da Operator il primo sparisce.
11. [x] **Niente allarmi falsi all'avvio** (T1) (il 05-11-2026 il maintainer accetta il test unitario al posto della prova a mano): `homeassistant-pro` non dà «Soggiorno troppo freddo: 0.0 °C».
12. [x] **I template con la cornice** (T1 e T2): titolo, ora e navigazione su ogni pagina, comandi senza accedere, il
        titolo tradotto cambiando lingua; `tc620-sistema` con data e ora. Confermato il 06-11-2026.
13. [x] (05-11-2026, IDE 8460) **Faceplate**: in `tc620-sistema` il faceplate di un'interfaccia propone `tc620.ethernet0`; `motor_basic` e
        `tank_level` mostrano «1450 rpm» e «62.5 %».
14. [ ] **L'assistente e i nomi tradotti** (T2): trova una pagina dal nome tradotto, e il riepilogo non mostra `{{t0069}}`.

## Prestazioni: dove se ne va il tempo (26-10-2026) — chiusa

Le cinque voci passate: 2 e 4 il 27-10, 1, 3 e 5 l'08-11-2026 sul TC620 di casa con CasaDomotica dall'IDE nel cloud
(2.26.0-rc.6): colonna del pannello col runtime e le sorgenti, e la misura che si spegne circa un minuto dopo essere
passati all'editor (`curl …/api/prestazioni/richiesta` → `{"attiva":false}`). Il testo delle voci è nella storia git.

## A. La misura che blocca C4 — chiusa

Le quattro voci spuntate il 24-10-2026; il piano C4 è archiviato come fatto il 25-10
(`docs/archive/2026-10-23-c4-tls-di-default.md`). Sezione tolta il 05-11-2026: il testo è nella storia git.

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
4. [ ] **Il guardiano segue il cambio**: con il TLS acceso «Genera» non c'è (compare solo a TLS spento), quindi la
       prova si fa con **«Disabilita TLS»**, che di fatto rigenera il certificato (punto 5). Atteso: il pannello resta
       in HTTPS con un'impronta nuova, l'IDE chiede di dimenticare quella vecchia in Connessione,
       `fiducia-browser.sh <config> --verifica` elenca ancora «SWS pannello» e lo schermo resta senza avvisi. Se
       compare l'avviso e `--verifica` non elenca il certificato, il `PathChanged` di `sws-fiducia.path` si è perso fra
       cancellazione e ricreazione (meno di un secondo). *(Corretto il 05-11-2026.)*
5. [ ] **Rimuovi** il certificato: oggi il pannello **non** torna in chiaro — col marcatore `fiducia-browser` il
       runtime ne genera subito uno nuovo. Difetto noto (05-11-2026, nel piano `docs/archive/2026-11-10-manutenzione-e-verifiche-rimandate.md`): si riprova quando è corretto.
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

1. [x] Dal cloud, con il TC620 collegato: Configurazione → Progetto → Report → «+ Nuovo report», periodo «turno», due o
       tre tag con lo storico acceso, salvare, e **fare il deploy**: il pannello genera con la definizione del suo
       progetto, e senza deploy risponde «nessun progetto aperto» o «report sconosciuto» (29-10-2026).
2. [x] «▶ Genera ora»: compaiono un PDF e un Excel; scaricarli (visto il 29-10-2026 su `tc620-garage`). Il PDF ha riepilogo, andamento e allarmi con i valori
       veri; l'Excel si apre e i numeri si sommano.
3. [x] Con un destinatario email e l'SMTP delle Notifiche configurato: la mail arriva con i due allegati — **confermato
       dal maintainer l'08-11-2026**: su CasaDomotica le mail dei report arrivano regolarmente.
4. [x] Lasciare il pannello acceso oltre l'ora del cron (es. `*/15 * * * *` per provare): i file nascono da soli; con
       «File da tenere» = 2 restano solo le ultime due generazioni. *(08-11: la generazione da sola è confermata dalle mail
       regolari di CasaDomotica; la rotazione dei file non è stata guardata a parte.)*

## A-sexies. Il tunnel: vivo, spento o perso (26-10-2026)

1. [ ] Console → Pannelli con il TC620 collegato: pallino verde. `sudo systemctl --user stop sws-runtime` sul
       pannello (o spegnerlo dal pulsante): il pallino diventa **giallo** con l'ora, e il log del gateway dice
       «spegnimento annunciato».
2. [ ] Staccare il cavo di rete del pannello (half-open): entro circa un minuto e mezzo il log del gateway dice
       «tunnel muto» e il pallino diventa grigio.
3. [ ] «Sposta azienda» su un pannello collegato: si ricollega da sé in pochi secondi.

## A-septies. Chi sta dall'altra parte: la disponibilità delle sorgenti (29-10-2026)

Piano `docs/archive/2026-10-28-chi-sta-dall-altra-parte.md`. Nasce dal Zigbee2MQTT di casa spento per trenta ore senza
che niente lo dicesse. **Si fa dopo che il cloud gira la versione che contiene la funzione**: un runtime più vecchio
ignora `disponibilita:` e la cancella al primo salvataggio, senza avvisare.

**Nell'IDE, subito** (basta l'8460 sul ramo, progetto `casa-locale`, che punta a un broker che non esiste):

1. [x] *(08-11-2026, dal vivo su CasaDomotica: vedi la nota sotto la 10.)* Configurazione → Protocolli → una card MQTT, **chiusa**: la testata dice «non risponde dalle HH:MM» col
       pallino rosso, e il motivo nel suggerimento. Aperta: la sezione **DISPONIBILITÀ** sta fra Autenticazione e
       Mappatura, con lo stato a destra del titolo e il pulsante «⚠ Crea l'allarme di disponibilità». Sotto la
       card non c'è più nessuna riga.
2. [x] (29-10-2026) Sezione **DISPONIBILITÀ** → «Chi dice se è vivo» → Zigbee2MQTT: si compilano topic, campo e valore. Salvare: in
       Variabili compare il tag `<sorgente>.disponibile`.
3. [x] (29-10-2026) «⚠ Crea l'allarme di disponibilità», dentro la sezione: la scheda Allarmi si apre con l'allarme in bozza
       (`bool_false`, 60 s, Warning, il nome della sorgente nel messaggio). Salvare. Tornando alla card, al posto
       del pulsante c'è «Vai all'allarme».
4. [ ] «Personalizzato…» con un topic e **senza** valore «vivo»: la validazione avvisa.

**Dal vivo, con CasaDomotica e il Zigbee2MQTT di casa:**

5. [ ] Su ogni sorgente `mqtt-*` che parla con Zigbee2MQTT: la preimpostazione Zigbee2MQTT. Lo stato dice
       «risponde».
6. [ ] Allarme di disponibilità creato dal pulsante, e Telegram acceso per il suo scatto nella tabella eventi.
7. [ ] **Fermare Zigbee2MQTT**: entro un minuto e qualche secondo arriva il messaggio Telegram; i tag della sorgente
       nel sinottico sono non aggiornati (stale); un allarme di soglia su uno di quei tag **non** scatta.
8. [ ] *(08-11-2026: provato col singolo dispositivo, non con Zigbee2MQTT fermo — riattaccata la presa le variabili sono
       tornate buone subito, perché Z2M ripubblica lo stato al ritorno; il caso «Z2M riavviato» resta.)* Riavviare Zigbee2MQTT: la disponibilità torna vera, ma i tag restano `Bad` finché ognuno non riceve un valore
       vero — premere un interruttore e vederlo tornare buono.
9. [ ] Con Zigbee2MQTT fermo, premere un pulsante del sinottico: il comando **parte lo stesso** (si vede nel log
       del runtime). È voluto: un falso «morto» non deve bloccare i comandi.

**Le altre sorgenti** (basta una):

10. [ ] Una sorgente Modbus o S7 verso un dispositivo vero: staccarlo → `<sorgente>.disponibile` falso e tag `Bad`;
        riattaccarlo → vero, e i tag tornano buoni alla prima lettura.

*(08-11-2026, col maintainer, TC620 con CasaDomotica dall'IDE nel cloud 2.26.0-rc.6 — la variante **per dispositivo**,
non prevista dalla lista: `mqtt-sandokan` con disponibilità «Personalizzato…» sul topic
`zigbee2mqtt/presa.sandokan/availability`, campo `state`, vivo `online`. In Zigbee2MQTT è stata abilitata la
disponibilità (era spenta; timeout attivo 2 min). Presa staccata: `offline` sul broker alle 18:49:56, la card dice
«not responding since 06:49 PM» col motivo letto dal topic, pallino rosso nell'albero, allarme di disponibilità
scattato, `sandokan.*` Bad. Riattaccata: `online` alle 18:55:05, tutto verde e Good. La 10 su Modbus/S7 resta.)*

*(09-11-2026, TC620 con la 2.26.0-rc.9 — la **sorgente unica** `mqtt-casa` con 29 dispositivi: staccata
`presa.Laboratorio`, pallino rosso solo su di lei, `plug_lab.*` Bad e il resto Good; l'allarme «non risponde da un
minuto» compare un minuto dopo l'offline e rientra riattaccandola. La sera dell'08-11, con la rc.8, l'allarme non
scattava: difetto del ritardo degli allarmi, corretto in `ce5c6b91`. Passato.)*

## A-octies. Le card delle sorgenti, ridisegnate (29-10-2026)

Piano `docs/archive/2026-10-29-card-delle-sorgenti.md`. Nasce dal collaudo a schermo di A-septies: il pulsante
dell'allarme troppo nascosto, i titoli delle sezioni dello stesso colore delle etichette, il watchdog da solo su una
riga. Basta l'8460 sul ramo; un progetto con una sorgente per tipo aiuta.

1. [x] **Le nove testate uguali** (visto il 29-10-2026, spuntato il 05-11): tipo colorato · id · riepilogo · stato · azioni · ▲. Host e server OPC-UA senza
       stato (non hanno un altro capo).
2. [x] **L'ordine dei campi** (visto il 29-10-2026): in ogni card l'indirizzo (host, porta seriale, IP, endpoint, URL) viene per primo,
       l'ID sorgente per ultimo nella prima riga.
3. [x] **MQTT → AVANZATE** (visto il 29-10-2026) parte chiusa e dice cosa c'è dentro; aperta, keep-alive, QoS, clean session e
       **watchdog** stanno su una riga sola.
4. [x] **MQTT → MAPPATURA**: l'interruttore `[Topic | Sparkplug B]` nel titolo. Sparkplug B sostituisce la tabella
       dei topic e fa sparire DISPONIBILITÀ; tornare a Topic con delle metriche chiede conferma. Confermato il
       06-11-2026 sull'8460.
5. [x] **Il contrasto, nei due temi** (visto il 29-10-2026): i titoli di sezione si staccano dalle etichette; i campi hanno un fondo
       diverso dalla card; nel tema chiaro la card si stacca dal grigio della pagina (bordo e ombra).
6. [x] **OPC-UA client** (visto il 29-10-2026): la security policy e i certificati stanno in AVANZATE, chiusa, col riepilogo «Security
       policy: …»; utente e password si scelgono in AUTENTICAZIONE.

## A-nonies. Un faceplate si disegna sul canvas (29-10-2026)

Piano `docs/archive/2026-10-27-faceplate-disegnato-sul-canvas.md`. Basta l'8460 sul ramo, con un progetto che usa un
faceplate (il dimostrativo ha `tank_level`).

1. [x] (05-11-2026, IDE 8460) Albero delle pagine: il ramo **🧩 Faceplate** con i tre predefiniti (◇). Configurazione non ha più la scheda
       Faceplates.
2. [x] (05-11-2026, IDE 8460) Aprire `tank_level`: il foglio ha la misura del faceplate, i testi `{label}` si leggono «label» (o il
       predefinito). Con una cornice predefinita nel progetto, sotto il faceplate **non** c'è la cornice.
3. [x] (05-11-2026, IDE 8460) Trascinare un figlio, poi aprire una pagina con un'istanza di `tank_level`: **l'istanza è già cambiata**, prima
       di salvare. Ctrl+Z la rimette.
4. [x] (05-11-2026, IDE 8460) Salvare: `tank_level` diventa ◆ (personalizzato). Nelle proprietà, «Ripristina il predefinito» lo riporta com'era
       e il ◇ torna.
5. [x] (05-11-2026, IDE 8460) «+ Nuovo faceplate», disegnarlo, aggiungere un parametro dalle proprietà, salvare e ricaricare la pagina del
       browser: c'è ancora. **Trascinarlo dal ramo su una pagina**: l'istanza nasce dove lo si lascia, col faceplate
       giusto e della sua misura. Il ＋ della riga fa lo stesso al centro della vista; su un faceplate aperto è spento.
       Fra gli strumenti, «Faceplate» non c'è più.
6. [x] (05-11-2026, IDE 8460) «{ } JSON»: cambiare il nome nella definizione e «Applica»; scrivere un JSON rotto: «Applica» resta spento. Con
       un oggetto `type: faceplate` dentro, lo dice e non applica.
7. [x] (05-11-2026, IDE 8460) Selezionare due oggetti su una pagina → «⧉ Crea faceplate dalla selezione»: il faceplate compare nel ramo, la
       selezione diventa un'istanza, un Ctrl+Z toglie tutti e due.
8. [ ] **CasaDomotica** (dopo il rilascio, regola del 16-10): ridisegnare `tank_level` dal canvas e vederlo sul WP630.

## A-decies. La miniatura nell'elenco dei progetti (29-10-2026)

Ramo D del piano `docs/archive/2026-10-26-aprire-sws-soligo-net.md`.

1. [x] Aprire un progetto, cambiare qualcosa nella pagina iniziale, salvare, chiudere il progetto: la sua scheda
       mostra la miniatura, con la cornice, nelle due viste (griglia ed elenco) — **approvata a schermo il 29-10-2026**
       (homeassistant-pro); il telefono non è stato guardato.
2. [x] Salvare una modifica a un'altra pagina: la miniatura non si rifà (nella scheda Network non parte il `PUT`).
       Confermato il 06-11-2026.
3. [x] (05-11-2026) Nel cloud: la miniatura si vede nell'elenco servito dal gateway, e `anteprima.png` non compare in un commit Git
       del progetto.

## A-undecies. Lo schermo del pannello dal cloud — validato

**Validato dal maintainer il 29-10-2026 sera**, sulla 2.23.7 («funziona perfettamente lo schermo remoto»); piano in
`docs/archive/2026-10-29-schermo-remoto.md`. Le sette voci di traccia sono tolte il 05-11-2026 (sono nella storia git).
L'unica che varrebbe ancora la pena di fare è di sicurezza: un utente di un'altra azienda, con l'indirizzo
`/schermo/<pannello>/` copiato, non entra (serve un secondo account in un'altra azienda).

## A-duodecies. I corpi del testo e i testi che LVGL non disegnava (25-10-2026)

Piano `docs/archive/2026-10-25-corpi-e-parita-lvgl.md`, archiviato il 30-10-2026 con questo collaudo come unico
residuo. Serve un pannello in **modalità LVGL** (WP630, o TC620 commutato) col progetto `demo-items-lvgl`, che usa
tutti questi tipi. **Tutte e sei confermate a schermo il 06-11-2026.**

1. [x] Cambiare il corpo del valore e quello dell'unità (`unit_font_size`) su un gauge e su un kpi: sul pannello
       cambiano tutt'e due, e l'unità segue il valore (nel kpi accanto, nel gauge sotto).
2. [x] Sotto un **symbol** compare l'etichetta dello stato attivo; in una **sparkline** l'ultimo valore in alto a
       destra.
3. [x] **alarm_banner**: la pillola ISA (piena per l'attivo, col bordo per il rientrato) e il tasto ACK sulla riga.
4. [x] **Storico allarmi** e **registro dati**: la tabella scorre col dito fino all'ultima riga; titolo «STORICO
       ALLARMI». Il messaggio e lo stato stanno in due colonne, non in una sottoriga (dichiarato: resta del web).
5. [x] **alarm_bell**: la campana si vede (non un quadratino); **lang_selector**: codici in maiuscolo.
6. [x] **recipe_panel**: senza ricette dice che è vuoto; applicandone una, la riga d'esito.

## A-terdecies. L'impianto lo tocca il pannello, anche dal cloud (25-10-2026)

Piano `docs/archive/2026-10-25-impianto-dal-dispositivo.md`, uscito nella 2.21.0 e archiviato il 30-10-2026. La gamba
«nel cloud le sorgenti non partono» è già provata (28-10, dai thread del container); restano due minuti all'IDE.
Serve un progetto nel cloud con un **pannello collegato** (CasaDomotica e il TC620 del garage).

1. [ ] Dal cloud, una sorgente MQTT → **Sfoglia broker**: trova i topic, passando dal pannello (prima: 0 topic).
2. [ ] Nell'editor nel cloud i valori dei tag si muovono: arrivano dal pannello collegato, non da sorgenti
       avviate nel container.

## B. Lo schema `http`/`https` non è più scritto a mano

Quattro punti che prima non rileggevano il certificato. **Nessuno cambia il comportamento di un
pannello in chiaro**: se il TLS è spento, tutto deve funzionare esattamente come prima.

5. [ ] **Pannello in chiaro, com'è adesso**: installare/aggiornare e verificare che l'installer
       stampi `viewer : http://…:7443` e `IDE : http://…:7444`, che il browser parta, e che il
       codice di abbinamento compaia nel riquadro.
6. [ ] **Pannello con TLS acceso**: rilanciare `install-container.sh` e verificare che adesso
       stampi `https://`, che punti il browser su `https://127.0.0.1:7443` e che il codice di
       abbinamento lo legga lo stesso (prima due sonde su tre erano mute).
7. [x] **Pannello LVGL con TLS acceso e quadlet vecchio** (lo schermo LVGL col sinottico, collaudo del 06-11-2026): il viewer deve ripartire lo stesso. Nel
       log (`journalctl --user -u sws-lvgl-viewer`) deve comparire
       `[base-url] http://… non risponde, https://… sì: uso quello` e lo schermo deve mostrare il
       sinottico. Se resta nero, il ripiego di schema non ha funzionato.

---

## C. Il certificato: nome vero, e governo da remoto

8. [x] *(Misurato il 05-11-2026 sul WP630: `CN = wp630-a-p3-07a077, O = SWS`, SAN `localhost`, il nome, il nome
       `.local`, `127.0.0.1` e l'IP.)* **Rigenerare** il certificato sul pannello e guardarne il soggetto:
       `openssl s_client -connect <pannello>:7443 </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
       Deve dire `CN = <nome del pannello>` (non più `rcgen self signed cert`) e i SAN devono
       contenere `localhost`, `<nome>` e `<nome>.local` oltre agli IP.
9. [x] **La card «Certificato TLS» con un pannello connesso** (Configurazione → Istanza → Device):
       in testa deve dire «Dispositivo connesso — `<host:porta>`», non «Questa istanza», e deve
       mostrare le tre righe gialle (riavvio, impronta che cambia, schema che cambia).
       **Prima questa card governava il PC su cui gira l'IDE.** Confermato il 06-11-2026.
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
15. [x] *(Misurato il 05-11-2026: l'impronta memorizzata dall'IDE 8460 per il WP630 è quella servita sulla 7443 e
        sulla 7444.)* Confrontare l'impronta con quella che il pannello dice di sé —
        `openssl x509 -in /data/user/sws/config/tls.crt -noout -fingerprint -sha256`. Devono
        coincidere. *(È la cosa che rende utile tutta la funzione: se non coincidono, il confronto
        che l'IDE propone è teatro.)*

---

## E. Accesso dal pannello LVGL — chiusa

Chiusa il 26-10-2026 sulla 2.22.0, con la guardia `check_accesso_lvgl.sh`. Sezione tolta il 05-11-2026.

---

## F. OpenPLC sul pannello (opzionale)

Rifatto il 30-10-2026 dopo il primo collaudo sul WP630, che aveva trovato il quadlet rotto: ora è un
container persistente (HOWTO cap. 28). **Già visto da Claude sul WP630 via SSH**: installazione con
`--solo-openplc`, programma caricato dall'Editor (CLI), stop pulito in 6 s, programma ancora in RUN
dopo un riavvio vero. Il giro **da utente** è fatto il 30-10-2026: bottone dall'IDE, Editor da Windows senza tunnel, Modbus letto da
SWS (`soglia_alta` = 900). Il riavvio (24) l'ha fatto Claude via SSH, col programma ancora in RUN.

19. [x] Senza `--con-openplc` OpenPLC non c'è: nessun container, nessun quadlet (WP630, 30-10-2026).
20. [x] **Dall'IDE, pannello già installato**: Istanza → Connessione → «OpenPLC sul pannello» →
        Installa. Il riquadro passa da «in corso» ad «Acceso» senza che SWS si fermi.
20b. [x] **Dichiarata coperta il 05-11-2026** (20 e 20c passate, il flag ha un test). **Dall'IDE, installando SWS**: scheda Installazione, «Installa anche OpenPLC» spuntata. Alla
        fine il riquadro della Connessione dice «Acceso».
20c. [x] **Dalla guida del cloud** (WP630, 02-11-2026: aggiornato alla 2.24.0 col comando della guida, OpenPLC e programma tenuti): la casella aggiunge `--con-openplc` all'ultimo comando. Si prova
        dopo una release: lo script viene dall'immagine del registry.
21. [x] L'Editor di OpenPLC **dal PC Windows**, sulla stessa rete, si collega alla 8443 del pannello
        senza tunnel, crea l'utente e carica un programma. La logica sta in `<progetto>/openplc/`.
22. [x] (05-11-2026, IDE 8460) La logica viaggia col progetto: backup, export e deploy la portano; `git` la prende da sé.
22b. [x] **Dall'IDE** (03-11-2026; fatto lo stesso giorno sul WP630 2.24.1: zip di 39 file caricato, riscaricato
        uguale e arrivato col deploy, `program.st` identico; trovati e corretti la codifica dei nomi nel deploy e lo zip
        non compresso): Connessione → «Logica PLC del progetto» → «Scarica (zip)», aprirla
        con l'Editor di OpenPLC sul PC Windows, modificarla, comprimere la cartella e «Carica zip…»;
        poi deploy e, sul pannello, il programma nuovo in `<progetto>/openplc/`.
23. [x] Modbus di OpenPLC risponde su `127.0.0.1:1502` e una sorgente Modbus di SWS puntata lì legge
        (`soglia_alta` = 900 col programma del laboratorio). Da Claude via SSH: sì.
24. [x] Dopo un riavvio del pannello OpenPLC riparte da solo, **col programma**.

---

## F-bis. Il tubo che segue un oggetto mosso da una variabile — chiusa

Confermato dal maintainer su tutti e due i motori, LVGL compreso sul WP630
(`docs/archive/2026-10-21-tubo-che-segue-gli-oggetti.md`), con la guardia `check_tubo_segue_lvgl.sh`. Tolta il 05-11.

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
    > **Ripulito il 05-11-2026** dal maintainer. Era: la prova è stata fatta dentro `CasaDomotica`, il progetto di riferimento.
    > Vanno tolti il tipo `motore`, il tag `Pompa2`, il tag orfano `'motore1.velocita '` e
    > l'oggetto in `Home.yaml:79`.
34. [x] (07-11-2026, TC620, tapparelle di «Collaudo 2.26») Un faceplate con parametro `istanza(Motore)`: scegliendo l'istanza, i campi si legano da soli.

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

30. [x] **Superata dal codice il 25-10-2026** (`9d58dbf3`): il trust store non sta più nella card della sorgente, che
        manda a Sicurezza → Certificati (solo Admin). Per un Supervisore il link porta in silenzio alle Variabili.
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
