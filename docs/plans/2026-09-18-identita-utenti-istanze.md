# Identità, utenti e istanze: di chi sono gli account, e chi comanda quando due copie non sono d'accordo

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.


## Perché queste tre stanno insieme

Non le ho raggruppate io: **Q56 dichiara da sé** di essere imparentata con Q44 e Q54. Sono la
stessa domanda vista da tre punti diversi:

| | La domanda vista da… |
|---|---|
| **Q44** | …chi ospita l'editor per più aziende: utenti, quote, branding, e progetti che non sono uno solo |
| **Q54** | …un dispositivo che si crea account propri: al deploy successivo chi vince? |
| **Q56** | …un IDE che non si autentica più, perché `users.yaml` governa il dispositivo e non l'editor |

Sotto tutte e tre c'è una cosa sola: **di chi sono gli account, e cosa succede quando due copie
dello stesso progetto non sono d'accordo su chi può entrare.** Decidere Q44 decide di fatto le
altre due; deciderle separatamente significa quasi certamente doverle rifare.

## Cosa NON fare adesso

Il maintainer è stato esplicito il 18-09-2026: **questo è il lavoro più corposo e va in coda**,
dopo gli altri. Questo file esiste per tenere insieme il materiale, non per cominciare.

> «Ora non ha senso, possono cambiare troppe cose. Ora facciamo un mini-plan per rivedere le 3
> questioni e accorparle in un plan coerente.»

Quindi: quando si comincerà, **prima una sessione di plan dedicata** che rilegga le tre schede
contro il codice di allora e ne faccia un piano unico. Le misure qui sotto hanno la data che
hanno.

## Da tenere d'occhio nel frattempo

- **CRA (Cyber Resilience Act)** — dal 05-10-2026 questo piano porta anche il punto 1 della
  [gap analysis CRA](2026-10-05-cra-gap-analysis.md): sezione «Vincoli dal CRA» più sotto. Cambia il peso
  di Q56 e del primo accesso al pannello: da «prezzo dichiarato» a requisito prima dell'immissione sul mercato.

- **Q60 (workspace)** sta nella stessa coda: se l'editor diventa un servizio multi-azienda,
  «dove vivono i progetti» cambia natura, e le due decisioni si condizionano.
- **Q46** (il selettore di cartelle confinato nella radice) è una decisione di sicurezza già
  collaudata: qualunque cosa si decida qui, non la si tocca di straforo.
- Ogni correzione che sposta il confine fra «utenti del progetto» e «utenti del dispositivo» va
  annotata qui sotto man mano, o quando si aprirà questo lavoro le schede saranno vecchie senza
  che nessuno lo sappia.



---

## Sessione di plan — 27-09-2026 (in corso)

Prima sessione dedicata, chiesta dal maintainer: «vorrei dessi meno cose possibili per scontate e ti
confrontassi con me in modo sincero e costruttivo». Qui solo ciò che il maintainer ha **deciso**, con
le sue parole, e ciò che è stato **misurato**; le proposte restano proposte finché non le sceglie.

### Il punto di partenza (maintainer)

> «l'ide potrà essere ospitato su un server dedicato (vps in internet). il PC dello sviluppatore e il
> runtime saranno su una o due reti distinte. […] lo spazio avrà una gerarchia azienda/sviluppatore»

### Deciso

1. **I file del progetto stanno solo in cloud**, sulla VPS, con la possibilità di salvarli in locale.
   («i file possiamo decidere che sono solo in Cloud con la possibilità di salvare il progetto in locale»)
2. **La contemporaneità che conta è più utenti, ognuno sul proprio progetto** (non più utenti sullo
   stesso progetto in tempo reale).
3. **Un processo runtime per ogni progetto aperto** (strada «a»), con davanti uno strato che autentica e
   instrada — non un runtime reso multi-progetto (strada «b»).

### Misurato il 27-09

- `AppState` (`router.rs:70`) tiene **un** progetto: `project_dir`, `db`, `alarms`, `historian`,
  supervisori di sorgenti e script. Due utenti sulla stessa istanza si scambiano il progetto.
- Un processo IDE con CasaDomotica aperto (42 tag, build debug): **86 MB** RSS, 10 thread.
- Il processo IDE (`ide_only`) **avvia le sorgenti** (si collega a MQTT/Modbus/… agli indirizzi del
  progetto) e **esegue gli script globali Python**; non registra lo storico e non manda notifiche
  (26-09).
- Più utenti sullo stesso progetto: esiste il blocco ottimistico (`If-Match`/409). Per file su pagine,
  faceplate, ricette; **per tutto `project.yaml`** su tag, allarmi, sorgenti e notifiche.

4. **IDE e runtime legati da una VPN** (proposta del maintainer), che arriva **solo al runtime**, non
   alla LAN d'impianto: la VPS vede le API del pannello e nient'altro.
5. **Nell'IDE ospitato sorgenti e script Python sono spenti**; i dati dal vivo arrivano dal runtime
   attraverso il tunnel (il relay `remote_relay.rs` esiste già per il dispositivo collegato).
6. **Firewall dei siti: «dipende dal cliente»** — serve comunque un modo che passi su TCP/443.
> ⚠️ **Le decisioni 7-11 sono superate dalla 38 (05-10-2026): niente VPN.** Restano scritte perché
> il ragionamento che ha portato alla 38 si capisce solo leggendole, e perché le misure fatte sul
> TC620 il 27-09 restano vere. Non vanno implementate.

7. ~~**Componente VPN: adottare, non scrivere.**~~ Headscale + Tailscale vanno bene, **ma** — maintainer:
   «nel caso dei tc e wp esiste una implementazione openvpn predisposta». Da capire come è predisposta
   prima di scegliere.

8. ~~**Solo OpenVPN**~~, anche per i dispositivi non Pixsys, che interessano **da subito**.
9. ~~**Un'istanza OpenVPN per azienda** sulla VPS: rete e CA proprie, isolamento per costruzione.~~
   **Corretta il 05-10-2026 — un'istanza sola, isolamento per configurazione.** Il motivo è
   aritmetico e non si aggira: la decisione 36 mette la VPN sulla **443**, e quella porta la lega un
   processo solo. Un proxy davanti non aiuta, perché i client OpenVPN non mandano SNI — haproxy non
   ha niente con cui distinguere il pannello dell'azienda A da quello dell'azienda B. Le alternative
   erano un IPv4 pubblico per azienda (isolamento intatto, si paga per IP) o la 443 solo per le
   prove; il maintainer ha scelto l'istanza unica.

   Quindi: **un endpoint per tutti**, e la separazione fra aziende la fanno `client-config-dir` con
   **sottoreti fisse per azienda** e le regole del firewall. È un cambio di natura, non di dettaglio:
   si passa da «isolamento per costruzione» a «isolamento per configurazione», dove un errore in una
   regola mette due clienti sulla stessa rete invece di dare un errore. Due conseguenze obbligatorie,
   non facoltative:
   - **una guardia** che verifichi che le sottoreti per azienda siano disgiunte e che le regole del
     firewall le rispettino, perché questo è esattamente il tipo di difetto che non si manifesta
     finché non è grave;
   - **si dice a chi prova** che l'isolamento è per configurazione. Il giorno in cui un cliente lo
     mette per contratto, la strada è l'IPv4 dedicato con la sua istanza, e la decisione 9
     originale torna valida per lui.
