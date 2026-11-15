# Le funzioni di `tyx_panelcontrol`: quali portare nel pannello di controllo di SWS

**Piano, 14-11-2026.** Il maintainer, dopo l'elenco di cosa fa il setup di Pixsys sul Tiny TY: «procediamo con il
plan, no seme, partiamo valutando funzione per funzione cosa fa, come si adatterebbe a sws e poi decidiamo se
importarla e se può essere estesa a tutti i prodotti».

Il punto di partenza è il [pannello di controllo](2026-11-13-pannello-di-controllo.md) (rete, Wi-Fi, ora, schermo,
info, riavvio) e la decisione del 12-11 di far fare a SWS quello che sul Tiny TY faceva `tyx_panelcontrol`
([SWS sul Tiny TY](2026-10-30-sws-lvgl-sul-tiny-ty.md), passo 5).

Questo file ha due fasi:
1. **la valutazione**: cosa fa ogni funzione e come entrerebbe in SWS;
2. **le decisioni del maintainer**: per ognuna, se si importa e su quali prodotti.

Dopo la seconda fase, quello che si importa diventa lavoro qui sotto; quello che si scarta resta scritto col
perché.

## Cos'è `tyx_panelcontrol` (misurato sul TY570, 14-11-2026, sola lettura)

- **Il programma:** un'app LVGL 9 in C, statica, che gira come root ed è tradotta in 10 lingue. Accanto ci sono
  12 script Python (2111 righe) che fanno il lavoro sul sistema. In tutto sono 4,9 MB in `/data/tyx_panelcontrol`.
- **All'accensione** `rc.local` sceglie: un tocco entro 2 s apre la `gui` (il setup); altrimenti parte senza schermo e
  tiene UPS, cicalino, retroilluminazione e i servizi del PLC.
- **Oggi sul TY570 gira, senza schermo, accanto a SWS** (misurato il 14-11: processo di root acceso da 10 ore,
  `rc.local` righe 360-367). L'ipotesi del 12-11 («`tyx_panelcontrol` non parte») non è quello che succede: SWS
  tiene lo schermo, lui tiene UPS e servizi. `startup.ini` dice `ups enabled=1, reboot_only=1`, `beep=1`, `timer=0`.
- **Timer systemd suoi:**
  - `tyx-chrony-estimate` stima la deriva di chrony;
  - `tyx-rtc-sync` tiene allineato l'orologio interno (RTC) in entrambi i modi di chrony;
  - `O20010.04.pixsys.auto-rebooter` riavvia PixsysPortal.
- **Configurazione:**
  - `data/tyx_panelcontrol.ini`: rotazione, lingua, dimensione del registro;
  - `data/startup.ini`: servizi, beep, oscuramento, UPS, WiFi Fast Setup;
  - `data/tyx_panelcontrol.users`: utenti e ruoli;
  - `data/tyx_panelcontrol.audit`: il registro delle attività.
- **Menu principale** (dalle stringhe del binario):
  - Ethernet, WLAN, Orologio;
  - Touch, Rotazione display, Lingua;
  - Informazioni, Backup, Utenti, Registro attività, Riavvia;
  - inoltre File, Mail, VPN, Servizi (PLC, PageLab, VNC, web server, Device Finder, PixsysPortal), UPS e NFC.

I prodotti di SWS, per la colonna «tutti i prodotti»:
- **TC/WP**: PixsysOS, podman rootless, Cockpit come via di fuga. Luce e beep li tiene il sistema.
- **Tiny TY**: Ubuntu 22.04, systemd, utente `sws`.
- **PC Linux generico**: Debian o Ubuntu.

## Fase 1 — la valutazione, funzione per funzione

Legenda della raccomandazione: **sì** (importare), **forse** (dipende da una risposta), **no** (resta a Pixsys o
non serve).

### 1. Orologio: server NTP scelti a mano

- **Cosa fa sul TY:** offre due modi.
  - Automatico: i server NTP dati dal DHCP (letti da NetworkManager), altrimenti una lista di riserva.
  - Manuale: da 1 a 4 server, nomi o IP, controllati.
  
  `chrony_sources.py` scrive `/run/chrony/*.sources` e chiede a chrony di rileggerli, senza riavviarlo. La pagina
  mostra la sorgente in uso, il peer e lo scarto in ms.
- **Noi oggi:** solo NTP acceso o spento. Sul Tiny TY quell'interruttore passa per `chrony_control.py --set` (`8e049bda`).
- **Come entrerebbe:** una sezione «Server NTP» con automatico e manuale (1-4 server) e lo stato della sincronizzazione.
  - Sul **Tiny TY** con `chrony_sources.py`: una seconda regola sudoers, come quella dell'orologio.
  - Su un **PC** con timesyncd, scrivendo `/etc/systemd/timesyncd.conf.d/sws.conf`. Serve root, quindi un piccolo
    aiutante con sudoers o polkit.
  - Su **TC/WP** da misurare: quale demone NTP ha PixsysOS e chi lo configura.
- **Perché serve:** un impianto senza internet ha il suo server NTP (il PLC, il server di stabilimento). Oggi su un
  pannello isolato l'interruttore NTP non serve a niente.
- **Raccomandazione:** **sì**, su tutti i prodotti dove si misura un modo pulito.

### 2. Orologio: formato di data e ora, primo giorno della settimana

- **Cosa fa sul TY:** impostazioni della sua interfaccia (24/12 ore, ordine della data, lunedì o domenica).
- **Noi:** il formato lo decide la lingua del progetto, e il progetto può già fissare i formati degli oggetti.
- **Raccomandazione:** **no** nel pannello di controllo. È un'impostazione di progetto, non del dispositivo.

### 3. Touch e retroilluminazione: beep, oscuramento, luminosità

- **Cosa fa sul TY:**
  - beep al tocco acceso o spento (PWM3);
  - dopo N secondi senza tocchi abbassa la luce a una percentuale;
  - calibrazione del touch a 5 punti in `/etc/pointercal`.
- **Noi oggi: c'è già quasi tutto.** `schermo.rs` e la sezione `pannello` del progetto fanno:
  - la luminosità;
  - l'oscuramento dopo N minuti, con percentuale (`dimmed_brightness`);
  - lo spegnimento dopo M minuti, con il primo tocco che non preme;
  - il beep con frequenza, durata e volume.
  
  Nel pannello di controllo: luce e calibrazione dei resistivi. Valgono dove l'installazione passa
  `--retroilluminazione` e `--cicalino`, cioè oggi il Tiny TY.
