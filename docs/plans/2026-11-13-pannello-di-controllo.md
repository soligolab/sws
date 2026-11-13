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

## Stato

- **13-11-2026**: piano approvato; il seme è passato qui con `git mv`.
- **Prossimo passo: la fase 0** (misure sui dispositivi, chiedendo prima di ogni SSH). Il lavoro delle fasi comincia
  dopo la chiusura di `fix/rc18-ritocchi`, oppure annidato su di esso se lo decide il maintainer.