10. ~~**Pixsys: il container scrive `client.ovpn` e `secrets.txt` in `/data/openvpn`**~~ (un mount in più
    nell'installer) e la VPN parte al riavvio del pannello.
11. ~~**Non Pixsys: il client OpenVPN gira sull'host**~~, installato da `install-container.sh` — la regola
    «l'host non si tocca» vale per i Pixsys.
12. **Abbinamento con un codice mostrato sul pannello**, che lo sviluppatore inserisce nell'IDE.

### Misurato sul TC620 il 27-09 (sola lettura, autorizzata)

- OpenVPN **2.6.14** sull'host. `openvpn-auto-login.service` (root, `WantedBy=multi-user.target`) parte
  **solo se** esistono `/data/openvpn/client.ovpn` e `/data/openvpn/secrets.txt`
  (`ConditionPathExists`), con `--auth-user-pass secrets.txt`: **utente/password obbligatori**.
  Oggi inattivo (file assenti). Presenti anche `openvpn-client@`/`openvpn-server@`, disabilitati.
- `/data/openvpn` è di **`user:setup-user`**: il container (che gira come `user`, `keep-id`) può
  scriverci se montata.
- `net.pixsys.Config1` **non ha un metodo per la VPN** (Buzzer, Display, FactoryReset, Launcher, Time,
  TouchReboot, USBDrives, UserApps, WebBrowser): senza root, la VPN si accende solo al riavvio.
- Il tunnel termina sull'**host**: il vincolo «solo al runtime» va imposto dal lato VPS (firewall verso
  la sola 8444, profilo senza `redirect-gateway` né rotte verso la LAN).

13. **L'indirizzo della VPS è scritto nell'immagine, modificabile** in configurazione (per chi ospita
    altrove). Il pannello lo usa in HTTPS, prima della VPN, per ritirare il profilo col codice.
14. **Il codice di abbinamento appare in tutti e due i posti**: sullo schermo del pannello (web e LVGL)
    e nella pagina locale del runtime, che vale anche per i dispositivi senza schermo.
15. **Un progetto dello spazio cloud appartiene all'azienda**; gli sviluppatori ci lavorano con i
    permessi che l'azienda dà, e se uno se ne va il progetto resta.
16. **Due livelli ora (azienda → sviluppatori), il terzo previsto**: lo schema non deve impedire un
    domani integratore → cliente finale → suoi progetti.

17. **Registrazione libera delle aziende, ma VPN e pannelli dopo l'approvazione** dell'amministratore
    della piattaforma: chi si registra prova l'editor con quote piccole; l'istanza OpenVPN e
    l'abbinamento dei pannelli si attivano solo ad azienda approvata. Discusso prima di scegliere: la
    registrazione libera porta dal primo rilascio invio email (verifica, recupero password),
    anti-abuso, quote, termini e informativa privacy (GDPR).
18. **Due ruoli nell'azienda: amministratore** (persone e dispositivi) **e sviluppatore** (progetti).
19. **Accesso con email e password, 2FA (TOTP) opzionale**, che l'azienda può rendere obbligatoria.
20. **Un pannello abbinato riceve qualunque progetto della sua azienda**: lo sviluppatore sceglie il
    pannello al deploy, come oggi con «Connetti».

21. **Utenti d'impianto: nel progetto, e anche sul pannello marcati «locali»** (opzione 3 di Q54): il
    deploy sostituisce quelli del progetto e non tocca quelli nati sul pannello — la revoca arriva,
    l'operatore creato in reparto resta.
22. **Account cloud e account d'impianto separati**: l'account cloud apre l'IDE, il pannello ha solo i
    suoi utenti. Un pannello resta usabile senza internet.
23. **Quote dal primo rilascio: numero di progetti, spazio su disco, numero di pannelli**, per azienda.
    *Nota:* «progetti aperti insieme» non è stata scelta come quota; ogni progetto aperto è un processo
    sulla VPS, quindi lo spegnimento dei processi inattivi diventa l'unica difesa — da tenere presente
    nel dimensionamento.
    > **Superata il 09-10-2026.** Le quote sono due, non tre: **spazio** e **progetti aperti
    > insieme**. Il numero di progetti sparisce, perché lo spazio lo copre già. I pannelli
    > restano un dato da vedere, non un limite. E «progetti aperti insieme» diventa proprio la
    > quota che qui si escludeva: ogni progetto aperto è un container, cioè memoria e CPU. Lo
    > spegnimento dei fermi resta, ma non è più l'unica difesa — si somma al tetto. Vedi
    > [Fase 4 — il gateway](2026-10-09-fase-4-gateway.md).
24. **Al superamento si blocca solo ciò che crea** (nuovi progetti, pannelli, spazio): deploy e
    pannelli già in servizio non si fermano mai.

25. **Un container per ogni processo IDE** sulla VPS (podman rootless): montata solo la cartella del
    progetto, rete solo verso la VPN della sua azienda. Riusa l'immagine del runtime.
26. **Lo strato davanti è lo stesso binario in una modalità nuova** (es. `sws-runtime --gateway`):
    login, aziende, quote, instradamento e avvio/spegnimento dei container.
27. **Solo cloud, con la porta del self-host tenuta aperta** (riscritta il 05-10-2026; prima diceva
    «l'IDE installabile resta, accanto a quello ospitato, per chi non vuole il cloud o lavora
    offline»). Parole del maintainer: «il servizio per ora lo fornirò solo cloud, è quello che penso
    essere il business model migliore. Vorrei però tenermi sempre la strada aperta per fornirlo in
    self-host, può anche essere un container che il cliente avvierà su un suo server, non è
    indispensabile sia installabile sul singolo PC».

    Quindi **non si vende** l'IDE installabile, ma **non si rende impossibile** darlo domani come
    container su un server del cliente. È un vincolo di architettura, non una funzionalità da
    costruire adesso — e un vincolo del genere vive solo se è scritto come regola, perché le
    dipendenze dal cloud si infilano una alla volta senza che nessuno le decida:
    - **il cloud è un modo di far girare l'IDE, non un prodotto diverso**: un'istanza con una sola
      azienda e nessun gateway deve restare una configurazione valida, non un caso rotto;
    - **il gateway è opzionale**: `ide_only` dietro il gateway non può diventare l'unico modo in cui
      l'autenticazione funziona (vedi la lettera d nella tabella CRA più sopra);
    - **nessun indirizzo della VPS compilato dentro**: già previsto dalla decisione 13, qui diventa
      anche un requisito del self-host;
    - **niente verifiche che telefonano a casa** per licenze o quote: le quote sono dello strato
      gateway, non del nucleo.

    Costa poco mantenerlo perché **oggi quella strada esiste già**: `scripts/start_editor.sh` è
    letteralmente «l'IDE come lo avvierebbe un cliente», e il runtime gira in container da sempre.
    Il rischio non è costruirla, è lasciarla marcire. Da decidere nella sessione di plan: se basta
    tenerla viva con una guardia che avvii l'IDE senza gateway né azienda, o se serve di più.

    **Nota CRA**: finché è solo cloud, l'IDE è un servizio e sta fuori dal perimetro del regolamento.
    Il giorno in cui un container self-host viene consegnato a un cliente, quello **è** un prodotto
    con elementi digitali e si porta dietro gli obblighi da fabbricante. Non è un motivo per non
    farlo: è un costo che si attiva alla consegna, e va saputo prima di prometterlo a qualcuno.
28. **Email via SMTP configurabile**, senza legarsi a un fornitore.

