# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.

**Last session**: 2026-07-29 — **Container aarch64 in servizio sul dispositivo, Telegram per singolo allarme, notifiche morte al boot** (branch `feat/container-aarch64`, portato in `main` con squash). Viewer a schermo pieno e auto-reload verificati in un browser, non più solo scritti.

**In parallelo, stessa giornata, dall'altra macchina**: demo "Nebulizzatore Sandokan" (MQTT reale) + fix dello storico perso al riavvio. Template e progetto importati/deployati, bug isolato e corretto, cherry-pickati in `main` (`718a3bb`, `d3fef51`). Branch `feat/project-location-and-brand-presets` cancellato in locale perché interamente contenuto in `main`. Nota: quel fix e il mio sulle notifiche sono **la stessa classe di bug** — il percorso di auto-apertura al boot in `main.rs` ricopiava a mano quello che fa `open_project`, e ogni pezzo dimenticato (lo storico, le notifiche) resta invisibile finché non serve.

- **Layout del viewer verificato in un browser (2026-07-29)**: era lavoro già pushato ma mai provato davvero. Nuovo `scripts/check_viewer_layout.sh` (+ `sws-editor/scripts/viewer_layout_measure.mjs`) che misura le barre di scorrimento a 1280×800 in quattro configurazioni. Confronto **prima/dopo** ricostruendo la SPA pre-fix: prima tre barre confermate — documento 816 px in 800 per il `margin: 8px` del body, area pagina `ch 730` contro pagina 800 (fasce non sottratte) e `cw 1264` contro 1280 — più `hide_viewer_chrome` ignorato e nessuno scale-to-fit. Dopo: nessuna barra, `<nav>` che scompare, scale 0,914 con le fasce e 1,0 senza, cap a 1 rispettato. Browser di Playwright ora installato su questa macchina (`~/.cache/ms-playwright`). Scoperto anche che `page_layout` non ha `width`/`height`: in modalità fisso la dimensione viene dal synoptic, e il PUT accetta quei campi con 204 scartandoli.

- **Telegram per-allarme provato sul dispositivo con un bot vero (2026-07-29)** — quattro casi sull'allarme `counter_high` di `pippo`, con l'immagine aarch64 aggiornata: *chat predefinite* (campo assente) → messaggio inviato; *non notificare* → silenzio; *chat specifiche* → messaggio inviato; *chat specifiche senza chat* → `WARN telegram: modo 'chat specifiche' senza nessuna chat` e nessun invio. Definizione dell'allarme ripristinata identica; `diff -r` col backup mostra come unica differenza `.history/historian.db`, cioè il registro storico che ha annotato gli eventi del test. Backup conservato in `/data/user/sws/.backup-claude/pippo-20260729-095821`.
- **Autostart del container al boot: verificato per la prima volta (2026-07-29)** su un riavvio reale del dispositivo (up 1h07 al momento del controllo): container già attivo e `healthy`, unit quadlet `active`, `Linger=yes`. Non serviva accesso fisico perché ha funzionato.

- **NOTIFICHE MORTE AL BOOT, trovato e corretto il 2026-07-29** — il bug più serio di questa sessione. Sul dispositivo, dopo ogni riavvio, gli allarmi non mandavano né Telegram né email e gli script globali non partivano: l'auto-apertura del progetto in `main.rs` non avviava canale Telegram, supervisore notifiche e supervisore script. Tornava a funzionare solo riaprendo il progetto dall'IDE. Spiega il sintomo *"la notifica di test mi arriva ma il messaggio dell'allarme no"*. Diagnosticato sul dispositivo (assenza della riga `notification supervisor started` al boot, presenza dopo un `open`, seguita da `telegram message sent`). **Corretto** estraendo `projects::start_project_services`, ora usata da tutti e tre i percorsi di apertura; `router::build` restituisce anche l'`AppState`. **Lezione**: tre copie della stessa sequenza di avvio divergono in silenzio — il percorso di boot non ha nessuno che lo guardi.
- **`install-container.sh`: validazione prima di fermare il servizio (2026-07-29)** — rimuoveva il container al passo 4 e scopriva la unit quadlet mancante al passo 5, lasciando il dispositivo senza runtime. Capitato dal vivo. Nuovo passo 0 che valida tutto prima di toccare qualsiasi cosa.

- **Auto-reload della SPA verificato (2026-07-29)**: nuovo `scripts/check_spa_autoreload.sh` (+ `sws-editor/scripts/spa_autoreload_measure.mjs`). Simula il deploy rinominando il chunk di entry con un hash diverso, quindi basta una build. Misurato: il viewer si ricarica dopo ~28-30 s e serve il bundle nuovo. Era l'altra metà del *"non prendere abbagli"*: prima non c'era prova che il pannello prendesse davvero la versione aggiornata.

- **Segreti in backup/export/deploy (2026-07-29)**: decisione del maintainer — password e token sono dati di progetto e devono essere salvati e ripristinati in tutte le procedure; la custodia sicura dei backup è responsabilità dello sviluppatore. Prima il bundle dichiarava `secrets_masked: true` mascherando **solo** MQTT, e siccome il deploy remoto usa la stessa `build_project_zip` il dispositivo riceveva un broker senza credenziali. Ora nessuno strip; `secrets_masked` resta nel manifest solo per compatibilità di formato, sempre `false`. **Invariata** la mascheratura `********` sulle GET (browser) — è un'altra cosa e serve. Verificato con un test sul bundle del deploy e col giro export→import sul runtime vero.

- **Telegram per singolo allarme (2026-07-28)**: colonna *Telegram* nella tab Allarmi con tre stati — chat predefinite / chat specifiche / non notificare. Campo assente = chat predefinite, per non spegnere in silenzio allarmi già in servizio. Decisione in `AlarmDef::telegram_routing()` con 6 test, incluso il giro su YAML di `off` (token booleano in YAML 1.1). "Chat specifiche" senza chat non ricade sul globale: segnalato nel log e sulla riga. Il canale Telegram porta ora `TelegramMessage` con destinatari opzionali; gli script restano sul canale `String`. **Verificato**: round-trip attraverso l'API reale (salvataggio → project.yaml → riapertura del progetto) su quattro allarmi, uno per stato più uno senza il campo. **Non ancora provato con un bot vero** — serve il token del maintainer; il percorso di rete è lo stesso già funzionante del test di notifica.

- **PERDITA DI DATI, causata e corretta il 2026-07-28**: `saveAll()` azzerava variabili, sorgenti e allarmi di un progetto. Spingeva su disco la copia in memoria di quelle tre collezioni, quindi qualunque istante in cui la copia è più povera del disco distruggeva il contenuto. Provato dall'audit log (`.run-editor/config/audit.jsonl`, seq 93-96): quattro scritture in 23 ms, `{"count": 0, "what": "tags"}` contro 16 variabili su disco, con la scrittura dei tag **duplicata** — la tab e `saveAll` insieme. Il rischio era latente da prima, ma l'ho reso attivo estendendo `saveAll` a Configurazione e al deploy. **Corretto**: `saveAll` non scrive più tags/sources/alarms (le possiedono le tab di Configurazione), e il flush automatico delle bozze resta solo per Notifiche e Datastore, le due che tracciano l'intenzione reale dell'utente. Verificato: progetto da template 49 tag/4 sorgenti/6 allarmi intatto col nuovo comportamento, azzerato col vecchio. **Lezione**: un flush automatico può scrivere solo ciò che l'utente ha esplicitamente modificato; un diff strutturale contro lo store non è una prova di intenzione.
- **Selettore variabili (2026-07-28)**: il `▾` di `TagInput` era nascosto quando il progetto non aveva variabili dichiarate, quindi nella tabella Allarmi sembrava una funzione assente. Ora è sempre visibile, con un avviso utile quando non c'è nulla da scegliere, ed elenca anche le variabili **dedotte dalle sorgenti** (nuovo `src/tagCatalog.ts`, 6 test) — in molti progetti sono le uniche che esistono. `TagInput` esteso ai 4 punti che avevano ancora un input semplice.

