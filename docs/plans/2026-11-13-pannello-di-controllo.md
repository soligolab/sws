# Il pannello di controllo del dispositivo, dentro SWS, su tutti i prodotti

> **Piano**, nato dal seme del 13-11-2026 sera e deciso col maintainer nella sessione di plan dello stesso giorno.
> Le misure della serata sul TY570 (perché nasce) sono nel «Contesto» e in `deploy/tiny-ty/ty570-1ad-p1.md`, punti 10
> e 11.

## Contesto

Il 13-11-2026 sera il TY570 è tornato senza IPv4 dopo un riavvio (corsa fra `/data/if_configure.sh` di Pixsys e
NetworkManager). Il setup Pixsys era coperto dal viewer di SWS e l'USB era spenta, quindi il dispositivo non aveva più
nessuna strada locale per tornare in rete. Si è recuperato solo via IPv6 link-local. Il seme da cui
nasce era questo stesso file, in `semi/`, fino all'approvazione.

Il maintainer vuole un **pannello di controllo del sistema operativo dentro SWS**: abilitato di default, disattivabile
dal progetto, uguale su tutti i prodotti.

**Decisioni del maintainer (13-11-2026, questa sessione):**

| tema | decisione |
|---|---|
| rispetto al costruttore | **proprio, uguale ovunque**: SWS parla direttamente col sistema; Cockpit (TC/WP) e `tyx_panelcontrol gui` (Tiny TY) restano vie di fuga all'avvio, non si toccano |
| prodotti | **TC/WP** (PixsysOS, podman rootless), **Tiny TY** (Ubuntu 22.04, systemd), **PC Linux generico** (Debian/Ubuntu) |
| accesso dallo schermo | **gesto fisso in esecuzione**, **gesto all'avvio**, **azione del sinottico** |
| protezione | **PIN di servizio**: si imposta nel progetto; un dispositivo nuovo ha come PIN iniziale **i 6 caratteri bassi del MAC di `eth0`** |
| progetto che lo disattiva | spariscono gesto in esecuzione e azione; **la finestra all'avvio resta sempre** (con PIN): via d'emergenza |
| contenuto della v1 | rete cablata, ora e fuso, info e riavvio, **Wi-Fi e schermo** (luce, calibrazione dei resistivi) |

Nomi nel codice **in inglese** (regola del 13-11): il concetto è `control_panel`, con API `/api/control-panel/...`. In
italiano l'interfaccia lo chiama «Pannello di controllo» e il dispositivo «dispositivo», non «pannello» (glossario
del seme `codice-in-inglese`).

## Architettura

```
 schermo (LVGL viewer | web RuntimeViewer)        IDE / cloud (fase 6)
        │  gesto · avvio · azione                        │
        ▼                                                ▼
   PIN → sessione di servizio ──►  sws-web  /api/control-panel/*  (stessa API)
                                        │
                                  trait OsBackend   (sws-web/src/control_panel/)
                     ┌──────────────────┼────────────────────┐
              NetworkManager      systemd timedated     logind (reboot/poweroff)
              (D-Bus, zbus)       hostnamed (D-Bus)     backlight/touch: viewer
                     │
         privilegi: regola polkit per l'utente di SWS (`sws` sul TY/PC, `user` su TC/WP)
```

- **Un backend solo, via D-Bus di sistema** (`zbus` 5.19 c'è già in `sws-web`, usato da `display_target.rs` e
  `launcher_dbus.rs`): NetworkManager per rete e Wi-Fi, `org.freedesktop.timedate1`, `hostname1`, `login1`. Le tre
  famiglie di prodotto differiscono solo per chi concede i permessi e per cosa c'è installato. Per questo c'è un
  trait `OsBackend` con un'implementazione D-Bus e una finta per i test e per lo sviluppo in container x86.
- **Capacità sondate, non presunte**: `GET /api/control-panel/capabilities` dice cosa questo dispositivo sa fare
  (NetworkManager sì/no, Wi-Fi sì/no, timedated, luce, touch resistivo). L'interfaccia mostra solo quello che c'è.
  È il pattern di `GetEnabled` già usato col launcher Pixsys.
