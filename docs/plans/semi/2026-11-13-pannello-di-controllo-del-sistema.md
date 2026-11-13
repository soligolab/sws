# Il pannello di controllo del sistema operativo, dentro SWS

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una **sessione di plan approfondita e
> dedicata** per sviscerarne tutti i dettagli: cosa si configura, su quali dispositivi, con quali permessi, e come
> convive col software del costruttore. Quello che segue è l'idea e quello che si è misurato il 13-11-2026, non un
> progetto.

## L'idea

Richiesta del maintainer, 13-11-2026: «dobbiamo pianificare un pannello di controllo per il sistema operativo,
abilitato di default e disattivabile da progetto, che permetta la configurazione del dispositivo».

- **Abilitato di default**: un dispositivo con SWS ha sempre un modo locale, dallo schermo, per sistemare rete, ora e
  il resto. Non deve mai dipendere dal fatto che la rete funzioni.
- **Disattivabile dal progetto**: chi consegna un impianto può toglierlo, come si tolgono le altre parti di servizio.
- **Configurazione del dispositivo**: è il sistema operativo sotto SWS, non il progetto.

## Perché nasce: la sera del 13-11-2026 sul TY570

1. Installato SWS, il viewer LVGL prende lo schermo all'avvio (`Restart=always`). Il setup di Pixsys
   (`tyx_panelcontrol gui`, che `rc.local` apre se si tocca lo schermo entro 2 s dall'accensione) resta coperto: la
   decisione del 12-11 «`tyx_panelcontrol` non parte, SWS tiene lo schermo» ha tolto anche l'unica configurazione
   locale (vedi `deploy/tiny-ty/ty570-1ad-p1.md` §7).
2. Al riavvio delle 20:05 il dispositivo è tornato **senza IPv4**. La causa è nel sistema Pixsys, non in SWS: la
   regola udev `70-persistent-mac.rules` lancia `/data/if_configure.sh`, che imposta il MAC e **riaccende** `eth0`
   prima che parta NetworkManager. NetworkManager trova la scheda già su, la adotta come configurazione esterna
   (`connection-assumed`, profilo volatile in `/run` con `ipv4.method=disabled`) e non fa DHCP. Alle 19:14 l'ordine
   era stato l'inverso, e la rete era salita.
3. L'USB era (probabilmente) disattivata: niente tastiera, niente console locale.

Risultato: un dispositivo acceso, con SWS che funziona sullo schermo, e **nessuna strada** per rimetterlo in rete
dallo schermo stesso. Si è recuperato solo perché rispondeva in IPv6 link-local e il PC di sviluppo ha potuto
riattivare IPv6. Un cliente al suo posto avrebbe dovuto riscrivere il sistema da SD.

## Cosa c'è oggi (misurato il 13-11-2026)

- **Lato SWS**:
  - `/api/system` con stop, start, reboot e il certificato TLS (`sws-web/src/system.rs`);
  - le impostazioni dello schermo del progetto: luce, oscuramento, spegnimento, beep (`PannelloConfig`,
    `sws-core/src/project.rs`);
  - la commutazione del motore e l'immagine di boot via D-Bus col launcher di PixsysOS sui TC/WP
    (`display_target.rs`, `launcher_dbus.rs`).
  - Della rete, il runtime legge le interfacce (`netif.rs`) solo per mDNS. Non c'è niente che configuri rete, ora,
    nome host o servizi del sistema.
- **Lato costruttore**:
  - sui TC/WP (Yocto, PixsysOS) il launcher Pixsys ha la sua configurazione;
  - sui Tiny TY (Ubuntu 22.04) c'è `tyx_panelcontrol`, che gestisce rete via NetworkManager, wifi, chrony, SFTP,
    calibrazione del touch, UPS e servizi, e gira come root.
- **Il precedente sul TY570**: oggi `prepara-dispositivo.sh` fa da sé nome host, avahi e SSH. Lo script è per
  l'installazione, non per chi sta davanti al dispositivo.

## Le domande per la sessione di plan

- **Cosa ci entra.** Rete (DHCP o statico, per scheda), ora e fuso, nome host, riavvio e spegnimento, luce e
  calibrazione, informazioni (versione, seriale, indirizzi). Il wifi? I servizi del costruttore?
- **Come ci si arriva sullo schermo**, senza rubare tocchi al progetto: un gesto, un tasto fisso, una pagina di
  sistema all'avvio? E con quale protezione: PIN, utente SWS con un ruolo, o niente se il progetto non ha utenti?
- **Su quali motori**: viewer LVGL (Tiny TY) e web (TC/WP). Una pagina di sistema costruita come i sinottici, o una
  schermata a sé nel viewer?
- **Chi applica le modifiche**: il runtime gira come utente `sws` senza privilegi (Tiny TY) o in un container (TC/WP).
  Servono un helper privilegiato stretto (polkit, D-Bus di NetworkManager, `systemd-run`), o le API del costruttore
  (il launcher D-Bus di PixsysOS)?
- **Convivenza col costruttore**: sui TC/WP sostituisce il launcher Pixsys, o lo richiama? Sui Tiny TY si lascia
  `tyx_panelcontrol` per il setup e SWS gli cede lo schermo, o lo si sostituisce?
- **«Disattivabile da progetto»**: cosa resta come uscita di emergenza quando è disattivato? (Un dispositivo deve
  sempre potersi riprendere senza riscriverlo da SD.)
- **Dall'IDE e dal cloud**: la stessa configurazione anche da remoto, accanto a Configurazione → Istanza → Device?

## Collegati

- `deploy/tiny-ty/ty570-1ad-p1.md` — le note per lo sviluppatore del TY (§7, chi tiene lo schermo).
- Il difetto immediato — il setup Pixsys coperto dal viewer e la corsa fra `if_configure.sh` e NetworkManager — si
  corregge subito sul ramo `fix/rc18-ritocchi`, senza aspettare questo seme.