- **Telegram: test e rilevamento chat spostati sul runtime (2026-07-28)**. Il maintainer continuava a percepire "perdo il token" passando da Editor a Configurazione: il dato era intatto su disco (verificato, 46 caratteri reali), ma i due pulsanti chiamavano l'API di Telegram **dal browser** e senza il token in chiaro si bloccavano. Ora passano dal backend, che risolve il token salvato (nuovo `POST /api/notifications/telegram-chats`; `test-telegram` esisteva già). Oltre a togliere il fastidio, la prova ora percorre la stessa catena degli allarmi — quella che stamattina nessun test copriva, ed è per questo che il test passava mentre il dispositivo non aveva configurazione. Verificato con 4 casi: token vuoto e placeholder risolvono il salvato e raggiungono Telegram (401 dal token finto = la chiamata è partita), senza configurazione l'errore è esplicito.

- **Fix 2026-07-28: token Telegram cancellato da "Salva tutto" (regressione mia)**. Il maintainer ha segnalato che il token spariva. Riprodotto con uno script contro un'istanza locale: il backend cancella il `bot_token` se riceve `notifications` **senza** la sezione `telegram` (la guardia copriva solo il placeholder `********`). Il grilletto era il mio cablaggio di `pendingSections`: "Salva tutto" ora svuota le bozze delle tab, e una bozza Notifiche disallineata — inevitabile, dato che il token arriva mascherato dalle GET — veniva scritta su disco. **Causa rimossa** con un flag `touched`: la tab si registra solo se l'utente ha modificato qualcosa, non per confronto strutturale (inaffidabile per costruzione con un segreto mascherato). Aggiunti un warning lato backend quando un token salvato sta per essere rimosso, e un campo token che mostra `✓ salvato sul server` invece di `********`. **Nota**: il token su disco NON era mai stato perso nei test del maintainer — la UI mostrava il valore mascherato e "Invia test" (che chiama la Bot API dal browser, non dal runtime) non poteva funzionare senza il token in chiaro. Due percorsi diversi che non si incrociano, ed è la stessa ragione per cui stamattina il test passava mentre sul dispositivo non c'era alcuna configurazione.

- **Sessione 2026-07-28 (3) — layout viewer su pannello industriale**:
  - **Tre barre di scorrimento, tre cause indipendenti**: (1) `body` con il `margin: 8px` di default mai azzerato contro una radice `height: 100vh` → scrollbar del documento **sempre**, su qualunque schermo e in qualunque modalità; (2) in modalità fisso l'`<svg>` con `height` letterale mentre il contenitore era già ridotto dei 70 px di chrome; (3) orizzontale come conseguenza delle prime due. Tutte e tre chiuse.
  - **`hide_viewer_chrome`** (impostazione di progetto, scelta del maintainer contro il parametro URL): nasconde nav **e** fascia allarmi. La fascia diventa sovrapposta — a riposo non esiste, con allarmi compare sopra il synoptic. Campanella con offset derivato invece di `top: 80` hardcoded.
  - **Modalità fisso ora rimpicciolisce** invece di scorrere: `ResizeObserver` in `RuntimeView` + `viewerFitScale()` pura in `pageLayout.ts` con **cap a 1** (si riduce, non si ingrandisce: a misure combacianti resta 1:1).
  - **`useBuildWatcher`**: rileva un frontend nuovo confrontando gli hash dei bundle nell'HTML di entry (30 s, `cache: no-store` obbligatorio perché `ServeDir` non manda `Cache-Control`). Viewer ricarica da sé, IDE mostra un banner — mai automatico dove ci sono modifiche non salvate.
  - **Fix**: `sws:autoRotate` scritto ma mai riletto all'avvio; su un pannello senza barra la rotazione è l'unico modo di cambiare pagina senza navbutton.
  - **Verifica**: round-trip dell'impostazione provato via API (PUT → `project.yaml` → GET → sopravvive al riavvio del runtime; progetto senza il campo resta valido); `viewerFitScale` con 4 test unitari (14/14 il totale frontend); `cargo test -p sws-web` 17/17; `pnpm build` verde. **Non verificato in browser**: Playwright non ha i browser installati su questa macchina e scaricarli non è un'operazione da fare di iniziativa propria.

- **Container riorganizzato (2026-07-28, su indicazione del maintainer)**: dati in **bind mount** su `/data/user/sws/{projects,config,logs,www}` invece di volumi nominati — visibili e copiabili sull'host, e `/data` è la partizione scrivibile Pixsys. `/data/user` e non `/data` perché il primo è dell'utente. L'installer migra i dati dai vecchi volumi. **La SPA esce dall'immagine**: secondo artefatto `sws-www-<ver>.tar.gz` (0,4 MB) e flag `--www-only` che la aggiorna in <1 s senza riavviare il container. Due difetti trovati provandolo sul dispositivo: (1) sostituire la *directory* montata rompe il bind mount → 404 su tutta la SPA finché non si riavvia il container, va sostituito il contenuto; (2) `curl -f` su `/` della porta admin dà 404 **pur servendo la SPA** (comportamento di `ServeDir::not_found_service`, che conserva lo status) — preesistente, si riproduce sull'editor di sviluppo, e rende `curl -f /` inutile come test di vivacità: usare `/health`.
- **Ricarica automatica dopo il deploy (2026-07-28)**: il runtime già ricaricava da solo, ma i client no — la SPA teneva in memoria il progetto caricato all'avvio. Nuovo `useProjectWatcher` sul fingerprint (3 s). **Comportamenti scelti dal maintainer**: viewer si aggiorna da solo con avviso breve di 4 s restando sulla pagina corrente; IDE **mai** automatico, solo banner con Ricarica/Ignora (i salvataggi propri sono esclusi con una finestra di 20 s, altrimenti l'avviso comparirebbe a ogni Ctrl+S); deploy con modifiche pendenti salva e procede. Confermato che l'auto-deploy al salvataggio quando connessi esisteva già.
- **Diagnosi 2026-07-28: "deploy riuscito ma sul dispositivo la versione vecchia"**. Non era il container né il deploy: `/api/remote/deploy` costruisce lo ZIP leggendo il progetto **da disco**, e le modifiche fatte nell'editor non erano state salvate. Provato con gli hash: i tre file sul device erano **byte-identici** a quelli su disco nell'editor, con mtime del giorno prima. Corretto con `flushBeforeDeploy()`: il deploy ora salva prima di esportare e si annulla se il salvataggio fallisce. Nota: la discovery mDNS ha funzionato al primo colpo dal browser del maintainer (`http://192.168.1.84:8444` trovato da "Cerca runtime"), quindi anche il fix dello schema annunciato è confermato in uso reale.

