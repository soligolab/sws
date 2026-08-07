# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.

**Last session**: 2026-08-07 — avviato un nuovo filone: motore di rendering **LVGL** per target
embedded (framebuffer/DRM/Wayland, in futuro ESP32), come seconda modalità di progetto accanto
al web. Sessione dedicata solo ad analisi architetturale + fondamenta (Fase 1), non a
rendering funzionante. Vedi sezione dedicata sotto e `docs/plans/2026-08-07-lvgl-engine.md` per
il piano completo.

**Sessione precedente**: 2026-08-06 (notte) — **sessione lunga in autonomia** (il maintainer è andato a
dormire a metà, chiedendo di proseguire i task pianificati e poi di indagare migliorie): T-41
(pagine cancellate/rinominate ora persistono davvero), un fix sistemico al mirror Rust↔TypeScript
(62 campi mancanti su `SynopticObject`), T-42/T-43 (campanella e barra allarmi piazzabili,
**verificati dal maintainer in browser**), T-44/T-45 (DataTable condiviso + Ricette + modalità
tabella su alarm_viewer, verificati solo da me con harness/build+test — **non ancora provati dal
maintainer**), e infine un audit di qualità del codice (due Explore agent) con una serie di fix
mirati (vedi sezioni dedicate sotto). T-46 (rimozione vecchia chrome allarmi) deliberatamente
rimandato — vedi nota su [[project_t46_alarm_chrome_removal]] in memoria: dopo T-46 gli allarmi
diventano per-pagina opt-in, non un fallback globale.

**Da fare alla ripresa**: provare in browser T-44 (Config → Ricette, sort/filtro) e T-45
(alarm_viewer → modalità Tabella) e i fix dell'audit (severità allarmi uniformi, watchdog MQTT
`max_silence_secs` ora in UI sotto Connessione, trasformazione disponibile su lang_button/
lang_selector) — poi, se tutto ok, squash-merge dell'intero branch in main. Rivedere anche
`docs/plans/2026-08-06-audit-widget-e-codice.md` (proposte non implementate: BindableInput
mancante su vari campi, color picker mancante su slider/checkbox/radio, possibile widget
faceplate/setpoint/XY-plot, ecc.) e decidere cosa vale la pena fare.

**Nota a parte**: il branch `feat/trend-compact-pan` (pulsanti pan ◀/▶ + passo configurabile sul
Trend compatto, da una sessione precedente a stanotte) resta isolato e non mergiato — con il
drag-to-zoom di T-48 ora in main, potrebbe essere in parte ridondante. Da decidere se
riprenderlo, scartarlo o riconciliarlo con T-47/T-48 prima di chiudere il branch.

## 2026-08-07: motore di rendering LVGL — Fase 1 (branch `feature/lvgl`)

Nuova richiesta del maintainer: poter generare l'interfaccia in **LVGL** per target embedded
(disegno diretto su framebuffer/DRM o come client Wayland), come seconda modalità di progetto
scelta alla creazione (Web vs LVGL, con parametri HW se LVGL — in futuro anche ESP32). Sessione
di sola analisi architetturale + fondamenta, su un **ramo di lunga durata separato**
(`feature/lvgl`, non il pattern `feat/T-XX`), con merge periodici da `main` e riunificazione
quando stabile — **non ancora mergiato**, resta isolato finché il motore non ha almeno un MVP
funzionante.

**Analisi** (tre Explore agent in parallelo su docs/architettura generale, frontend `sws-editor`,
backend `sws-runtime`): il motore Rust (`sws-core`/`sws-historian`/`sws-pyscript`/i plugin
protocollo) è già disaccoppiato dal web (nessuna dipendenza da axum); il backend non renderizza
mai nulla, espone solo lo schema `SynopticObject`/`SynopticPage` via REST e stream WS
snapshot+delta (`/ws/tags`, `/ws/alarms`) — tutta l'interpretazione widget-per-widget vive solo
in TypeScript (`SvgCanvas.tsx`). `sws-kiosk` (GTK4+WebKitGTK) è l'unico precedente concettuale
ma è solo un wrapper browser, escluso dal cross-compile Yocto perché il sysroot Pixsys non ha
GTK4/WebKitGTK — è esattamente il gap che LVGL risolverebbe. Verificato anche lato LVGL: v9
supporta ufficialmente fbdev/DRM/Wayland/simulatore SDL2 (`lv_port_linux`), ma il binding Rust
ufficiale (`lvgl` crate, `lv_binding_rust`) risulta fermo a LVGL 8.x — gap tecnico registrato,
non bloccante (vedi `docs/OPEN_QUESTIONS.md` Q14).

**Decisione architetturale** (`docs/adr/0002-lvgl-rendering-engine.md`): il motore LVGL è un
**nuovo binario Rust separato** (`sws-lvgl-viewer`), client WS/REST verso il runtime `sws-web`
esistente — stesso ruolo che ha oggi il browser/`sws-kiosk`. **Nessuna modifica al runtime
esistente** per partire; i protocolli sono già tutti disponibili automaticamente (girano lato
server, indipendenti dal renderer) — il lavoro vero è solo l'interprete di `SynopticObject` in
LVGL, per un sottoinsieme di widget più piccolo di quello web.

**Scaffolding fatto**: nuovo crate `sws-runtime/crates/sws-lvgl-viewer` (dipendenza `lvgl` 0.6,
config vendorizzata, nessuna feature `drivers`/SDL2 ancora, nessuna logica — solo un `main.rs`
placeholder), escluso dal workspace di default (`exclude` in `sws-runtime/Cargo.toml`, stesso
motivo/pattern di `sws-kiosk`: richiede un toolchain C/bindgen non garantito ovunque). Verificato
`cargo check --manifest-path crates/sws-lvgl-viewer/Cargo.toml` verde in isolamento su questo dev
server (libclang via llvm-14 presente; SDL2 dev headers no, ma non ancora necessari con le
feature disabilitate). Il resto del workspace non è stato toccato.

**Deciso col maintainer** (via domande esplicite): l'MVP di Fase 2 punterà prima al **simulatore
SDL2** (iterazione rapida senza hardware, prima di framebuffer/DRM o Wayland reali); l'estensione
del wizard di creazione progetto (scelta target + pre-config area di lavoro/colori per tutti i
progetti) è **rimandata a dopo** una prima demo funzionante del motore, non in questo blocco.

**Da fare alla ripresa**: Fase 2 — spike sul simulatore SDL2 (richiede `libsdl2-dev`, non
installato su questo dev server, da valutare se installarlo qui o solo sulla macchina di casa),
client WS/REST verso un'istanza `sws-runtime` reale, porting minimo di `resolveObject()`/soglie
da `SvgCanvas.tsx`, primi tipi widget (`rect`, `text`, `button`, `led`, `slider`). Roadmap
completa (Fasi 3-6: wizard, backend HW reali, container podman multi-arch, ampliamento catalogo,
ESP32) in `docs/plans/2026-08-07-lvgl-engine.md`.

---

## 2026-08-06 (notte): T-41…T-45 + audit qualità codice (branch `fix/T-41-page-delete-persist`)

Sessione partita dai pulsanti pan sul Trend compatto (poi isolati sul branch
`feat/trend-compact-pan`, vedi nota sopra), proseguita con un blackout elettrico a metà (nessuna
perdita — tutto il lavoro già scritto su disco, solo un `cargo build` da rifare) e conclusa in
autonomia notturna su richiesta esplicita del maintainer.

**T-41 — bugfix prioritario**: `deletePage`/`renamePage` erano puramente in-memory nello store;
`saveAll()` faceva solo upsert; non esisteva `DELETE /api/synoptics/:name` (a differenza di
faceplates/recipes, che ce l'hanno già). Il file della pagina "cancellata" restava orfano su
disco e ricompariva a ogni riapertura progetto. Aggiunta la route, `api.deleteSynoptic` (tollera
un 404 — `save_synoptic` pulisce già da solo il file di un rename per `id`, quindi una delete in
parallelo può trovarlo già sparito), e `persistedPageNames` nello store per far chiamare
`deleteSynoptic` su ogni nome sparito dall'ultimo caricamento. Verificato dal vivo con
un'istanza isolata: delete + riavvio completo del processo, doppia delete idempotente, contenuto
dello zip di deploy. Rimossi anche gli orfani reali già presenti su Sandokan (`Page 2.yaml`,
`Sandokan (copia).yaml`, confermato dal maintainer come scarti, in entrambe le copie del
progetto).

**Fix sistemico — mirror Rust↔TypeScript**: scoperto per caso debuggando perché lo stile
per-traccia del Trend (T-47) non persisteva — `SynopticObject` in `sws-web/src/synoptic.rs` è
uno specchio manuale del tipo TypeScript, e un campo non dichiarato lì sparisce silenziosamente
a ogni save/reload (serde ignora i campi sconosciuti). Un confronto sistematico (script ad-hoc)
ha trovato **62 campi mancanti**, non solo nel Trend: `alarm_viewer` (tutti e 8 i suoi campi),
`sparkline`, `pipe`/connettore (waypoints e routing inclusi), `bar_chart`, `pie_chart`,
`faceplate` instance, `lang_selector` — tutti rotti allo stesso modo da prima di questa sessione.
Aggiunti tutti (tipizzati dove banale, `Option<Value>` generico per gli array di oggetti
annidati, stesso pattern di `options`/`table_rows`). Verificato dal vivo con un'istanza isolata:
impostati campi di alarm_viewer/sparkline/pipe via PUT, riavviato il processo, confermato che
sopravvivono. Un secondo giro dello stesso script dopo T-42/T-43 (che aggiungono `alarm_bell`/
`alarm_banner`) ha confermato 0 campi mancanti anche lì — mirrorati da subito, non dopo essere
scoperti rotti.

**T-42/T-43 — allarmi piazzabili, verificati dal maintainer in browser**: nuovi oggetti SCADA
`alarm_bell` (campanella, dropdown attivi/storico/ack/shelve) e `alarm_banner` (barra, blink/ACK/
priorità ISA-18.2), estraendo la logica condivisa in `AlarmBellPanel.tsx` e riusando
`AlarmBanner.tsx` esistente. Nessuna migrazione automatica: la chrome fissa (campanella in alto a
destra, barra in cima) resta finché non viene rimossa manualmente in **T-46** — deliberatamente
rimandato, richiede sia T-42+T-43 fatti sia una conferma page-by-page che ogni pagina che deve
mostrare allarmi abbia davvero l'oggetto piazzato (nota completa in memoria,
`project_t46_alarm_chrome_removal`).

**T-44/T-45 — non ancora provati dal maintainer**: componente `DataTable` condiviso (sort per
colonna + filtro, nessuna virtualizzazione — dataset piccoli tipo allarmi/ricette), sostituisce
la lista Ricette in ConfigView; `alarm_viewer` guadagna una terza modalità "Tabella" che riusa lo
stesso componente. Verificati con harness Playwright isolato (sort/filtro funzionanti) e
build/test, ma non ancora nel browser reale del maintainer.

**Audit di qualità del codice** (su richiesta esplicita, due Explore agent in parallelo — uno sul
catalogo widget, uno sul codice): trovati e sistemati subito (bassa rischiosità, stesso pattern
di verifica di tutta la sessione) altri due gap dello stesso tipo di bug (`SynopticPage.
background_dark` mancante da Rust; `MqttConfig.max_silence_secs` mai esposto in UI — ora
impostabile in Config → Protocolli → sorgente MQTT → Connessione, chiude un loose end della
sessione precedente su Sandokan), colori severità allarme unificati (`alarm_viewer` usava un hex
diverso da bell/banner per "Warning"), filtro severità aggiunto ad `alarm_viewer` (aveva il campo
dati ma nessuna UI), completato `getXDomain()` in `TrendCanvas.tsx` (T-48 lo usava solo per il
drag-to-zoom, non per polling/draw/CSV — stessa classe di bug del Trend già vista e sistemata
solo a metà), deduplicata la palette colori fra Trend compatto ed espanso, corretto
`SUPPORTS_TRANSFORM` (mancavano `lang_button`/`lang_selector`), nascosto un pannello UI morto
(eventi su `grid`), rimosso codice morto (`_force_login_ok_used`, modulo `sws-auth::session` mai
implementato). Il resto dei findings (BindableInput mancante su vari campi, color picker mancante
su slider/checkbox/radio, widget `faceplate` non piazzabile da UI, possibili nuovi tipi widget) è
**documentato, non implementato** — vedi `docs/plans/2026-08-06-audit-widget-e-codice.md`.