- **Due padroni:** sul TY570 anche `tyx_panelcontrol` è acceso, con `beep=1`. Luce e cicalino li toccano in due. Da
  provare se il beep suona doppio; l'oscuramento di Pixsys è spento (`timer=0`), quindi lì non c'è conflitto oggi.
- **La differenza vera:** da noi oscuramento e beep stanno nel **progetto**, sul TY nel **dispositivo**.
- **Domanda:** devono poter cambiare anche dal pannello di controllo, come regolazione locale che vince sul
  progetto? Oggi la luce funziona così (la sezione Schermo scrive sul dispositivo).
- **Raccomandazione:** **forse**.
  - Il minimo utile: nella sezione Schermo l'interruttore del beep e il tempo di oscuramento, come regolazione locale.
  - Il resto resta nel progetto.
  - Su TC/WP luce e beep sono di PixsysOS: lì non si mostrano, come oggi.

### 4. Rotazione dello schermo

- **Cosa fa sul TY:** 0/90/180/270 in `tyx_panelcontrol.ini`. `rotation_control.py` cambia in modo transazionale anche
  lo script di LogicLab (`runLLExec.sh`). Il TY570 di prova è a `rotation=270`.
- **Noi:** **non c'è.** Il viewer LVGL disegna solo in orizzontale. Il piano del Tiny TY (12-11) dice «non urgente, ma
  nessuna scelta deve impedirla».
- **Come entrerebbe:** due pezzi.
  - Un lavoro di viewer: `lv_display_set_rotation`, il touch ruotato, la cornice e il progetto disegnati per un
    pannello verticale.
  - Un'impostazione: del dispositivo (come montato fisicamente) oppure del progetto (pagine pensate in verticale).
  
  La rotazione fisica è del dispositivo; un progetto verticale è un'altra cosa (la misura del sinottico).
- **Prodotti:** Tiny TY e PC con viewer LVGL. Su TC/WP il browser lo ruota PixsysOS (da verificare).
- **Raccomandazione:** **sì, ma come piano a sé**. È lavoro di motore grafico, non di pannello di controllo.
- **Deciso dal maintainer il 15-11-2026:** «il progetto deve nascere nella IDE in landscape o portrait e poi nel
  device posso settare la rotazione 180 gradi». Quindi le due cose restano separate:
  - **l'orientamento è del progetto**: orizzontale o verticale, scelto nell'IDE alla nascita. Le pagine si disegnano
    già nel verso giusto, e il viewer ruota di 90° da sé quando il progetto è verticale;
  - **il dispositivo ha una sola scelta**: capovolto o no (180°), nel pannello di controllo, per com'è montato.
    Niente 90/270 scelti sul dispositivo.
  
  Da rivedere con la rotazione, perché fatti prima: l'angolo che riavvia (gli angoli sono calcolati sullo schermo non
  ruotato) e l'immagine di avvio del Tiny TY (il file raw è scritto nel verso del framebuffer).
- **L'angolo che riavvia segue il disegno, non il vetro** (maintainer, 15-11-2026): «deve rispettare il nome tipo alto
  a sinistra, riferito al disegno della pagina e adattarsi di conseguenza alla rotazione del dispositivo». «In alto a
  sinistra» è l'angolo in alto a sinistra della pagina come la vede chi sta davanti: con il progetto verticale o il
  dispositivo capovolto, l'angolo fisico cambia e il nome no. Vale anche per l'angolo che apre il pannello di
  controllo e per il riquadro di anteprima.

### 5. Wi-Fi: IP statico, canale del punto di accesso

- **Cosa fa sul TY:** sul Wi-Fi permette DHCP o IP statico (IP, maschera, gateway, 2 DNS), rete nascosta, e il canale
  dell'access point.
- **Noi:** il Wi-Fi c'è (scansione, connessione, password sbagliata, reti salvate, hotspot). L'IP statico esiste solo
  sulle schede cablate.
- **Come entrerebbe:** la stessa scheda IPv4 della sezione Rete applicata alla connessione Wi-Fi attiva, via
  NetworkManager, con la stessa conferma entro 60 s. Il canale dell'hotspot è un campo in più.
- **Prodotti:** tutti quelli con NetworkManager.
- **Raccomandazione:** **sì** l'IP statico, **no** il canale (nessuno l'ha chiesto, NetworkManager lo sceglie da solo).

### 6. WiFi Fast Setup (configurazione dall'hotspot del telefono)

- **Cosa fa sul TY:** con `fast_wifi.py` e `captive_portal.py`:
  1. il dispositivo si collega a un hotspot del telefono con nome e password noti;
  2. un portale guida la configurazione dal telefono;
  3. l'USB resta spenta fino a quel momento (GPIO116).
- **Noi:** l'abbinamento all'IDE e il QR di abbinamento fanno un altro lavoro.
- **Raccomandazione:** **no**. È un percorso Pixsys di messa in servizio, e spegne l'USB: proprio quello che il 13-11
  ci ha lasciato senza strada locale.

### 7. UPS: riavvio pulito a corrente mancata

- **Cosa fa sul TY:** legge il GPIO36 (ingresso di mancanza rete, con `edge`). Quando scatta:
  1. spegne la luce (`bl_power`);
  2. manda SIGTERM all'applicazione e aspetta al massimo 4 s;
  3. `sync` e `reboot`.
  
  Opzioni: abilitato, «solo riavvio», un'applicazione da fermare.
- **Noi:** niente, ma **la protezione oggi c'è**: `tyx_panelcontrol` gira senza schermo e sorveglia il GPIO36
  (`direction=in`, `edge=both`, misurato il 14-11). Con `reboot_only=1` chiama `/sbin/reboot`, e systemd ferma
  `sws-runtime` con SIGTERM come in un riavvio normale. La prima stesura di questo piano diceva «protezione
  spenta»: era sbagliato.
- **Cosa resta da verificare:** che il runtime, al SIGTERM, chiuda lo storico entro il tempo che l'UPS concede (da
  chiedere a Pixsys quanti secondi tiene), e cosa succede a corrente mancata davvero (una prova col TY).