- **Sessione 2026-07-28 (2) — gestione container (su richiesta: "sistema il più possibile")**:
  - **Avvio al boot**, il buco principale: un container rootless non riparte dopo un reboot nemmeno con `--restart=unless-stopped`. Nuova unit **quadlet** `deploy/container/sws-runtime.container` + `deploy/container/install-container.sh` che gira **sul device senza sudo** e fa tutto (immagine, volumi, unit, linger, attesa di `/health`). Idempotente: i volumi esistenti non si toccano; il container precedente **va** rimosso, perché continuerebbe a usare l'immagine vecchia anche dopo `podman load` sullo stesso tag.
  - **Volume dei log**: prima i log stavano nel layer scrivibile e sparivano alla ricreazione.
  - **mDNS — la mia spiegazione di ieri era sbagliata**: non è il confine di subnet (il device *viene* scoperto da questa macchina), è la rete bridge di podman che non passa il multicast. Con `--host-network` la discovery funziona, verificato. Inoltre l'annuncio pubblicava sempre `https` anche girando in HTTP → URL offerto non funzionante: ora pubblica lo schema reale (`discover.rs` lo legge con default `https` per i runtime più vecchi).
  - **Bug preesistente trovato**: `hostname -I` in `deploy/yocto/install.sh` e `deploy/generic-linux/install.sh` — opzione di net-tools, inesistente dove `hostname` è di coreutils (Pixsys OS). Con `set -euo pipefail` abortiva l'installer **sul messaggio finale**, a installazione riuscita. Sostituito con `ip -4 -o addr`, che elenca tutti gli indirizzi (questi device ne hanno più di uno: `192.168.1.84` e `192.168.60.200`).
  - **Misurato sul device**: `podman stop` 1,3 s con exit 0 (prima 10 s + SIGKILL); deploy dall'IDE su `:8444` completo; connect su `:8443` rifiutato col messaggio corretto; progetto conservato dopo reinstall; unit `active` con `NRestarts=0`; discovery da altra macchina LAN ok in host network.
  - **Nota**: il deploy di test ha cancellato un progetto `test1` che era sul device — il deploy remoto svuota i progetti remoti prima di caricare (voluto, mono-progetto T-34). Il container era spento quando avevo sondato, quindi non l'avevo visto.
  - **Non provato**: il **reboot** del device, unica verifica reale che linger+unit facciano ripartire il container. Non l'ho fatto di mia iniziativa: se non tornasse su servirebbe accesso fisico.