- **Modifiche di rete con rete di sicurezza**: una modifica a rete o IP si applica con **conferma entro 60 s**,
  altrimenti si torna alla configurazione di prima, come fanno i monitor. Chi cambia l'IP via cloud o IDE non si deve
  chiudere fuori. Per farlo si usa `Reapply`/`Checkpoint` di NetworkManager (`CheckpointCreate` con rollback
  automatico, presente da NM 1.12).
- **PIN**:
  - nel progetto come hash in `project.yaml` (`control_panel.pin_hash`, argon2 come `sws-auth`), così viaggia col
    deploy;
  - senza PIN di progetto vale il **PIN iniziale del dispositivo**: i **6 caratteri bassi del MAC di `eth0`**
    (decisione del maintainer, 13-11-2026), cioè lo stesso suffisso del nome in rete (`ty570-1ad-p1-06e990` → PIN
    `06e990`). Si calcola, non si salva. Lo si legge dall'etichetta del MAC, e lo stampano `install.sh` e
    `prepara-dispositivo.sh`;
  - **limite dichiarato**: chi vede il nome mDNS o l'ARP conosce il PIN iniziale. Protegge dal dito curioso sullo
    schermo, non da chi è in rete. La protezione vera è il PIN del progetto: l'IDE avvisa finché il progetto non ne
    imposta uno, e il cloud lo segnala nella console. L'immissione accetta lettere `a-f` (tastiera esadecimale);
  - dopo il PIN parte una sessione di servizio breve (15 min), separata dagli utenti del progetto (`sws-auth`) e
    dell'installazione (`sws-identita`);
  - tentativi limitati in memoria, come `sws-auth`.
- **Progetto**: `control_panel: { enabled: bool (default true), pin_hash?: string }`. Con `enabled: false` spariscono
  il gesto in esecuzione e l'azione; la **finestra all'avvio resta**.

## Come ci si arriva sullo schermo

1. **All'avvio di SWS**: per 5 s, sopra il progetto o la schermata di abbinamento, un tasto «Impostazioni
   dispositivo» in alto a destra. Vale per tutti i prodotti e non tocca le finestre di avvio del costruttore, perché
   SWS prende lo schermo **dopo** di loro: dopo `desktop.target` su PixsysOS (regola della via di fuga STOP), dopo
   `rc-local.service` sul Tiny TY (commit `ff8e567b`).
2. **Gesto in esecuzione**: pressione ferma di 5 s nell'angolo in alto a destra (80×80 px, lo stesso angolo dello STOP
   di PixsysOS). Si intercetta **prima** del progetto: in LVGL in `touch_indev.rs`, sul web con un listener in
   cattura su `RuntimeViewer`. Lo stesso tocco non arriva a un pulsante del progetto finché non si rilascia prima dei
   5 s. Poi un anello di avanzamento.
3. **Azione del sinottico**: `ButtonAction` nuova `{ type: "open_control_panel" }` (`sws-editor/src/types/index.ts`
   accanto a `open_popup`), eseguita da `RuntimeView.tsx` e dal viewer LVGL.

## Le schermate (due motori, stessa API)

- **Web** (TC/WP col motore web, PC Linux con browser): pagina React nuova servita dal runtime sulla 7443, aperta
  sopra il progetto. Componenti `ui/` esistenti, i18n in `it.json`/`en.json`. File:
  `sws-editor/src/control-panel/`.
- **LVGL** (Tiny TY, TC/WP col motore LVGL): schermate native nel viewer (`sws-lvgl-viewer/src/control_panel/`), con
  la tastiera di LVGL (`lv_keyboard`) per IP e password Wi-Fi e le tabelle/finestre già esistenti (`tabella.rs`,
  `lvgl_avviso.rs`). Le parole stanno nei testi di sistema (`sws-core/src/testi_sistema.rs` e
  `tests/fixtures/testi-sistema.json`), con la guardia che già tiene allineati web e LVGL.
- Sezioni: **Rete** (per scheda: stato, indirizzi, DHCP/statico, DNS), **Wi-Fi** (scansione, connetti, dimentica),
  **Ora** (NTP sì/no, data/ora, fuso), **Schermo** (luce, calibrazione), **Dispositivo** (modello, seriale, versioni,
  nome in rete, PIN iniziale se nessuno impostato, riavvia, spegni).