36. **Le porte pubbliche** (05-10-2026). *Nota del 05-10, sera: con la decisione 38 il conflitto che
    ha generato questa decisione non esiste più — il tunnel dei pannelli è HTTPS, quindi la 443 la
    condividono dietro lo stesso proxy. Resta valido il principio sulla diagnosticabilità, e resta vero che Let's Encrypt
    con la 80 libera è più semplice.* Testo originale: la 443 è della VPN, l'IDE sta altrove. Parole del
    maintainer: «l'IDE non è necessario sia sulla porta 443, basta un redirect dalla porta 80 quando
    uno apre la pagina, se non vede la pagina il problema è della sua rete. Più importante è la VPN
    sulla 443 perché se non si raggiunge il pannello diventa difficile capire cosa non vada».

    La ragione è la diagnosticabilità, ed è buona: un IDE che non si apre è un guasto che l'utente
    vede e capisce; un pannello che non si collega è invisibile. Quindi **80** → reindirizzamento,
    **443** → OpenVPN, IDE su una porta TLS dedicata.
    - *Effetto collaterale favorevole*: con la 80 libera, Let's Encrypt funziona con la sfida
      HTTP-01 senza girarci intorno — la 443 occupata avrebbe lasciato solo DNS-01.
    - *Il prezzo, dichiarato*: gli sviluppatori di un'azienda di automazione lavorano spesso
      **dentro** l'impianto del cliente, dietro lo stesso firewall ostile che preoccupa per il
      pannello. Lì una porta non standard può essere bloccata proprio mentre si è davanti alla
      macchina. Accettato consapevolmente.