- **Sessione 2026-07-28 — fix connect-porta + SIGTERM**:
  - **`connect_remote` non verificava nulla in no-auth mode**: causa reale del deploy fallito di ieri. L'handler salvava l'URL senza fare **alcuna** richiesta al target, quindi l'IDE diventava verde anche puntando alla porta viewer (o a un host inesistente); il 404/405 emergeva solo a metà deploy, perché le route di progetto stanno solo sulla porta admin. Ora sonda `GET /api/projects` — pre-auth sulla admin, assente sulla viewer — e su 404 rifiuta indicando la porta giusta. `/health` non sarebbe servito: risponde su entrambe.
  - **SIGTERM**: nuova `shutdown_signal()` (SIGINT **o** SIGTERM, con degrado a solo SIGINT se l'handler non si installa, invece di panic). Prima ogni `podman stop`/`systemctl stop` aspettava il grace period e finiva in SIGKILL, con rischio di troncare scritture.
  - **Verifica fatta**, non solo build: due istanze locali (viewer 8543+admin 8544 come target, admin 8546 come IDE) → connect verso 8543 rifiutato col messaggio corretto, verso 8544 accettato, verso porta chiusa errore di rete. SIGTERM: uscita in ~100 ms con `shutdown signal received` a log. `cargo test -p sws-web` 17/17.
  - **Nota di metodo**: i primi due tentativi di test SIGTERM si sono auto-sabotati — `pgrep`/`pkill -f "admin-port 8544"` matchavano la command line della mia stessa shell, uccidendola. Spostati in uno script su file, il pattern non si auto-matcha più.

- **Sessione 2026-07-27 (4) — container podman aarch64**:
  - **Perché non si è riusato il Dockerfile esistente**: è marcato legacy nei doc e ha quattro difetti concreti — compila Rust dentro l'immagine (ore in emulazione arm64), il builder non ha `libpython3-dev` mentre pyo3 usa `auto-initialize` (il link fallisce), il `CMD` non passa `--viewer-port`/`--www` (viewer mai in ascolto, healthcheck su 8443 perennemente rosso) e l'entrypoint pretende `SWS_ADMIN_PASSWORD`, che precede il no-auth mode. Resta intatto: è il percorso container x86 storico.
  - **Base image imposta dal binario, non scelta**: `readelf` sul binario cross dà `NEEDED libpython3.12.so.1.0` e simboli fino a `GLIBC_2.39` → serve Python 3.12 **e** glibc ≥ 2.39 insieme. `debian:bookworm-slim` (2.36 + 3.11) e `debian:trixie-slim` (2.41 + 3.13) sono entrambe fuori; `ubuntu:24.04` combacia.
  - **Trappola trovata in corso d'opera**: `HEALTHCHECK` non esiste nella spec OCI, quindi col formato di default podman lo scarta con un warning e `podman ps` non direbbe mai `healthy`. Lo script costruisce con `--format docker`.
  - **Esito sul device**: entrambi i listener su, `/health` ok da device e da LAN, SPA servita, template popolati, `podman ps` → `healthy`, progetto sopravvissuto alla **ricreazione** del container (volumi nominati, non bind mount: sotto rootless i bind mount richiedono che gli UID combacino con `subuid`). **RestrictedPython disponibile** → script sandboxati, cosa che l'immagine legacy non otteneva.
  - **Difetto scoperto, non risolto**: il runtime intercetta solo `ctrl_c()` (SIGINT), non SIGTERM (`main.rs:939`) → ogni `podman stop`/`restart` attende 10 s e finisce in `SIGKILL`, interrompendo eventuali scritture su `project.yaml`/SQLite. Riguarda anche il percorso systemd nativo, dove è solo meno visibile. **→ risolto il 2026-07-28.**
  - **Primo test dall'IDE (maintainer) — due esiti, entrambi NON bug del container**:
    1. **Deploy fallito con 404 + 405**: l'IDE era connesso a `http://192.168.1.34:**8443**`, la porta viewer. Le route di lifecycle progetto (`GET /api/projects`, `POST /api/projects/upload`) esistono **solo sulla 8444** — architettura dual-port voluta, `docs/CONTEXT.md`. Verificato sul device: su 8443 → 404 e 405, su 8444 → 200 e 400 (400 = corpo mancante, cioè la route c'è). **Soluzione: connettersi a `http://192.168.1.34:8444`.** Resta però un difetto di UI: "Connetti" verso la 8443 riesce e mostra "● Connesso" in verde, perché controlla solo `/health`, che risponde su entrambe le porte — dà per buona una connessione da cui il deploy non può funzionare. **→ risolto il 2026-07-28** (causa reale: in no-auth mode `connect_remote` non contattava affatto il target).
    2. **"Cerca runtime" non lo trova**: due cause indipendenti, nessuna risolvibile lato container. (a) mDNS è link-local e **non attraversa subnet diverse** — la dev box è su `192.168.0.201`, il device su `192.168.1.34` (debito già noto); (b) anche a parità di subnet, sulla rete rootless di podman il multicast non raggiunge la LAN: servirebbe `--network host`. Da riprovare con IDE e device sulla stessa subnet e container in host network.
  - **Permessi**: `Bash(ssh *)`/`Bash(scp *)` erano in **deny** (il deny vince sull'allow, `docs/CLAUDE_CODE_SETUP.md:248`); su indicazione del maintainer sono stati tolti dal deny e sostituiti da un allow ristretto a `user@192.168.1.34`. `Bash(rsync *)` resta in deny. **Da rivalutare a fine test.**

> **`archive/office-line-2026-05-21` eliminato il 2026-07-29** (locale + remoto), punta
> `4d93de8e76fe479be77c9714d9378716f2a46da9`. Non era un branch di feature: era una **linea di
> sviluppo parallela e non correlata** — nessun antenato in comune con `main`, radice diversa
> (`522df09`), 151 commit dal 10 al 21 maggio, dall'`Initial commit` fino a `feat(rbac): restrict
> Operator/Viewer to runtime-only`. Copriva TagDb, Modbus, MQTT, auth, historian, UX dell'editor,
> oggetto grid, OPC-UA, `sws-kiosk`, cross-build Yocto, RBAC — tutto rifatto meglio sulla linea di
> `main`, che alla data della cancellazione era avanti di 59.742 righe rispetto a quella punta.
>
> Solo 4 file esistevano lì e non in `main`: `ProjectIO.tsx` (rimosso di proposito), `scripts/dev.sh`
> (sostituito da `start_runtime.sh`/`start_editor.sh` — i riferimenti rimasti indietro sono stati
> corretti in `ed17fe9`), `SWS_Repository_Bootstrap_Prompt.md` e un piano del 14 maggio poi
> realizzato (`BindableInput`). **Nota: quei 151 commit non erano raggiungibili da nessun altro ref**,
> quindi dopo il `gc` non sono più recuperabili — a differenza dei branch qui sotto, il cui
> contenuto vive in `main`.

> **Branch chiusi il 2026-07-29.** Le due catene dell'editor sono entrate in `main` con gli squash
> `2ef99e6` (catena A: percorso progetto, progetti recenti, preset per brand, creazione cartelle,
> apertura da ZIP) e `3bddb66` (catena B: stato non salvato + Ctrl+S, controlli zoom, header a due
> livelli, rimozione di `ProjectIO`). Lo squash crea hash nuovi, quindi `git branch --merged` non li
> elencava pur essendo il contenuto già dentro: verificato funzione per funzione (`selectIsDirty`,
> `setZoomCentered`, `MainMenu`, `getDevicePresets`, `fs/mkdir`, `openFromZip`) e per dimensione dei
> file condivisi, dove `main` è sempre il più grande. Un merge tardivo avrebbe **riportato indietro**
> il codice: quei branch contengono la vecchia firma di `router::build`, il vecchio export di
> `alarm.rs` e la gestione segnali con solo `ctrl_c`.
>
> Punte cancellate, recuperabili con `git checkout <sha>`:
>
> | branch | punta |
> |---|---|
> | `feat/dirty-state-and-save` | `435de806d7337a27269eb7f8e1c78c8bfc9e851e` |
> | `feat/editor-zoom-toolbar` | `68dec23842f1f149be4ff167f9def20ee46a6c35` |
> | `feat/fs-mkdir` | `e3001a75e23df9102fd5fecd867b911d4c2016bc` |
> | `feat/slim-app-header` | `9ae8acc83c085f71ecc5ae72cc0393722cdb4836` |
> | `feat/project-location-and-brand-presets` | `80d948c69a9715d6360e529f2ea0a513ec69e417` (locale) / `918c274365218d52b14e10e6b61eecf6a3bf0874` (remoto) |
>
> Erano incatenati per evitare conflitti su `App.tsx`/`EditorShell.tsx`/`WelcomeScreen.tsx`; al merge
> l'unico conflitto di codice fra le due catene è stata la riga di import di `pageLayout` in
> `EditorShell.tsx`. `feat/container-aarch64` resta in piedi (mergiato in `main` come `72b6b3c`):
> `CLAUDE.md` chiede di non cancellare i branch subito dopo il merge.

- **Sessione 2026-07-29 — demo Sandokan (MQTT reale) + fix storico perso al riavvio (cherry-pick diretto in `main`, non branch dedicato — vedi nota di processo)**:
  - **Template `examples/templates/nebulizzatore-sandokan/`**: presa smart Zigbee2MQTT reale (NEO NAS-WR01B, `zigbee2mqtt/presa.sandokan` su `192.168.1.6:1883`) che alimenta un nebulizzatore antizanzare — sorgente MQTT multi-`json_path` sullo stesso topic, storico SQLite, due allarmi soglia 1W (`Above`/`Below`, l'unico modo per avere due notifiche Telegram distinte accensione/spegnimento — il motore invia Telegram solo sull'attivazione, mai sul rientro), pagina con simbolo pompa animato + 3 trend separati (potenza/corrente/tensione, assi indipendenti per non schiacciare i valori piccoli contro la tensione). Bot Telegram reale rilevato via `getUpdates` (stessa tecnica del pulsante "Rileva chat") e configurato **solo** nei progetti locali gitignored, mai nel template committato. Importato come progetto "Sandokan" su IDE e runtime (creazione indipendente su entrambi via l'endpoint pre-auth, non il flusso "Deploy" one-click che avrebbe cancellato il progetto "default" già attivo sul runtime).
  - **Bug trovato durante il test**: il maintainer nota che il trend non mostra lo storico pregresso all'apertura pagina, solo i dati da quel momento in poi. Isolato confrontando una query SQLite diretta (448 campioni dalle 21:54 della sera prima) con la risposta API nello stesso istante (15 campioni, solo dal riavvio del processo delle 06:49) — il percorso di boot "legacy auto-open" in `main.rs` non chiamava mai `historian.swap_store(...)`, a differenza di `open_project` (handler HTTP) che lo fa correttamente dal commit `2911d14`. Fix: stessa chiamata aggiunta al percorso di boot. Verificato in log (`historian: swapped to project SQLite`) e via API (storico completo tornato).
  - **Preset "Tutto"** nel pop-up espanso del trend (oltre 1h/8h/24h/7d): risolve `fromMs` dal campione più vecchio via l'endpoint stats già esistente.
  - **Nota di processo**: lavoro fatto sul branch `feat/project-location-and-brand-presets` (che nel frattempo un'altra sessione aveva già in parte squash-mergiato in `main` tramite una catena diversa, `feat/fs-mkdir`). Uno squash dell'intero branch avrebbe ri-toccato file già superati da lavoro indipendente su `main` (refactor `App.tsx`/header/toolbar); invece, dopo aver riallineato `main` a `origin/main`, **cherry-pick mirato** dei soli 2 commit realmente nuovi (`718a3bb` demo, `d3fef51` fix storico) — nessun conflitto, `cargo build`+`pnpm build` verdi. Branch locale cancellato dopo la verifica; il branch remoto resta finché `main` non viene pushato (per non lasciare il lavoro assente da GitHub nel frattempo).
  - **Verifica**: `cargo build` (sws-core/-web/-runtime) + `pnpm build` verdi; storico e allarmi confermati via API sul runtime live dopo il riavvio; **validato dal maintainer** ("funziona").

- **Sessione 2026-07-27 (3d) — cartelle + copia sul PC (branch `feat/fs-mkdir`)**:
  - **`POST /api/fs/mkdir`** accanto a `browse-dirs`: parte pura `resolve_new_dir()` (testabile senza `AppState`, riusa `safe_project_name`), `create_dir` e **non** `create_dir_all` — un refuso in `parent` non deve materializzare un albero. 409 su esistente, 403 su permessi.
  - **Postura di sicurezza**: la route entra nel gruppo **pre-auth** `project_lifecycle` come `browse-dirs`, perché il selettore serve prima che esista una sessione. Non aggiunge capacità nuove (`POST /api/projects` con `parent_path` fa già `create_dir_all` arbitrario), ma la superficie `/api/fs/*` pre-auth è ora annotata in `docs/OPEN_QUESTIONS.md` sotto Q8 come debito da chiudere al passaggio a prodotto.
  - **UI**: "＋ Nuova cartella" nel `DirectoryBrowser` con input inline (Invio/Esc) — non `prompt()`, che non è traducibile né stilabile ed è soppresso in alcune webview kiosk (questa app gira su WebPanel). Dopo la creazione si entra nella cartella nuova.
  - **"📂 Apri da file ZIP…"** nella WelcomeScreen: esisteva già dietro "Nuovo progetto → Da ZIP", ora ha un ingresso proprio. È **non distruttivo** (nuovo progetto), a differenza della voce nel ☰.
  - **Verifica**: `cargo check -p sws-web` + `cargo test -p sws-web` (17 test, 2 nuovi) + `pnpm build` verdi; **validato in browser dal maintainer**.

- **Sessione 2026-07-27 (2) — percorso progetto a scelta + progetti recenti + preset brand (branch `feat/project-location-and-brand-presets`)**:
  - **Registro `known_projects.json`** (nuovo `sws-web/src/project_registry.rs`): mappa `nome → {path, last_opened_ms}`, persistito in `config_dir`, caricato in `AppState.known_projects`. Toccato automaticamente da `create_project`, `open_project` e `upload_project_zip` — copre sia i progetti in `projects_root` sia quelli a percorso custom.
  - **Percorso a scelta in creazione**: `CreateProjectRequest.parent_path` (+ query `?parent_path=` su upload ZIP) opzionale, path assoluto validato/creato con `create_dir_all`; assente = comportamento invariato (`projects_root`). Nessuna whitelist di radici (scelta esplicita del maintainer — PoC, LAN fidata).
  - **`list_projects`** ora unisce la scansione legacy di `projects_root` con lo snapshot del registro, **ordinata per `last_opened_ms` decrescente** (elenco "progetti recenti"); nuovi campi DTO `path`, `last_opened_ms`, `external`.
  - **`rename`/`duplicate`/`delete`**: risoluzione via registro; comportamento differenziato per le voci **esterne** (path fuori da `projects_root`) — rename non sposta la cartella (solo `meta.name` + chiave registro), duplicate crea una cartella sorella nello stesso genitore, delete **de-registra soltanto** senza toccare i file (mai cancellare a sorpresa dentro Documenti/backup del maintainer).
  - **Nuovo endpoint `GET /api/fs/browse-dirs`**: mini file-browser server-side (elenca sottocartelle, naviga su/giù), nessuna whitelist, default `$HOME`/`projects_root` se `path` assente.
  - **Frontend**: `WelcomeScreen.tsx` → `NewProjectModal` ha una sezione "Cartella di destinazione" (comune alle 3 tab: vuoto/template/ZIP) con campo testo + pulsante "Sfoglia…" che apre il nuovo componente `DirectoryBrowser`; anteprima live del path finale. Ogni card progetto mostra il `path` come sottotitolo/tooltip, badge "esterno" e — per le voci esterne — l'azione "Elimina" diventa "Rimuovi dall'elenco".
  - **Preset dispositivo legati al brand**: `Brand.devicePresets` (letto da `meta.device_presets` in `brand.json`); i 5 modelli Pixsys (WP570/WP800/WP815-615/WP820-620/WP830-630) spostati da `pageLayout.ts` (hardcoded) a `public/branding/pixsys/brand.json`. `DEVICE_PRESETS` → `STANDARD_DEVICE_PRESETS` + nuova `getDevicePresets()` = standard + preset del brand attivo; dropdown raggruppato in due `<optgroup>`.
  - **Verifica**: `cargo build -p sws-core -p sws-web -p sws-runtime` + `cargo test -p sws-web` (15 test) + `pnpm build` verdi; **validato in browser dal maintainer**.
  - **Nota di processo**: lavoro inizialmente iniziato per errore sul working tree di `main` — spostato su branch dedicato prima del commit.

- **Sessione 2026-07-27 (3b) — zoom + toolbar editor (branch `feat/editor-zoom-toolbar`)**:
  - **Il problema segnalato**: zoomando non c'era modo di tornare alla pagina intera. Gli unici comandi erano un badge `%` non cliccabile e un `⊡` in un angolo del canvas — e quel `⊡` adattava **agli oggetti**, non alla pagina.
  - **`fitPage()`** nuova: dimensioni reali della pagina meno la fascia righelli e 24px di margine per lato; in modalità **fluida** ricade su `fitObjects` e il pulsante è disabilitato con tooltip. Dimensione calcolata dalla nuova pura `editorFitSize()` in `pageLayout.ts`. **`Ctrl+Shift+0` ora adatta la pagina** (via ref, così segue la pagina corrente).
  - **Slider** a passi discreti 10→400%; la `%` mostrata è il valore vero (un Ctrl+rotella intermedio resta onesto), cliccarla torna al 100%.
  - **`EditorToolbar`** nuova (solo in Editor, tra header e tab pagine): undo/redo (finora **solo da tastiera**), griglia+snap spostati dall'header, righelli, zoom. Estratta anche `PageTabs`.
  - **Scelta architetturale**: zoom/pan restano in ref locali dentro `SvgCanvas` ed escono con un handle imperativo `CanvasViewApi`; nello store il pan (frequenza mousemove) farebbe rigirare i selettori di tutta l'app ~60 volte/s. `applyView` notifica il genitore solo se il fattore cambia davvero. `showRulers` invece va nello store: toggle discreto con due punti di ingresso.
  - **Verifica**: `pnpm build` verde; nuovo `tests/pageLayout.test.ts` (4 casi) — ha subito trovato che `referenceResolutionFor` restituisce l'intera voce `ASPECT_RATIOS` e non solo width/height, normalizzato.

- **Sessione 2026-07-27 (3c) — header a due livelli (branch `feat/slim-app-header`)**:
  - Risposta alla domanda "cosa serve raramente": **tema, lingua UI, Reboot, pannello Log**. Log e Reboot → ☰ (con conferma e gate `canConfigureProject`); utente + pill ruolo, lingua e tema → nuovo menu **👤**, che di proposito non contiene azioni privilegiate (identico per tutti i ruoli).
  - Ordine finale: logo · pill runtime remoto · progetto + pallino non salvato · Editor|Config · acquisizione + Start/Stop · Deploy · 👤 · ☰.
  - **Scomposizione, non riscrittura**: `App.tsx` 1047 → 626 righe; estratti `BrandLogo`, `RuntimeCtrl` (meno Reboot), `MainMenu`, `UserMenu`, `headerStyles.ts` (+ hook `useOutsideClose`, prima duplicato). Tradotte le ultime stringhe IT hardcoded toccate.
  - **Attenzioni rispettate**: `<input type=file>` resta fuori da `{open && …}` (GitHub issue #2); l'etichetta "☰ Menu" è invariata (tre spec e2e ci dipendono); i gate di ruolo riapplicati uno per uno dopo lo spostamento.
  - **Copia sul PC trovabile**: "Esporta/Importa progetto" → **"💾 Salva copia sul PC…"** / **"📂 Sostituisci da copia sul PC…"** (restano Admin-only). Aggiornato il selettore di `e2e/import-tags.spec.ts` nello stesso commit. Eliminato `ProjectIO.tsx`, duplicato morto degli stessi flussi.

- **Sessione 2026-07-27 (3) — stato "modificato", Ctrl+S, salvataggio globale (branch `feat/dirty-state-and-save`)**:
  - **Contesto**: richiesta del maintainer (4 migliorie all'editor). Analizzando il codice sono emersi tre buchi non sospettati: `Ctrl+S` **non esisteva**, non c'era `beforeunload`, e in modalità Configurazione salvare era *fisicamente impossibile* (il salvataggio era un contatore `saveSerial` a cui reagiva `EditorShell`, che lì è smontato).
  - **Modello dirty riscritto**: `isDirty` era acceso solo da `pushHistory` (tab di Configurazione invisibili) e undo/redo non lo toccavano (undo fino allo stato salvato lo lasciava acceso). Ora è un selettore derivato `selectIsDirty` su due sorgenti: contatore `pagesRev` timbrato nelle voci di history (ripristinato da undo/redo/jumpTo) con `savedPagesRev` scritto solo da un salvataggio completo; e registro `pendingSections` (chiave → come salvarsi) in cui si registrano la `SaveBar` della tab attiva e il `FunctionEditor`. Il campo `isDirty` è stato **rimosso** perché non possa disallinearsi.
  - **Trappola evitata**: i setter `updateProject*` non marcano dirty — le tab salvano su API e *poi* aggiornano lo store, quindi la copia in memoria combacia sempre col disco; marcarli renderebbe il progetto sporco per sempre.
  - **`saveAll()` nello store** al posto di `saveSerial`: svuota prima le bozze registrate, poi salva pagine + sezioni di progetto (Admin). "Salva tutto" nel ☰ non è più editor-only. `waitingForSave` ora aspetta `saveStatus === "ok"` e non `!isDirty` (altrimenti una tab sporca bloccherebbe "Salva e chiudi" all'infinito).
  - **UI**: `DirtyIndicator` (pallino ambra cliccabile) accanto al nome progetto nell'header di app, `●` nel titolo scheda, `Ctrl+S` globale, `beforeunload` solo mentre sporco, `resetDirty()` su chiudi-progetto/logout (altrimenti dopo un "chiudi scartando" un F5 chiederebbe conferma per un progetto non più aperto).
  - **Fix collaterale**: `renameGroup` mutava le pagine senza `pushHistory` — invisibile sia a undo sia al flag.
  - **Verifica**: `pnpm build` verde; nuovo `tests/dirtyState.test.ts` 6/6 verde (undo fino al salvato, redo, undo oltre il salvato, bozze indipendenti dal canvas, resetDirty); **validato in browser dal maintainer**. Nota: `pnpm lint` non parte sulla dev box (manca `eslint-plugin-react-hooks` in `node_modules`) — preesistente.
  - **DA FARE (browser)**: vedi elenco validazioni in sospeso.

- **Sessione 2026-07-27 (1) — gestione pagine + pannelli ridimensionabili + fix lang_selector (branch `fix/T-40-regressions`, squash-mergiato in `main`)**:
  - **Dimensionamento pagina** (project-wide): Fisso (1:1 no-scaling)/Solo proporzioni (scale-to-fit su risoluzione standard)/Fluido; `PageSizeMode`/`PageLayoutConfig` su `Project`, endpoint `PUT /api/project/page-layout`; passare a "Proporzioni" propaga la risoluzione a tutte le pagine. Clamp rigido ai confini in editor. Preset dispositivo (5 Pixsys WebPanel + 4 standard) in Proprietà pagina. Pannello "Impostazioni pagine progetto" (⚙): modalità + rapporto + home page.
  - **Home page**: fallback automatico se fuori zona ABAC; rotazione kiosk riparte dalla home.
  - **Riordino drag&drop** pagine + **miniature** live nella lista.
  - **Report "Verifica collegamenti"** (🔗): navbutton con target inesistente + pagine orfane.
  - **Lock pagina** (🔒/🔓): canvas e pannello proprietà read-only via `fieldset[disabled]`, non blocca duplica/elimina.
  - **Fix collaterale**: `auto_rotate_skip` mancava dal mirror Rust `synoptic.rs` → perso ad ogni GET (round-trip) — corretto.
  - **Pannelli editor ridimensionabili** (sinistra 160–480px, destra 220–560px), persistiti in localStorage.
  - **Fix bug**: oggetto "Lingua ▾" (`lang_selector`) non trascinabile in editor — `<select>` HTML dentro `foreignObject` montato anche in edit mode intercettava il mousedown; riallineato al pattern slider (preview SVG in editor, widget reale solo a runtime).
  - **Verifica**: `cargo build` (sws-core/-web/-runtime) + `pnpm build` verdi; e2e manuale via API (round-trip locked/auto_rotate_skip/page_layout, audit trail) su runtime reale; **validato dal maintainer in browser** (pannelli + drag lang_selector confermati funzionanti).

- **Sessione 2026-07-26 (2) — Q8: isolamento runtime↔IDE — modalità operator-only + audit log**:
  - **Contesto**: analisi della history del progetto su richiesta del maintainer → identificati task abbandonati (nessuno critico) e il gap architetturale più rilevante: runtime e IDE/admin condividono lo stesso processo (`AppState` unico, due router sulla stessa istanza). Documentato come **Q8** in `docs/OPEN_QUESTIONS.md` con roadmap A(operator-only)/B(gating)/C(reload granulare)/D(audit)/E(split processi)/F(python out-of-process).
  - **A — modalità `--no-admin`** (`sws-runtime/src/main.rs`, `sws-web/src/router.rs`): non binda la porta admin/IDE (richiede `--viewer-port`); riduce la superficie a viewer + funzioni bound.
  - **B — gating**: in quella modalità `/api/script/exec` (codice arbitrario) non è registrato sul viewer; `/api/script/run/:name` (bottoni) resta.
  - **D — audit log reale** (`sws-audit`, prima uno stub): hash-chain SHA-256 + HMAC opzionale (`SWS_AUDIT_KEY`), JSONL append-only, `verify()` rileva manomissioni. Cablato su login/logout/tag-write/script-exec/script-run/modifiche-config (tags/sources/alarms/notifications/global_scripts). Endpoint `GET /api/audit` + `/api/audit/verify` (Admin). Vista read-only in Configurazione → Sistema.
  - **Verifica end-to-end fatta** (non solo build): runtime avviato, tag write + script exec → `GET /api/audit` mostra le entry con hash-chain corretta, `verify` → `ok:true`; alterata a mano una entry nel file → `verify` rileva `broken_at` corretto. `cargo build` (sws-audit/-web/-runtime) + `pnpm build` verdi.
  - **DA FARE (browser/runtime)**: validare la vista Audit in Configurazione → Sistema; provare `--no-admin` su un device reale (richiede `--viewer-port` impostato, es. `start_runtime.sh`).

- **Sessione 2026-07-26 (1) — Notifiche Telegram + uniformazione tasto Salva**:
  - **Telegram** (canale allarmi + funzione script `send_telegram`): nuovo `TelegramConfig` in `NotificationConfig`; `sws-web/src/telegram.rs` (`TelegramSender` drainer + `reqwest`, config hot-swappabile); allarmi `ActiveUnacked`/escalation → chat globali Telegram (in `notifications.rs`); binding `send_telegram("testo")` iniettato negli script globali (pyscript HTTP-free, spinge su canale mpsc drenato da sws-web); `bot_token` mascherato nelle GET. **UI** in Notifiche: toggle/token/chat + **"Invia test"** e **"Rileva chat"** che chiamano la Bot API **direttamente dal browser** (funzionano dal solo editor), con auto-retry sul rilevamento. Endpoint `POST /api/notifications/test-telegram` (server-side, non più usato dal frontend). **Scope**: `send_telegram` attivo negli script globali (nelle funzioni esiste ma "non configurato" — follow-up).
  - **Fix persistenza Notifiche**: `NotificationsTab` non aggiornava lo store dopo il save → config spariva al cambio tab. Nuovo setter `updateProjectNotifications`.
  - **Uniformazione tasto Salva**: `SaveBar` verde, in alto a destra, sticky, con feedback "✓ Salvato", applicata a tutte le tab con salvataggio (Tags/Protocolli/Allarmi/Notifiche/Script/Datastore/Lingue); Faceplate/Ricette ricolorate a verde; aggiunto feedback dove mancava (Datastore).
  - **DA FARE (browser/runtime)**: rebuild+restart runtime per attivare allarmi Telegram + `send_telegram` negli script (config/test già funzionano dall'editor); validare uniformazione Salva.

- **Sessione 2026-07-24 — fix MQTT + palette + feature "Estrai da JSON"**:
  - **MQTT packet size**: nessun client impostava `set_max_packet_size` → default rumqttc 10 KB → un retained da 29 KB rompeva browse + ricezione live. Fix: costante `MAX_PACKET_SIZE_BYTES = 5 MB` su `connect`/`browse`/sparkplug ([sws-plugin-mqtt](sws-runtime/crates/sws-plugin-mqtt/)).
  - **MQTT browse durata**: default 30 s (era 8), cap 120 s (era 15) — [router.rs](sws-runtime/crates/sws-web/src/router.rs) + input frontend.
  - **Fix palette su progetto vuoto**: `addObject` non aveva pagina corrente → nessun oggetto aggiunto. Ora crea la pagina al volo ([store/index.ts](sws-editor/src/store/index.ts)).
  - **Feature "Estrai da JSON"** ([ConfigView.tsx](sws-editor/src/config/ConfigView.tsx)): pulsante nella card MQTT → incolli un payload JSON → appiattimento a variabili foglia (dot-path annidati, tipo dedotto), selezione → genera righe `TopicMapping` + opzionale creazione `TagDef`. Interamente frontend (il plugin naviga già i json_path).
  - **DA FARE (maintainer, browser)**: riavvio runtime per il cap durata 120 s (packet size già live); hard-refresh per palette + Estrai-JSON.

- **Sessione 2026-07-21 — anteprima lingua editor + filtro/ordinamento tabella Lingue**:
  - **Sintomo (maintainer)**: nell'editor, cambiando lingua, i testi degli oggetti sul canvas non cambiavano. **Causa**: `EditorShell` cablava l'anteprima sulla lingua predefinita del progetto e il corpo non sottoscriveva nulla di reattivo alla lingua → il memo `canvasObjects` non ricalcolava.
  - **Decisioni maintainer**: (1) anteprima canvas indipendente dalla lingua UI; (2) i due selettori (Progetto + Editor) stanno nel tab Configurazione → Lingue; «Lingua progetto» = sorgente/predefinita (`table.default`), «Lingua Editor» = anteprima; (3) tabella messaggi filtrabile + ordinabile.
  - **Implementato**: nuovo `editorPreviewLang` nello store (`sws.editorPreviewLang`, helper in `projectI18n.ts`); `EditorShell` legge `previewLang` dallo store (fallback a default); `LanguagesTab` con 2 selettori + filtro per colonna (case-insensitive) + ordinamento per colonna (asc→desc→off, solo visuale); vista index-safe (`origIdx`) così le modifiche colpiscono la riga giusta con filtro/ordine attivi; rimozione lingua/import CSV azzerano filtri stale; nuove chiavi i18n IT/EN.
  - **DA FARE (maintainer, browser)**: hard-refresh `:8460` → tab Lingue: 2 selettori + filtro/ordinamento; «Lingua Editor»=en → canvas oggetti in inglese.

- **Sessione 2026-07-13 — T-39 + T-40 + fix regressioni + template**:
  - **T-39 — IDE/Runtime bilingue IT/EN** (11 commit `e454d6b`…`b786b99`): infra react-i18next (IT base + EN, lingua da `localStorage sws.uiLang` → browser → it, fallback en), `UiLangSelect` in header IDE e nav viewer, **~667 chiavi** estratte da tutta la chrome (App shell, viewer, LeftPanel, auth, WelcomeScreen, componenti minori, EditorShell ~190 label, ConfigView 14 tab). Asse UI indipendente dai contenuti di progetto.
  - **T-40 — tabella lingue di progetto** (`79825df`, `895dbfe`): Rust `LanguageTable {default, langs, entries:[{key,values}]}` + campo `Project.languages` (`#[serde(default)]`, viaggia con export/import ZIP) + `PUT /api/project/languages`. Frontend: `src/i18n/projectI18n.ts` (`resolveMsg` risolve `{{token}}` nella lingua corrente; `localizeObjects` applicato a monte di SvgCanvas nel viewer/editor), store `projectLang`, tab **"Lingue"** in ConfigView (griglia + CSV export/import), oggetti canvas `lang_selector`/`lang_button` + token-picker nel pannello proprietà. Round-trip e2e verde (`e2e/lang-table.spec.ts`).
  - **Fix 2 regressioni T-40** (`4a0f8a2`, e2e `e2e/bugcheck.spec.ts`): (1) **crash su selezione oggetto** — selettore Zustand instabile in `ObjectProps` (`…entries?.map()` → nuovo array a ogni render → loop infinito) → risolto con `useMemo` su `entries`; (2) **nuovo progetto vuoto mostrava il contenuto del precedente** — il mount-effect in `App.tsx` usciva senza `setPages([], "")` sui synoptic vuoti → aggiunto azzeramento pagine/faceplates.
  - **Template conformi IT/EN** (`42094b3`): **479** stringhe `label`/`text`/`pipe_label` tokenizzate `{{token}}` + tabella `languages` (it/en) in tutti i 9 template (homeassistant-pro 154 voci, casa-locale 135, ecc.; s7/enip/sparkplug-demo tabella vuota). `lang_selector` in Page 1 dei 6 con contenuto. **Insidia risolta**: key `on`/`off` quotate (altrimenti booleani YAML rompono il load).
  - **Capitolo manuale "Multilingua"** (`docs/manual/15_multilingua.md`), riga aggiunta all'indice in `MAIN.md`.
  - **DA FARE (browser)**: validazione di T-39/T-40 (switch lingua UI header, tab Lingue, `lang_selector` in un template, no-crash su selezione, nuovo progetto vuoto pulito).

---

## Storico (sessioni chiuse: mergiate e verificate — dettaglio in `CHANGELOG.md` e `git log`)

- **2026-07-09** — fix tema chiaro: righelli canvas + pannello LOG, colori hardcoded → `var(--brand-*)` (`71fb0d9`). Confermato in browser.
- **2026-07-08** — **T-38 brand Pixsys** white-label (`cfee5f1`): `public/branding/pixsys/` (brand.json 10 token, logo, favicon), `active.json` → `pixsys`.
- **2026-07-07** — **T-37 build pacchetti** (`2a991e9`): `scripts/build_deploy.sh` → 4 tarball editor/runtime × x86_64/aarch64; installer `deploy/{editor,yocto,generic-linux}`; fix `--viewer-port` mancante nei launcher.
- **2026-07-06** — **T-35 infrastruttura white-label**: `public/branding/` + loader `applyBranding()` (CSS var `--brand-*`, title, favicon); ~977 colori di chrome portati a `var(--brand-*)`.
- **2026-06-20** — **GitHub issue #2** (import progetto: `<input type=file>` smontato alla chiusura del menu → `onChange` mai eseguito), regression test `e2e/import-tags.spec.ts`; bugfix grid paste/cut in sub-celle, riscrittura `TagInput`, valore live in Variabili, auto-deploy al salvataggio.
- **T-34** — runtime mono-progetto (marker `.active-project`), versionamento progetto (`saved_by`, `POST /api/project/migrate`), no-auth mode. Verificato da `scripts/test_t34.sh` (18/18 verdi).
- **WebSocket remote bridge + no-auth + deploy relay** — `POST/DELETE /api/remote/connect`, `GET /api/remote/status`, `/ws/remote/{tags,alarms,logs}`, `POST /api/remote/deploy` (nessun fetch diretto browser→device).
- **TLS opzionale** — HTTP plain di default, HTTPS se `config/tls.crt` è presente all'avvio; endpoint admin genera self-signed / carica cert+key / disabilita, con reboot.
- **Split `dev.sh`** → `start_runtime.sh` (viewer 8443 + IDE 8444 + companion HTTP 8080) e `start_editor.sh` (IDE 8460 + companion 8090).
- **T-29…T-33** — widget canvas Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline.
- **T-28** — IDE package builder + deploy SSH su device. **T-27** — packaging generic Linux (`package.sh` + installer systemd). **T-26** — git commit/push dall'IDE. **T-25** — remote log viewer. **T-24** — project fingerprint SHA256 + dashboard Device.

**Branch**: `main` = `c4d8e62`, allineato a `origin/main`. Pulizia branch del 2026-07-27: eliminati i branch già assorbiti in `main` (`feat/T-37-build-deploy`, `fix/light-theme-ruler-log`, `feat/T-39-ide-i18n`, `feat/T-40-project-i18n`, `fix/T-40-regressions`). Aperto e **non mergiato**: `feat/project-location-and-brand-presets` (da testare in browser). Tenuti apposta: `archive/office-line-2026-05-21`, `backup/friday-phase-a1`.

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

> **Piano "migliorie editor" (2026-07-27)**: 4 blocchi decisi col maintainer — (1) stato "non salvato" ✅, `feat/dirty-state-and-save`; (2) zoom + toolbar contestuale ✅, `feat/editor-zoom-toolbar`; (3) header a due livelli ✅, `feat/slim-app-header`; (4) creazione cartelle nel picker + copia progetto sul PC ✅ fatto, branch `feat/fs-mkdir` sopra `feat/project-location-and-brand-presets`. Tutti e 4 mergiati in `main` il 2026-07-27 dopo validazione in browser.

**Validazioni in sospeso (browser / runtime reale)**

- [ ] **Audit log + `--no-admin`** (2026-07-26): vista Audit in Configurazione → Sistema; `--no-admin` su un device reale (richiede `--viewer-port`).
- [ ] **Telegram** (2026-07-26): rebuild+restart runtime per attivare allarmi Telegram e `send_telegram` negli script; validare l'uniformazione del tasto Salva.
- [ ] **MQTT** (2026-07-24): riavvio runtime per il cap browse a 120 s; hard-refresh per palette su progetto vuoto e "Estrai da JSON".
- [ ] **Multilingua T-39/T-40** (2026-07-13/21): switch lingua UI, tab Lingue (2 selettori + filtro/ordinamento), `lang_selector` in un template, anteprima canvas in lingua Editor.
- [ ] **Branding** (T-35/T-38, entrambi in `main`): logo/palette/titolo/favicon Pixsys in tema **chiaro e scuro**, IDE (8460/8444) e viewer (8443); switch brand via `public/branding/active.json`.
- [ ] **Pacchetti T-37 su device reale**: `sws-runtime-*-linux-aarch64.tar.gz` su un Pixsys (`sudo ./install.sh` → `/data/user/sws`), viewer `:8443` + IDE `:8444`; su PC `sws-editor-*` + `./run-editor.sh`.
- [ ] **Verifica manuale T-27** — packaging tarball + installer generic Linux. Comandi sotto.
- [ ] **Verifica manuale T-24/T-25/T-26** — fingerprint/device dashboard, remote logs, git commit/push. Comandi sotto.

**Debito tecnico noto (non bloccante)**

- [ ] **`sws-kiosk` non rispetta `--viewer-port`** (hardcoded `https://localhost:8443` nel wayland spawn). Fix triviale in `main.rs` se/quando si usa il kiosk su device multi-istanza.
- [ ] **`stop_existing()` in `scripts/start_runtime.sh` usa `fuser`** — su macOS o sistemi senza `fuser` non funziona. Non prioritario (sviluppo su Linux).
- [ ] **mDNS**: in container serve `--host-network` (la rete bridge di podman non passa il multicast). Verificato che attraversa `192.168.0.x` ↔ `192.168.1.x` su questa LAN, quindi il vecchio appunto "non attraversa subnet" era sbagliato. Resta aperto: un device con più interfacce compare più volte in `/api/discover` (un'entry per indirizzo) e la UI mostra duplicati.
- [ ] **Q8 C/E/F** — reload granulare, split processi runtime/IDE, python out-of-process. Vedi `docs/OPEN_QUESTIONS.md`.

### Verifica manuale T-27 da fare

```bash
# Build tarball completo (richiede ~5 min per cargo + pnpm)
./scripts/package.sh

# Verifica struttura
tar tzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz | head -10

# Test installer in locale (o su VM)
tar xzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz
sudo ./sws-0.1.0-dev-linux-x86_64/install.sh
# → apri https://localhost:8443 e https://localhost:8444
```

### Verifica manuale T-24/T-25/T-26 da fare

```bash
# Avviare runtime locale (viewer 8443 + IDE/admin 8444)
./scripts/start_runtime.sh

# T-26: Configurazione → Runtime → connettiti → sezione "GitOps"
# → "💾 Commit" → scrivi messaggio → Salva
# → "↑ Push (N)" → confirm → mostra output git push

# T-24: Configurazione → tab "Device"
# → aggiungi device (URL del runtime locale: https://localhost:8444, admin/admin)
# → "Aggiorna" → mostra stato online + firma SHA256
# → "Connetti" → l'IDE si connette a quel runtime

# T-25: Configurazione → Runtime → connettiti
# → sezione "Log remoti" → "Aggiorna" → lista log
# → "● Live" → aggiornamento automatico ogni 5 s

# Smoke fingerprint:
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq -r .token)
curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project/fingerprint
# → {"sha256":"...","computed_at_ms":...}
```

---

## Feature set consegnato (PoC completo T-01…T-40)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step, gestione pagine (dimensionamento, riordino, miniature, lock, home) |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log hash-chain |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation, Telegram |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N`, `--no-admin` (operator-only), mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live, audit log verificabile |
| **Canvas** | Pipe/tubazione multi-waypoint (flat/tube/wire), SVG path animato, drag waypoint |
| **Widget avanzati** | Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline |
| **Multilingua** | UI IT/EN (react-i18next, ~667 chiavi) + tabella lingue di progetto (`{{token}}`, CSV, `lang_selector`) |
| **Branding** | White-label via `public/branding/` (brand.json + logo + favicon + 10 token colore); brand Pixsys |
| **Packaging** | `scripts/build_deploy.sh` → tarball editor/runtime x86_64+aarch64; installer systemd generic-linux e Yocto |
| **IDE deploy** | Build tarball + deploy SSH su device direttamente da Configurazione → Runtime |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q1…Q7 decise. **Q8** (isolamento runtime↔IDE): A/B/D fatti, **C/E/F aperti**.