- **Calibrazione dei resistivi**: solo LVGL (TY750/TY770), cinque punti, la matrice salvata in
  `/var/lib/sws/viewer/` e applicata in `touch_indev.rs`. Sul web resta quella del costruttore (Weston/libinput), e
  la sezione la nasconde.
- **Dispositivo** mostra il PIN iniziale solo finché il progetto non ne imposta uno suo.

## Fasi (un ramo per fase, annidato sul precedente se serve)

0. **Misure sui dispositivi** (sola lettura, SSH col tuo ok):
   - su TC620 e WP630: c'è NetworkManager? timedated/hostnamed? quali regole polkit valgono per `user`? Il socket del
     bus di sistema nel container basta per NM?
   - sul TY570: polkit, e quali azioni NM servono per `sws`.

   Esito scritto nel piano. Se PixsysOS non concede niente a `user` e l'host non si può toccare (vincolo del
   24-09-2026), la domanda va a Pixsys: una regola polkit nell'immagine, o un'API nel loro `net.pixsys.Config1`.
1. **Backend e API**: `control_panel/` in `sws-web` (trait `OsBackend`, impl D-Bus + finta), capacità, rete
   cablata con checkpoint, ora, info, riavvio. PIN e sessione di servizio, campo `control_panel` nel progetto
   (`sws-core/src/project.rs`, schema e validazione), PIN iniziale dal MAC di `eth0` (la stessa lettura del suffisso
  di `prepara-dispositivo.sh`; se `eth0` non c'è, la prima scheda fisica). Test Rust con il backend finto.
2. **Web**: pagina React, gesto in esecuzione, finestra all'avvio, azione `open_control_panel` (editor: pannello
   proprietà del pulsante, schema AI, gemello `demo-items-*` se serve per la guardia). Vitest.