`cargo test -p sws-web -p sws-auth -p sws-core -p sws-plugin-mqtt -p sws-runtime`: 98/98 verdi.
`pnpm build`/`test`: verdi in ogni punto della sessione. `cargo build` rifatto ogni volta che
serviva un binario aggiornato per una verifica dal vivo (non solo `cargo check`).

## 2026-08-06: il boot con `--project` ignorava Random Client ID (e ignorerebbe qualunque cosa) — unificato con `open_project`

Il maintainer ha notato che i grafici di Sandokan sul device reale (`tc620-a-p3-c6-07aff9.local`)
si erano fermati verso le 7:30, pur non avendo toccato il device — e soprattutto: **il progetto
aveva Random Client ID attivo, mai disattivato**, eppure il log mostrava il client_id letterale
(`sws-sandokan-ide`, non `<id>-sws-sandokan-ide`).

**Ricostruito con i log reali**: il container era stato ricreato ieri sera alle 23:16 (un
redeploy, non toccato da nessuno stamattina). Al boot successivo il client_id era tornato
letterale — mentre il file `project.yaml` sul device ha davvero `random_client_id: enabled: true`
(un mio grep troncato in una risposta precedente aveva fatto credere il contrario). Stamattina i
miei stessi test sul flash della grafica (sessione precedente) hanno aperto Sandokan più volte
sull'editor locale con lo stesso client_id letterale, verso lo stesso broker reale — collidendo
col device, ora anch'esso letterale per lo stesso motivo. Da lì i kick delle 7:29-7:34, poi il
device è cascato nel bug del `poll()` sospeso (non ancora distribuito), silenzio da allora.

**Causa radice**: `sws-runtime/src/main.rs` ha un secondo percorso di caricamento progetto — il
boot con `--project`, usato a ogni riavvio del processo/container — che **ricopiava a mano** la
logica di `open_project` (`sws-web/src/projects.rs`) invece di riusarla. Un commento già nel
codice, scritto in una sessione precedente per un problema analogo (storico/notifiche dimenticati
allo stesso modo), lo diceva esplicitamente. Quando ho aggiunto `resolve_mqtt_client_ids` per il
fix di Random Client ID, l'ho collegato solo dentro `open_project` — non in questo secondo
percorso. È la **terza volta** che questa duplicazione perde un pezzo.

**Deciso col maintainer**: niente più toppe — eliminare la duplicazione.

**Fatto** (branch `fix/unify-project-boot-open-path`):
- Nuova funzione condivisa `apply_loaded_project` (`sws-web/src/projects.rs`): seed dei tag
  derivati, `populate_tags`, registry datastore, swap storico, carico allarmi (+ wiring del
  journal), risoluzione client_id MQTT, `supervisor.reload`, registro funzioni. Non avvia
  notifiche/script globali (serve un `AppState` che al boot non esiste ancora) — ritorna
  `(notifications, global_scripts)` perché il chiamante li avvii quando può.
- `open_project` e il boot in `main.rs` ora chiamano entrambi questa funzione, passando i propri
  pezzi (`AppState` nel primo caso, le variabili individuali costruite prima di `AppState` nel
  secondo). `config_dir`/`instance_id` spostati più in alto in `main.rs` — servono già al boot,
  non solo più avanti per `router::build`.
- Un futuro passo di apertura progetto dimenticato in un solo posto non è più possibile: c'è un
  solo posto.

**Verificato dal vivo** (non solo `cargo check`/`test`): un'istanza di prova lanciata con
`--project` puntato alla copia locale di Sandokan (Random Client ID attivo, `position: suffix`)
— **prima** del fix: log mostra client_id letterale al boot (bug riprodotto). Trovato anche un
errore mio nella prima verifica: `cargo check`/`cargo test` non ricompilano il binario eseguibile
principale (`target/debug/sws-runtime`) di un crate `bin`, serve `cargo build` — il primo giro di
verifica testava ancora il binario vecchio. **Dopo** `cargo build` e il fix: log mostra
`"client_id":"sws-sandokan-ide-69dcbe"` — risolto correttamente anche al boot, non solo aprendo
da IDE. `cargo test -p sws-web -p sws-core -p sws-plugin-mqtt -p sws-runtime` 58+9 verdi.

**Non ancora fatto**: redeploy sul device reale (questa sessione ha solo diagnosticato +
sistemato il codice, non toccato il device). Il maintainer aveva messo in pausa qualunque
redeploy finché non si capiva la causa — ora chiarita, il redeploy può includere anche questo fix
oltre a reconnect/staleness e client_id.

## 2026-08-06: flash della grafica (e degli allarmi) del progetto precedente al cambio progetto

Il maintainer ha segnalato: aprendo Sandokan, chiudendo il progetto e creandone uno vuoto, per
un istante vede ancora la grafica del progetto precedente. Ha anche sollevato il sospetto che il
nuovo progetto "si portasse dietro" la sorgente MQTT di Sandokan (stesso client_id) — **escluso
con i timestamp esatti del log reale** (`~/.run-editor/logs/runtime-2026-08-06.jsonl`): l'ultima
riga MQTT di Sandokan e la riga `"stopping source task"` sono a 14 ms di distanza, e nessuna riga
MQTT compare più in nessuna delle aperture/chiusure successive di "vuoto". Il log MQTT che il
maintainer vedeva era semplicemente quello di **Sandokan rimasto aperto dal giorno prima** sullo
stesso processo `start_editor.sh` (mai chiuso esplicitamente dopo i miei test di verifica) —
comportamento corretto, non un bug.

**Il flash grafico invece era reale.** Causa: lo store Zustand dell'IDE (`store/index.ts`) è un
singleton che sopravvive allo smontaggio dei componenti — nessuna azione azzerava
`pages`/`project`/`customSymbols`/`faceplates` alla chiusura del progetto (`App.tsx`
`executeClose` faceva solo `resetDirty/closeProject/clearAuth/setNoActiveProject`). All'apertura
del progetto successivo, `onProjectOpened` chiama `setNoActiveProject(false)` **in modo
sincrono**, rimontando subito l'`EditorShell` — che legge `pages` direttamente dallo store senza
nessuna guardia "progetto non ancora caricato". I dati veri arrivano solo dopo, in modo
asincrono (`api.getProject()`/`api.listSynoptics()`). La finestra fra il remount sincrono e la
risoluzione asincrona era il flash osservato.

**Fatto** (branch `fix/project-switch-stale-canvas-flash`):
- Nuova azione `resetProjectState()` nello store (`store/index.ts`), che riusa `setPages([], "")`
  già esistente e in più azzera `project`, `projectLoadError`, `customSymbols`, `faceplates`.
- Chiamata in `App.tsx`: in `executeClose` (igiene alla chiusura) e — il fix che conta —
  **prima** di `setNoActiveProject(false)` dentro `onProjectOpened`, così l'`EditorShell` si
  rimonta già vuoto invece che con lo stato del progetto precedente.
- **Trovato durante la verifica automatizzata** (non a tavolino): il banner allarmi mostrava
  anch'esso per un istante l'allarme del progetto precedente (`alarms` è un campo separato dello
  store, non toccato dal fix iniziale). Esteso `resetProjectState()` per azzerare anche `alarms`.

**Verificato con un test end-to-end automatizzato**, non solo a occhio: Playwright headless
(pacchetto installato al volo nello scratchpad, browser Chromium già in cache ma di revisione
diversa — lanciato puntando esplicitamente al binario in `~/.cache/ms-playwright/chromium-1223/`)
guida l'IDE reale su `:8460` — apre Sandokan, conferma il caricamento (`"Nebulizzatore"` nel
DOM), chiude, crea un progetto vuoto, e campiona il testo della pagina ogni ~60ms per ~900ms
durante la transizione. **Prima** del fix sugli allarmi: rilevata un'occorrenza reale del banner
"sandokan_power_off" durante la transizione (screenshot salvato). **Dopo** entrambi i fix: zero
occorrenze su 15 campionamenti, ripetuto due volte. `pnpm build`/`pnpm test` (32/32) verdi.

**Non ancora provato**: sul device reale (questo fix è solo frontend, quindi non richiede
rebuild del binario Rust — basta la nuova SPA nell'immagine al prossimo giro di build/deploy).

## 2026-08-05 (sera): sessione MQTT bloccata per sempre senza errore — timeout su poll() + staleness

Il maintainer ha segnalato che il problema MQTT "sembra esserci ancora" quando apre la pagina
viewer (`:8443`) dal browser mentre il runtime gira sul device — sua ipotesi, non certezza.
Chiesto esplicitamente un audit approfondito di tutta l'implementazione MQTT, raccogliendo tutti
i dubbi prima di agire.

**Ipotesi del maintainer esclusa con certezza** (tre indagini in parallelo, codice alla mano):
nessun percorso di codice collega l'apertura/moltiplicazione di sessioni viewer (`:8443`,
`/ws/tags`) né eventi di login/sessione/`/api/remote/connect` a `SourceSupervisor` o
`MqttConfig`. Il polling è strutturalmente indipendente dal numero di client (broadcast puro,
nessun contatore, nessun hook on-connect) — verificato riga per riga.

**Cosa è successo davvero**, ricostruito dal log del device (`tc620-a-p3-c6-07aff9.local`):
tra le 20:18 e le 20:20 una serie di redeploy ravvicinati (il maintainer stava configurando
"Random Client ID") causa normali cicli di riconnessione. Poi, dalle 20:20:11 in poi, **silenzio
totale nel log per oltre 95 minuti** (verificato più volte nell'arco della sessione, mai
auto-ripreso), tag congelate a `quality: "Good"`. Il maintainer conferma che il dispositivo
Zigbee era attivo in quella finestra: non era "nessun dato legittimo", era una sessione bloccata
per davvero — anche col client_id ormai reso univoco dal fix precedente (quindi non è una
recidiva della collisione di client_id, è un problema diverso).

**Causa individuata leggendo `rumqttc` 0.24.0**: il keep-alive interno dovrebbe far fallire
`eventloop.poll()` entro ~2× `keep_alive_secs` in caso di connessione morta. Il fix di martedì
però reagisce solo a un `Err` *restituito* — se quella singola chiamata resta sospesa per sempre
(stato interno incoerente dopo la sequenza di riconnessioni ravvicinate), il retry-con-backoff
non scatta mai, perché `run_session` non torna. Combacia esattamente: l'ultima riga di log è
"MQTT subscribing" (subito prima del loop `poll()`), poi nulla.

**Gap secondario, confermato assente in ogni plugin**: nessun meccanismo verifica "sto
ricevendo dati aggiornati?" indipendentemente da un errore di libreria.

**Deciso col maintainer**: chiudere entrambi.

**Fatto** (branch `fix/mqtt-poll-timeout-staleness`, sopra `feat/mqtt-client-id-management`):
- `sws-plugin-mqtt/src/lib.rs` + `sparkplug.rs`: `eventloop.poll()` avvolto in
  `tokio::time::timeout` (soglia proporzionale a `keep_alive_secs`, minimo 30s). Se scade, viene
  trattato come sessione morta e rientra nel retry-con-backoff già esistente — nessuna nuova
  logica di retry, solo il buco che lo bypassava chiuso.
- `sws-core/src/project.rs`: nuovo `MqttConfig.max_silence_secs: Option<u64>` — opzionale,
  **disattivo di default** (a differenza di Random Client ID: un valore indovinato rischierebbe
  di riavviare sorgenti legittimamente silenziose, dato che MQTT è push-based senza un
  intervallo naturale).
- `sws-web/src/source_supervisor.rs`: watchdog esteso con `restart_stale_sources` — per ogni
  sorgente con `max_silence` impostato, calcola il `timestamp_ms` più recente fra i suoi
  `owned_tags` e la riavvia se supera la soglia, anche se il task non è mai andato in errore.
  Una sorgente senza ancora nessun dato (appena avviata) viene lasciata stare invece di essere
  trattata come stale, per non innescare un loop di riavvii durante una connessione iniziale
  lenta. Meccanismo agnostico rispetto al tipo di sorgente (lavora solo su `owned_tags` + una
  soglia) — per ora solo MQTT espone il campo; estendere agli altri 7 tipi è un lavoro a parte,
  lasciato per una sessione futura.