38. **Niente VPN: un tunnel per dispositivo** (05-10-2026). Supera le decisioni 7, 8, 9, 10 e 11.

    **Il motivo è un modello di minaccia che prima non era stato messo per iscritto**, parole del
    maintainer: «il runtime del PLC potenzialmente è modificabile dall'utente visto che può ottenere
    l'accesso root al dispositivo». Un pannello non è un endpoint fidato: è hardware del cliente, e
    il cliente può farne quello che vuole. Metterlo dentro una VPN significa mettere hardware
    potenzialmente ostile dentro una rete condivisa con gli altri clienti.

    **E «un'istanza per azienda» proteggeva meno di quanto il nome prometta.** Due istanze sulla
    stessa macchina hanno due `tun`, ma l'inoltro fra i due lo governa sempre lo stesso kernel e le
    stesse `iptables`: l'isolamento del *traffico* resta regolamentare. Quello che le CA separate
    comprano davvero è l'isolamento dell'**autenticazione** — un pannello compromesso dell'azienda A
    non può entrare nella VPN della B. Buono, ma paga la 443 (una porta, un processo) o degli IPv4
    aggiuntivi.

    **La domanda giusta non era quale VPN, ma se serve una rete.** Il requisito della decisione 4 è
    «la VPS vede le API del pannello e nient'altro»: non è una rete, è un canale verso la 8444. Una
    VPN dà a ogni pannello un indirizzo su un segmento condiviso e poi passa la vita a vietare con
    delle regole tutto ciò che quel segmento per sua natura permette.

    **Quindi**: il pannello apre **lui** una connessione persistente al gateway, in TLS sulla 443, e
    il gateway la multiplexa. Ogni pannello ha una **sessione**, non un indirizzo. Fra due pannelli
    non esiste nessun segmento comune, quindi non c'è niente da vietare: l'isolamento è strutturale,
    e il gateway decide per ogni richiesta quale azienda può parlare con quale pannello. Un pannello
    compromesso può impersonare **sé stesso** e nient'altro — che è il massimo ottenibile, visto che
    i suoi dati sono comunque suoi.

    **Quello che si guadagna, oltre all'isolamento:**
    - la **443 torna condivisibile** con l'IDE: il tunnel è HTTPS con WebSocket, quindi lo instrada un
      proxy HTTP qualunque (decisione 40) — non serve nemmeno guardare l'SNI. Il
      conflitto che aveva prodotto le decisioni 36 e la correzione della 9 **sparisce**;
    - niente `/dev/net/tun`, niente root, **niente riavvio del pannello** — cade il problema
      misurato il 27-09, cioè che `net.pixsys.Config1` non ha un metodo per la VPN e quindi il
      tunnel partiva solo al reboot;
    - niente `/data/openvpn` da montare nell'installer (10), niente client sull'host per i non
      Pixsys (11): **la stessa strada per tutti i dispositivi**, che era l'obiettivo della 8;
    - solo uscite dal pannello: nessuna porta in ingresso, nessuna regola da chiedere al cliente.

    **Quello che costa, detto senza sconti**: è codice nostro invece di un componente adottato, e
    contraddice la decisione 7. Va scritto un multiplexer con riconnessione, keepalive, backpressure
    e timeout, e i flussi dal vivo (`/ws/tags`, `/ws/alarms`, `/ws/logs`) devono passare di lì.

    **Ma costa molto meno di quanto sembri, ed è stato verificato**: tutte le operazioni remote
    dell'IDE compongono `{base}/api/…` a partire da `RemoteTarget.url` (`remote.rs:600, 665, 726,
    794`, e `inoltra_aggiornamento` per tutte quelle di aggiornamento). Puntare quel `base` a
    `https://<gateway>/dev/<pannello>` fa funzionare **l'intero strato remoto già scritto** —
    connessione, deploy, utenti, backup, database, aggiornamenti — senza riscriverlo. E
    `remote_relay.rs` fa già da ponte ai WebSocket, nell'altro verso. Il pezzo davvero nuovo è il
    lato pannello (una connessione uscente che inoltra a `localhost:8444`) e il multiplexer nel
    gateway.

    **Resta valido** della parte VPN: la decisione 12/14 (codice di abbinamento) — che ora è anche il
    modo in cui il pannello riceve la credenziale del tunnel — e la 13 (l'indirizzo del server
    scritto nell'immagine e modificabile), che diventa l'indirizzo del gateway.

39. **Il server è un VPS OVH** (05-10-2026; **preso il 06-10-2026**: `debian@vps-5ea9b77b.vps.ovh.net`,
    dedicato all'IDE SWS — scheda in [TEST_SETUPS](../TEST_SETUPS.md) §0), si parte dal **VPS-1** (2 vCore, 4 GB, 40 GB NVMe) con
    l'idea di salire fino al VPS-4 se serve. È KVM, quindi **podman annidato** funziona senza i
    contorsionismi di un LXC non privilegiato — ed era il motivo principale per preferire una VM.
    (Con la decisione 38 cade il secondo motivo, `/dev/net/tun`: non serve più a nessuno.)

    Perché 4 GB bastano per cominciare: **la decisione 5 è anche un dimensionamento**. Nell'IDE
    ospitato sorgenti e script Python sono spenti, quindi un progetto aperto non interroga nessun bus
    e non esegue niente a ciclo — la CPU per progetto è quasi zero e il vincolo è la memoria
    (~150-250 MB per progetto aperto in release). Lo stesso vale per il disco: senza registratore
    dei datastore lo storico non cresce, e il costo fisso è l'immagine.

    **Il numero da sorvegliare non è quanti si registrano, ma quanti progetti sono aperti insieme** —
    e la decisione 23 ha scelto di *non* farne una quota, lasciando come unica difesa lo spegnimento
    dei processi inattivi (Fase 4 del piano d'esecuzione). Finché quello non c'è, dieci schede
    dimenticate sono dieci container vivi.
    > **Dal 09-10-2026 è una quota**, e la difesa è doppia: il tetto per azienda più lo
    > spegnimento dei fermi. Vedi [Fase 4](2026-10-09-fase-4-gateway.md).

    Tre vincoli operativi: **non si compila sul VPS** (una `target/` di questo workspace si mangia i
    40 GB da sola — build altrove, immagini su ghcr, il VPS fa `pull`); **datacenter UE**, perché con
    la registrazione libera si trattano dati personali (decisione 17 e GDPR); **la porta 25 in uscita
    è bloccata di default sui VPS OVH**, e morde sulla verifica dell'indirizzo — serve un relay su
    587, con PTR, SPF e DKIM, o le email di registrazione finiscono nello spam e la demo sembra
    rotta.

40. **La porta di casa è Traefik, la GUI sui container è Portainer** (06-10-2026). Richiesta del
    maintainer: «sul VPS vorrei implementare qualcosa tipo Traefik o simile ma con GUI e vorrei fosse
    il modo per ospitare più servizi in container».

    **Nota sulla GUI, perché la richiesta non si può soddisfare come posta**: la dashboard di Traefik
    è di **sola lettura** — la configurazione resta file ed etichette dei container. La GUI che si
    ottiene con questa coppia è quindi **sui container** (Portainer: avviare, fermare, guardare i
    log), non sull'instradamento, che si configura con le etichette. In cambio: quando si aggiunge un
    servizio non c'è niente da configurare nel proxy, perché Traefik lo scopre da sé.

    **Semplificazione che viene dalla decisione 38**: il tunnel dei pannelli è una connessione TLS
    uscente che parla WebSocket, cioè HTTPS normale. La porta di casa non ha quindi bisogno di
    instradamento TCP né di guardare l'SNI grezzo — le basta HTTP, WebSocket e Let's Encrypt. Finché
    sulla 443 c'era OpenVPN serviva haproxy con l'SNI; ora non più, e le menzioni precedenti in questi
    piani sono state corrette.

    **Il confine, che è la parte da non sbagliare.** Il proxy possiede 80 e 443, fa i certificati e
    instrada **per nome host** verso i servizi della macchina, il gateway SWS fra questi. **Non**
    instrada verso i container dei progetti: quella non è una scelta per nome ma dipende
    dall'autenticazione (chi sei, di che azienda, puoi aprire questo progetto) e dal ciclo di vita
    (avviarli a richiesta, spegnerli da fermi — contro le schede dimenticate; dal 09-10-2026 si
    somma al tetto per azienda, che la decisione 23 non prevedeva). Due proxy in serie vanno bene; un proxy
    che fa il mestiere del gateway no.

    **Trappola da configurare esplicitamente**: i **timeout di inattività**. Un proxy che chiude le
    connessioni ferme dopo un minuto taglia il tunnel dei pannelli, ed è esattamente il guasto che la
    Fase 0 del piano d'esecuzione deve misurare. Va alzato, non lasciato al default.

41. **Un nome per servizio, e niente proxy Cloudflare** (06-10-2026). `sws.soligo.net` per l'IDE,
    `tunnel.soligo.net` per la connessione dei pannelli; tutti e due su Cloudflare come **solo DNS**,
    nuvola grigia, risolti a `37.187.181.142`. Maintainer: «credo sia meglio dividere i nomi dei vari
    servizi».

    **Perché dividere i nomi conviene**, al di là di Cloudflare: due nomi sono **due certificati**,
    quindi un problema su uno non spegne l'altro; il tunnel può **traslocare** su un'altra macchina
    cambiando un record DNS, senza toccare l'IDE né i pannelli già installati; i log e le regole del
    firewall si leggono per nome invece che per percorso; e il giorno che si volesse riaccendere uno
    scudo davanti all'interfaccia pubblica, lo si accende **solo su quella**.

    **Perché il proxy sta spento.** Con la nuvola arancione Cloudflare non è un DNS ma un
    intermediario: termina il TLS, quindi vedrebbe in chiaro i progetti e i dati d'impianto dei
    clienti; impone la sfida **DNS-01** per il certificato (token API da custodire sul server, invece
    della più semplice HTTP-01); e **chiude le connessioni ferme** dopo un centinaio di secondi, cioè
    taglia un tunnel che per sua natura sta zitto per ore — rimediabile con dei ping, ma aggiunge un
    terzo da sospettare ogni volta che un impianto si scollega. In cambio dava scudo anti-DDoS e IP
    nascosto: su un servizio che ancora nessuno conosce, valore reale ma basso. Si riaccende con un
    clic quando servirà, e la destinazione naturale è accenderlo **solo su `sws.soligo.net`**.

29. **Nessun ramo di sviluppo lungo** (maintainer: «No, ok, alla fine tutto questo lavoro ha senso
    anche per un uso locale»). Il lavoro entra in `main` a pezzi piccoli, un ramo corto per volta come
    da `CLAUDE.md`: il gateway come modalità nuova (`--gateway`) che finché nessuno la lancia non
    cambia niente; **prima** i pezzi che toccano il codice condiviso e servono anche in locale — la
    semantica di `ide_only`, gli utenti d'impianto «locali» (chiude Q54), il mount di `/data/openvpn`
    nell'installer. Motivo: un ramo lungo accumula i conflitti di significato che git non vede, come
    il 14-09.

42. **Una console di amministrazione della piattaforma** (06-10-2026). Richiesta del maintainer: «la
    configurazione la metterei in una pagina web di amministrazione del servizio, dove vedrò le
    richieste di creazione delle aziende e degli utenti e potrò approvarle. L'idea è che a quella
    pagina entrerò con utente e password, poi configuro l'SMTP e poi abilito anche per l'admin il
    2FA».

    Non è una pagina di impostazioni: è **un posto**, e raccoglie tre decisioni già prese che finora
    non avevano un luogo — l'approvazione delle aziende (17), la configurazione SMTP (28),
    l'attivazione della 2FA (19).

    **SMTP scelto: Infomaniak**, `mail.infomaniak.com:587` STARTTLS. La decisione 28 («senza legarsi
    a un fornitore») resta valida: il fornitore è una configurazione, non un'assunzione nel codice.
    Le credenziali sono **segreti di installazione**: file 0600 in `<config_dir>`, fuori da git e
    fuori dall'export, come già vale per `secrets.yaml` dei progetti. La console ne cambia il
    contenuto, non il posto.

    **Il problema d'ordine, e la sua soluzione.** «Entro con utente e password» presuppone un
    amministratore che esista già, e non può averlo creato una registrazione via email: l'SMTP si
    configura *dopo* essere entrati. Il primo accesso deve quindi nascere altrove — e il meccanismo
    giusto è lo stesso della **decisione CRA 4**: un **codice monouso stampato all'avvio** (nei log
    del servizio, non raggiungibile da chi arriva alla pagina), che dimostra accesso alla macchina
    invece di fidarsi di chi preme per primo. È esattamente ciò che Portainer ha preteso da noi il
    06-10 installandolo sul VPS, e funziona.

    **La 2FA dopo l'SMTP è l'ordine corretto**, con una condizione: all'attivazione si generano
    **codici di recupero** da conservare fuori dal sistema. Senza, un telefono perso più una posta
    che non parte significa nessuna strada di ritorno — e la posta, su un VPS OVH, dipende da un
    relay esterno che può essere giù proprio quando serve.

    **Dove entra nelle fasi**: la console nasce nella **Fase 3** (è lì che vivono aziende e
    approvazioni) e si riempie nella **Fase 5** (SMTP, registrazione, 2FA). Il primo accesso con
    codice monouso è lo stesso codice della Fase 1 per l'installazione locale: un meccanismo, due
    usi.

43. **Il marchio di un'azienda si sceglie da un catalogo, nella console** (06-10-2026). Richiesta del
    maintainer: «nella pagina admin, all'azienda devo poter associare il branding». Scelto il
    **catalogo di marchi preparati da lui**, non il caricamento libero. Chiude la terza gamba della
    richiesta originale di Q44 (aziende, utenti, **branding relativo**).

    **È la scelta più economica, e non per poco.** Senza caricamenti non c'è niente da
    immagazzinare né da servire dinamicamente: i marchi restano file statici dentro l'immagine,
    dove sono già (`sws-editor/public/branding/<id>/`), e al gateway basta annunciare a ogni azienda
    un `active.json` diverso. Il frontend **non cambia di una riga**: `loadBranding()`
    (`sws-editor/src/branding/index.ts:151`) fa già `fetch("/branding/active.json")` e non sa da
    dove arrivi la risposta.

    **Due cose misurate il 06-10-2026 che hanno portato a questa scelta.**

    *Il logo è un SVG* (`logo.svg`, `favicon.svg`). Un SVG caricato da un'azienda e servito dalla
    stessa origine dell'IDE può contenere `<script>`, che girerebbe **dentro** la pagina
    dell'editor con la sessione dell'utente. È la via di attacco classica di «è solo un'immagine».
    Con il catalogo il problema **non esiste**; il giorno del caricamento libero servono o soli
    formati raster, o una ripulitura dell'SVG fatta sul serio, o un'origine separata.

    *Un marchio non è solo aspetto: contiene il catalogo prodotti.* Il `brand.json` di Pixsys porta
    `device_presets` con i venti modelli sistemati il 02-10. Quindi assegnare un marchio assegna
    anche **quali pannelli l'azienda vede** scegliendo la dimensione di una pagina. Per un
    rivenditore Pixsys è giusto; per un'azienda che vuole solo il proprio logo è un effetto
    collaterale non richiesto.

    **Conseguenza accettata, da riaprire quando morderà**: con il catalogo la coppia
    aspetto + dispositivi resta unita, perché un marchio è un file solo. Il giorno in cui servirà
    dare a un'azienda il logo di uno e i dispositivi di un altro — o nessun catalogo — la risposta è
    separare le due cose sull'azienda invece che dentro il `brand.json`. Non si fa adesso: si sa che
    è lì.

44. **La versione sta sul progetto, non sull'azienda** (06-10-2026). Il maintainer, mentre si
    scriveva la Fase 3a: «se l'azienda ha decine di pannelli e non sono tutti aggiornati potrà
    aprire il progetto con una istanza specifica?».

    **Il timore è fondato, e in modo concreto.** Ogni scrittura di `project.yaml` passa da
    `stamp_and_serialize` (`sws-core/src/project.rs:1956`), che marchia il progetto con la versione
    del runtime che l'ha scritto; `needs_update()` è letteralmente
    `saved_by != runtime_version()`. Quindi aprire con un IDE più nuovo e salvare una virgola
    timbra il progetto con la versione nuova — e da lì il deploy su un pannello rimasto indietro è
    una scommessa, perché in più punti il formato usa `deny_unknown_fields` e un campo nato dopo
    non viene ignorato: fa fallire il caricamento.

    **L'azienda è l'unità sbagliata.** Quello che si deploya su un parco di pannelli è il
    **progetto**, e due progetti della stessa azienda possono vivere su parchi diversi.

    Quindi: il **progetto** porta la sua versione, l'**azienda** fissa il predefinito per i progetti
    nuovi e il tetto massimo. Il dato per progetto **non va inventato**: è `saved_by`, che esiste
    già, e il pulsante «⚠ Aggiorna progetto» — oggi solo un avviso che il progetto viene da un
    runtime diverso — diventa il gesto deliberato con cui si porta avanti un progetto *e i suoi
    pannelli*, quando sono pronti.

    **Il costo operativo, precisato dal maintainer lo stesso giorno**: il gateway dovrà saper
    avviare **più versioni insieme**, e su ghcr **le release restano, le immagini di prova no** —
    «le immagini di test si possono potare, solo le release saranno fissate dal momento in cui
    andremo in produzione». Quindi l'impegno è limitato e sostenibile: non tutte le immagini per
    sempre, solo quelle rilasciate, e solo da quando c'è qualcuno in produzione.

    **Regola che ne discende, e va applicata dove si sceglie la versione**: un progetto può essere
    legato solo a una **release**, mai a una `rc` né a un tag di commit. Quelle si potano, e un
    progetto legato a un'immagine potata non si riapre più. Il selettore della console e il gateway
    devono offrire solo release; un progetto che arrivasse marchiato con una `rc` va trattato come
    «da aggiornare», non come «da avviare su quella rc».

45. **I marchi si configurano dalla console, logo compreso** (06-10-2026). Corregge la decisione
    43, che aveva scelto un catalogo preparato a mano **proprio per evitare i caricamenti**.
    Richiesta del maintainer: «nella console prevedi il concetto di branding, che deve essere un
    menù a parte in cui configuro i brand (che di fatto sono stili grafici e default dell'IDE) e
    poi nella gestione delle aziende associo ad ogni azienda un brand».

    **Dove vivono**: `<config_dir>/branding/<id>/`, con lo stesso schema del catalogo dispositivi —
    quelli del prodotto restano nell'immagine, quelli dell'installazione in configurazione, e a
    parità di identificativo vince l'utente (`catalogo.rs`, `Radici::trova`). Così i marchi che si
    spediscono restano e quelli creati sopravvivono agli aggiornamenti.

    **Il logo si può caricare, SVG compreso, e non serve ripulirlo.** Il fatto che lo permette:
    il logo si disegna con `<img src=…>` (`BrandLogo.tsx:15`), e uno script dentro un SVG **non
    viene eseguito** quando l'SVG è caricato come immagine — gira solo se il file è aperto come
    documento, cioè navigandoci sopra o dentro un `iframe`. Quella strada si chiude servendo i file
    dei marchi da una **rotta nostra** invece che da `ServeDir`, con
    `Content-Security-Policy: default-src 'none'; sandbox` e `X-Content-Type-Options: nosniff`:
    neutralizza gli script anche a chi ci naviga sopra apposta, e costa un'intestazione invece di
    un sanificatore di SVG — che sarebbe stato un lavoro a sé, con una superficie d'errore sua.

    **Conseguenza da non dimenticare**: quella rotta dev'essere **pre-auth**, perché la schermata
    di accesso mostra il logo prima che esista un token. Va quindi nella lista bianca di
    `check_rotte_preauth.sh`, con il motivo — ed è l'unica rotta aperta che serve file scrivibili
    da fuori, quindi è anche quella su cui l'elenco delle estensioni ammesse e il limite di
    dimensione contano davvero.

### Prerequisito: aggiornamento automatico del runtime (27-09-2026, sera)

Chiesto dal maintainer come parte di questo piano, poi **spostato in un piano suo** perché propedeutico
(«facilita lo sviluppo futuro») e chiudibile da solo, senza VPS né aziende:
[2026-09-27-aggiornamento-runtime-e-bus-utente](../archive/2026-09-27-aggiornamento-runtime-e-bus-utente.md). Le decisioni
prese qui (numerate 30-35) vivono lì. **Va fatto prima** dei pezzi di questo piano: la VPN e l'abbinamento
toccano lo stesso installer, e con gli aggiornamenti i pannelli seguono le versioni nuove senza SSH.

### Ancora aperto

- Il **rischio più grosso non ancora misurato**: il ciclo completo su un pannello vero — codice
  mostrato, profilo ritirato in HTTPS, riavvio, OpenVPN in TCP/443 verso un'istanza per azienda,
  IDE in container che raggiunge la 8444 attraverso il tunnel. Va provato a mano **prima** di
  scrivere il gateway: se un pezzo non regge (per esempio l'`auth-user-pass` obbligatorio, o il
  firewall di un sito), cambia il disegno.
- Il conflitto di significato già visto il 14-09 va ricontrollato: `ide_only` oggi vuol dire «nessuna
  autenticazione». Nel container dietro il gateway deve voler dire «l'autenticazione la fa il
  gateway», e le due cose non vanno confuse.
- Gli utenti d'impianto (Q54) nel nuovo quadro.
- Il resto è nell'elenco della conversazione e verrà riportato qui man mano che si decide.

**Quando il lavoro partirà, la prima cosa resta una sessione di plan approfondita**: questa è la prima,
non l'ultima.


---

## Vincoli dal CRA — 05-10-2026

Dalla [gap analysis CRA](2026-10-05-cra-gap-analysis.md), punto 1 («senza utenti il pannello è aperto, un'istanza
IDE non ha mai password»), integrato qui su richiesta del maintainer perché è lo stesso lavoro. Il CRA (Reg. UE
2024/2847, Allegato I parte I) chiede prodotti **sicuri per impostazione predefinita** (lettera b) e **protetti da
accessi non autorizzati** con autenticazione e gestione delle identità (lettera d), con le misure **dall'11-12-2027**
per ciò che si immette sul mercato da allora. Non è un parere legale (vedi la gap analysis).

### Misurato il 05-10-2026

- `senza_autenticazione(ide_only, ha_utenti) = ide_only || !ha_utenti` (`sws-web/src/router.rs`): un **pannello
  senza utenti** serve tutto con un Admin sintetico; un'**istanza IDE** non chiede mai la password (Q56).
- Il TC620 di prova (rc.22, senza utenti) risponde `200` senza login su `:8444/api/projects` e `:8444/metrics`.
- Sul **router completo** (IDE, e un pannello lanciato senza `--no-admin`) sono **pre-auth sempre**, anche con utenti:
  `/api/projects` (lista e creazione), `open`, `rename`, `duplicate`, `DELETE /api/projects/:name`, `close`,
  `upload`, `/api/fs/browse-dirs`, `/api/fs/mkdir`, `/api/templates`, `/api/catalogo/dispositivi…`, `/metrics`,
  `/cert` (blocco `project_lifecycle` + `open` in `build()`). Motivo dichiarato nel codice: la schermata iniziale le
  chiama prima che esista una sessione. Sul pannello con `--no-admin` la stessa gestione sta in `deploy_only_app`
  dietro `require_admin`, che però **passa** quando non ci sono utenti.
- Già in linea col CRA: password **argon2**, **limite ai tentativi** di login (`sws-auth`), ruoli
  Viewer/Operator/Admin, `auth.login`/`auth.login_failed`/`auth.users_replaced` nel registro di audit a catena
  firmata, guardia «il primo utente di un dispositivo è un Admin» (14-09), `applica_seed_di_recupero`.

### Come si incastra con le decisioni del 27-09

| Decisione del 27-09 | Cosa aggiunge il CRA |
|---|---|
| 12, 14 — codice di abbinamento mostrato sul pannello e nella pagina locale | **Deciso il 05-10-2026**: lo stesso meccanismo **è** il primo accesso. Al primo avvio il pannello genera un codice monouso, lo mostra sullo schermo LVGL e sulla pagina locale, e finché non viene usato non entra nessuno nemmeno in lettura; chi lo inserisce nell'IDE rivendica il pannello e fissa la prima credenziale. Spariscono l'Admin sintetico e `senza_autenticazione()`, e non nasce nessuna password di fabbrica |
| 19 — email e password, 2FA TOTP opzionale | Copre la lettera d per l'IDE ospitato; **2FA** è un buon argomento nella valutazione del rischio |
| 21, 22 — utenti d'impianto nel progetto e «locali» sul pannello, account cloud separati, pannello usabile senza internet | Il pannello deve avere **sempre** un'autenticazione propria, anche offline: coerente. Manca il caso «pannello appena installato, nessun progetto»: oggi è aperto |
| 26 — il gateway (`--gateway`) fa login e instradamento | Per l'IDE ospitato il requisito è soddisfatto dal gateway: `ide_only` dietro il gateway = «l'autenticazione la fa il gateway» (già annotato in «Ancora aperto») |
| 27 — solo cloud, self-host tenuto possibile (riscritta il 05-10-2026) | Finché è solo cloud l'IDE è un servizio e sta fuori dal CRA; il requisito «nessun IDE senza autenticazione» resta per ragioni sue, non del regolamento. Il giorno in cui il container self-host viene consegnato, diventa un prodotto e servono gli obblighi da fabbricante — compresa l'**opzione 2 di Q56** (utenti dell'installazione), che quindi non è cancellata ma rimandata |
| 29 — prima i pezzi che toccano il codice condiviso e servono anche in locale | I vincoli CRA sono proprio di questo tipo: si possono fare **prima** del gateway e della VPN |

### Cosa serve (vincoli, non ancora un disegno)

1. **Nessun accesso amministrativo anonimo sul pannello**, nemmeno senza progetto o senza `users.yaml`.
2. **Nessun IDE senza autenticazione** quando è raggiungibile da altri (installabile o ospitato).
3. **Rotte pre-auth ridotte a una lista bianca esplicita** (login, `health`, `cert`, il minimo per la schermata
   iniziale), con un test che fallisca se se ne aggiunge una; `/metrics` autenticato o solo su loopback.
4. **Recupero** documentato (credenziale persa) che non riapra il pannello a tutti: oggi c'è
   `applica_seed_di_recupero`, da rileggere con questo vincolo.
5. **Ripristino di fabbrica** degli account e dei segreti insieme ai dati (CRA lettera m), che riporti al primo
   accesso sicuro e non a un pannello aperto.

### Il primo pezzo — e perché l'ordine è cambiato (05-10-2026)

La proposta era: **primo accesso del pannello** (punto 1) e **lista bianca delle rotte pre-auth** (punto 3) — piccoli,
in locale, prima di VPS e VPN, in linea con la decisione 29.

Il maintainer ha dato un'altra ragione, che viene prima di quella tecnica: «il prossimo step che mi interessa è
l'implementazione utenti/aziende/spazi di lavoro … vorrei mostrare il lavoro tramite un sito web ad alcune possibili
aziende facendo capire la strada che ha preso il progetto. È sempre un PoC quindi non mi serve una compliance CRA
pesante ma i meccanismi chiave tipo la registrazione degli utenti, la 2FA e un po' di infrastruttura base mi servono».

**Quindi il primo pezzo è il tronco cloud** — registrazione, aziende, spazi di lavoro, 2FA — e non il pannello. Non è
in conflitto con la proposta di prima: il primo accesso (decisione 4 del CRA, ormai presa) e la lista bianca delle
rotte pre-auth **sono lo stesso lavoro visto dall'altro lato**, e un IDE che sta per vivere su un dominio pubblico non
può accendersi senza. Entrano quindi nel primo pezzo invece di precederlo.

**Il criterio per tutto il resto**, parole sue: «la CRA deve rimanere un po' sul fondo come linea guida». Non è il
programma di lavoro: è il metro con cui si giudicano scelte che hanno un'altra ragione. Vedi
[gap analysis CRA](2026-10-05-cra-gap-analysis.md) §7, decisione 5.

**La prima cosa della sessione di plan resta una sessione di plan**: 29 decisioni, più queste, più la contraddizione
sulla 27 qui sopra. Niente codice prima.


---

## Dalla scheda Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Poter ospitare l'editor su un sito web, con una pagina di configurazione
dell'hosting: utenti, il concetto di **azienda** e dei suoi utenti, il **branding** relativo, e un
minimo di parametrizzazione — numero di progetti e spazio per utente — da estendere in seguito.

### Perché è la questione più grande aperta finora

Non aggiunge una funzione: cambia **cosa è** SWS. Oggi è un programma che si installa accanto a un
impianto; questo lo rende un servizio che ospita gli impianti di più clienti sullo stesso server. Le
cose che oggi funzionano perché c'è un solo cliente smettono di funzionare tutte insieme.

### Cosa il modello attuale dà per scontato, verificato sul codice

| Oggi | Perché non regge in multi-azienda |
|---|---|
| `users.yaml` sta **dentro la directory del progetto** (`sws-auth/src/lib.rs:5`) | Gli utenti appartengono a un progetto. Qui devono stare **sopra** i progetti: un utente dell'azienda A ha più progetti |
| Ruoli `Viewer < Operator < Supervisor < Admin`, per progetto | Manca del tutto il livello «di chi è questo progetto» |
| **Modalità senza utenti**: nessun `users.yaml` ⇒ tutto è Admin senza token (`router.rs:663-673`) | Su un host pubblico è fatale. Va resa impossibile, non solo sconsigliata |
| Un runtime ha **un** progetto attivo (`--projects-root`, `.active-project`) | N aziende × M progetti non entrano in «un progetto attivo» |
| Il branding è **per installazione**: `public/branding/active.json` sceglie un marchio per tutta la SPA servita | La richiesta è branding **per azienda**: la stessa SPA deve mostrarsi diversa a clienti diversi |
| Nessuna nozione di quota | Da costruire: dove si contano i progetti, dove si misura lo spazio, e cosa succede al superamento |
| I segreti viaggiano col progetto in chiaro (decisione 2026-08-20) | Su un disco condiviso fra clienti è una decisione da riesaminare, non da ereditare |

### Opzioni

1. **Un piano di controllo separato**, davanti a N runtime (uno per azienda o per progetto): la
   tenancy, le quote e il branding vivono lì; il runtime resta quello che è. Isolamento forte,
   pezzo nuovo da scrivere e da mantenere.
2. **Estendere il runtime a multi-progetto e multi-utente**: un solo processo che serve tutti.
   Meno parti, ma tocca autenticazione, storage e ogni endpoint, e un difetto di isolamento diventa
   un incidente fra clienti.
3. **Ibrido**: un piano di controllo sottile solo per aziende/utenti/quote/branding, con i runtime
   per progetto avviati su richiesta.

### Le domande da sciogliere

1. **Isolamento**: oggi la separazione fra progetti è il filesystem e un processo. Quale garanzia si
   promette a un cliente sul fatto che un altro non veda i suoi dati?
2. **Dove vive lo stato di tenancy.** Non dentro un progetto — sta sopra. Serve un archivio nuovo.
3. **Le quote dove si fanno rispettare.** Contare i progetti è facile; misurare lo spazio mentre uno
   storico cresce da solo è un'altra cosa. E cosa succede quando si supera: si blocca la scrittura?
   si ferma lo storico? Un impianto che smette di registrare perché è finito lo spazio è un guasto.
4. **Backup e ripristino per azienda**, non per progetto come oggi.
5. **La licenza.** Vedi la sezione dedicata qui sotto: è la parte che il maintainer ha portato
   avanti per prima, e la premessa da cui era partita si è rivelata sbagliata.
6. **Il perimetro del «minimo per iniziare».** Il maintainer ha detto numero di progetti e spazio per
   utente, poi si estende. Vale la pena scrivere quali estensioni si prevedono, perché lo schema dei
   dati si progetta una volta sola.

### La licenza — verificato il 2026-09-07

Il maintainer ha chiesto se esistano licenze che permettano di offrire il servizio **senza obbligo
di rilasciare il sorgente**. Quello che segue sono fatti misurati, non un parere legale: prima di
muoversi serve un avvocato.

#### La premessa della domanda non regge

**L'AGPL vincola chi *riceve* il software, non chi lo possiede.** Il titolare dei diritti non può
violare una licenza che è lui a concedere: Soligonet che ospita codice di Soligonet non deve niente
a nessuno. L'obbligo scatterebbe per *altri* che avessero ricevuto il codice sotto AGPL e lo
ospitassero a loro volta.

Quindi, per il solo scopo «ospitare senza pubblicare», **non serve cambiare licenza**.

#### E il codice è già stato distribuito

Il maintainer riteneva di non aver distribuito nulla. Misurato il 2026-09-07:

| | |
|---|---|
| `github.com/soligolab/sws` | **pubblico** dal 2026-05-10 (`visibility: public`, licenza dichiarata AGPL-3.0) |
| `ghcr.io/soligolab/sws-runtime:latest-arm64` | **scaricabile da chiunque** con un token anonimo (HTTP 200) |
| Fork | **0** — stelle 2, watcher 0 |

Chiunque abbia preso una copia conserva i diritti AGPL **su quelle versioni, in modo
irrevocabile**: non si può richiamare indietro. In pratica però l'esposizione è teorica — nessuno
ha forkato in quattro mesi.

Questo **non** impedisce di cambiare licenza alle versioni **future**: chi è titolare unico può
rilasciare la 2.7.0 sotto qualunque licenza voglia. Il passato resta com'è.

#### Titolarità e dipendenze: nessun ostacolo tecnico

- **Un solo autore umano.** 382 commit `Mauro Soligo <mauro@soligo.net>` più 2 `pixsysedp
  <edp@pixsys.net>`, che sono la stessa persona su due macchine. Nessun contributore esterno.
- **Nessuna dipendenza impone AGPL o GPL.** Scansionati **577 crate** Rust e **319 pacchetti** npm:

  | Licenza | Dove | Effetto |
  |---|---|---|
  | MIT / Apache-2.0 / ISC / BSD | la grande maggioranza | nessun vincolo |
  | MPL-2.0 | `async-opcua*` (9 crate), `serialport` | copyleft **per file**: si pubblicano le modifiche *a quei file*, ma si possono collegare a software proprietario. **Non blocca** |
  | `unescaper` — `GPL-3.0/MIT` | 1 crate | doppia: si sceglie MIT |
  | `r-efi` — `MIT OR Apache-2.0 OR LGPL` | 2 crate | si sceglie MIT |
  | npm | 319 pacchetti | **zero copyleft** |

#### Le opzioni, e cosa comprano davvero

| | Cosa | Cosa ottieni | Cosa perdi |
|---|---|---|---|
| 1 | **Lasciare AGPL** | Ospiti lo stesso: sei il titolare | Chi vuole includere SWS in un prodotto proprietario non può, e molti uffici legali industriali vietano l'AGPL in blocco |
| 2 | **Doppia licenza** (AGPL + commerciale) | Il pubblico resta AGPL; vendi la commerciale a chi la vuole | Richiede di restare titolare unico: servirebbe un CLA al primo contributore esterno |
| 3 | **MIT sulle versioni future** | Chiunque può usarlo e includerlo ovunque, senza attriti legali | **Chiunque può anche ospitarlo come servizio concorrente e non deve niente** |
| 4 | **Proprietaria sulle versioni future** | Controllo massimo | Nessuna adozione esterna; e il fork AGPL pubblico resta comunque disponibile |

#### L'esigenza, precisata dal maintainer (2026-09-07)

> «La mia esigenza è offrire il **servizio**, non offrire i sorgenti: gli utenti useranno il mio
> servizio e stop.»

Con questa precisazione la questione licenza **esce dal percorso critico di Q44**: l'esigenza è già
soddisfatta oggi, senza cambiare niente.

- Gli utenti del servizio **non ricevono codice** — è software come servizio, non distribuzione.
- L'unico appiglio dell'AGPL su questo caso è l'uso in rete (§13), e ricade su **chi opera sotto
  licenza**, cioè su un licenziatario. Il titolare dei diritti non è licenziatario di se stesso.

Quindi Q44 si può progettare e costruire **senza aspettare la decisione sulla licenza**. Restano da
decidere solo cose che riguardano altri scopi:

| Se un domani si vuole… | Serve |
|---|---|
| impedire ad **altri** di ospitare SWS come servizio | non MIT — semmai doppia licenza o proprietaria sulle future |
| togliere attrito ai clienti che vogliono **integrare** il codice | MIT o simile |
| solo ospitare, come oggi | **niente** |

#### Orientamento del maintainer (2026-09-07)

**MIT**, motivato dall'essere unico autore. Registrato come orientamento, non come decisione.

Due cose da pesare prima di renderlo definitivo, dette una volta e senza insistere:

- **MIT concede molto più di quanto lo scopo richiedesse.** L'obiettivo era «ospitare senza
  pubblicare», che la titolarità già garantisce (opzione 1). Con MIT, chiunque — un concorrente,
  un cliente, Pixsys — può prendere SWS, ospitarlo come servizio a pagamento e non restituire
  niente. Se un domani Q44 diventa un prodotto, è la licenza che protegge meno.
- **Ma c'è un argomento pratico forte a favore**, in questo settore: molti reparti acquisti e uffici
  legali industriali **vietano l'AGPL** per contratto. Se l'obiettivo è che i clienti possano
  integrare SWS senza una revisione legale, MIT toglie un attrito reale che l'AGPL crea. Vale la
  pena dire a voce alta se è *questa* la ragione, perché allora MIT è la scelta giusta e non un
  eccesso.

#### Cosa resta da chiedere a un avvocato

1. **Esiste un contratto con Pixsys** che renda parte del lavoro commissionato? La nota di progetto
   dice che Pixsys è cliente e non proprietaria, ma è un fatto contrattuale non verificabile dal
   codice.
2. **I contributi generati dall'IA**: i termini di Anthropic assegnano l'output all'utente, ma lo
   stato del diritto d'autore su output di IA non è uniforme fra giurisdizioni. Tende a *ridurre* la
   protezione, non a creare un terzo che rivendica.
3. **Il cambio di licenza va fatto bene**: `LICENSE`, il campo `license` nei quattro manifesti, le
   intestazioni dei file se ce ne sono, e una nota che dica da quale versione vale.

### Rapporto con le altre voci

- **Q26** (server MCP) e il piano della chat IA: entrambi partono dal presupposto «la chat vive solo
  sul PC di sviluppo». Se l'editor diventa ospitato, quel presupposto cade e va rifatto il ragionamento.
- **Q17**, **Q27**: i confini di scrittura sono stati chiusi assumendo un solo cliente.

### Default per il PoC

Nessuno: oggi l'editor si installa, non si ospita. **La licenza non è un prerequisito**: vedi la
precisazione del 2026-09-07 qui sopra.

### Decisa

`not yet`


---

## Dalla scheda Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

*Aperta l'11-09-2026, come conseguenza dichiarata della decisione dello stesso giorno («gli
utenti appartengono al progetto, il deploy li porta»). Il maintainer l'ha nominata lui stesso:
«esiste il caso futuro in cui nel progetto utente sia implementata una vista per
creare/modificare gli utenti, e in quel caso gli utenti del dispositivo potrebbero differire da
quelli del progetto».*

**Context.** Dall'11-09-2026 il deploy sostituisce `users.yaml` sul dispositivo con quello del
progetto, con una casella per saltarlo. Oggi gli account nascono in un solo posto — la tab
Utenti dell'IDE, dentro il progetto — quindi il dispositivo non ha nulla di suo e sostituire non
perde niente. Il giorno in cui esisterà il componente sinottico «gestione utenti», un capo turno
creerà un operatore **sul pannello**: quell'account vive solo lì, e il deploy successivo lo
cancella. La casella «Sostituisci anche gli utenti» copre il caso solo se chi preme il pulsante
**sa** che sul pannello sono nati account — cioè si ricorda di una cosa che non ha fatto lui.

**Options.**

1. **Come oggi: la casella, a mano.** Zero codice in più. Il deploy resta una scelta consapevole,
   ma dipende dalla memoria di chi lo fa; l'errore è silenzioso e irreversibile.
2. **Fusione per username.** Il deploy porta gli utenti del progetto e **tiene** quelli del
   dispositivo che il progetto non nomina. Nessuna perdita accidentale, ma un utente **rimosso**
   dal progetto non sparisce più dal pannello: una revoca non arriva a destinazione, che è il
   caso in cui contare sul deploy serve di più.
3. **Marcatura «utente locale».** `users.yaml` distingue chi è nato dal progetto da chi è nato sul
   dispositivo (un campo, es. `origine: dispositivo`); il deploy sostituisce i primi e non tocca i
   secondi. Copre entrambi i casi — la revoca arriva, l'operatore creato in reparto resta — al
   prezzo di un campo nel formato e della sua migrazione, e della domanda «di chi è la password»
   quando un username esiste da tutt'e due le parti.
4. **Il pannello rifiuta il deploy** finché qualcuno non riconcilia a mano, mostrando le
   differenze. Nessuna perdita, ma un deploy che si blocca su un impianto in servizio è peggio
   del problema.

**Default for PoC.** Opzione 1: la casella esiste, il componente «gestione utenti» no. Finché gli
account nascono solo nel progetto, il caso non si presenta. La scheda serve a non decidere per
inerzia quando quel componente si farà: è **quella** la sessione in cui va scelta la 2 o la 3,
non dopo il primo account perso.

**Decided:** not yet.


---

## Dalla scheda Q56 — Un IDE non si autentica più: `users.yaml` governa il dispositivo, non l'editor

*Aperta il 14-09-2026 come conseguenza dichiarata della correzione dello stesso giorno
(`docs/archive/2026-09-14-primo-utente-non-chiude-fuori.md`). Imparentata con **Q44** (ospitare l'editor come
servizio) e **Q54** (un dispositivo che crea utenti propri).*

**Context.** Il maintainer ha definito il primo utente di un progetto dall'IDE — `user`, ruolo
Operator, pensato per il pannello — e l'IDE si è chiuso fuori dal proprio progetto: scrivere
`users.yaml` accende l'autenticazione **nello stesso runtime** che serve l'editor, il token che
l'editor porta in modalità senza utenti è un sentinella che il server non ha mai emesso, e
l'unico account esistente era un Operator, che l'IDE non ammette (`permissions.ts`). Il progetto
è diventato irraggiungibile senza spostare il file a mano.

La causa non è un difetto isolato: **un elenco di utenti, due consumatori**. Lo stesso
`users.yaml` per-progetto governa il dispositivo (dove è giusto: viaggia col deploy, protegge
l'impianto) e il runtime dell'IDE che tiene quel progetto aperto (dove non serve a niente, perché
l'IDE è il posto da cui quegli utenti si **scrivono**).

**La correzione del 14-09** taglia il nodo dal lato utile subito: su un'istanza IDE
(`AppState.ide_only`, cioè nessun `--viewer-port`) la porta admin resta in modalità senza utenti
comunque, e in `create_user` una guardia impedisce che il primo account di un **dispositivo** sia
non-Admin. Decisione del maintainer, presa esplicitamente quel giorno: *«sarebbe un utente per il
dispositivo target, non per l'IDE»*.

**Cosa resta aperto — il prezzo.** Un IDE **raggiungibile in rete** ora non ha password, e in modo
permanente invece che solo finché non si definiscono utenti. Sul PC di sviluppo è `localhost` e la
cosa non si nota; su un host esposto è esattamente ciò che Q44 chiama «fatale», e quella riga della
tabella di Q44 ora descrive una condizione **più ampia** di prima.

**Options.**

1. **Lasciarlo com'è** — l'IDE è un programma da PC di sviluppo, si protegge col fatto di ascoltare
   dove ascolta. È il default PoC, ed è coerente con «SWS si installa accanto a un impianto».
2. **Un'autenticazione dell'IDE separata da quella del progetto**: un elenco di utenti
   dell'installazione (non del progetto), che governa chi apre l'editor, indipendente dal
   `users.yaml` che viaggia col deploy. È la forma piccola della risposta di Q44 (utenti **sopra**
   i progetti) e si può costruire prima del resto.
3. **Riattivare l'autenticazione dell'IDE quando non è locale** — per esempio quando il listener
   non è su loopback, o dietro una variabile d'ambiente esplicita. Rimette in piedi il guasto di
   oggi se qualcuno definisce un Operator come primo utente su un'istanza così, a meno di
   estendere lì anche la guardia sul primo Admin.

**Default for PoC.** Opzione 1. Il prezzo è scritto qui perché non venga riscoperto per caso, e la
risposta vera è la 2, che nasce dentro Q44 e non prima.

**Decided:** not yet.
