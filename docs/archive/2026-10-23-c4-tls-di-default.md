# C4 — TLS acceso di default sul pannello

> **FATTO il 25-10-2026, archiviato.** Pezzo 1 (lo schema non scritto a mano) il 23-10; pezzo 2 (generatore unico
> col nome vero, rotte remote, audit) col piano dei certificati; pezzo 3 il 25-10: il pannello Pixsys che ha il
> certificato del dispositivo e gira in chiaro **propone** l'HTTPS con quello, col comando da lanciare, e ricorda un
> «no». La scadenza col rinnovo firmato vive nel suo seme. Collaudo in `COLLAUDI_IN_SOSPESO.md` §A-bis.

> **Misurato sul codice il 23-10-2026.** La voce C4 di
> [`2026-10-15-piano-prima-fascia-e-cra.md`](../plans/2026-10-15-piano-prima-fascia-e-cra.md) è marcata
> `[plan]` e la sua domanda aperta sta alla riga 64 di quel file: «come arriva la fiducia nel
> certificato del pannello (pinning all'abbinamento?)». Questo file porta la misura, il pezzo
> già fatto, e le domande che restano al maintainer.
>
> Il piano CRA dice che C4 e **P6** (2FA/LDAP) condividono una sola sessione di plan. Resta vero
> per il pezzo 3; i pezzi 1 e 2 no, e il pezzo 1 è già chiuso.

## Com'è fatto oggi, in una riga

Il TLS si accende perché **esiste un file**, e per nient'altro: `main.rs:517`, «se
`config/tls.crt` c'è, parti in TLS». Nessun flag, nessuna variabile d'ambiente, nessuna riga di
configurazione — `grep SWS_TLS` nel repo non trova niente. E **nessuno semina mai quel file**: la
funzione che genera un certificato esiste in due copie gemelle (`main.rs:2186` e
`system.rs:1000`) ma la chiamata nel runtime sta **dentro** l'`if ...exists()`, cioè serve solo a
riparare un certificato illeggibile, mai a crearne il primo. L'unico seme vero è
`POST /api/system/tls/generate`, il pulsante nella card dell'IDE.

## Quello che c'è già, ed è più di quanto sembrasse

- **Il motore della fiducia è finito e condiviso.** `sws_core::pin_tls` prova **prima** le
  autorità pubbliche (serve al gateway con Let's Encrypt) e solo se falliscono applica la fiducia
  al primo contatto per impronta SHA-256, rifiutando se l'impronta cambia. Lo usano tre
  consumatori indipendenti con tre archivi: l'IDE verso i dispositivi, il plugin MQTT, il viewer
  LVGL. Il «dimentica» c'è come rotta e come pulsante, e **non è mai automatico**.
- **mDNS annuncia già lo schema** (`scheme` nelle TXT, `https` quando la proprietà manca): la
  scoperta è già pronta a un pannello in HTTPS.
- **Il pannello ha già un segreto mostrato fisicamente**: il codice di abbinamento, 80 bit,
  monouso, su schermo, log, installer e pagina locale.
- **Il ramo Yocto è già scritto per HTTPS**: unit, installer e launcher. Lì C4 è quasi solo
  allineare la realtà alla documentazione.

## Pezzo 1 — lo schema non si scrive più a mano — **FATTO** (23-10-2026)

Ramo `fix/c4-schema-non-cablato`. Non cambia il comportamento di un pannello in chiaro, e
**correggeva un difetto vivo**, non un rischio futuro.

Il controllo di salute delle due immagini chiedeva `/health` solo in chiaro, e il quadlet del
runtime ha `Notify=healthy`: il servizio risulta avviato solo quando quel comando passa.
Accendere il TLS dall'IDE non si vedeva subito — `system_reboot` è un `exec()` in posto e systemd
non vede nessun riavvio — ma al **primo riavvio vero** l'unità non sarebbe mai diventata sana, e
con `Restart=always`/`RestartSec=5` il pannello sarebbe ripartito ogni cinque secondi. Un
aggiornamento sarebbe tornato indietro da solo.

Con lui gli altri tre punti cablati: il **browser del pannello** (puntato su `http://` contro una
porta che parla TLS), l'**installer del container** (indirizzi in chiaro, due sonde su tre mute),
e il **ripiego del viewer LVGL** (sapeva cambiare porta, non schema — e il suo quadlet si riscrive
solo quando un operatore lo conferma). Guardia: `scripts/check_schema_tls.sh`.

**Quello che il pezzo 1 ha lasciato fuori di proposito**: il `PublishPort` e il `--http-port` per
la pagina «accetta il certificato» sul pannello. Una misura dice di metterlo, l'altra osserva che
su uno schermo senza tastiera una pagina da leggere non è una risposta. È la domanda 2 qui sotto,
non un dettaglio.

## Pezzo 2 — il certificato — da fare, insieme al piano dei certificati

I due generatori gemelli diventano uno, perché nome e scadenza vanno cambiati una volta sola.
Oggi il certificato è **`CN=rcgen self signed cert` su ogni pannello del mondo** e **non scade
mai** (rcgen: 1975 → 4096). Il piano
[`2026-10-15-certificati-in-un-posto-solo.md`](../archive/2026-10-15-certificati-in-un-posto-solo.md) ha già
deciso nome vero e scadenza breve (decisioni 5-6) e dichiara che avviso e rinnovo sono lavoro di
C4. Mancano anche i tre eventi di audit (`tls.generate`, `tls.upload`, `tls.remove`) e le rotte
`/api/remote/system/tls`, che quel piano chiama «il presupposto di C4».

**Già fatto di questo pezzo**: le rotte `/api/remote/system/tls` (decisione 2, ramo
`fix/certificati-2-tls-remoto`); i tre eventi di audit più i due OPC-UA (decisione 7, ramo
`fix/certificati-7-ruoli-e-audit`); il **generatore unico con il nome vero** (decisione 5, ramo
`feat/c4-certificato-con-un-nome`).

**Resta solo la scadenza**, e il maintainer l'ha sciolta il 23-10-2026 scegliendo **due anni con
rinnovo automatico**: il pannello annuncia l'impronta nuova firmandola con la vecchia, così il
giro del «dimentica» a ogni rinnovo non esiste. Avviso in tre posti: barra dell'IDE, allarme di
sistema, email.

**Non è una variante, è un protocollo**, e ha un seme suo:
[`2026-10-23-rinnovo-del-certificato-firmato.md`](../plans/2026-10-23-rinnovo-del-certificato-firmato.md).
Il punto duro misurato: l'archivio tiene solo `sha256:<hex>`, e **da un'impronta non si verifica
una firma**. **La scadenza si mette dopo che il rinnovo esiste**, e il rinnovo viene dopo la
prova sul TC620.

Stima: 200-300 righe per il generatore unico, più 300-400 per rinnovo e avviso.

## Pezzo 3 — il default acceso, e la fiducia — **FATTO il 25-10-2026** (disegno qui sotto)

Stima 400-700 righe più la sessione di plan vera. **Quando questo lavoro comincia, il primo passo
è una sessione di plan dedicata e approfondita** per sviscerarne i dettagli: fra la domanda e il
lavoro passa troppo tempo perché un disegno scritto oggi resti vero.

### Le risposte del maintainer, 23-10-2026

| | Domanda | Scelta |
|---|---|---|
| **1** | Chi accende il TLS di default | **Solo il ruolo «pannello»** — l'istanza che non ha né `--gateway` né `--auth-delegata`. Il ruolo si legge già dalla riga di comando, e accenderlo per tutti spegnerebbe il cloud |
| **2** | Il browser del pannello davanti all'autofirmato | **Si prova sul TC620 prima di decidere.** È l'unica incognita che il codice non risponde |
| **3** | Come arriva la fiducia (riga 64) | **TOFU, ma l'IDE mostra l'impronta** appena memorizzata, perché chi vuole la confronti con quella sullo schermo. Il modello di SSH: nessun accoppiamento fra archivi, niente da digitare |
| **4** | I pannelli già installati | **Si accende su tutti, con un marcatore** in `config/` che distingue «non ha mai scelto» da «ha scelto no». Stessa regola di compatibilità appena applicata alla policy OPC-UA |

**La 3 è fatta** (ramo `feat/c4-impronta-mostrata`): `POST /api/remote/connect` restituisce
l'impronta del certificato del dispositivo e dice se è stata memorizzata **adesso**, e la scheda
Connessione la mostra — in giallo al primo contatto, in grigio quando era già conosciuta. Su
`http://` non compare niente, perché non c'è nessuna identità da verificare.

**La 2 blocca il resto, e questa macchina non la può sciogliere.** La sessione gira su
`theobroma`, che il TC620 non lo raggiunge: va provata da una macchina che lo vede, e **prima di
qualunque SSH va chiesto al maintainer**. Finché non è provata, le risposte 1 e 4 non si possono
mettere in codice: seminare un certificato al primo avvio su un pannello il cui browser poi non
lo accetta vuol dire uno schermo con un interstiziale al posto del sinottico.

**Cosa provare sul TC620, esattamente** — scritto per esteso, con gli altri collaudi in sospeso, in [`docs/COLLAUDI_IN_SOSPESO.md`](../COLLAUDI_IN_SOSPESO.md) §A: accendere il TLS dalla card, riavviare il pannello, e
guardare cosa fa `chromium@main-app.service` davanti a `https://127.0.0.1:7443` con un
autofirmato. Il launcher è di PixsysOS e riceve **solo un URL via D-Bus**: nel repo non c'è un
solo flag di chromium, quindi la via «gli passiamo un argomento» va verificata prima di
prometterla.

### La misura sul TC620 (24-10-2026) — la domanda 2 ha la sua risposta, e una strada nuova

Fatta da casa, sul TC620 con la **2.20.0** (`ceb2ac46…`), seguendo i collaudi in sospeso §A.

- **Accensione**: `POST /api/system/tls/generate` sulla porta di gestione (7444) → 204. Il runtime è passato
  a HTTPS **senza ricreare il container** (riavvio interno), `healthy`; la 7443 risponde solo in HTTPS, e
  **chromium è già puntato su `https://127.0.0.1:7443`**: lo schema non si scrive più a mano (pezzo 1) regge.
- **Lo schermo** (osservato dal maintainer): l'interstiziale **«La connessione non è privata»**; toccando
  **Procedi** si arriva al sinottico. Quindi l'autofirmato **non** passa da solo, ma non è un vicolo cieco.
  Chromium però gira con `--incognito`: la scelta «Procedi» con ogni probabilità **non si ricorda**, e
  l'interstiziale tornerebbe a ogni avvio del browser (il riavvio di verifica non è stato fatto).
- **Fotografare lo schermo da remoto non si può**: `weston-screenshooter` risponde `unauthorized`.
- **Dove il browser potrebbe fidarsi**: `/` è squashfs in sola lettura, ma `/home` è un overlay
  **persistente** e scrivibile da `user`; chromium ha già il suo archivio NSS in
  `/home/user/.pki/nssdb`, e sul pannello c'è `certutil`.

**La scoperta: PixsysOS ha già un certificato del dispositivo di cui il browser si fida** (indicazione
del maintainer). In `/mnt/protected/ssl/`:

| | |
|---|---|
| Certificato | `<seriale>.server.crt` (`CN=p052600c00292600014`, fino al 2076, `TLS Web Server Authentication`) |
| Nomi | `localhost`, `tc620-a-p3-c6-07aff9.local`, `127.0.0.1` — copre l'URL del kiosk |
| Catena | `Pixsys Issuing CA 2026` → `Pixsys Root Certification Authority 2026`; file pronto `<seriale>-chain.server.crt` |
| Fiducia | la root è **già** nell'NSS di `user` (`PixsysRootCA`, `C,,`) e nello store di sistema |
| Chiave | `<seriale>.server.key`, **`root:root 0600`**: `user`, e quindi il runtime rootless, non la legge |

**Come la usa PixsysPortal**: `pixsys-portal.service` è un'unità di **sistema** che gira come root; il suo
`ExecStartPre` (`install-pixsys-portal-certs.sh`) crea due link simbolici, `server.pem` → la catena e
`server.key` → la chiave, col seriale letto da `/proc/device-tree/serial-number`. **Non c'è un meccanismo
per le applicazioni utente**: il Portal la legge perché è root.

**Le strade, per la decisione del maintainer** (non prese):

1. **Un'unità di sistema nostra**, sul modello del Portal, installata una volta con `sudo`, che a ogni
   avvio rende certificato e chiave leggibili al runtime (es. in `/data/user/sws/config/`, `0640`, gruppo di
   `user`). SWS servirebbe la 7443 con la catena del dispositivo: **niente interstiziale e niente NSS
   da toccare**. Contro: la chiave privata del dispositivo esce dalla partizione protetta, ed è la stessa del
   Portal; e l'installer di SWS oggi non chiede mai `sudo`, di proposito.
2. **Il ripiego senza root**: certificato nostro, aggiunto come fidato nell'NSS di `user` con `certutil`.
   Funziona su ogni pannello Linux con chromium; è un certificato nostro, non del dispositivo; il TOFU
   dell'IDE (risposta 3) resta com'è.
3. **Chiedere a chi fa PixsysOS** un modo previsto: un gruppo con lettura della chiave, o un servizio che
   firmi con la CA del dispositivo un certificato per le applicazioni utente. La strada migliore, ma non
   dipende da noi.

Sui pannelli che non sono Pixsys la strada 1 non esiste: lì vale la 2, o il loopback in chiaro.

**Decisione del maintainer (24-10-2026), e prova**: in via eccezionale, un passaggio di installazione
**opzionale** che copia certificato e chiave del dispositivo con `sudo`, entrando come `pixsys`
(`deploy/container/certificato-dispositivo.sh`, HOWTO §29). La domanda a chi sviluppa PixsysOS (strada 3)
resta aperta, e il maintainer l'ha annotata. Provato sul TC620: catena convalidata contro la sola root
Pixsys, `healthy` dopo un riavvio a freddo con `NRestarts=0`, e **sinottico senza avvisi** sullo schermo.

### Le domande per il maintainer

**1. Chi accende il TLS di default?** Ogni istanza dell'immagine, o solo il ruolo «pannello»?
Il ruolo si legge già dalla riga di comando (`--gateway`, `--auth-delegata`), e **accenderlo per
tutti spegne il cloud**: il gateway raggiunge i container dei progetti su `http://…:8444` scritto
a mano (`gateway/progetti.rs:250,254`), e davanti c'è già Traefik che termina il TLS.

**2. Il browser del pannello davanti al proprio certificato autofirmato, su uno schermo senza
tastiera.** Loopback in chiaro (zero codice, ma è un'eccezione da dichiarare nel fascicolo CRA),
certificato installato nell'archivio di fiducia del pannello (la risposta pulita, ma è lavoro su
PixsysOS e il filesystem è in sola lettura fuori da `/data`), o un flag a Chromium (che oggi
riceve **solo un URL via D-Bus**: nel repo non c'è un solo flag di chromium). **È l'unica
incognita che il codice non risponde, e va provata sul TC620 prima di prometterla.**

**3. Come arriva la fiducia nel certificato — la domanda di riga 64.** Oggi l'impronta viene
memorizzata **prima** che il codice di abbinamento venga chiesto: al primissimo collegamento un
attaccante sulla rete viene memorizzato come legittimo. Le strade: lasciare il TOFU e **mostrare**
l'impronta appena memorizzata perché chi vuole la confronti con quella sullo schermo (una
ventina di righe, è il modello di SSH); una **conferma a vista obbligatoria** al primo contatto
(~150 righe più il punto dove il pannello mostra la sua impronta); oppure **legare l'impronta al
codice di abbinamento** (~400 righe, e un vincolo nuovo fra due archivi oggi indipendenti —
rigenerare il certificato dovrebbe rigenerare il codice, che è anche la chiave dell'abbinamento
al cloud).

**4. I pannelli già installati.** L'aggiornamento accende il TLS su di loro, solo sulle
installazioni nuove, o su tutti ma con un **marcatore** in `config/` che distingue «non ha mai
scelto» da «ha scelto no»? La terza è venti righe ed è la stessa regola di compatibilità appena
applicata alla policy OPC-UA, dove ha funzionato.

**5. La scadenza, e chi si era già fidato.** Il piano dei certificati ha scelto «uno o due anni
con avviso e rinnovo». La misura aggiunge un dettaglio che lì non c'era: **ogni rinnovo rompe il
pinning di chiunque si fosse già fidato**, perché il verificatore confronta l'impronta della
foglia e basta. Così com'è, ogni due anni ogni IDE e ogni viewer LVGL del campo mostra
«certificato cambiato» e qualcuno deve premere «dimentica».

### La scelta sul browser (25-10-2026)

Davanti alle tre strade (cert del dispositivo, nostro autofirmato nell'NSS di Chromium, kiosk in chiaro sul
loopback) il maintainer ha scelto: **il TLS di default si accende solo dove c'è il certificato del dispositivo**,
di cui il browser del pannello si fida già. Dove non c'è (pannelli non Pixsys, o Pixsys senza il passaggio
opzionale) resta com'è oggi: si accende a mano dalla vista dei certificati. Così nessun pannello si accende con un
interstiziale al posto del sinottico. Con questa scelta tutte le domande del pezzo 3 hanno risposta.

### Il disegno del pezzo 3 (sessione di plan del 25-10-2026)

**Il limite, prima di tutto**: il runtime **non può** accendere da solo il certificato del dispositivo. La chiave è
`root:root 0600` e il container gira rootless come `user`; solo il passaggio con `sudo`
(`certificato-dispositivo.sh`, HOWTO §29) la può copiare. «Acceso di default» diventa quindi **proposto di
default, a un comando di distanza, con la scelta ricordata**:

| Pezzo | Cosa |
|---|---|
| **L'installatore** | su un Pixsys con `/mnt/protected/ssl/<seriale>-chain.server.crt` scrive `config/certificato-dispositivo` (il percorso della catena); altrove lo toglie. Gira anche nell'aggiornamento dei quadlet (`--solo-unita`), quindi raggiunge i pannelli già installati |
| **Il marcatore** (risposta 4) | `config/tls-scelta`: assente = «non ha mai scelto», `no` = «ha scelto no». Lo scrive il «No, resta in chiaro» della proposta e lo scrive **«Rimuovi»** del certificato: togliere l'HTTPS è una scelta esplicita |
| **Chi propone** (risposta 1) | solo il ruolo pannello: né IDE (`ide_only`), né gateway (`regia`), né container di progetto (`segreto_gateway`) |
| **Quando propone** | ruolo pannello, TLS spento, certificato del dispositivo segnalato, marcatore diverso da `no` — funzione pura `proposta_tls`, con test |
| **Il comando** | il runtime copia lo script dall'immagine in `config/` (la cartella che l'host vede, come fa l'aggiornamento dei quadlet), e la proposta mostra quel percorso sull'host, da lanciare come `pixsys` |
| **Dove si vede** | nella card TLS (Sicurezza → Certificati, colonna del pannello): spiegazione, comando da copiare, «No, resta in chiaro» |
| **Rotte** | `GET /api/system/tls` porta la `proposta`; `POST /api/system/tls/scelta` (Admin, audit `tls.choice`), col gemello remoto |

Fuori: la fiducia nell'NSS di Chromium e il loopback in chiaro (strade non scelte), e i pannelli non Pixsys, che
restano a mano.

## Ordine

**C4 prima, vista Certificati dopo.** Lo dice il piano dei certificati di sé stesso: la decisione
2 è «il presupposto di C4», le decisioni 5-6 sono «lavoro di C4, non della vista». Costruire la
vista prima vorrebbe dire costruirla due volte.