3. **LVGL**: le stesse schermate nel viewer, gesto in `touch_indev.rs`, finestra all'avvio, azione.
4. **Wi-Fi e schermo**: Wi-Fi via NM su entrambi i motori; luce (c'è già `schermo.rs` per il TY; sul TC/WP via
   `/sys/class/backlight` o l'API Pixsys, da misurare in fase 0); calibrazione LVGL dei resistivi.
5. **Installazione e permessi**:
   - Tiny TY: `install.sh` installa la regola polkit per `sws`;
   - PC Linux: lo stesso, in uno script di installazione;
   - TC/WP: quello che dice la fase 0;
   - `install.sh` stampa il PIN iniziale.
6. **IDE e cloud**: Configurazione → Istanza → Device → «Pannello di controllo» (abilitato, PIN del progetto, con
   l'avviso finché vale quello del MAC) e la stessa API raggiungibile in remoto per il proprietario del dispositivo
   abbinato.

Ogni fase finisce con la *definition of done* e il collaudo sul dispositivo. Le funzioni visibili entrano anche in
**CasaDomotica**: un pulsante «Impostazioni dispositivo» nella pagina SystemInfo.

## File principali

- nuovi: `sws-runtime/crates/sws-web/src/control_panel/{mod,backend,nm,time,pin}.rs`,
  `sws-runtime/crates/sws-lvgl-viewer/src/control_panel/`, `sws-editor/src/control-panel/`,
  `deploy/tiny-ty/50-sws-control-panel.rules` (polkit);
- toccati: `sws-core/src/project.rs` (campo `control_panel`), `sws-web/src/router.rs` (rotte),
  `sws-editor/src/types/index.ts` (`ButtonAction`), `RuntimeView.tsx`, `RuntimeViewer.tsx`, `touch_indev.rs`,
  `main.rs` del viewer, `testi_sistema.rs` + fixture, `deploy/tiny-ty/install.sh`, i18n `it`/`en`;
- da riusare: `zbus` come in `display_target.rs`; l'hash e il limite ai tentativi di `sws-auth`; `netif.rs` per gli
  indirizzi; `schermo.rs` per la luce; `abbinamento.rs` (viewer) per la schermata in cui mostrare il PIN iniziale.

## Verifica

- `cargo test` col backend finto: transizioni di rete, rollback del checkpoint senza conferma, PIN giusto/sbagliato e
  blocco, `enabled: false` che toglie gesto e azione ma non la finestra d'avvio.
- vitest: pagina web, gesto (pressione 5 s sì; rilascio a 4 s arriva al pulsante sotto), azione nell'editor.
- `check_static.sh` (schema sinottico, testi di sistema web/LVGL, unità systemd), `pnpm build`, `cargo check`.
- Collaudo sul **TY570** (LVGL, NM 1.36): si passa da DHCP a statico e ritorno, rollback lasciando scadere i 60 s, ora
  e fuso, riavvio, luce; gesto, avvio e azione; PIN iniziale da `install.sh`.
- Collaudo su **TC620/WP630** (web e LVGL), secondo quello che consente la fase 0.
- PC Linux: una VM Debian con NM.

## Fase 0 — misure (13-11-2026 sera, da `ufficio`)

| | **TY570** (Ubuntu 22.04) | **TC620** (PixsysOS 2.1.3) |
|---|---|---|
| D-Bus | NetworkManager 1.36, timedate1, hostname1, login1, locale1 | NetworkManager, timedate1, timesync1, hostname1, login1, `net.pixsys.Config1`, `net.pixsys.SWUpdate1` |
| polkit | **0.105**: solo file `.pkla` in `/etc/polkit-1/localauthority/50-local.d/`, le regole JS non si leggono | **124**: regole JS; quelle di Pixsys in `/usr/share/polkit-1/rules.d/` |
| utente di SWS | `sws`: NM `network-control`/`settings.modify.system`/`wifi.scan` = `auth`, `CanReboot` = `challenge` → serve un `.pkla` nostro | `user` (gruppo `setup-user`, è l'utente del container con `keep-id`): **già `yes`** per NM (anche `checkpoint-rollback`), `timedate1` (ntp, time, timezone, local-rtc), `hostname1.set-static-hostname`, `login1.reboot`, e `systemd1.manage-units` su `touch-calibration.service` (regole Pixsys 12-16) |
| spegnimento | da concedere col `.pkla` | **non concesso** (solo reboot): o si toglie dalla v1 su TC/WP, o si chiede a Pixsys |
| luce | `/sys/class/backlight/backlight` (già in `schermo.rs`, gruppo `video`) | `brightness` di root 644 → via **`net.pixsys.Config1.Display`** (`GetBrightness`, `GetIdleTimeout`, `GetRotation`, `HasDisplayCapabilities` e i loro `Set`); beep via `net.pixsys.Config1.Buzzer` (`Get/SetTouchFeedback`) |
| calibrazione | resistivi (TY750/770): nel viewer | `touch-calibration.service` di Pixsys, avviabile da `setup-user` |
| schede | `eth0`, `eth1`, `can0`; niente Wi-Fi | **`ethernet0`**, `ethernet1`, `bond0`, `can0`, `dummy0`; niente Wi-Fi |
| MAC per il PIN | `eth0` = `7c:6c:39:06:e9:90` → `06e990` | `ethernet0` = `7c:6c:39:07:af:f9` → `07aff9` (come il nome `tc620-…-07aff9`) |

Conseguenze per le fasi:
- il PIN iniziale si legge da `eth0`, poi da `ethernet0`, poi dalla prima scheda fisica;
- **TC/WP non chiede niente a Pixsys** per rete, ora, nome e riavvio: il socket del bus di sistema è già nel
  container (lo usano `display_target.rs` e `launcher_dbus.rs`) e le regole ci sono. La luce passa da
  `net.pixsys.Config1.Display`, la calibrazione da `touch-calibration.service`;
- **Tiny TY e PC Linux**: l'installatore mette un `.pkla` (polkit 0.105) **e** una regola `.rules` (polkit ≥ 0.106),
  per il gruppo dell'utente di SWS. Le azioni sono quelle concesse da Pixsys più `login1.power-off`;
- **nessuno dei due ha Wi-Fi**: la sezione Wi-Fi si costruisce sul backend finto e sulla capacità sondata, e si prova
  su un PC Linux con una chiavetta;
- il **WP630** (in ufficio, non raggiungibile da qui) ha lo stesso PixsysOS: si verifica al collaudo.

## Stato

- **13-11-2026**: piano approvato; il seme è passato qui con `git mv`.
- **13-11-2026 sera**: fase 0 fatta su TY570 e TC620 (sopra).
- **14-11-2026**: fasi 1, 2 e 3 sul ramo `feat/control-panel` (annidato su `fix/rc18-ritocchi`, non pushato):
  backend e API (`4176ef11`), schermate web (`8af76988`), lingua dei contenuti del progetto (`23fbad4d`),
  schermate LVGL (`d8c5a094`). Installato sul TY570 (pacchetto con nome rc.17): le API rispondono su NM e
  timedated col PIN `06e990`. Il collaudo sul vetro non è ancora fatto.
- **14-11-2026**: dettaglio della **fase 4** scritto qui sotto. Si aspetta il via libera.
- **14-11-2026**: **fase 4** sul ramo `feat/control-panel-4` (annidato su `feat/control-panel`): backend Wi-Fi,
  hotspot e luce (`05051ab8`), web (`1db73c84`), calibrazione PixsysOS (`f580f0f5`), LVGL con la calibrazione dei
  resistivi (`f89e6752`, `9ff94804`). Non collaudata: aspetta la chiavetta Wi-Fi sul TY570.
- **14-11-2026**: **fasi 5 e 6** sul ramo `feat/control-panel-5` (annidato sul 4, `6df86069`): PIN del progetto e
  interruttore nella finestra «Impostazioni progetto» (non in Istanza → Device: è un campo del progetto, e quella
  finestra è il posto unico delle impostazioni del progetto), `PUT /api/project/control-panel`, hash mascherato in
  `GET /api/project`, installatori che stampano il PIN iniziale. **Resta fuori**: la stessa API dal cloud per il
  proprietario del dispositivo abbinato (passa dal tunnel; chi può cambiare la rete di un dispositivo da remoto
  va deciso col maintainer, con la conferma dei 60 s che diventa decisiva); il pulsante in CasaDomotica quando il
  lavoro entra in `main`; la voce di `NOVITA.yaml`, perché il blocco 2.26.0 ha già 15 voci su 15.

## Fase 4 — dettaglio (14-11-2026)

Decisioni del maintainer, dello stesso giorno:
- **Wi-Fi anche come access point**: il dispositivo crea una sua rete Wi-Fi a cui collegarsi col telefono. Il
  maintainer l'ha chiamata «modalità APN»: è l'hotspot, non l'APN di un modem 4G;
- **la luce regolata dal pannello è del dispositivo**: vale sopra quella del progetto (`pannello.luminosita`) e
  il deploy non la cancella, finché non la si riporta a «come dice il progetto»;
- **la calibrazione dei resistivi si costruisce adesso, senza collaudo**: un TY750/770 non c'è. Si collauda
  quando ce n'è uno.

### Misure sul TY570 (14-11-2026, in sola lettura)

| cosa | trovato |
|---|---|
| Wi-Fi in NM | `libnm-device-plugin-wifi.so`, `wpasupplicant` 2.10; `nmcli radio` dice Wi-Fi abilitato |
| hotspot | `dnsmasq-base` 2.90 c'è: NM `ipv4.method=shared` funziona senza installare niente |
| driver USB nel kernel 5.10.252 | `r8188eu` (staging), `88x2bu`, `rt2800usb`, `mt76x0u`, `mt76x2u` |
| strumenti | `iw` e `wireless-tools` **non** ci sono (non servono: si sonda tutto via NM) |
| luce | `/sys/class/backlight/backlight`, max 255 (già di `schermo.rs`) |
| touch | capacitivo ILITEK e, caricato comunque, `TSC2007` (vedi `ty570-1ad-p1.md` punto 9) |
| calibrazione Pixsys | formato **tslib**: `/usr/local/etc/pointercal` = `4157 4 -683600 37 4135 -846804 65536 1024 600`, scritto da `/data/calibrate.sh` (`ts_calibrate` sul `fb0`) |

Il viewer oggi legge il TSC2007 **crudo** con `EVIOCGABS` e lo stende fra minimo e massimo: sui resistivi **non
applica la calibrazione di fabbrica di Pixsys**. Il commento in testa a `touch_indev.rs` parla di un `ts-uinput`
che sul Tiny TY non c'è. Quindi la calibrazione corregge anche un difetto, non è solo una funzione nuova.

### Wi-Fi

**API** (stesso stile delle altre, dietro la sessione di servizio):
- `GET /api/control-panel/wifi`: radio accesa sì/no, scheda (`wlan0`…), modo (`client` | `hotspot` | `off`),
  rete attiva, reti viste (SSID, segnale %, sicurezza `open`/`wpa`/`wpa3`/`enterprise`, già nota sì/no), profili
  salvati, e `can_hotspot`;
- `POST /api/control-panel/wifi/scan`: `RequestScan` sulla scheda; la lista si rilegge dopo ~3 s;
- `POST /api/control-panel/wifi/connect` `{ssid, password?, hidden?}`: `AddAndActivateConnection` con un profilo
  `sws-wifi-<ssid>`, oppure `ActivateConnection` se il profilo c'è già;
- `POST /api/control-panel/wifi/forget` `{ssid}`: cancella il profilo;
- `PUT /api/control-panel/wifi/radio` `{enabled}`: `WirelessEnabled`;
- `GET`/`PUT /api/control-panel/wifi/hotspot` `{enabled, ssid, password}`: un profilo solo, `sws-hotspot`, con
  `802-11-wireless.mode=ap`, banda 2,4 GHz, canale automatico, WPA2-PSK, `ipv4.method=shared` (NM dà 10.42.0.1/24
  e il DHCP con `dnsmasq`), `autoconnect=true`, così riparte al riavvio;
- l'indirizzamento di `wlan0` (DHCP/statico) è quello che c'è già: `wlan0` compare fra le schede della sezione Rete,
  come `eth0`.

**Regole**:
- **hotspot e client si escludono**: una chiavetta USB ha una scheda sola. Accendere l'hotspot spegne il client e
  viceversa, e la schermata lo dice prima di farlo;
- **`can_hotspot`** viene da `WirelessCapabilities` di NM, bit `NM_WIFI_DEVICE_CAP_AP` (0x40). Una chiavetta che
  non sa fare da access point non mostra l'hotspot. `r8188eu` di staging è il primo sospetto: si vede col collaudo;
- **la rete di sicurezza dei 60 s vale anche qui** (checkpoint NM, come la fase 1): collegarsi a una rete, accendere
  o spegnere l'hotspot. Il caso che la giustifica: chi è collegato all'hotspot e lo spegne, o chi dall'IDE sposta
  il dispositivo su una rete Wi-Fi che non raggiunge;
- **i valori proposti per l'hotspot**: SSID `sws-<6 caratteri del MAC>` (lo stesso suffisso del nome in rete) e
  una password **casuale di 10 caratteri**, mostrata in chiaro e modificabile. Non è il PIN: il PIN iniziale si
  ricava dal MAC, e la password dell'hotspot è la porta d'ingresso della rete;
- **QR per collegarsi**: con l'hotspot acceso la sezione mostra il QR `WIFI:T:WPA;S:<ssid>;P:<password>;;`.
  `lv_qrcode` è già acceso nel viewer per l'abbinamento;
- **segreti**: la password la tiene NM nel profilo di sistema (file di root, `psk-flags=0`). SWS non la salva da
  nessuna parte. La rilegge con `GetSecrets` solo per il QR e per la casella dell'hotspot, dietro la sessione;
- reti **enterprise** (802.1X): si vedono in lista ma non si possono collegare, con la scritta «non supportata».

**Permessi**: al `.pkla` e al `.rules` del Tiny TY si aggiungono `org.freedesktop.NetworkManager.wifi.share.protected`
e `wifi.share.open`. Le altre azioni Wi-Fi ci sono già. Sul TC/WP la fase 0 non ha visto Wi-Fi: la capacità
sondata la nasconde.

**Schermate**:
- web e LVGL, una sezione **Wi-Fi** che compare solo con `capabilities.wifi`;
- in LVGL serve la **tastiera alfanumerica** per SSID e password: `lv_keyboard` è già usato dal login
  (`lvgl_render.rs`) e `lvgl_font.rs` ha già la correzione dei font per i suoi tasti. Il tastierino esadecimale
  della fase 3 resta per PIN e indirizzi.

### Luce

- **Dove sta**: `config/control_panel.json` del dispositivo, `{"brightness": 60}`. È un **file di stato del
  dispositivo** (regola del codice in inglese: quelli che nessun deploy riscrive), nome nuovo e già in inglese;
- **API**: `GET`/`PUT /api/control-panel/display` `{brightness: 5-100 | null}`. `null` vuol dire «come dice il
  progetto». Capacità nuova `display` in `capabilities`;
- **Tiny TY e LVGL**: il viewer la legge da `/api/control-panel` e la mette sopra `PannelloConfig.luminosita` in
  `schermo.rs`. Oscurato e spento a riposo restano del progetto;
- **TC/WP**: il runtime chiama `net.pixsys.Config1.Display.SetBrightness` (fase 0). La scala di Pixsys si misura al
  collaudo. Sul TC/WP il progetto non regola la luce (lo fa `schermo.rs` solo col `--retroilluminazione`), quindi lì
  non c'è niente da sovrascrivere;
- **PC Linux**: niente capacità, niente sezione;
- la slitta si muove dal vivo e si salva quando si rilascia.

### Calibrazione dei resistivi

- **Formato tslib**, lo stesso di Pixsys (`a b c d e f s xres yres`: `x = (a·X + b·Y + c)/s`, scalato se lo schermo
  ha un'altra risoluzione). Così una calibrazione fatta con `/data/calibrate.sh` vale anche per SWS, e viceversa;
- **lettura**: `touch_indev.rs`, per un touch **resistivo** (TSC2007 o con `_ts` nel nome, non ILITEK), cerca
  `/var/lib/sws/viewer/pointercal` e poi `/usr/local/etc/pointercal`. Se c'è, applica la matrice. Se non c'è,
  continua a stendere fra minimo e massimo come oggi. Si scrive nel log quale ha preso;
- **scrittura**: SWS scrive solo il suo (`/var/lib/sws/viewer/`). Quello di Pixsys è di root e resta com'è;
- **schermata**: solo LVGL. Cinque croci (quattro angoli e il centro) e i minimi quadrati sui cinque punti, come
  `ts_calibrate`, poi una prova «tocca qui» con il punto che segue il dito, e «Salva» o «Rifai». Durante la
  calibrazione il touch passa crudo, senza matrice e senza il filtro del gesto nell'angolo. Senza un tocco per
  30 s si torna alla calibrazione di prima: un resistivo fuori calibrazione non deve poter chiudere fuori chi lo usa;
- **capacità** `touch_calibration`: sì solo in LVGL con touch resistivo. Il viewer la sa e il runtime no, quindi la
  sezione la mostra il viewer, senza chiederla all'API;
- **TC/WP**: il pulsante avvia `touch-calibration.service` di Pixsys (`systemd1.manage-units`, già concesso).
  Quel servizio prende lo schermo per conto suo: si vede al collaudo;
- **collaudo rimandato**: niente resistivo a disposizione. I test Rust coprono matrice, minimi quadrati e la
  lettura del file di Pixsys misurato qui sopra.

### Sezione «Schermo»

Raccoglie luce e calibrazione. Compare se c'è almeno una delle due capacità. Sul web resta solo la luce.

### Ordine di lavoro (ramo `feat/control-panel-4`, annidato su `feat/control-panel`)

1. backend: Wi-Fi e hotspot in `dbus.rs` e nel backend finto (con reti finte, una enterprise, una chiavetta senza
   AP), più luce e capacità. Test Rust;
2. permessi: `.pkla`/`.rules` con `wifi.share.*`;
3. web: sezioni Wi-Fi e Schermo, con vitest;
4. LVGL: tastiera alfanumerica, Wi-Fi con QR, luce in `schermo.rs`, poi calibrazione (matrice in `touch_indev.rs`,
   schermata), con i test;
5. istantanee dei due motori in `sws/tmp/pannello-di-controllo/`;
6. collaudo sul TY570 con la chiavetta: scansione, collegamento, rollback dei 60 s, hotspot col telefono e QR,
   luce. La calibrazione resta in `docs/COLLAUDI_IN_SOSPESO.md` finché non c'è un resistivo.

Cosa chiede alla chiavetta: un driver fra quelli del kernel qui sopra. Se `lsusb` mostra un chip senza driver, si
prova un'altra chiavetta: compilare driver per il kernel di Pixsys è fuori dalla fase.