- **Come entrerebbe:** un sorvegliante nel runtime che legge il GPIO e, quando scatta:
  1. chiude lo storico (flush) e le sorgenti;
  2. fa `sync`;
  3. riavvia o spegne.
  
  Il GPIO lo dice l'installazione, come `--cicalino`. Nel pannello di controllo resterebbero solo abilitato, cosa fare
  e uno stato.
- **Prodotti:** il GPIO è del Tiny TY. Su TC/WP e PC da chiedere: esiste un segnale di mancanza rete? Per i PC con UPS
  USB c'è NUT, ma è un altro mondo.
- **Raccomandazione:** **no finché `tyx_panelcontrol` resta acceso**: lo fa già lui. Si fa la verifica qui sopra. Il
  sorvegliante nel runtime serve solo se un giorno `tyx_panelcontrol` si spegne, o su un prodotto senza di lui.

### 8. File: server SFTP e cartella di rete SMB

- **Cosa fa sul TY:**
  - un server SFTP con utenti dedicati, confinati in `/data/sftp` (`file_sftp_gate.py`, PAM);
  - il montaggio di una cartella SMB/CIFS in `/data/network`.
- **Noi:** niente. Lo storico si esporta già dall'IDE e dal viewer; i backup passano dall'IDE e dal cloud.
- **Raccomandazione:** **no** per ora. Un caso d'uso possibile c'è: esportare lo storico su una cartella di rete. Se
  servirà, sarà una funzione di SWS (destinazione di esportazione), non un montaggio di sistema.

### 9. Mail (SMTP2GO)

- **Cosa fa sul TY:** configura e prova l'invio di posta per le applicazioni Pixsys.
- **Noi:** le notifiche di SWS hanno i loro canali, configurati nel progetto.
- **Raccomandazione:** **no**.

### 10. VPN di PixsysPortal

- **Cosa fa sul TY:** la registrazione al portale con password monouso e l'avvio all'accensione.
- **Noi:** il gateway e il cloud di SWS fanno l'accesso remoto.
- **Raccomandazione:** **no**. È un servizio Pixsys.

### 11. Servizi: PLC, PageLab, VNC, web server, Device Finder, PixsysPortal

- **Cosa fa sul TY:**
  - l'avvio all'accensione di CODESYS, LogicLab, OPC UA, PageLab, VNC (con password), web server e HTTPS, Device
    Finder, PixsysPortal;
  - la cancellazione del progetto PLC dopo l'arresto dei servizi (`plc_control.py`).
- **Noi:** niente, e sono tutti prodotti Pixsys. Li accende `tyx_panelcontrol`, che oggi gira senza schermo accanto
  a SWS.
- **Raccomandazione:** **no** nel pannello di SWS. La **domanda a Pixsys** (punto 5 di `ty570-1ad-p1.md`) diventa una
  conferma: questa convivenza (lui senza schermo per servizi e UPS, SWS sullo schermo) è quella voluta?

### 12. Informazioni

- **Cosa fa sul TY:** numero di serie, versione dell'immagine, versione hardware, kernel, Ubuntu, MAC delle schede.
- **Noi:** modello, numero di serie, nome, versione di SWS. I MAC stanno già nelle schede della sezione Rete.
- **Come entrerebbe:** versione del sistema (`/etc/os-release`), kernel (`uname`) e, dove c'è, l'immagine del
  costruttore (`/etc/pixsys/device.info` sul TY; da vedere su TC/WP).
- **Prodotti:** tutti.
- **Raccomandazione:** **sì**, piccolo. Serve a chi chiama l'assistenza.

### 13. Utenti e ruoli del pannello

- **Cosa fa sul TY:** utenti propri con ruoli (oggi `pixsys` e `ut5`), creazione, modifica e cancellazione.
- **Noi:** il PIN di servizio, deciso il 13-11 apposta al posto degli utenti.
- **Raccomandazione:** **no**. È una decisione già presa.

### 14. Registro delle attività, esportazione su USB

- **Cosa fa sul TY:** registra chi ha cambiato cosa (le password no), con un tetto in MB, e lo esporta su una chiavetta
  USB (monta la partizione in `/run/tyx-audit-usb-*`).
- **Noi:** le azioni del pannello di controllo vanno già nell'audit di SWS (`control_panel.time`,
  `control_panel.reboot`…), che si legge dall'IDE.
- **Raccomandazione:** **no** l'esportazione su USB, almeno per ora. Il registro c'è già.

### 15. Lingua dell'interfaccia

- **Cosa fa sul TY:** dieci lingue, scelte nel pannello.
- **Noi:** il pannello di controllo parla la lingua del contenuto del progetto, in inglese se manca.
- **Raccomandazione:** **no**.

### 16. Backup

- **Cosa fa sul TY:** una voce del menu principale. Dalle stringhe non si capisce cosa salvi: solo l'etichetta, in
  cinque lingue.
- **Raccomandazione:** **da guardare a schermo** prima di decidere: serve il setup aperto, cioè un tocco
  all'accensione. Attenzione, entrare nel setup cancella il WiFi Fast Setup (`ty570-1ad-p1.md`, punto 11). Senza un
  caso d'uso, **no**.

### 17. NFC EEPROM

- **Cosa fa sul TY:** avvio all'accensione di un servizio NFC di Pixsys.
- **Raccomandazione:** **no**.

### 18. Orologio interno e deriva (timer di chrony e RTC)

- **Cosa fa sul TY:**
  - `tyx-rtc-sync` tiene l'RTC allineato all'ora di Linux;
  - `tyx-chrony-estimate` salva la deriva misurata in modo `monitor`.
  
  Sono timer systemd, **non** dipendono dalla `gui`.
- **Noi:** niente da fare: girano anche con `tyx_panelcontrol` spento (verificato: `active waiting`).
- **Raccomandazione:** **no**. Si annota solo che ci sono.

## Riassunto della raccomandazione

| # | funzione | raccomandazione | prodotti |
|---|---|---|---|
| 1 | server NTP scelti a mano e stato | **sì** | tutti, dove si misura un modo pulito |
| 5 | IP statico sul Wi-Fi | **sì** | tutti con NetworkManager |
| 12 | versioni di sistema in Info | **sì** | tutti |
| 4 | rotazione dello schermo | **sì, piano a sé** | Tiny TY, PC LVGL |
| 3 | beep e oscuramento anche dal pannello | **forse** | dove SWS tiene luce e cicalino |
| 7 | UPS, riavvio pulito a corrente mancata | **no**, lo fa già `tyx_panelcontrol`; solo una verifica | Tiny TY |
| 16 | Backup | da guardare | — |
| 2, 6, 8-11, 13-15, 17, 18 | il resto | **no** | — |