**Verificato**: `cargo check --workspace` pulito, `cargo test -p sws-web -p sws-core -p
sws-plugin-mqtt` 58/58 verdi (3 nuovi test su `most_recent_update`, nessuna regressione).
**Non verificato dal vivo end-to-end**: un broker locale per riprodurre "connessione viva ma
silenziosa" non è stato possibile allestirlo su questo dev server (mosquitto bloccato da
AppArmor per file fuori da `/etc/mosquitto/*`, il broker reale non è raggiungibile da qui). Da
verificare sul device reale dopo rebuild+redeploy: impostare `max_silence_secs` su Sandokan e
controllare che un futuro blocco silenzioso venga recuperato entro un tick del watchdog (~30s)
invece di restare bloccato per ore.

## 2026-08-05: collisione di client_id MQTT fra IDE e device — Random mode + override per-device

Il maintainer è tornato dopo l'incidente di martedì (fix reconnect+watchdog) segnalando che il
device `tc620-a-p3-c6-07aff9.local` aveva "perso di nuovo il broker MQTT". **Verificato dal vivo
che non era un regressione del fix**: il container era `healthy` da 22h, il retry-con-backoff
ritentava puntualmente ogni 5s esattamente come progettato, e il broker esterno risultava
irraggiungibile *dal device* — ma il maintainer, connesso con MQTT Explorer dallo stesso PC,
raggiungeva lo stesso broker senza problemi. Il broker era su, non era un problema di rete.

**Causa reale**: `client_id: sws-sandokan-ide` in `project.yaml` — letterale, quindi identico su
ogni istanza che apre il progetto. Sul dev server, alle 15:41 (un minuto prima che il device
iniziasse a saltare) era stata avviata una copia locale dello stesso progetto Sandokan
nell'IDE locale (`start_editor.sh`, porta 8460), stesso `client_id` verso lo stesso broker. Per
specifica MQTT il broker disconnette la sessione più vecchia quando l'altra si ripresenta col
suo client_id — e col retry-con-backoff di martedì **entrambe le parti** ora ritentano ogni 5s,
quindi il conflitto si perpetua invece di risolversi da solo dopo un kick. Aggravante: il default
quando il campo è vuoto è `"sws-runtime"` fisso (`sws-core/src/project.rs`) — chiunque non lo
imposti esplicitamente collide comunque, non solo in questo caso specifico.

**Deciso col maintainer** (in chat, con più giri di `AskUserQuestion` sui dettagli implementativi
prima di scrivere codice): due meccanismi alternativi, non sovrapponibili, entrambi per singola
sorgente MQTT:

1. **"Random Client ID"**: ogni istanza — IDE compresa — incolla al `client_id` configurato un
   id persistente e univoco (`config_dir/instance_id`, generato una sola volta, stesso pattern
   già usato per il certificato TLS — non rigenerato a ogni riavvio). Nessuna azione manuale
   richiesta; le sorgenti MQTT create da ora in poi nascono con questa modalità già attiva.
2. **Override manuale per-device**: un pulsante "Invia Client ID al dispositivo connesso" nel
   pannello sorgente, per fissare un valore esatto su un device specifico (es. per farlo
   combaciare con una ACL del broker). Persistito **fuori da `project.yaml`**
   (`config_dir/mqtt_client_id_overrides.yaml` sul device), così un redeploy del progetto non lo
   cancella.

**Fatto** (branch `feat/mqtt-client-id-management`):
- `sws-core/src/project.rs`: nuovo `RandomClientId { enabled, position }` su `MqttConfig`
  (campo opzionale — progetti esistenti senza il campo si comportano esattamente come prima,
  nessuna migrazione).
- `sws-runtime/src/main.rs`: `load_or_create_instance_id`, mirror esatto del pattern
  load-or-generate-and-save del certificato TLS. Nessuna dipendenza nuova (id breve da entropia
  di sistema, non serve robustezza crittografica per distinguere una manciata di istanze).
- `sws-web/src/projects.rs`: `resolve_mqtt_client_ids` — un solo punto, chiamato in
  `open_project` subito prima di `supervisor.reload(...)`, muta il `client_id` effettivo prima
  che arrivi al supervisor (che resta generico, nessuna modifica). Copre automaticamente sia il
  path MQTT plain sia Sparkplug B, senza toccare i plugin. Nuovo endpoint
  `PUT /api/mqtt/source/:id/client-id-override` (rifiuta con 400 se la sorgente ha Random attivo).
- `sws-web/remote.rs`: proxy `POST /api/remote/mqtt-client-id`, stesso schema di
  `remote_push_users`/"Aggiorna utenti sul dispositivo".
- `sws-plugin-mqtt/src/lib.rs` + `sparkplug.rs`: aggiunto `client_id` ai log "MQTT subscribing" /
  "Sparkplug B connected" — prima non c'era modo di verificare da log quale id stesse usando
  un'istanza, dettaglio che è servito subito in fase di verifica.
- Frontend: `MqttRandomClientIdSection` in `ConfigView.tsx` (toggle + posizione + pulsante invio,
  visibile solo con Random disattivo e device connesso), nuove sorgenti create con Random attivo
  di default (`emptyMqtt()`).

**Verificato dal vivo** (non solo `cargo check`/`pnpm build`), usando le due istanze locali già
presenti su questo dev server come "IDE + secondo device simulato" (`start_editor.sh` porta 8460
+ `--instance 2` temporanea su 8462, poi rimossa):
- Retrocompatibilità: `project.yaml` di Sandokan invariato (nessun `random_client_id`) →
  `client_id` risolto identico al letterale.
- Random mode: stesso progetto aperto su due istanze → `sws-sandokan-ide-1778ef` (istanza 1) vs
  `sws-sandokan-ide-2a4494` (istanza 2) — stessa etichetta riconoscibile, id diversi, **esattamente
  lo scenario dell'incidente, risolto senza alcuna azione manuale**.
- Override manuale: applicato via `curl`, effetto immediato in log, **sopravvive a
  chiusura+riapertura del progetto** (persistito nel file separato, non nello stato in memoria).
- Conflitto: con Random attivo, un override rimasto nel file viene ignorato (non
  applicato) e l'endpoint rifiuta un nuovo tentativo con 400.
- `cargo check --workspace`, `cargo test -p sws-web -p sws-core -p sws-plugin-mqtt` (54 test
  sws-web, nessuna regressione), `pnpm build`, `pnpm test` (32/32) verdi.

**Non ancora provato**: sul device reale (serve rebuild+redeploy del container, non fatto in
questa sessione — la verifica sopra è stata interamente sul dev server). Il pulsante "Invia
Client ID al dispositivo connesso" è stato verificato lato backend via `curl` diretto
all'endpoint device-side, non attraverso il flusso UI completo IDE→proxy→device (richiede un
device reale connesso, non riproducibile qui).

## 2026-08-03: sorgente MQTT morta per sempre dopo la caduta del broker — reconnect + watchdog

Il maintainer ha segnalato: progetto **Sandokan** su device arm64 in container, "se chiudo l'IDE
il database e i grafici smettono di funzionare". Verificato dal vivo via SSH sul device
(`tc620-a-p3-c6-07aff9.local`, chiavi già disponibili sul dev server):

- Il container era `Up 22h (healthy)` — il processo runtime non si era mai fermato.
- `GET /api/tags` mostrava tutte le tag di Sandokan con `quality: "Good"` ma valori e
  `timestamp_ms` **fermi a 10 ore prima**, esattamente l'istante dell'ultima riga di log —
  dopo la quale il journal era **completamente silenzioso**, nessun warning nemmeno uno.
- Il broker MQTT esterno (`192.168.1.6:1883`) risultava irraggiungibile al momento del
  controllo (test TCP diretto fallito) ed è **indipendente dal PC/IDE del maintainer**
  (confermato da lui: non si spegne insieme all'IDE).

**Causa reale, trovata nel codice, non un problema di rete che si aggiusta da solo**:
`sws-plugin-mqtt/src/lib.rs` (path MQTT "plain", quello usato da Sandokan) non aveva **nessun
loop di riconnessione** — alla prima sessione caduta il task moriva per sempre. Il commento di
modulo prometteva "reconnect on session error with 5s backoff", ma il pattern vero esisteva già
solo nel modulo gemello `sparkplug.rs` (`run_sparkplug`, loop con backoff 5s). In più,
`source_supervisor.rs` controllava i task morti **solo** dentro `reload()`, invocato solo da
un'azione utente esplicita (apri/chiudi progetto, salva config) — nessun watchdog periodico.
Combinati, questo spiega perfettamente la segnalazione: l'unico modo *attuale* per far
ripartire una sorgente MQTT caduta era riaprire il progetto dall'IDE (si vede proprio la
sequenza `stopping source task` → `starting MQTT task` nel log di un redeploy), quindi "IDE
chiuso" coincideva sempre con "dati fermi" — non per una dipendenza reale dal client, ma perché
riaprire da IDE era l'unico trigger di restart esistente.

**Fatto** (branch `fix/mqtt-reconnect-watchdog`):
- `sws-plugin-mqtt/src/lib.rs`: il path plain ora fa retry-con-backoff 5s, mirror esatto di
  `sparkplug.rs::run_sparkplug`.
- `sws-web/src/source_supervisor.rs`: nuovo watchdog periodico (ogni 30s) che rileva e rilancia
  qualunque sorgente il cui task sia terminato da solo — generico per tutti gli 8 tipi
  (Modbus TCP/RTU, MQTT, OPC-UA client/server, HomeAssistant, S7, EnIP), non solo MQTT. Aggiunto
  il campo `def: SourceDef` a `RunningSource` per permettere il rilancio senza richiedere la
  definizione dall'esterno.

**Verificato**: `cargo check --workspace` verde, `cargo test -p sws-plugin-mqtt -p sws-web`
54/54 verdi (nessuna regressione). **Non verificato dal vivo con un broker reale**: un test
manuale con `mosquitto` locale è stato tentato ma bloccato dal profilo AppArmor di sistema su
questo dev server (`/etc/apparmor.d/mosquitto` confina il binario a leggere solo
`/etc/mosquitto/*`, non file temporanei) — non ha senso aggirarlo con `sudo` su una macchina
condivisa per un test usa-e-getta. Da verificare sul device reale o con un broker che rispetti
il percorso consentito dal profilo.

## 2026-08-02: build container aarch64 generica, senza SDK — verificata (non ancora installata/testata su device)

Richiesto perché l'SDK Yocto Pixsys non era disponibile: nuovo percorso gemello di
`Containerfile.x86_64`/`.builder` ma per aarch64, senza cross-compile — compila dentro
`Containerfile.aarch64-generic.builder` (stesso `ubuntu:24.04`) sotto **emulazione QEMU**, dato
che build-arch (x86_64) e target-arch (arm64) non coincidono. Nuovi
`scripts/build_container_aarch64_generic.sh`, `parse_image_tarball` esteso con `"aarch64-generic"`,
sezione dedicata in `docs/DEPLOY_CONTAINER_AARCH64.md`.

**Non sostituisce il percorso SDK per un device Pixsys reale** — niente tuning cortex-a35, niente
ABI pinning esatto all'OS Pixsys. Tag/archivio sempre col suffisso `-generic`, mai raggiungibile
dal default automatico di `install-container.sh --pull`.

**Quattro problemi reali trovati testando, non solo temuti** (tutti documentati nei commenti dello
script/Containerfile, non solo qui):
1. **QEMU rootless non funziona**: podman rootless + crun non riesce a eseguire binari arm64 sotto
   emulazione anche a registrazione binfmt corretta ("Exec format error"). Serve `sudo` per l'intero
   script — unico percorso container di questo progetto che lo richiede. Effetto collaterale: gli
   artefatti (`target-container-aarch64-generic/`, `.cargo-container-aarch64-generic/`,
   l'archivio in `dist/`) restano root-owned, serve chown/rm manuale.
2. **DNS non passa sotto `sudo podman`**: la rete bridge di default non passa il resolver
   dell'host, `ports.ubuntu.com`/crates.io irraggiungibili pur risolvendo bene sull'host. Fix:
   `--network host` su tutte le chiamate podman dello script.
3. **`cc` va in SIGSEGV compilando l'assembly ARM NEON+SHA3 di `aws-lc-sys`** (dietro rustls) sotto
   QEMU — limite noto di QEMU con certe estensioni crypto, non un bug SWS. Fix:
   `AWS_LC_SYS_NO_ASM=1`, che però forza il builder CMake di aws-lc-sys (richiede `cmake`
   nell'immagine builder) e che a sua volta accetta `NO_ASM` solo con `opt-level` **esattamente 0**
   (`CARGO_PROFILE_RELEASE_OPT_LEVEL=0`) — binario non ottimizzato, accettabile per verificare che
   il container si installi e parta, non per misurare prestazioni.
4. **`cc1` (il compilatore stesso) è andato in SIGSEGV una volta compilando un file C ordinario**
   (niente assembly, niente crypto) — bug non deterministico di QEMU sotto carico di compilazione
   pesante. Un semplice rilancio dello script (nessuna modifica) è passato la seconda volta.

**Verificato**: build completa (~27 minuti di `cargo build` emulato), `readelf` conferma
`libpython3.12`/`GLIBC_2.39` coerenti con la base, immagine taggata
`sws-runtime:2026.7.0-arm64-generic`, archivio `dist/sws-runtime-2026.7.0-aarch64-generic-image.tar.gz`
(65 MB). `cargo test -p sws-web` 54/54 verde.

**Aggiornamento stesso giorno — quinto problema trovato testando davvero il deploy**: primo
tentativo di installazione fallito perché il device di prova era x86_64, non arm64 — il messaggio
di `install-container.sh` ("immagine senza SPA") è fuorviante in quel caso, il vero problema è un
mismatch di architettura (verificato montando l'immagine con `podman image mount` + `podman
unshare`: la SPA c'era). Nel frattempo, rigenerare l'immagine x86_64 con la versione corrente ha
fatto scoprire che la build aarch64-generic (sudo) aveva lasciato **root-owned anche
`sws-editor/dist/`** (non solo gli artefatti del proprio percorso) — `pnpm build`, lanciato
direttamente sull'host e non in un container, gira come root sotto sudo. Bloccava qualunque
`pnpm build` successivo con `EACCES`. Corretto lo script con un `trap ... EXIT` che restituisce
tutto (`dist/`, `sws-editor/dist/`, i due artefatti di build) a `$SUDO_USER` all'uscita, a
successo o fallimento — non serve più un chown a mano dopo.

**Non ancora fatto**: installazione/avvio reale del container risultante (via `install-container.sh`
o dall'IDE) — il maintainer vuole prima mergiare il codice, poi testare. Se possibile, sarebbe utile
anche un confronto diretto con una build sul device arm64 reale (`tc620-a-p3-c6-07aff9.local`,
citato dal maintainer come alternativa a QEMU) per capire se vale la pena preferirla in futuro,
vista quanto si è rivelata fragile l'emulazione su questo host.

> ## Da dove ripartire (letto per primo al rientro)
>
> - **`main` è la verità**: tutti e sette i branch sono chiusi e riconosciuti da `git branch
>   --merged`. Nessuno ha contenuto che `main` non abbia — verificato con merge a secco uno per uno,
>   non dedotto. Restano in piedi solo come storia, come chiede `CLAUDE.md`.
> - **Release `2026.7.0`**, tag git `v2026.7.0`. Su `ghcr.io/soligolab/sws-runtime` ci sono **entrambe
>   le architetture**, ciascuna con tre tag: `2026.7.0-<arch>`, `<sha>-<arch>` e **`latest-<arch>`**
>   (mobile; `latest-arm64` è il default di `install-container.sh --pull`). Verificati pubblici con
>   token anonimo — HTTP 200 — e con l'architettura letta dal manifest, non dedotta dal nome.
> - **Il WP630 in ufficio ha ancora `0.1.0-dev`**: l'installazione di stamattina precede la release.
>   Per aggiornarlo basta `./install-container.sh --pull` sul dispositivo — prenderà `latest-arm64`,
>   cioè `2026.7.0`, e scaricherà solo i layer cambiati.
> - **Dall'IDE si installa dal registry** (ultima cosa fatta): Configurazione → Runtime → Installa su
>   dispositivo → Container (Podman) ha un selettore di sorgente, Registry di default, più una spunta
>   di installazione pulita. È il rimedio al caso che ha aperto la giornata — un archivio vecchio
>   installato perché era l'unico in `dist/`.
> - **Tre cose non ancora provate su un dispositivo vero**: `install-container.sh --pull` dal registry
>   (sul WP630 si è usato il percorso offline `--image`), **l'installazione pulita con un `--data` non
>   standard** — va guardato dal vivo *quale* directory sparisce — e la pill del container su un
>   runtime realmente in container invece che forzato con `SWS_CONTAINER_ENGINE`. Il percorso
>   **x86_64** invece è chiuso, vedi sotto.
> - **Non esiste più nessun branch**, né in locale né su `origin`: c'è solo `main`. Registro qui
>   sotto.
> - **La release `2026.7.0` non contiene il lavoro di fine giornata** (x86_64 dentro il builder,
>   installazione dal registry): quello sta in `main` sotto `[Unreleased]`. Se serve portarlo su un
>   dispositivo, va tagliata una `2026.7.1` e ripubblicate le immagini — non l'ho fatto di iniziativa
>   perché una release è una decisione, non un passaggio meccanico.

## Verificato 2026-08-01: installazione container dall'IDE, via registry, su x86_64

Il maintainer ha chiesto di provare la procedura "cliente" — installazione container dall'IDE,
sorgente Registry — su questa macchina di sviluppo (x86_64), dopo essersi assicurato che non ci
fossero runtime già attivi (trovato e rimosso un container di test residuo, `0.1.0-dev`, con
`install-container.sh --uninstall`, non solo `podman stop`, perché l'unit systemd lo faceva
ripartire da solo).

**Un problema trovato e risolto, non nel codice**: primo tentativo fallito con `422 Unprocessable
Entity — missing field www_tarball`. Causa: il processo IDE su questa macchina (`.run-editor`,
porta 8460) girava ininterrottamente dal 2026-07-31 mattina, da prima che arrivasse tutto il
lavoro pomeridiano in ufficio (registry, SPA-nell'immagine, `www_tarball` rimosso dal payload) —
il `git pull` aveva aggiornato i sorgenti su disco ma non il binario già caricato in memoria.
Risolto con `./scripts/start_editor.sh` (ricompila e riavvia pulito). **Lezione**: dopo un `git
pull` che porta codice backend, un processo IDE/runtime già in esecuzione va riavviato — i
sorgenti aggiornati sul disco non bastano da soli.

**Dopo il riavvio, self-SSH da IDE verso questa stessa macchina** (sorgente Registry, riferimento
immagine vuoto → l'installer ha dedotto `latest-amd64` da solo, percorso dati custom
`/home/max_xxv/sws_container`): installazione riuscita. Chiude la verifica x86_64 della procedura
"installa dal registry dall'IDE" iniziata il 2026-07-31 (lì provata solo su `main`, non ancora
end-to-end da IDE). Resta com'era il resto della lista dei "non ancora provate": `--pull` sul
WP630 reale (arm64), installazione pulita con `--data` non standard dal vivo, pill del container
non forzata via `SWS_CONTAINER_ENGINE`.

## Fatto 2026-08-01: griglia di posizionamento + sfondo pagina light/dark + impostazioni progetto nel pannello destro

Richiesto dal maintainer il 2026-08-01, implementato lo stesso giorno.

**Griglia** (`SvgCanvas.tsx`, non è mai stata a puntini — è un tratteggio a L, forma non cambiata
perché non richiesto): il gate era solo `gridSize > 0`, senza nessun controllo su edit-mode né
`snapEnabled` — **appariva anche nel viewer/runtime**, bug reale trovato leggendo il codice, non
solo assunto. Corretto in `{onMove && snapEnabled && gridSize > 0 && (...)}` su entrambi i punti
che disegnano il pattern. Il passo era già legato a `gridSize` (la stessa variabile che guida lo
snap reale), nulla da collegare. Colore: nuovo `gridColor` nello store (sessione, non persistito,
come `gridSize`/`snapEnabled` suoi vicini diretti), picker in `EditorToolbar.tsx`.

**Sfondo pagina**: nuovo campo opzionale `background_dark` su `SynopticPage` — `background`
resta il colore "chiaro"/default, nessuna migrazione dei `project.yaml` esistenti (fallback su
`background` quando `background_dark` non è impostato). Risolto al tema attivo via una nuova
`resolvePageBackground()` in `theme.ts`, letta sia in `EditorShell.tsx` sia in `RuntimeView.tsx`.
Nessun hook reattivo "isDark" esisteva prima — non ne serviva uno nuovo, `resolveMode(themeMode)`
già esistente basta, letto ai due call site.

**Impostazioni pagine progetto**: spostate dal modale dietro l'icona ⚙ (poco visibile, nel
pannello sinistro) a una sezione dedicata nel pannello destro, sotto "Proprietà" pagina — non
fusa con quella per non confondere impostazioni di progetto (modalità dimensionamento, rapporto,
home page, hide-chrome) con proprietà della singola pagina. Salvataggio rimasto esplicito e
separato dal salvataggio a batch delle pagine, non per pigrizia: `store/index.ts` dichiara
esplicitamente che i setter `updateProject*` sono deliberatamente non dirty-tracked, per non
rompere il meccanismo `pagesRev`/`savedPagesRev` pensato per le pagine — unificarli avrebbe
rischiato di riprodurre il bug "dirty per sempre" che quel commento descrive.

**Verifica**: `pnpm build`/`pnpm test` (32/32) + `cargo build`/`cargo test -p sws-web` (53/53)
verdi. Nessuna modifica al backend Rust: le pagine viaggiano come YAML generico
(`serde_yaml::Value`), un campo opzionale in più non tocca `project.rs`.

## Registro dei branch chiusi il 2026-07-31

Tutti e sette cancellati, locale **e** `origin`, su richiesta del maintainer. **Non si è perso
niente**, e stavolta la frase è verificabile invece che rassicurante: ogni punta era stata chiusa con
un merge in `main`, e un merge conserva entrambi i genitori — quindi ogni commit resta **raggiungibile
da `main`**. Il `gc` non li può potare e `git log <sha>` funziona per sempre. È una situazione diversa
da quella del 2026-07-29, dove i branch erano entrati con il **solo** squash: là le punte diventavano
irraggiungibili e questo registro era una scialuppa di salvataggio, qui è solo una comodità.

Verificato prima di cancellare con `git merge-base --is-ancestor <branch> main` su tutti e sette.

| branch | punta | merge di chiusura | contenuto |
|---|---|---|---|
| `feat/install-from-registry` | `ae961c7` | `d9478f1` | installazione dal registry dall'IDE, `--pull-only`, installazione pulita |
| `feat/container-registry-procedure` | `e8aa31c` | `704cc86` | registry, SPA nell'immagine, riconciliazione x86_64, discovery, bottone Viewer, slider |
| `chore/disable-legacy-container-publish` | `482481c` | `14a5d4a` | stop alla pubblicazione CI dell'immagine legacy, metadati OCI |
| `chore/e2e-and-docs` | `c656711` | `de1b490` | la suite end-to-end torna eseguibile, regola sui piani condivisi |
| `fix/container-host-network-default` | `d9ee20d` | `2e80c81` | rete host come default dell'installer, `--bridge` per tornare indietro |
| `fix/deploy-preserve-database` | `2a5033d` | `17a227b` | il deploy non cancella il database, gestione database, pulsante utenti |
| `fix/project-write-safety` | `22ae221` | `b0533bd` | un salvataggio non può più azzerare o impoverire `project.yaml` |
| `fix/multiselect-drag` | `d37b738` | `d17a181` | tentativo **rotto** di fix del drag multi-selezione; il fix vero è altrove in `main` |

Per rivedere il lavoro di uno di questi isolato: `git log <punta>`, oppure
`git log <chiusura>^1..<chiusura>^2` per i soli commit che quel branch aggiungeva. Per farlo tornare
un branch vero: `git branch <nome> <punta>`.

**Sessione precedente (2026-07-30, sera 1)**: **tre branch portati in `main` con squash e validati in
un solo giro** (`d0d9110` sicurezza in scrittura del progetto, `9f20d06` deploy/database/utenti,
`631e6d2` impalcatura e2e). Il punto di ritorno è il tag **`pre-merge-2026-07-30`**, anche su
`origin`: da lì si torna con `git reset --hard pre-merge-2026-07-30`.

Scelta del maintainer: le modifiche erano troppe da validare branch per branch, quindi si allinea
`main` e si valida una volta. Il vantaggio pratico è che i sei script di verifica coesistono solo qui.

---

## "Installa su dispositivo" installa dal registry (2026-07-31)

Validato dal maintainer e portato in `main` con squash. Piano in
`docs/plans/2026-07-31-installa-da-registry.md`, copiato lì apposta perché quelli in
`~/.claude/plans/` non viaggiano con git — serve se il lavoro riprende da casa.

Nasce dal caso concreto di stamattina: il WP630 installato dall'IDE scegliendo l'unico archivio
presente, `0.1.0-dev` del giorno prima, con un frontend vecchio a bordo. Il menù non sbagliava —
elencava fedelmente l'unica cosa che c'era. Il percorso registry esisteva dal 30 luglio ma dall'IDE
non era raggiungibile.

**Cosa c'è ora**: un selettore di sorgente — **Registry** (default) o **Archivio locale** — e una
spunta **Installazione pulita**. Dal registry sul dispositivo arrivano solo installer e unit quadlet,
pochi kB invece di 59 MB.

**Le due cose non ovvie**, entrambe emerse leggendo il codice e non progettando a tavolino:

1. **`--uninstall --purge` fa `exit 0`** e non prosegue mai con l'installazione, quindi un'installazione
   pulita è due comandi remoti, non una flag in più.
2. **Il purge deve ripetere `--data`.** Fa `rm -rf "$DATA"` prendendo il valore dalle flag: senza
   ripeterlo avrebbe cancellato il default `/data/user/sws` lasciando intatti i dati veri — distrutti
   i dati sbagliati, mancati quelli giusti. C'è un test dedicato che lo protegge.

**Tua decisione sull'ordine**: nuova flag `--pull-only` che procura l'immagine ed esce, così la
sequenza è `scp → pull-only → purge → install`. Se il pull fallisce non si cancella niente.

**Corretto anche il default cablato**: `install-container.sh` aveva `latest-arm64` fisso, che su
x86_64 scarica un'immagine che non parte. Ora compone il tag da `uname -m` sul dispositivo — che è
l'unico a saperlo, visto che dall'IDE si installa su macchine diverse da quella di sviluppo.

**Verificato**:

- `cargo test -p sws-web` 53 (12 nuovi) + `sws-runtime` 9, `pnpm test` 32/32 (6 nuovi),
  `cargo check --workspace`, `pnpm build`, `bash -n` verdi.
- `install-container.sh` provato per davvero: su questa macchina x86_64 `--pull-only` compone
  `latest-amd64` (prima sarebbe stato `latest-arm64`); con `uname -m` finto a `armv7l` fallisce
  senza toccare niente; un riferimento esplicito continua a vincere; `--uninstall` non pretende
  un'architettura nota.
- **Sequenza dei comandi remoti misurata con un `ssh` finto in `PATH`**, senza bisogno di un
  dispositivo. Registry + pulizia + `--data /opt/sws-data`: due `scp`, poi `--pull-only`, poi
  `--uninstall --purge --data /opt/sws-data`, poi `--pull --data /opt/sws-data`. Da archivio +
  pulizia: tre `scp` e **nessun** `--pull-only`, perché l'immagine è già lì. Registry senza pulizia:
  due `scp` e basta.
- Pannello provato in un browser: selettore, campo riferimento che compare solo in modalità registry,
  conferma che nomina la cartella, `clean_install` nel payload, spunta che si azzera dopo l'uso.
- Compatibilità col payload vecchio verificata con `curl`: solo `image_tarball` + credenziali
  continua a risolvere in modalità archivio, esattamente come prima.

**Non verificato**: niente di tutto questo è stato provato su un dispositivo vero. In particolare il
purge con un `--data` non standard va guardato dal vivo, controllando *quale* directory sparisce.

---

## Container x86_64: stessa base dell'arm64, compilato dentro un builder (2026-07-31, dopo la release)

Richiesta del maintainer prima di partire: *"fare il container a partire dallo stesso sistema usato
per l'immagine arm, credo debian trixie"*. Due correzioni di fatto, entrambe rilevanti:

1. **L'immagine arm64 non è Debian trixie, è `ubuntu:24.04`.**
2. **La base non si sceglie: la impone il binario.** PyO3 gira con `auto-initialize`, quindi il
   binario linka la `libpython` dell'ambiente che lo compila.

Il secondo punto rendeva la richiesta impossibile da soddisfare cambiando una riga. Misurato: lo
**stesso commit** dà `libpython3.11` + `GLIBC_2.34` compilato sul dev server (Debian 12) e
`libpython3.13` sulla macchina di casa (python da pyenv). Due immagini diverse dallo stesso codice, e
nessuna delle due compatibile con `ubuntu:24.04`. Il `FROM debian:trixie-slim` che c'era descriveva
una sola di quelle due macchine.

**Soluzione**: nuovo `deploy/container/Containerfile.x86_64.builder` — `ubuntu:24.04` con toolchain
Rust e `python3-dev` — dentro cui `build_container_x86_64.sh` lancia il `cargo build`. È per x86_64
quello che l'SDK Yocto Pixsys è per aarch64: un ambiente di compilazione fisso. Chiude il **«limite
noto: riproducibilità legata alla macchina di build»** che quel documento si portava dietro, e con
esso la necessità di riverificare a mano la riga `FROM` a ogni postazione.

**La verifica `readelf` è diventata automatica**: lo script confronta la libpython richiesta dal
binario con quella della base e si ferma spiegando che il container *"partirebbe e morirebbe su
`cannot open shared object file`"*. Prima era una riga di documentazione che chiedeva di rifarla a
mano, e il difetto sarebbe emerso al primo `podman run` sul dispositivo.

**Un difetto emerso costruendo le due immagini di seguito**: il tag **locale** non portava
l'architettura, quindi la seconda build si prendeva il nome della prima e
`podman run sws-runtime:2026.7.0` dava quella costruita per ultima. Corretto in entrambi gli script
(`sws-runtime:<versione>-arm64` / `-amd64`). I tag del registry non lo mostravano perché lì il
suffisso c'era già. **Nota su podman 4.x**: `podman untag <ref>` rimuove **tutti** i nomi
dell'immagine, non solo quello indicato — scoperto lasciando l'immagine senza tag.

**Verificato, misurando**: `readelf` sul binario prodotto → `libpython3.12` + `GLIBC_2.39`. Immagine
avviata su porte 8591/8592 per non toccare le istanze di sviluppo → `/health` su entrambe le porte,
`index.html` e bundle serviti dall'immagine, SPA admin, 10 template, RestrictedPython disponibile
senza warning, `podman ps` → `healthy`, Python 3.12.3 dentro il container. Pubblicata come
`2026.7.0-amd64`, `f25c8d5-amd64`, `latest-amd64`: tutte pubbliche, e l'architettura del manifest
letta dal registry dice `amd64 linux`.

**Non provato**: avvio automatico al boot su questa macchina, e `install-container.sh --pull` verso
questa immagine da un host x86_64 pulito.

---

## Release 2026.7.0 (2026-07-31) — prima release con un numero vero

Chiusura della sessione prima delle ferie del maintainer: tutto in `main`, tutto pushato, immagine
pubblicata.

**Il numero**: `0.1.0-dev` → **`2026.7.0`**. CalVer come da `CONTEXT.md`, ma con una correzione di
forma imposta dal toolchain: `2026.07` è rifiutato da Cargo (lo zero iniziale nel minor non è SemVer
valido) e `2026.7` pure (la patch non è opzionale). Il formato reale è quindi **`YYYY.M.PATCH`** —
annotato in `CONTEXT.md`, perché la riga diceva un'altra cosa. Il confronto resta numerico, quindi
`2026.7.0` precede correttamente `2026.10.0`: è solo l'ordinamento alfabetico dei tag che inganna.

**Tag mobile `latest-<arch>`** accanto a `<versione>-<arch>` e `<sha>-<arch>` (scelta del maintainer),
ed è il nuovo default di `install-container.sh --pull`. La ragione è concreta: un default pinnato va
aggiornato nello script a ogni release, e la volta che qualcuno se ne dimentica i dispositivi restano
indietro **in silenzio** — che è esattamente lo stato in cui era `0.1.0-dev`. Non rende gli
aggiornamenti automatici: il pull resta un comando che qualcuno dà.

**Un difetto che la release avrebbe fatto esplodere subito**: `install-container.sh` aveva
`TAG="localhost/sws-runtime:0.1.0-dev"` cablato e dopo `podman load` verificava proprio quello. Con
un numero diverso l'installazione **offline** sarebbe morta su *"immagine assente"* davanti a un
archivio valido, mandando a cercare il problema dalla parte sbagliata. Ora il riferimento si legge
dall'output di `podman load`; un `--tag` esplicito continua a vincere.

**Pubblicato e verificato**: `build_container.sh --push` da `main` pulito al commit `21bd613`. I tre
tag interrogati con token anonimo da `ghcr.io/token` (la tecnica giusta, imparata il 30 quando un
`curl` diretto aveva dato `401` anche su un package pubblico) → **HTTP 200 tutti e tre**.

---

## Sessione 2026-07-31 (ufficio) — allineamento dei branch e riconciliazione dei due percorsi container

Il maintainer arriva in ufficio dopo aver lavorato da casa la notte, fa il pull e trova sette branch
locali. Richiesta: allineare tutto, poi riprendere.

**Allineamento.** `main` era indietro di 6 commit (fast-forward `2bf742a` → `d17a181`, fatto con
`git fetch origin main:main` per non toccare il working tree — su questa macchina girano più sessioni
sullo stesso checkout). Tutti e sette i branch locali erano identici ai rispettivi remoti: niente di
divergente, niente perso.

**Sei branch su sette avevano il contenuto già in `main`** e sono stati chiusi con un merge `-s ours`
ciascuno, come già fatto la notte per `fix/multiselect-drag` e `feat/container-x86_64`: nessuna
modifica al codice, solo il collegamento storico, così `git branch --merged` li riconosce. Albero di
`main` verificato byte-identico a `origin/main` dopo i cinque merge.

| branch | perché è chiuso |
|---|---|
| `fix/project-write-safety` | squash `d0d9110`; poi `main` ci ha riscritto sopra — il diff verso `main` è di sole rimozioni |
| `fix/deploy-preserve-database` | squash `9f20d06`; 8 file su 15 byte-identici, gli altri superati da `9cd0a3f`/`9c368da` |
| `chore/e2e-and-docs` | squash `631e6d2`; unico residuo un paragrafo `STATUS.md` **duplicato**, non portato |
| `fix/container-host-network-default` | squash `c028b16`; merge a secco → albero identico a `main` |
| `chore/disable-legacy-container-publish` | squash `add86bb`; merge a secco → albero identico a `main` |
| `fix/multiselect-drag` | già chiuso la notte con `d17a181` |

**Il problema vero: i due percorsi container si contraddicevano.** `feat/container-registry-procedure`
(30 sera, ufficio) aveva messo la SPA **dentro** l'immagine e reso `--pull` la strada normale. Il
lavoro della notte da casa (`9c368da`, container x86_64 + installazione dall'IDE via SSH) è partito
dal layout **precedente**, con la SPA fuori: `Containerfile` sdoppiato in `.aarch64`/`.x86_64` senza
il `COPY www/`, e un `POST /api/deploy/device-container` che trasferisce quattro file e invoca
`install-container.sh --image X --www Y`. Mergiare il branch così com'era **avrebbe rotto** "Installa
su dispositivo", perché l'installer del registry rifiuta `--www` con un errore esplicito.

**Decisione del maintainer**: vale quella del 30 sera — SPA nell'immagine — estesa a entrambe le
architetture. Riconciliato sul branch (merge `5cf634d`):

- Il merge meccanico era quasi pulito: i due lati toccano file quasi disgiunti (solo
  `docs/DEPLOY_CONTAINER_AARCH64.md` e `scripts/build_container.sh` in comune), e git ha seguito da
  solo la rinomina `Containerfile` → `Containerfile.aarch64` portandoci sopra le modifiche del branch.
  Unico conflitto l'introduzione del documento aarch64, risolta tenendo entrambe le indicazioni.
- `Containerfile.x86_64` allineato al gemello: `COPY www/` come ultimo layer di contenuto,
  `/var/sws/www` non è più un punto di mount.
- `build_container_x86_64.sh`: `--push`/`--registry` e i controlli preliminari del gemello (albero
  pulito, `podman login`, entrambi *prima* della build), tag `<versione>-amd64` e `<sha>-amd64`,
  niente più archivio SPA separato.
- `packaging.rs`: tre file invece di quattro, niente `--www` nel comando remoto, via `www_tarball` da
  `ContainerPackage` e dalla richiesta di deploy. Un client più vecchio che lo manda ancora non rompe
  niente (serde ignora i campi in più — è il lato utile di **Q9**). Nuovo test sull'assenza di `--www`.
- Il deploy SSH dall'IDE resta come **percorso offline** accanto a `--pull`: un dispositivo in campo
  che non raggiunge il registry è il caso normale, non un ripiego di serie B.

**Verificato**: `cargo check --workspace` verde, `cargo test -p sws-web` 34/34 (1 nuovo), `pnpm build`
verde, `pnpm test` 20/20, `bash -n` sui tre script toccati.

**Poi verificato sul dispositivo dal maintainer, poche ore dopo** — il pezzo che qui risultava
mancante. Installazione dall'IDE su un **WP630** (`wp630-a-p3-07a077.local`, due indirizzi:
`192.168.1.120` e `192.168.60.177`), percorso offline `--image`. Il log conferma che è girato il
codice riconciliato e non quello precedente:

- **tre** `scp` invece di quattro — immagine, installer, unit quadlet: la SPA non viaggia più a parte;
- `==> [3/6] verifico che l'immagine contenga la SPA` → `/var/sws/www/index.html presente`, il
  controllo che esiste solo nell'installer del branch;
- `Network=host (default)`, `linger già attivo`, `/health ok dopo 2s`, `Health check: OK`, `DONE`;
- poi `connected to remote runtime http://192.168.1.120:8444`.

Tempi: ~1,6 s di `scp` per l'immagine, ~18 s di `podman load`, ~47 s in tutto dal `mkdir` al `DONE`.
L'IDE girava in modalità **solo-IDE** (`--viewer-port not set`, porta 8460), cioè `start_editor.sh`
sul PC: è il caso d'uso previsto, editor sul PC e runtime sul dispositivo.

**Resta non verificato**: il percorso `--pull` dal registry (qui si è usato `--image`), e il percorso
**x86_64** — la sua verifica del 2026-07-30 (`docs/DEPLOY_CONTAINER_X86_64.md` §Verifica) precede
questo cambio ed è stata fatta con la SPA fuori dall'immagine.

### Poi: "Cerca runtime" distingue i container (stessa sessione)

Segnalazione del maintainer: cercando i runtime sulla rete non c'è modo di sapere quali girino in
container. Serve per una ragione pratica — dice quale procedura di aggiornamento usare.

**Fatto**: il runtime annuncia una proprietà mDNS `container` col nome del motore, e la riga in
ConfigView porta una pill `📦 podman` / `📦 docker`. Il rilevamento è **a runtime**
(`/run/.containerenv`, `/.dockerenv`, ripiego sul cgroup), non cotto nell'immagine: funziona anche
sull'immagine legacy e sui dispositivi già installati senza ricostruire niente, e non mente se la
stessa immagine viene eseguita da un motore diverso. Un runtime nativo **non annuncia la proprietà**,
quindi niente pill — l'assenza non viene interpretata come "nativo".

**Nel farlo sono usciti due difetti nella discovery, entrambi corretti**:

1. Il doppione già annotato (era item 3 del 30 sera) era in realtà un **triplo**: misurato in locale,
   3 voci per un solo runtime. Causa confermata: `browse_mdns_blocking` accumulava una voce per ogni
   `ServiceResolved`, e mdns-sd ne consegna uno per risposta ricevuta.
2. **Il difetto più serio l'ho quasi introdotto io.** Deduplicare per nome tenendo la prima risposta
   sembrava ovvio, ma le risposte non sono equivalenti: `enable_addr_auto()` annuncia tutti gli
   indirizzi dell'host, loopback compreso, e la prima può portare solo `127.0.0.1`. La prima stesura
   offriva `http://127.0.0.1:8444` **due volte su tre** — un URL inutilizzabile da un'altra macchina,
   cioè peggio del doppione che stavo correggendo. Se ne è accorto il confronto prima/dopo, non la
   rilettura del codice. Ora la scelta dell'indirizzo è ordinata e preferisce un IPv4 non-loopback, e
   una risposta successiva promuove la voce se porta un indirizzo migliore.

**Verificato**: nuovo `scripts/check_discover.sh` (due runtime, N giri, controlla numero di voci +
valore di `container` + assenza di loopback) → 6/6 su 3 giri, e 10/10 nel confronto prima/dopo.
Misura prima/dopo con la deduplica disattivata: 3 voci → 1. `cargo test` 41 (sws-web, 7 nuovi) + 9
(sws-runtime, 5 nuovi), `pnpm build`/`pnpm test` 20/20 verdi.

**Non verificato**: la pill non è stata vista in un browser — provata a livello di API. Si vede al
primo "Cerca runtime" dall'IDE.

### Poi: bottone "🖥 Viewer ↗" nell'header (stessa sessione)

Richiesta del maintainer: dall'editor, un bottone che apra la pagina del runtime in una scheda del
browser, per vedere se risponde. Sta accanto a Deploy — la domanda *"ha funzionato?"* arriva subito
dopo aver premuto quello.

Apre il runtime **connesso** se c'è, altrimenti quello che serve la SPA. Lo stato della connessione
viene chiesto al server al montaggio dell'header e non solo letto dallo store: `remoteUrl` lo scrive
soltanto `RuntimeConnectionTab`, quindi chi ricarica l'IDE senza passare da Configurazione si sarebbe
trovato il bottone puntato al runtime locale mentre era connesso a un dispositivo.

**Due scelte tue**, entrambe con una conseguenza da ricordare:

- **Sonda `/health` prima di aprire**, invece di aprire e basta. Funziona perché `/health` è pre-auth
  su entrambe le porte e il runtime manda CORS permissivo — la risposta è leggibile, non un opaco.
- **La porta del viewer è dedotta** come `admin − 1` invece di essere esposta dal runtime. Corretta
  per ogni installazione esistente (8443/8444, 8445/8446, `CMD` dei Containerfile), ma resta una
  convenzione: **chi avvia con porte fuori convenzione ottiene un indirizzo sbagliato**. Mitigato
  mostrando l'URL dedotto nel tooltip e facendo sparire il bottone quando dedurre non ha senso.

**Verificato in un browser** (non solo in build), tre casi: non connesso → punta al locale e col
viewer assente non apre niente ma mostra il messaggio; connesso a un secondo runtime via API **senza
mai aprire Configurazione** → punta al viewer di quello e apre la pagina vera (è il caso che
l'interrogazione al server serve a coprire); viewer spento → nessuna scheda, messaggio, bottone di
nuovo utilizzabile. Nuovo `viewerUrlFromAdmin()` puro con 6 test; `pnpm test` 26/26.

**Una regressione mia, presa in tempo**: avevo scritto `??` dove serviva `||`, e siccome
`getRuntimeBaseUrl()` restituisce la stringa **vuota** e non `null`, il bottone spariva del tutto nel
caso "non connesso". L'ha trovata la prova in browser, non la rilettura — la build era verde.

### Anche: lo slider ignorava orientamento e sola lettura

Segnalato dal maintainer: «l'oggetto slider se metti orientamento verticale non cambia nulla». Vero,
e il valore **veniva salvato correttamente** — c'è anche nel mirror Rust, quindi sopravvive al
round-trip: semplicemente non lo leggeva nessuno, né l'anteprima nell'editor né il controllo a
runtime. Dimenticanza del solo slider: `radio_group` onora `orientation`, il grafico a barre
`bar_orientation`.

A runtime il controllo nativo viene **ruotato di −90°** (scelta del maintainer) invece di usare
`writing-mode: vertical-rl`: quest'ultimo è lo standard moderno ma vuole Chrome 120+/WebKit 17.4+, e
sul browser dei pannelli Yocto non sappiamo cosa ci sia — dove non fosse supportato lo slider
resterebbe orizzontale, cioè il difetto di partenza ma più difficile da riconoscere.

**Secondo difetto, trovato leggendo il codice per il primo**: lo slider ignorava anche `read_only`.
La spunta "Sola lettura" c'era nel pannello e non faceva niente, quindi un comando dichiarato in sola
lettura scriveva comunque il tag. Corretto (`disabled`). `checkbox`, l'unico altro oggetto che offre
quella spunta, la onorava già.

**Verificato in un browser, misurando**: nel viewer, orizzontale 192×15 senza trasformazione,
verticale 15×245 ruotato, verticale in sola lettura 15×245 ruotato **e `disabled=true`**;
nell'editor, binario orizzontale lungo 200 px e binario verticale lungo 278 px.

**Da sapere**: l'orientamento non tocca la geometria dell'oggetto. Uno slider lasciato alla dimensione
di default della toolbar (200×40) e messo verticale diventa un moncone — misurato, 15×23 px. Va reso
più alto che largo. Se conviene che il cambio di orientamento inverta da sé larghezza e altezza, è una
riga, ma è una decisione da prendere: cambiare la geometria di un oggetto in risposta a una proprietà
è una sorpresa, e va nella history dell'undo.

### Anche: WP830/WP630 sono 1920×1080

Segnalato dal maintainer: il preset dispositivo li dichiarava 1366×768. Corretto in
`brand.json`. **Il preset agisce solo alla creazione della pagina**, quindi i progetti già disegnati
con la misura vecchia restano a 1366×768 finché non si cambia a mano la dimensione — se ce n'è
qualcuno in servizio, va sistemato a mano.

**Da riprendere**:

1. **Provare `install-container.sh --pull`** dal registry: l'installazione sul WP630 ha usato il
   percorso offline `--image`, quindi il percorso registry con la SPA nell'immagine non è ancora
   stato esercitato su un dispositivo. Serve `build_container.sh --push` (e l'SDK Yocto).
2. **Il percorso x86_64 va riprovato**: `build_container_x86_64.sh` non è stato eseguito dopo la
   riconciliazione, e la sua verifica del 30 precede il cambio.
3. L'occasione di 1 e 2 serve anche per **vedere la pill del container su un runtime vero**, non
   forzato con `SWS_CONTAINER_ENGINE`, e per guardare il bottone Viewer contro un dispositivo reale.
4. **`feat/container-registry-procedure` aspetta il tuo via libera** per lo squash merge in `main`.

---

## Sessione 2026-07-31 — fix deploy container (hang, log, output remoto) + percorso dati brand-aware (branch `feat/container-x86_64`)

Continuazione della sessione precedente sullo stesso branch, non ancora mergiato. Il maintainer ha
provato il flusso "Installa su dispositivo → Container" dall'IDE verso un device reale
(192.168.1.169) e ha riportato due problemi.

**Il deploy restava bloccato dopo il `mkdir` iniziale, senza errore.** `run_ssh_cmd` (condivisa da
`deploy_device` e `deploy_device_container`) passava solo `-o StrictHostKeyChecking=no`: senza
`sshpass` e senza una chiave SSH già autorizzata, `ssh`/`scp` tentavano un prompt interattivo che
il processo backend — nessun terminale, nessun `DISPLAY` funzionante — non può mai soddisfare, e
restavano appesi indefinitamente. Aggiunto `-o BatchMode=yes` (solo quando non si usa `sshpass`,
perché altrimenti romperebbe proprio il meccanismo con cui `sshpass` intercetta il prompt) e
`-o ConnectTimeout=10` su entrambi i percorsi. Riprodotto lo scenario esatto del maintainer
(self-SSH, nessuna chiave autorizzata): prima del fix restava appeso, dopo fallisce in 0,14 s con
un errore chiaro.

**I messaggi del deploy non arrivavano al logger principale**, solo allo stream HTTP effimero del
modale — `packaging.rs` non aveva nessuna chiamata `tracing::`. Aggiunta una macro
(`log_deploy_line!`) che specchia ogni riga nel logger globale (già instradato da `main.rs` verso
`LogBusLayer` → file JSONL + pannello Log), usata nei tre handler streaming (`build_package`,
`deploy_device`, `deploy_device_container`).

**Un `exit 1` senza spiegazione, anche dopo il fix del hang**: `run_ssh_cmd` catturava solo lo
stato di uscita, non stdout/stderr — l'output reale del comando remoto (incluso quello di
`install-container.sh` sul device) finiva ereditato dallo stdio del processo backend, invisibile
sia nella UI sia nei log. Riscritta per catturare e inoltrare ogni riga (con un rientro di 4 spazi
per distinguerla dalle righe `==>` proprie). Verificato via self-SSH: il log ora mostra il vero
errore stampato sul device, non solo il codice di uscita.

**Percorso dati sul device brand-aware**: il fallimento reale sul device del maintainer era
`install-container.sh` che non riusciva a creare `/data/user/sws` (permessi) — confermato solo
grazie al fix precedente, che finalmente mostra l'output remoto. Il maintainer ha confermato che
il percorso giusto cambia da prodotto a prodotto, e ha chiesto un menù a tendina per il modello del
device, con i modelli definiti nel branding dell'IDE (chi ha il brand Pixsys vede i modelli
Pixsys, brand SWS vede solo il custom). Ricalcato esattamente il pattern già esistente per i
preset di risoluzione pagina (`Brand.devicePresets` / `EditorShell.tsx`): nuovo
`Brand.dataPathPresets: {label, path}[]`, popolato da `data_path_presets` in `brand.json` (oggi
solo Pixsys, un modello: `/data/user/sws`, la convenzione comune a tutta la linea Yocto WP-series).
`install-container.sh` non è stato toccato — `--data` esisteva già come flag; serviva solo che il
backend lo passasse. Nuovo campo `DeviceContainerDeployRequest.data_path` (stringa vuota =
comportamento identico a oggi), validato con la stessa `validate_remote_path` già usata per
`remote_dir`, e una `build_install_cmd` estratta per essere testabile in isolamento.

**Verifica end-to-end via self-SSH** (stessa tecnica delle sessioni precedenti: chiave autorizzata
solo per la durata del test, ripristinata subito dopo) con `--data /tmp/sws-deploy-data-test`: la
directory dati, il caricamento immagine, l'unpack della SPA, la riscrittura dei mount nella unit
quadlet e l'avvio sono andati **tutti a buon fine** — `/health ok dopo 2s`, primo deploy container
davvero completo (non solo parziale) di questa serie di test. Ripulito con
`install-container.sh --uninstall --purge` (nota per il futuro: il purge non ricorda il `--data`
usato all'installazione — va ripassato esplicitamente, altrimenti prova a ripulire il default).

**Verifica**: `cargo test -p sws-web` → 33/33 (2 nuovi su `build_install_cmd`) + `pnpm build`/
`pnpm test` (20/20) verdi. Istanze dev live (porta 8460) verificate intatte dopo ogni test.

**Resta da fare**: riprovare il deploy verso il device reale 192.168.1.169 scegliendo il modello
Pixsys (o un percorso custom, se quel device non segue la convenzione `/data/user/sws`); il resto
di "Resta da fare" della sessione precedente (aggiornare README con "container è la via
standard") è ancora aperto.

---

## Sessione 2026-07-30 (sera 2) — container x86_64 + installazione da IDE (branch `feat/container-x86_64`)

Richiesta del maintainer: il container deve diventare **la via standard** per il runtime, sia su
arm64 sia su x86_64, e l'installazione deve poter partire **dall'IDE** (Configurazione → Runtime),
riusando le credenziali SSH già in UI. Confermato con l'utente: **solo Podman** per ora (Docker
avrebbe richiesto un secondo percorso completo — niente quadlet lì — rimandato).

**Parte A — build x86_64** (mancava del tutto: verificato leggendo `docs/DEPLOY_PX30.md` per
intero che il commento nel Containerfile che vi rimandava per "x86 legacy" era sbagliato — quel
doc copre target ARM64 generici buildati da un laptop x86, non un target x86_64):
- `deploy/container/Containerfile` → rinominato `Containerfile.aarch64`; nuovo `Containerfile.x86_64`
  gemello (nessun SDK, binario nativo `cargo build --release`, nessun cross-compile).
- Nuovo `scripts/build_container_x86_64.sh`, ricalca `build_container.sh` riga per riga.
- **Verifica `readelf` fondamentale, non skippabile**: il primo tentativo con `debian:bookworm-slim`
  (ipotesi ragionevole, stessa base della legacy) si sarebbe rivelato **rotto all'avvio** — il
  binario buildato su questa macchina (Python non di sistema, tipo pyenv) dichiara
  `libpython3.13.so.1.0` + `GLIBC_2.39`, che bookworm-slim non ha. Corretto a `debian:trixie-slim`
  (glibc 2.41 + Python 3.13) **prima** di distribuire qualunque cosa, verificato con `podman run`
  diretto: `healthy`, `/health` 200, template non vuoti, RestrictedPython attivo, nessun
  `SWS_ADMIN_PASSWORD` richiesto.
- **Limite dichiarato in `docs/DEPLOY_CONTAINER_X86_64.md`**: a differenza del binario Yocto
  (SDK fisso, riproducibile), un binario x86_64 nativo lega glibc/Python alla macchina che lo
  builda — la riga `FROM` del Containerfile.x86_64 **va riverificata per ogni macchina di build
  diversa**, non è un valore universale.
- Test end-to-end di `install-container.sh` fatto **senza toccare le istanze dev già attive sulla
  stessa macchina** (porte 8443/8444/8460 già occupate): copia temporanea dello script con porte
  remappate (28443/28444) + `--data` in scratch dir — mkdir, `podman load`, unpack SPA, avvio,
  `/health ok dopo 2s`; istanze live verificate intatte dopo.

**Parte B — installazione container dall'IDE via SSH**: nuovo endpoint
`POST /api/deploy/device-container` (`sws-web/src/packaging.rs`), stesso pattern shell-out
SSH/SCP già usato da `deploy_device` (il binario nudo — nessuna libreria SSH Rust, `sshpass`/`scp`/
`ssh` di sistema via `tokio::process::Command`), ma: carica **quattro** file (immagine, SPA,
`install-container.sh`, il quadlet — l'installer legge quest'ultimo da una posizione relativa a
sé stesso, quindi devono stare nella stessa directory remota) ed esegue l'installer **senza
`sudo`** (podman rootless — differenza reale rispetto al binario nudo, comunicata anche in UI).
Nuovo `GET /api/build/container-packages` elenca le coppie immagine+SPA già buildate in `dist/`
(pattern `sws-runtime-<versione>-{aarch64,x86_64}-image.tar.gz`), segnala se manca l'archivio SPA
corrispondente (l'immagine non lo contiene mai). Frontend: `ConfigView.tsx` → tab Runtime →
"Installa su dispositivo" ha ora un selettore **Binario nativo / Container (Podman)**, stessi
campi host/porta/utente/password/directory remota riusati identici — solo l'elenco pacchetti e
l'endpoint chiamato cambiano.

**Verifica end-to-end del deploy via SSH**: fatta su questa stessa macchina (self-SSH, chiave
temporaneamente autorizzata e rimossa subito dopo il test, nessun accesso nuovo dato che c'era
già shell completa) contro un'istanza runtime usa-e-getta su porta dedicata (per non toccare le
istanze dev live): `GET /api/build/container-packages` trova l'immagine x86_64 già costruita,
`POST /api/deploy/device-container` esegue correttamente mkdir + 4× scp + invocazione di
`install-container.sh` (fallito solo sull'ultimo passo per un limite **pre-esistente e non mio**
dello script — `/data/user/sws` non esiste su questa macchina generica, assunzione valida solo su
device Pixsys reali).

**Verifica**: `cargo build`/`cargo test -p sws-web` (31 test, 4 nuovi su `parse_image_tarball`/
`validate_remote_path`) + `pnpm build`/`pnpm test` (20/20) verdi.

**Resta da fare**: mergiare `feat/container-x86_64` dopo validazione del maintainer; provare il
deploy container da IDE verso un device Pixsys reale (non solo self-SSH); considerare se
aggiornare la messaggistica "il container è la via standard" anche in `README.md`/altri doc di
primo impatto, non solo nei doc di deploy dedicati.

**Batteria completa su `main` fuso** — `cargo check` verde, Rust 21+6+27 test, frontend 20/20,
`pnpm build` verde, e i sei controlli:

| controllo | esito |
|---|---|
| `check_project_write_safety.sh` | 9/9 (4/9 senza il fix) |
| `check_deploy_preserve.sh` | storico 500→500, utenti/ricette/backup intatti, 4 casi utenti |
| `check_database_mgmt.sh` | orfani, cancellazione, spazio recuperato, retention |
| `check_multiselect_drag.sh` | ancora e seguace entrambi dx=120 dy=60 |
| `check_viewer_layout.sh` | nessuna scrollbar in 4 configurazioni su 4 |
| `check_spa_autoreload.sh` | ricarica dopo ~28 s col bundle nuovo |

`check_e2e.sh` **non** è nella batteria: passa 3-4 test su 6 e quali cambia fra esecuzioni, perché i
test condividono un runtime e ognuno apre i propri progetti. Da isolare prima di poterlo usare come
gate; il limite è scritto in testa allo script.

**Resta da provare sul dispositivo**: il deploy che conserva il database e il pulsante utenti — il
codice è **già sul dispositivo** dalla sera del 30 (immagine ricostruita e installata dal registry),
ma nessuno li ha esercitati. Resta il fallimento stabile di `lang-table`, che nel viewer non risolve
`{{token}}`: da capire se è il test o la funzione.

---

## Sessione 2026-07-30 (sera, dev server) — il container si distribuisce da un registry

Il maintainer ha chiesto di aggiornare il runtime sul WP620 (`user@192.168.1.84`), poi un deploy
pulito, poi tutta la procedura di compilazione/pubblicazione/installazione.

**Dove siamo arrivati**: l'immagine aarch64 è pubblicata su `ghcr.io/soligolab/sws-runtime` come
package **pubblico**, e il dispositivo la scarica **senza credenziali** — verificato, `podman login
--get-login ghcr.io` risponde *not logged into* e il pull riesce lo stesso. Portare una versione
nuova era copiare 59 MB via `scp` più un secondo artefatto con la SPA; ora è
`install-container.sh --pull`, e si trasferisce solo il layer cambiato (il binario è 14,3 MB
compressi, i 50 MB di base e apt il dispositivo li ha già).

- **La SPA è entrata nell'immagine** (decisione del maintainer): stava fuori per non ritrasferire
  59 MB a ogni modifica del frontend, ragione caduta con la deduplicazione dei layer. Sta **dopo** il
  binario, perché un layer che cambia invalida quelli sotto. Sparisce `--www-only`, sparisce il modo
  di avere SPA e binario di versioni diverse sullo stesso dispositivo.
- **Aggiornamenti a comando, non automatici** (decisione del maintainer): `podman auto-update` c'è e
  il SO fornisce già il timer, ma su una macchina in servizio un riavvio non richiesto è peggio di un
  aggiornamento tardivo.
- **La rete host è il default dell'installer.** Senza, "Cerca runtime" non trova **mai** un runtime in
  container: sulla rete rootless di podman il multicast non esce. Misurato dallo stesso editor a
  pochi minuti di distanza — `--bridge` → `/api/discover` risponde `[]`, default → trova il runtime
  con `admin_url http://192.168.1.84:8444`.
- **Job CI della pubblicazione disattivato**: costruiva l'immagine *legacy* (quella coi quattro
  difetti) e la pubblicava all'indirizzo che il badge del README promette. Non è correggibile in CI —
  il binario buono richiede l'SDK Yocto Pixsys, che sui runner GitHub non c'è.

**Il bug della giornata**: `--uninstall --purge` seguito da un'installazione **non** dava un
dispositivo pulito. Il purge svuota i bind mount, e l'installer migrava i dati dai volumi nominati
pre-2026-07-28 *proprio perché* la cartella era vuota — cioè per definizione dopo un purge. Il
dispositivo è tornato in servizio con un progetto `test1` di due giorni prima, aperto come attivo.
Ora la migrazione è dietro `--migrate-volumes`. **Stessa forma degli altri tre casi della
settimana**: un automatismo che deduce l'intenzione dell'utente da uno stato ambiguo.

**Due errori miei, entrambi utili da ricordare**:

- Ho concluso che il package GHCR fosse privato perché un `curl` sul manifest dava `401`. GHCR
  pretende un bearer token **anche per le immagini pubbliche**: quel 401 non dimostra niente. La
  verifica giusta è token anonimo da `ghcr.io/token?scope=...` e poi il manifest.
- Ho messo le `LABEL` OCI subito dopo il `FROM`, invalidando la cache di tutto ciò che segue: la
  build è rimasta 15 minuti a ricostruire sotto QEMU il layer `apt` che era già pronto. In fondo al
  Containerfile la stessa build dura 2,7 secondi.

**Sessione precedente**: 2026-07-29 — **Container aarch64 in servizio sul dispositivo, Telegram per singolo allarme, notifiche morte al boot** (branch `feat/container-aarch64`, portato in `main` con squash). Viewer a schermo pieno e auto-reload verificati in un browser, non più solo scritti.

**Da riprendere (2026-07-30 sera)**:

1. **`feat/container-registry-procedure` aspetta il tuo via libera per il merge** — `91b8687`
   (registry, SPA nell'immagine, `--migrate-volumes`) e `52ea5d3` (documentazione in tre fasi +
   README). Provato sul dispositivo, non ancora confermato da te. Gli altri due branch container sono
   già in `main` (`c028b16`, `add86bb`).
2. **Il purge non è stato riprovato dopo la correzione**: il dispositivo aveva sopra il tuo `Test034`
   e distruggerlo per un test non valeva il prezzo. Da fare sul prossimo dispositivo da azzerare
   davvero — `--uninstall --purge` + install → `GET /api/projects` deve dare `[]`.
3. ~~**`/api/discover` mostra ogni runtime due volte.**~~ **Corretto il 2026-07-31** (vedi la sezione
   in cima). La causa era quella individuata — `browse_mdns_blocking` accumulava una voce per evento
   `ServiceResolved` — ma il conteggio era per difetto: misurate **tre** voci, non due. E deduplicare
   da solo non bastava: teneva la prima risposta, che spesso porta solo il loopback.
4. **Backup lasciati sul dispositivo**, in `~` di `user@192.168.1.84`:
   `sws-data-backup-20260730-144812.tar.gz` (progetto `pippo` e config del 29) e
   `volbackup-sws-{projects,config,logs}-20260730.tar` (i volumi nominati prima di rimuoverli).
   Da cancellare quando sei sicuro che non servano.

> **Nota di metodo**: su questa macchina girano **più sessioni Claude contemporanee sullo stesso
> checkout**. `git status` può cambiare fra due comandi consecutivi e un branch può cambiare sotto
> una build lunga: per build e deploy conviene un worktree isolato su un commit fisso.

**Sessione precedente**: 2026-07-29 — **Container aarch64 in servizio sul dispositivo, Telegram per singolo allarme, notifiche morte al boot** (branch `feat/container-aarch64`, portato in `main` con squash). Viewer a schermo pieno e auto-reload verificati in un browser, non più solo scritti.

**Permessi `ssh`/`scp`** (deciso il 2026-07-30, non più in sospeso): restano fuori dal `deny` di
`.claude/settings.json` finché il test sul dispositivo non è chiuso — se serve indagare insieme, senza
accesso non si può — e si rimettono subito dopo. `Bash(rsync *)` resta in `deny`.

**Da riprendere alla prossima sessione** — tre verifiche che richiedono una persona davanti allo
schermo, e una decisione:

1. **Guardare il pannello WP620.** Il layout del viewer l'ho misurato in Chromium a 1280×800
   (`scripts/check_viewer_layout.sh`), ma nessuno ha visto lo schermo del dispositivo dopo
   l'aggiornamento di oggi. Per far sparire la barra superiore serve attivare `hide_viewer_chrome`:
   Editor → pannello sinistro → PAGINE → ⚙ (non sta in Configurazione).
2. **La colonna Telegram dalla tab Allarmi.** Provata via API con quattro casi e un bot vero; la
   tendina non l'ha ancora toccata una persona.
3. **Le notifiche email.** Il fix delle notifiche al boot vale anche per SMTP, ma ho esercitato solo
   Telegram: nessuna email è stata inviata in nessun test.
4. **Decisione sui permessi**: `Bash(ssh *)` / `Bash(scp *)` sono stati tolti dal `deny` di
   `.claude/settings.json` per i test sul dispositivo, con un allow ristretto. I test di oggi sono
   chiusi: da decidere se rimetterli. `Bash(rsync *)` è rimasto in `deny`.

Nuove questioni aperte annotate in `docs/OPEN_QUESTIONS.md`: **Q9** (le `PUT /api/project/*`
accettano e scartano in silenzio i campi sconosciuti — scoperto mandando `width`/`height` a
`page-layout` e ricevendo `204`) e **Q10** (una sorgente non parsabile viene scartata all'apertura e
**cancellata dal disco** al primo salvataggio successivo: stessa forma della perdita di dati corretta
il 28).

**In parallelo, stessa giornata, dall'altra macchina**: demo "Nebulizzatore Sandokan" (MQTT reale) + fix dello storico perso al riavvio. Template e progetto importati/deployati, bug isolato e corretto, cherry-pickati in `main` (`718a3bb`, `d3fef51`). Branch `feat/project-location-and-brand-presets` cancellato in locale perché interamente contenuto in `main`. Nota: quel fix e il mio sulle notifiche sono **la stessa classe di bug** — il percorso di auto-apertura al boot in `main.rs` ricopiava a mano quello che fa `open_project`, e ogni pezzo dimenticato (lo storico, le notifiche) resta invisibile finché non serve.

- **Layout del viewer verificato in un browser (2026-07-29)**: era lavoro già pushato ma mai provato davvero. Nuovo `scripts/check_viewer_layout.sh` (+ `sws-editor/scripts/viewer_layout_measure.mjs`) che misura le barre di scorrimento a 1280×800 in quattro configurazioni. Confronto **prima/dopo** ricostruendo la SPA pre-fix: prima tre barre confermate — documento 816 px in 800 per il `margin: 8px` del body, area pagina `ch 730` contro pagina 800 (fasce non sottratte) e `cw 1264` contro 1280 — più `hide_viewer_chrome` ignorato e nessuno scale-to-fit. Dopo: nessuna barra, `<nav>` che scompare, scale 0,914 con le fasce e 1,0 senza, cap a 1 rispettato. Browser di Playwright ora installato su questa macchina (`~/.cache/ms-playwright`). Scoperto anche che `page_layout` non ha `width`/`height`: in modalità fisso la dimensione viene dal synoptic, e il PUT accetta quei campi con 204 scartandoli.

- **Telegram per-allarme provato sul dispositivo con un bot vero (2026-07-29)** — quattro casi sull'allarme `counter_high` di `pippo`, con l'immagine aarch64 aggiornata: *chat predefinite* (campo assente) → messaggio inviato; *non notificare* → silenzio; *chat specifiche* → messaggio inviato; *chat specifiche senza chat* → `WARN telegram: modo 'chat specifiche' senza nessuna chat` e nessun invio. Definizione dell'allarme ripristinata identica; `diff -r` col backup mostra come unica differenza `.history/historian.db`, cioè il registro storico che ha annotato gli eventi del test. Backup conservato in `/data/user/sws/.backup-claude/pippo-20260729-095821`.
- **Autostart del container al boot: verificato per la prima volta (2026-07-29)** su un riavvio reale del dispositivo (up 1h07 al momento del controllo): container già attivo e `healthy`, unit quadlet `active`, `Linger=yes`. Non serviva accesso fisico perché ha funzionato.

- **NOTIFICHE MORTE AL BOOT, trovato e corretto il 2026-07-29** — il bug più serio di questa sessione. Sul dispositivo, dopo ogni riavvio, gli allarmi non mandavano né Telegram né email e gli script globali non partivano: l'auto-apertura del progetto in `main.rs` non avviava canale Telegram, supervisore notifiche e supervisore script. Tornava a funzionare solo riaprendo il progetto dall'IDE. Spiega il sintomo *"la notifica di test mi arriva ma il messaggio dell'allarme no"*. Diagnosticato sul dispositivo (assenza della riga `notification supervisor started` al boot, presenza dopo un `open`, seguita da `telegram message sent`). **Corretto** estraendo `projects::start_project_services`, ora usata da tutti e tre i percorsi di apertura; `router::build` restituisce anche l'`AppState`. **Lezione**: tre copie della stessa sequenza di avvio divergono in silenzio — il percorso di boot non ha nessuno che lo guardi.
- **`install-container.sh`: validazione prima di fermare il servizio (2026-07-29)** — rimuoveva il container al passo 4 e scopriva la unit quadlet mancante al passo 5, lasciando il dispositivo senza runtime. Capitato dal vivo. Nuovo passo 0 che valida tutto prima di toccare qualsiasi cosa.

- **Auto-reload della SPA verificato (2026-07-29)**: nuovo `scripts/check_spa_autoreload.sh` (+ `sws-editor/scripts/spa_autoreload_measure.mjs`). Simula il deploy rinominando il chunk di entry con un hash diverso, quindi basta una build. Misurato: il viewer si ricarica dopo ~28-30 s e serve il bundle nuovo. Era l'altra metà del *"non prendere abbagli"*: prima non c'era prova che il pannello prendesse davvero la versione aggiornata.

- **Segreti in backup/export/deploy (2026-07-29)**: decisione del maintainer — password e token sono dati di progetto e devono essere salvati e ripristinati in tutte le procedure; la custodia sicura dei backup è responsabilità dello sviluppatore. Prima il bundle dichiarava `secrets_masked: true` mascherando **solo** MQTT, e siccome il deploy remoto usa la stessa `build_project_zip` il dispositivo riceveva un broker senza credenziali. Ora nessuno strip; `secrets_masked` resta nel manifest solo per compatibilità di formato, sempre `false`. **Invariata** la mascheratura `********` sulle GET (browser) — è un'altra cosa e serve. Verificato con un test sul bundle del deploy e col giro export→import sul runtime vero.

- **Telegram per singolo allarme (2026-07-28)**: colonna *Telegram* nella tab Allarmi con tre stati — chat predefinite / chat specifiche / non notificare. Campo assente = chat predefinite, per non spegnere in silenzio allarmi già in servizio. Decisione in `AlarmDef::telegram_routing()` con 6 test, incluso il giro su YAML di `off` (token booleano in YAML 1.1). "Chat specifiche" senza chat non ricade sul globale: segnalato nel log e sulla riga. Il canale Telegram porta ora `TelegramMessage` con destinatari opzionali; gli script restano sul canale `String`. **Verificato**: round-trip attraverso l'API reale (salvataggio → project.yaml → riapertura del progetto) su quattro allarmi, uno per stato più uno senza il campo. Poi **provato con un bot vero sul dispositivo** il 2026-07-29, quattro casi su quattro (voce sopra).

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

> **La storia della linea "office" è conservata dal tag `archive/office-2026-05-21`** (commit
> `4d93de8`), presente in locale **e su `origin`** dal 2026-07-29. I tag non vengono potati dal `gc`:
> quei 151 commit restano raggiungibili anche se i branch che li puntavano non esistono più. Vale la
> pena saperlo prima di allarmarsi: cancellando `archive/office-line-2026-05-21` avevo scritto che la
> storia andava perduta, ed era falso — il tag c'era già, semplicemente non l'avevo cercato.
>
> **`backup/friday-phase-a1` eliminato il 2026-07-29** (locale + remoto), punta `42babe9`. Era un
> backup del venerdì sera 15 maggio sulla stessa linea "office": si separava a `f1cd49f` con **un
> solo commit proprio**, il frontend di Phase A1 in corso d'opera (`WelcomeScreen` di 406 righe).
> Superato due volte — dalla versione completa sulla linea office (`a4fa839`, raggiungibile dal tag) e
> da quella indipendente sulla linea di `main` (`5f17bf1`, dove `WelcomeScreen.tsx` è oggi 1190
> righe). I 63 commit condivisi restano raggiungibili dal tag: l'eliminazione ha reso irraggiungibile
> solo quel WIP.

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

> **`feat/container-aarch64` chiuso il 2026-07-29**, punta `634665c809ee7680270546199e86b6ccf328ab10`.
> 18 commit dal 27 al 29 luglio (container podman aarch64, deploy sul dispositivo, viewer a schermo
> pieno, Telegram per-allarme, notifiche morte al boot, segreti nei bundle, perdita di dati di
> "Salva tutto"), entrati in `main` con lo squash `72b6b3c`. Il **contenuto** è in `main`; quello che
> si perde dopo il `gc` è la storia granulare — i 18 messaggi di commit, che erano la parte più
> documentata della sessione. Il riassunto vive nel messaggio di `72b6b3c` e il dettaglio in
> `CHANGELOG.md` e nelle voci qui sopra.

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
- [ ] **T-49 — mDNS annuncia anche sulle interfacce veth di podman/docker, l'editor sceglie quella sbagliata** (2026-08-06): `announce_mdns()` in `sws-runtime/src/main.rs:1182` usa `enable_addr_auto()` di `mdns-sd`, che pubblica un indirizzo per **ogni** interfaccia locale — incluse le veth residue di container (`vethXXXXXXX`, solo IPv6 link-local con `%scope`) viste su questa macchina di sviluppo. L'editor, connettendosi via discovery, ha risolto `https://fe80::...%veth58fbd0f:8444` invece della LAN IPv4 reale (`192.168.1.169`), rendendo "Connetti runtime" inutilizzabile senza inserire l'indirizzo a mano. Probabile fix: filtrare le interfacce prima di passarle a `mdns-sd` (escludere `veth*`/`docker*`/`br-*`, o restringere a quella di `detect_lan_ip()` già presente nello stesso file) — imparentato ma distinto dal duplicate-entry item sopra. Workaround nel frattempo: bypassare la lista scoperta e digitare l'IP LAN a mano in ConfigView → Runtime → Connetti.
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