## Da misurare prima di scrivere codice

- **TC620 / WP630** (serve il permesso per l'SSH):
  - quale demone NTP c'è e come si configurano i server;
  - dove sta la versione dell'immagine PixsysOS;
  - se esiste un ingresso di mancanza rete.
- **Tiny TY:**
  - la voce «Backup» a schermo;
  - il comportamento di `chrony_sources.py` lanciato dall'utente `sws` (proprietario di `/run/chrony`).

## Fase 2 — le decisioni del maintainer

### Prima sessione, 14-11-2026

**La premessa che cambia il piano.** Parole del maintainer: «tyx_panelcontrol verrà eliminato quando tutto il lavoro
sarà completo. Nei prodotti wp/tc l'ups non è monitorato ma avvia lo shutdown di sistema e ha energia per uno
spegnimento controllato».

Quindi la convivenza di oggi (lui senza schermo, SWS sullo schermo) è provvisoria, e il criterio non è più «cosa ci
manca nel setup» ma **«cosa smette di funzionare sul Tiny TY il giorno che `tyx_panelcontrol` sparisce»**. Tutto
quello che fa senza schermo va preso da SWS oppure dichiarato perso.

| # | funzione | decisione |
|---|---|---|
| 7 | UPS | **si importa sul Tiny TY**: senza `tyx_panelcontrol` nessuno sorveglia il GPIO36. Su TC/WP non serve: l'UPS avvia lo spegnimento del sistema e ha energia per finirlo; a SWS basta chiudersi bene al SIGTERM |
| 1 | server NTP a mano | **sì**, tutti i prodotti |
| 5 | IP statico sul Wi-Fi | **sì**, tutti i prodotti |
| 12 | versioni di sistema in Info | **sì**, tutti i prodotti |
| 3 | beep e oscuramento | **restano nel progetto**; niente di nuovo nel pannello di controllo |
| 4 | rotazione dello schermo | **piano a sé, dopo questo** |

### Cosa fa `tyx_panelcontrol` senza schermo, da sostituire prima di eliminarlo

Misurato il 14-11 (`rc.local`, `startup.ini`, i percorsi nel binario):

| cosa | oggi | senza di lui |
|---|---|---|
| UPS (GPIO36) | riavvio a corrente mancata | **da fare in SWS** (punto 7) |
| beep al tocco e luce | li tocca anche lui (`beep=1`) | resta solo SWS, che li fa già: sparisce il doppio padrone |
| calibrazione del touch | `/etc/pointercal`, 5 punti | SWS ha la sua calibrazione dei resistivi (da collaudare) |
| avvio dei servizi Pixsys | Device Finder acceso, gli altri spenti (`startup.ini`) | **da decidere**: nessuno li accende più |
| alimentazione USB all'avvio | `rc.local` riga 184: `fast_wifi.py boot` (GPIO116) | **da fare**: qualcuno deve accendere l'USB, o le chiavette Wi-Fi restano spente |
| chrony | `chrony.service` è sostituito da `chrony_control.py --run`; l'interruttore NTP di SWS chiama `--set` | **da decidere**: se spariscono anche i file, chrony non parte e l'interruttore NTP di SWS non ha più cosa chiamare |
| timer RTC e deriva | `tyx-rtc-sync`, `tyx-chrony-estimate` | unità systemd che chiamano `chrony_control.py --sync-rtc` e `--save-estimate` (verificato): senza i file falliscono |
| server NTP dal DHCP | `/etc/NetworkManager/dispatcher.d/20-tyx-chrony` chiama `chrony_sources.py` | senza i file fallisce a ogni cambio di rete |

**L'orologio è il nodo.** `chrony.service` ha due drop-in di Pixsys (`90-tyx-clock.conf`, `95-tyx-mode.conf`) che
sostituiscono l'avvio con gli script di `/data/tyx_panelcontrol`. «Eliminare» può voler dire due cose: non far
partire il programma (i file restano, l'orologio continua a funzionare), oppure togliere anche la cartella (e allora
SWS deve rimettere chrony su una configurazione sua: drop-in rimossi, server, `rtcsync`).

### Seconda parte della sessione, 14-11-2026

| tema | decisione |
|---|---|
| cosa vuol dire «eliminato» | **via tutto, SWS autonomo**: sparisce anche `/data/tyx_panelcontrol`. L'installatore di SWS rimette chrony su una configurazione propria e accende l'USB |
| UPS sul Tiny TY | **come Pixsys, fisso**: spegne la luce, chiude storico e sorgenti, salva su disco, riavvia. Nessuna impostazione; attivo dove l'installazione indica l'ingresso |
| servizi Pixsys | **interruttori nel pannello di SWS**: una sezione Servizi che accende e spegne le unità Pixsys presenti, **su tutti i prodotti Pixsys**. Il maintainer, stessa sessione: «molti servizi sono simili anche sui prodotti tc/wp» |

### Ancora da decidere

- **Backup** (punto 16): da guardare a schermo, prima che il setup Pixsys sparisca.
- **Chi toglie `tyx_panelcontrol`** e come: è avviato da `/etc/rc.local` di Pixsys (righe 360-367), che fa anche altro.
  Un'opzione dell'installatore, o una richiesta a Pixsys per l'immagine. Si decide al passo 7.
- **La finestra all'avvio**: oggi un tocco entro 2 s apre il setup Pixsys. Senza, la via d'emergenza è la finestra
  all'avvio del pannello di controllo di SWS, che c'è già.

## Misure sul TC620 (14-11-2026, sola lettura, `user@tc620-a-p3-c6-07aff9.local`)

Pixsys OS 2.1.3, kernel 6.12.19. Nessuna scrittura: solo elenchi, introspezione D-Bus e le chiamate `Get*`.

**Il launcher Pixsys (`net.pixsys.Config1`, che usiamo già per l'immagine di boot) espone quasi tutto**, e l'utente
`user` lo chiama senza permessi in più (le `Get*` rispondono):

| oggetto | metodi | valore oggi | a cosa serve qui |
|---|---|---|---|
| `Time` | `Get/SetCustomNTPServers(b, as)` | `false`, nessuno | **server NTP a mano** (passo 4): c'è già la chiamata |
| `Display` | `Get/SetRotation(u)` | 0 | **rotazione** (passo 8) |
| `Display` | `Get/SetIdleTimeout(u)`, `Get/SetBrightness(u)`, `IsBrightnessAvailable` | 0, disponibile | oscuramento e luce: oggi su TC/WP `pannello` del progetto non fa niente |
| `Display` | `Get/SetRemoteDesktopEnabled(b)` | `false` | VNC (sezione Servizi) |
| `Buzzer` | `Get/SetTouchFeedback(b)` | `true` | beep al tocco |
| `USBDrives` | `Export/ImportBackup`, `Export/ImportUserData`, `Export/ImportLicenses`, `GetImages`, `CheckFirmwareUpdateImage` | — | il «Backup» del punto 16, su chiavetta |
| `WebBrowser/MainApp` | `Get/SetEnabled`, `Get/SetUrl`, `Get/SetCodesysAllowUrlOverride`, tastiera a schermo | — | già noto |
| `TouchReboot` | `Get/SetActiveCorner(u)` | — | un angolo che, toccato, riavvia |
| `FactoryReset` | `FactoryReset()` | — | ripristino di fabbrica |
| `UserApps` | `Create(ss)`, `Remove(s)` | — | applicazioni dell'utente |

**I servizi** esistono come unità systemd con nomi simili a quelli del TY: `codesys-control`, `codesysedge`,
`logiclab`, `logiclab-opcua`, `finder-server`, `pixsys-portal`, `openvpn-auto-login`, `O20010.04.pixsys.auto-rebooter`.
Però `Config1` **non ha un metodo per accenderli o spegnerli**, e non c'è nessuna regola polkit che lo conceda a
`user` (gruppi: `setup-user`, `dialout`, `plugdev`, `wayland`, `seat`). Via `Config1` passa solo il VNC. Per gli
altri serve una richiesta a Pixsys (un oggetto `Services` in `Config1`) o capire come li accende Cockpit.

**Orologio**: `systemd-timesyncd`, sincronizzato; `timedated` dice `CanNTP=yes`. **UPS**: `ups-init.service` alza solo
un piedino; lo spegnimento lo fa il sistema, come detto dal maintainer.

**Cosa cambia nel piano:**
- sui TC/WP il passo 4 (NTP a mano) è una chiamata D-Bus, senza aiutante privilegiato;
- la rotazione (passo 8) sui TC/WP è già del sistema: lì basta un'impostazione;
- beep, luce e oscuramento sui TC/WP si possono finalmente comandare. La decisione «restano nel progetto» vale, ma
  si apre una domanda: il progetto li applica anche ai TC/WP tramite `Config1`?
- la sezione Servizi sui TC/WP oggi può offrire solo il VNC.

### Terza parte della sessione, 14-11-2026 (dopo le misure sul TC620)

| tema | decisione |
|---|---|
| chi toglie `tyx_panelcontrol` | **l'installatore di SWS fa tutto.** Il maintainer: «tu lavora in modo che l'installer faccia tutto, con pixsys poi vedrò come gestire backup e aggiornamenti ma l'idea è di essere svincolati dal loro tyx_panelcontrol e poter lavorare su un sistema pulito» |
| backup e aggiornamenti del sistema | li gestisce il maintainer con Pixsys: fuori da questo piano (punto 16 chiuso così) |
| servizi sui TC/WP | **non si toccano, per ora**: «sui wp/tc i runtime li gestisce il sistema operativo e non toccarli per ora». La sezione Servizi (passo 6) resta solo per il Tiny TY |
| beep, luce e oscuramento sui TC/WP | **sì**: le impostazioni `pannello` del progetto si applicano anche lì, tramite `net.pixsys.Config1` (`Buzzer.SetTouchFeedback`, `Display.SetBrightness`, `Display.SetIdleTimeout`). Passo 9 |

**Domanda del maintainer, stessa sessione**: backup su chiavetta, ripristino di fabbrica e angolo che riavvia
«possono essere controllati anche dal nostro pannello di controllo?». Sì, sui TC/WP: sono chiamate di `Config1`
(`USBDrives.ExportBackup/ImportBackup`, `FactoryReset.FactoryReset`, `TouchReboot.Get/SetActiveCorner`) e `user` le
raggiunge. Provate solo le letture: le scritture vanno provate una per una, e il ripristino di fabbrica cancella
anche SWS. Sul Tiny TY non c'è niente di equivalente.

**Deciso il 15-11-2026**: «backup su chiavetta e angolo che riavvia li voglio sul pannello di controllo». Entrano
tutti e due, sui TC/WP (passo 10). Il **ripristino di fabbrica resta fuori**: non è stato chiesto, e cancella anche
SWS.

**`rc.local` e il programma PLC (15-11-2026).** Sul Tiny TY un tocco nei 2 secondi in cui `rc.local` arriva in
fondo (con `/data/finalized` e `/data/installok` presenti) cancella `/data/plcsys/PlcCode*.bin`. L'installatore
commenta la riga che apriva il setup ma **lascia la cancellazione, per decisione del maintainer**: «è quella che
elimina il programma di collaudo che è fatto come applicazione logiclab, lascia così, credo sia corretto».

## Il lavoro

L'ordine mette prima quello che vale per tutti i prodotti e poi l'autonomia del Tiny TY, con l'eliminazione per
ultima: si toglie `tyx_panelcontrol` solo quando ogni riga della tabella «da sostituire» è coperta e collaudata.

1. **Versioni di sistema in Info** (tutti). `/etc/os-release`, kernel, e l'immagine del costruttore dove c'è
   (`/etc/pixsys/device.info`, `pixsys.info`). Web e LVGL.
2. **IP statico sul Wi-Fi** (tutti con NetworkManager). La scheda IPv4 della sezione Rete sulla connessione Wi-Fi
   attiva, con la conferma entro 60 s.
3. **L'orologio del Tiny TY su chrony di sistema.** L'installatore toglie i drop-in `90-tyx-clock.conf` e
   `95-tyx-mode.conf`, i due timer `tyx-*` e il dispatcher `20-tyx-chrony`, e scrive una configurazione di SWS:
   sorgenti in un file proprio, `rtcsync` per l'orologio interno. L'interruttore NTP torna a `timedated` come sugli
   altri prodotti, e la regola sudoers `50-sws-clock` di oggi (`8e049bda`) sparisce. Da misurare: cosa si perde
   della stima di deriva di Pixsys (`compensation.json`), e se importa.
4. **Server NTP a mano** (tutti). Automatico (DHCP, poi riserva) o manuale (1-4), più stato, sorgente e scarto.
   Un aiutante privilegiato piccolo che scrive il file delle sorgenti: chrony sul TY, timesyncd o chrony sui PC,
   TC/WP da misurare. Viene dopo il passo 3 per farlo una volta sola.
5. **UPS sul Tiny TY.** Un sorvegliante nel runtime sull'ingresso indicato dall'installazione (GPIO36 sul TY570):
   luce spenta, storico e sorgenti chiusi, `sync`, riavvio. Da misurare con una prova a corrente staccata: quanti
   secondi ci sono, e quanto impiega il runtime a chiudere. Su TC/WP niente: basta chiudersi bene al SIGTERM, e si
   verifica che succeda.
6. **Sezione Servizi** (Tiny TY e TC/WP). Elenco dei servizi presenti (Device Finder, CODESYS, LogicLab, OPC UA,
   PageLab, VNC…), acceso/spento all'avvio e stato. La capacità è sondata servizio per servizio: su un PC la
   sezione non compare. Un elenco solo di servizi conosciuti, con due modi di parlarci:
   - **Tiny TY**: unità systemd, dal runtime che gira sull'host. Da misurare quali sono davvero unità e quali
     `tyx_panelcontrol` le avvia a modo suo.
   - **TC/WP**: il runtime è in un container e sull'host non si tocca niente (vincolo del 24-09-2026), quindi via
     D-Bus: `net.pixsys.Config1` del launcher Pixsys (già usato per l'immagine di boot; espone anche
     `WebBrowser.SetCodesysAllowUrlOverride`) e, se serve, `org.freedesktop.systemd1`. Sul TC620 girano
     `codesyscontrol` e `codesysedge` (`docs/TEST_SETUPS.md`, 27-09-2026). **Da misurare sul dispositivo**: quali
     servizi ci sono, cosa espone `Config1`, e cosa l'utente `user` può accendere senza una regola polkit nuova.
7. **USB all'avvio e rimozione.** L'installatore accende l'alimentazione USB (GPIO116) con un'unità propria, poi
   toglie `tyx_panelcontrol` dall'avvio e la cartella. Collaudo completo sul TY570: riavvio, ora, Wi-Fi con
   chiavetta, corrente staccata, calibrazione, servizi.
8. **Rotazione dello schermo**: piano a sé, dopo questo. Deciso il 15-11: orientamento del progetto nell'IDE
   (orizzontale o verticale), sul dispositivo solo il capovolgimento di 180° (vedi §4).
9. **Beep, luce e oscuramento del progetto anche sui TC/WP**, tramite `net.pixsys.Config1`. Da misurare prima: le
   unità di `SetIdleTimeout` e `SetBrightness`, e se il beep di Pixsys ha solo acceso/spento (frequenza, durata e
   volume del progetto lì non avrebbero effetto, e l'IDE deve dirlo).
10. **Backup su chiavetta e angolo che riavvia nel pannello di controllo** (TC/WP), tramite `net.pixsys.Config1`.
    La capacità è sondata: dove `Config1` non c'è (Tiny TY, PC) le due voci non compaiono. Web e LVGL.
    - **Backup: rimandato** (maintainer, 15-11-2026): «il backup per PixsysOS lo vediamo in futuro perché sta
      evolvendo ed è meglio fare il lavoro su PixsysOS 2.2.0 o successivo». Il TC620 misurato ha la 2.1.3: niente
      misure e niente codice su questa versione. Quando questo piano si chiude, il punto passa in un seme. Quello
      che segue è ciò che si sapeva il 15-11-2026, da rimisurare sulla versione nuova.
    - **Backup** (rimandato, vedi sopra): esporta e importa su chiavetta (`USBDrives.ExportBackup/ImportBackup`). Da misurare prima, con
      una chiavetta nel TC620: gli argomenti delle due chiamate, cosa contiene il backup (i dati di SWS ci sono?),
      quanto dura e come `Config1` dice che ha finito o che è fallito, e cosa succede senza chiavetta.
      L'importazione sovrascrive: chiede conferma. Da decidere alla misura se entrano anche `Export/ImportUserData`
      e `Export/ImportLicenses`.
    - **Angolo che riavvia**: scelta dell'angolo, o nessuno (`TouchReboot.Get/SetActiveCorner(u)`).
      **Misurato sul TC620 il 15-11-2026** (scritture provate, valore rimesso a 1): `0` nessuno, `1` in alto a
      sinistra, `2` in alto a destra, `3` in basso a destra, `4` in basso a sinistra; da 5 in su la chiamata
      fallisce. `user` scrive senza regole nuove, e il valore finisce in `/etc/pixsys/main-config.toml`
      (`[touch_reboot] active_corner`). Il testo di Pixsys: «Press and hold display for 5 seconds at the selected
      corner to reboot the device». Non provato il tocco vero (serve un dito sul pannello): quanto è grande
      l'angolo, e se riavvia senza conferma.
    - **Angolo che riavvia anche sui Tiny TY** (richiesta del maintainer, 15-11-2026: «sarebbe da implementare
      anche nei TY»). Lì il launcher Pixsys non c'è e il tocco lo tiene il viewer LVGL: va fatto da noi, stessa
      voce nel pannello di controllo, stessi cinque valori, stessi 5 secondi. Da decidere alla scrittura dove vive
      l'impostazione (stato del dispositivo, non del progetto, come sui TC/WP) e la misura dell'angolo.

11. **Immagine di avvio del Tiny TY dall'IDE** (richiesta del maintainer, 15-11-2026: «sistema anche l'immagine di
    boot che nel TY passa per il file raw e che vorrei configurare dall'IDE»). Sui TC/WP l'IDE la imposta già,
    tramite il launcher Pixsys (`boot_image.rs`); sul TY l'immagine è un file raw. Da misurare sul TY570 prima di
    scrivere codice: dove sta il file, in che formato (misure, profondità, ordine dei colori), chi lo mostra e
    quando, e con quali permessi si scrive. Poi la stessa voce dell'IDE vale anche per il TY: il runtime converte
    l'immagine del progetto nel formato raw e la mette al suo posto.

### Fatto il 15-11-2026: l'immagine di avvio del Tiny TY (passo 11, da collaudare)

- **Misurato sul TY570** (sola lettura): `rc.local` di Pixsys, presto nell'avvio, fa `cat /data/plc/bootlogo.raw >
  /dev/fb0` se il file c'è (`/data/screen.sh`). Formato: BGRA a 32 bit, la misura dello schermo — sul TY570
  **1024×600** (2 457 600 byte), non 800×480 come dice il commento di `rc.local`. Il file oggi non c'è: l'immagine
  di fabbrica è nessuna immagine. `/data/plc` è di root.
- **L'IDE non cambia**: la pagina di boot abilitata del progetto e il suo PNG c'erano già (T-72). Cambia solo
  l'ultimo passo: dove il lanciatore dichiara `SWS_BOOT_IMAGE_RAW`, il runtime non chiama il launcher Pixsys ma
  converte il PNG (scalato e ritagliato alla misura del framebuffer, letta da
  `/sys/class/graphics/fb0/virtual_size`) e scrive `config/boot-image/bootlogo.raw`.
- **L'installatore** fa di `/data/plc/bootlogo.raw` un collegamento a quel file; un logo già presente va in
  `/var/lib/sws-pixsys-backup/bootlogo.raw` e `--uninstall` lo rimette.
- «Ripristina l'immagine di fabbrica» nell'IDE, sul TY, toglie il file.
- **Da collaudare**: un progetto con una pagina di boot abilitata mandato al TY570, poi un riavvio. Da guardare
  anche quanto resta a schermo prima che parta il viewer (l'avvio dura circa 21 s).

### Fatto il 15-11-2026: l'angolo che riavvia (passo 10, da collaudare)

- **Dove vive.** Sui TC/WP è del sistema (`Config1.TouchReboot`): il pannello di controllo lo legge e lo scrive, e
  il comportamento resta quello di Pixsys. Sul Tiny TY lo sorveglia il viewer LVGL (il lanciatore del runtime
  dichiara `SWS_REBOOT_CORNER_BY_VIEWER=1`) e sta in `config/control_panel.json`, stato del dispositivo che un
  deploy non riscrive.
- **Sul Tiny TY è configurabile**, come chiesto dal maintainer dopo aver provato il TC620 («l'angolo è una
  porzione di video di circa 2 cm di lato, non chiede conferma per il riavvio… sul TY potresti mettere
  configurabili questi aspetti assieme al tempo di pressione»): tempo di pressione 2-15 s, lato dell'angolo
  40-200 px, conferma sì/no. I valori di partenza sono quelli di Pixsys: 5 s, 100 px, nessuna conferma.
- **Il lato è in pixel**, non in centimetri: il viewer non conosce la misura fisica dello schermo. 100 px sono
  circa 2 cm sul TY570 (7", 800×480).
- **In alto a destra non si può scegliere**: è l'angolo che apre il pannello di controllo. Il runtime lo rifiuta
  su tutti i prodotti; se il sistema Pixsys ce l'ha già, si vede e si può cambiare.
- **Il tocco** passa dallo stesso meccanismo del gesto che apre il pannello: un dito fermo nell'angolo è
  trattenuto, l'anello (rosso) mostra l'avanzamento, e rilasciato prima diventa un tocco normale per il progetto.
  A pannello di controllo aperto l'angolo non vale.
- **Il riavvio** lo chiede il viewer con `systemctl reboot` (logind, che l'installazione concede a `sws`); con la
  conferma, la domanda resta 15 s e poi sparisce.
- API: `GET /api/control-panel/display` porta anche `reboot_corner` e `reboot_corner_options`,
  `PUT /api/control-panel/reboot-corner`, capacità `reboot_corner`. Web e LVGL.
- **Da collaudare**: sul TY570 tutto (la scheda nel pannello, l'anello, il riavvio con e senza conferma, un
  bottone del progetto nell'angolo); sul TC620 la scheda nel pannello web e che l'angolo scelto sia quello che
  riavvia.
- **Da sapere**: un bottone del progetto tenuto premuto più del tempo scelto dentro l'angolo riavvia il
  dispositivo. È il motivo per cui parte da «nessuno».

### Fatto il 14-11-2026 (ramo `fix/sfondi-alla-misura`, da collaudare sul TY570)

I passi 3, 5 e 7 insieme, perché togliere `tyx_panelcontrol` senza UPS e USB lascerebbe il TY scoperto:

- **`deploy/tiny-ty/remove-panelcontrol.sh`**, lanciato da `install.sh` prima dei servizi. Salva tutto quello che
  tocca in `/var/lib/sws-pixsys-backup/tyx_panelcontrol.tar.gz`, poi: Device Finder abilitato in systemd se era
  acceso; via i drop-in, i timer e il dispatcher di Pixsys per chrony; `chrony.conf` e sorgenti di SWS; NTP lasciato
  com'era (`sync` = acceso, `monitor` = spento); le cinque righe di `rc.local` che chiamano la cartella commentate
  con `#sws-removed#` (lo script risultante passa `bash -n`, altrimenti non si tocca niente); programma fermato e
  cartella tolta; `sws-usb-power.service` per l'alimentazione USB. `--restore` rimette tutto, e lo chiama
  `install.sh --uninstall`.
- **UPS nel runtime** (`sws-web/src/power_fail.rs`, `--power-fail-input`): il lanciatore passa GPIO36 quando è un
  ingresso (cioè quando la scheda ha l'UPS). Tre letture a 0 di seguito, a 100 ms: luce a zero e riavvio tramite
  logind. Si arma solo dopo aver visto 1, così un ingresso fermo a 0 non riavvia in ciclo.
- **L'interruttore NTP** torna quello di `timedated`: il codice per il chrony di Pixsys e la regola sudoers
  `50-sws-clock` (nati la mattina, `8e049bda`) sono tolti.

**Provato sul TY570 la notte del 14-11** (installazione e due riavvii): nessun processo `tyx_panelcontrol`, cartella
tolta e copia presente (1,8 MB), `rc.local` valido con cinque righe commentate, USB accesa (`sws-usb-power` attivo,
GPIO116 a 1), Device Finder attivo, runtime e viewer attivi, nessuna unità fallita, NTP spento com'era. Al primo
riavvio la sorveglianza dell'UPS **non era partita**: il lanciatore controllava la direzione di GPIO36 prima che
`rc.local` lo esportasse. Corretto: il lanciatore passa sempre l'ingresso e il runtime legge quando il file c'è; al
secondo riavvio la riga «power-fail input watched» c'è. **Non provato**: la corrente staccata davvero, una chiavetta
Wi-Fi dopo il riavvio, l'NTP acceso dal pannello.

**Rimasto di Pixsys, da sapere**: `rc.local` aspetta ancora 2 s un tocco all'accensione e, se c'è, **cancella il
programma PLC** (`/data/plcsys/PlcCode*.bin`) e crea `/tmp/runsetup`; prima apriva il setup, ora non apre più
niente. Da decidere se togliere anche quel ramo. Lo stima di deriva di Pixsys (`compensation.json`) si perde: chrony
usa il suo `driftfile`.

Ogni passo che tocca i PC o i TC/WP va anche in CasaDomotica dove ha senso (regola del 16-10); la sezione Servizi
e l'UPS no, e si annota.

## Deciso il 15-11-2026, dopo il collaudo sul TY570

Provati e riusciti sul TY570: luce dal pannello, immagine di avvio, angolo che riavvia con l'anello, Ora automatica e
manuale, deriva. Fatti lo stesso giorno, su richiesta: la pressione che dura finché il dito resta nell'angolo, il
riquadro di anteprima, l'anello largo un terzo del lato corto, i quattro angoli, l'angolo che apre il pannello
(sceglibile o spento, mai lo stesso del riavvio) e la sezione «Informazioni».

Le risposte del maintainer alle quattro domande rimaste:

- **Angolo che riavvia dal progetto: solo spegnerlo.** Un interruttore nel progetto, come quello del pannello di
  controllo. Posizione, tempo e lato restano del dispositivo.
- **Server NTP, «automatico» = la lista di riserva** (i pool già configurati). Manuale = da 1 a 4 server. Niente
  server dal DHCP. Sul Tiny TY senza permessi nuovi: il file delle sorgenti di chrony è dell'utente `sws`, e per
  farlo rileggere si spegne e riaccende l'NTP da `timedated`.
- **Sul pannello LVGL i server si scrivono con la tastiera del pannello**: quella del Wi-Fi diventa generica.
- **Esportazione diagnostica: su chiavetta USB e scaricabile dal web.** Dentro registri, versioni, stato e audit.
  **Né il progetto né lo storico** (non scelti).

Driver Wi-Fi: sul TY570 mancavano i firmware di `rtl8xxxu` e `rtl8192cu`; messi a mano da linux-firmware
(RTL8723BU, RTL8192EU, RTL8723AU). La RTL8191SU resta fuori: manca il modulo `r8712u`, che va compilato per il
kernel 5.10.252 di Pixsys. Da decidere se l'installatore porta i firmware su ogni Tiny TY.

### Secondo giro di domande (15-11-2026)

- **Divieto dell'angolo sui TC/WP: lo spegne in PixsysOS.** Fatto (`4e03a514`): `enforce_project` all'avvio e a
  ogni modifica del progetto.
- **Firmware Wi-Fi: nel pacchetto.** Fatto (`4e03a514`).
- **Server NTP ed esportazione: Tiny TY e TC/WP.** Misurato sul TC620 (PixsysOS 2.1.3):
  - NTP: `systemd-timesyncd`, e `net.pixsys.Config1.Time` ha `GetCustomNTPServers() -> (b, as)` e
    `SetCustomNTPServers(b, as)`: acceso/spento più l'elenco, cioè esattamente «manuale + server». Oggi `false`, 0.
  - Chiavetta: nessun `udisks`; `Config1.USBDrives` offre solo export fissi (backup, licenze, dati utente). Dal
    container non si scrive su una chiavetta. Il registro del kernel non è leggibile dall'utente `user`.
- **Diagnostica sui TC/WP: solo dal web, con i registri di SWS.** Chiavetta e registri di sistema quando PixsysOS li
  offre, come il backup.
- **Diagnostica sul Tiny TY: registri di SWS e di sistema, con un aiutante con sudoers.** La chiavetta la monta già
  Pixsys in `/media/usb` come root: uno script di SWS, che `sws` lancia come root e che fa una cosa sola, raccoglie
  i registri di sistema e scrive il file lì.
- **`autorun.sh` da chiavetta come root: si segnala a Pixsys, non si tocca** (`ty570-1ad-p1.md` §13).

Restano da scrivere: server NTP a mano (runtime, web, LVGL con la tastiera generica) ed esportazione diagnostica.

### Terzo giro di domande (15-11-2026, pomeriggio)

Dal collaudo sul TY570: il capovolgimento di 180° funziona; Schermo e Informazioni erano più alte della pagina e
non scorrevano (corretto, `fix(control-panel): le sezioni più alte dello schermo scorrono`). Richieste e risposte:

1. **Angolo che apre il pannello come quello che riavvia**: lato dell'area regolabile (40-200 px) **e tempo
   regolabile (2-15 s)**, riquadro di anteprima mentre lo si imposta, anello di avanzamento **verde**.
2. **Pannello di controllo su schermi stretti**: oggi è disegnato solo per l'orizzontale (menu a sinistra). Serve una
   disposizione stretta per i progetti verticali; il Tiny TY da 5" è **800×480** (480×800 in verticale).
3. **Pulsante «elimina progetto e abbinamento»**: cancella **progetto, storico, utenti e abbinamento**; restano le
   impostazioni del dispositivo (angoli, luce, capovolgimento, server NTP) e di sistema (rete, Wi-Fi, ora). Si
   conferma **ridigitando il PIN**. Sta in **Dispositivo**, sotto Riavvia e Spegni, **su tutti i prodotti**, pannello
   LVGL e web.
4. **Pacchetto del Tiny TY**: si scarica **dal VPS**, pubblicato **a ogni rc insieme alle immagini**. Nel pannello
   «Installa su dispositivo» entra con una **scelta del prodotto all'inizio** (TC/WP a container oppure Tiny TY).
5. **Rotazione sui TC/WP**: via libera a provare `SetRotation` sul TC620 (poi rimesso a 0) e riferire.

