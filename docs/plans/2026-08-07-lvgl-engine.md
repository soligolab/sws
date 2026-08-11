# Motore di rendering LVGL per SWS — analisi architetturale e fondamenta (Fase 1)

## Contesto

SWS oggi ha un unico modo di presentare i sinottici: una SPA React che disegna SVG/Canvas2D nel browser, consumata via `sws-kiosk` (wrapper GTK4+WebKitGTK) o via Chromium su Weston sui device Yocto reali. Questo funziona bene su hardware con un motore browser completo disponibile, ma **non è cross-compilabile per il sysroot Pixsys** (manca GTK4/WebKitGTK) — oggi su quei device gira Chromium esterno a SWS, non `sws-kiosk`.

È arrivata una richiesta nuova: poter generare l'interfaccia grafica in **LVGL**, disegnando direttamente su framebuffer o Wayland, per target embedded più leggeri di un browser — con un occhio già aperto su architetture future come ESP32. L'idea del maintainer è che questo diventi una seconda "modalità" di progetto (Web vs LVGL) scelta al momento della creazione, con l'IDE che poi espone solo il sottoinsieme di oggetti/protocolli supportato dal target scelto, il tutto sviluppato su un ramo Git dedicato e riunito a `main` quando stabile.

Questa sessione è dedicata esplicitamente a: **analisi di fattibilità** + **fondamenta solide** (non l'intero motore). L'obiettivo concreto di questo blocco di lavoro è arrivare ad avere un primo eseguibile Rust che, sul simulatore SDL2 di LVGL, disegna qualcosa — provando che l'approccio architettonico scelto regge — più tutta la documentazione/branch necessaria perché il lavoro sia ripartibile su un'altra sessione o un'altra macchina.

## Sintesi della fattibilità (dall'esplorazione del repo)

- **Terreno vergine**: nessuna menzione di LVGL/framebuffer/ESP32 in tutto il repo. `sws-kiosk` (108 righe, GTK4+WebKitGTK) è l'unico precedente concettuale — è solo un wrapper browser, non offre codice di rendering riusabile, ma offre un **pattern di lifecycle già collaudato** (flag `--kiosk-wayland` in `sws-runtime/crates/sws-runtime/src/main.rs`, spawn di un binario viewer separato quando `/health` risponde).
- **Il motore Rust è già ben disaccoppiato dal web**: `sws-core`, `sws-historian`, `sws-pyscript`, `sws-auth`, `sws-audit`, i plugin protocollo (`sws-plugin-modbus/opcua/mqtt/s7/enip/homeassistant`) **non dipendono da axum** — comunicano tramite canali `tokio::sync::broadcast`/tipi condivisi. L'unico punto che mette tutto insieme e lo espone all'esterno è il crate `sws-web` (router Axum, dual-porta 8443 viewer/8444 admin).
- **Il backend non renderizza mai nulla**: espone solo JSON (`SynopticObject`/`SynopticPage`, ~150 campi opzionali, molti SVG/CSS-specifici come `stroke-dasharray` o `transition_duration_ms`) via REST (`/api/synoptics/:name`) e stream WebSocket con pattern snapshot+delta (`/ws/tags`, `/ws/alarms`). Tutta l'interpretazione widget-per-widget vive **solo in TypeScript**, in `sws-editor/src/canvas/SvgCanvas.tsx` (dispatcher `SvgObject()`, un ramo `if` per tipo).
- **I protocolli sono già indipendenti dalla presentazione**: girano come task Tokio nel `SourceSupervisor` (dentro `sws-web`, ma senza dipendenza dal renderer) e scrivono nel `TagDb` condiviso. Questo significa che **un client LVGL non deve reimplementare né limitare nulla lato protocolli** — qualunque sorgente dati (Modbus, OPC-UA, MQTT, S7, EtherNet/IP, HomeAssistant) alimenta allo stesso modo sia il browser sia un ipotetico viewer LVGL, perché entrambi leggono dallo stesso `TagDb` via WebSocket. La frase "oggetti e protocolli implementati anche per LVGL" del brief va quindi riletta come: **i protocolli sono già tutti disponibili**, il lavoro reale è solo sul sottoinsieme di *widget* renderizzabili.
- **LVGL v9 supporta ufficialmente tutti i backend richiesti su Linux** (progetto di riferimento [`lv_port_linux`](https://github.com/lvgl/lv_port_linux)): framebuffer legacy (fbdev), DRM/KMS diretto, Wayland client, **e un simulatore SDL2** per sviluppo desktop senza hardware — quest'ultimo è particolarmente utile dato il vincolo "sessioni sparse, hardware non sempre a portata di mano".
- **Rischio tecnico da tenere d'occhio**: il crate Rust ufficiale `lvgl` (org. `lvgl/lv_binding_rust` su crates.io) risulta fermo a **LVGL 8.x** (bindings safe via `lvgl-sys`/bindgen + `lvgl-codegen`), mentre i driver Linux moderni (DRM/KMS, Wayland) documentati sopra sono dell'ecosistema LVGL v9. Non è un problema bloccante ma va gestito esplicitamente (vedi sezione dedicata sotto) — non abbiamo la certezza che il binding Rust segua 1:1 l'ultima versione C della libreria.

## Decisione architetturale: nuovo client, motore esistente invariato

**Scelta**: il motore LVGL è un **nuovo binario Rust separato** (`sws-lvgl-viewer`, nuovo crate in `sws-runtime/crates/`) che si comporta come **client WS/REST verso il runtime `sws-web` già esistente** — esattamente lo stesso ruolo che oggi ha il browser (o `sws-kiosk`): si connette a `/ws/tags` e `/ws/alarms` sulla porta viewer (8443, `optional_auth`), e legge `/api/synoptics/:name` + `/api/project` via REST.

**Perché non l'alternativa** (linkare direttamente `sws-core`/`sws-historian`/i plugin in un nuovo binario, bypassando `sws-web`): sarebbe più "puro" ma richiederebbe di estrarre da `sws-web` orchestrazione che oggi vive solo lì (`SourceSupervisor`, script globali, notifiche) — un refactoring del runtime esistente, rischioso per un PoC con decisioni "congelate" e un solo maintainer. L'approccio a client:
- **zero modifiche al runtime esistente** in questa fase — nessun rischio per ciò che già funziona;
- riusa un protocollo di sincronizzazione già progettato, testato e capito (snapshot+delta);
- ricalca un pattern già collaudato nel repo (`sws-kiosk` come processo viewer separato, spawnabile con lo stesso meccanismo `--kiosk-wayland`/health-check già in `main.rs`);
- tiene il binario LVGL **leggero**: a differenza di `sws-runtime`, non ha bisogno di PyO3/libpython (lo scripting resta lato server), quindi in prospettiva potrà usare un'immagine container più snella.

Il lavoro vero, quindi, non è "disaccoppiare il motore" (lo è già abbastanza) ma **scrivere un interprete di `SynopticObject` in LVGL**, equivalente a `SvgCanvas.tsx` ma in Rust/C, per un sottoinsieme di widget scelto deliberatamente più piccolo di quello web.

## Rischio tecnico: binding Rust per LVGL (v8 vs v9)

Due strade, da non decidere "alla cieca" ma verificare con uno spike pratico a inizio Fase 2:

- **A — crate ufficiale `lvgl` (LVGL 8.x)**: API Rust safe già pronta, meno lavoro FFI, partenza più rapida. Incognita: se il suo backend Linux/SDL2 integrato sia sufficiente, e se in futuro (Fase 4, Wayland/DRM reali) regga il passo o vada sostituito.
- **B — bindgen custom contro sorgenti C di LVGL v9** (vendorizzati, seguendo `lv_port_linux` per i driver): più lavoro iniziale, API unsafe da wrappare a mano, ma allineato ai driver Linux ufficialmente mantenuti oggi (fbdev, DRM/KMS, Wayland, SDL2 tutti confermati su LVGL 9.4–9.6).

**Raccomandazione**: iniziare con l'opzione A per la Fase 2 (SDL2, vedi sotto) per massimizzare velocità di feedback nelle prime sessioni; **rivalutare esplicitamente** quando si arriverà alla Fase 4 (framebuffer/DRM/Wayland reali) se il crate v8 regge o se conviene migrare a bindgen custom su v9. Questa rivalutazione va registrata come nuova voce in `docs/OPEN_QUESTIONS.md` (vedi sezione documentazione sotto), non decisa a priori adesso.

## Fasi del lavoro

**Fase 1 — questo blocco (fondamenta)**:
- Creare il branch dedicato `feature/lvgl` da `main` (ramo di lunga durata, non il pattern `feat/T-XX` a singolo task — con merge periodici da `main` e riunificazione quando stabile, come richiesto).
- Scaffolding del nuovo crate `sws-runtime/crates/sws-lvgl-viewer` (binario, `Cargo.toml` con dipendenza `lvgl` opzione A, nessuna logica ancora).
- ADR in `docs/adr/0002-lvgl-rendering-engine.md` che fissa questa decisione architetturale (client separato, non fusione nel runtime) per iscritto.
- Nuova voce in `docs/OPEN_QUESTIONS.md` per le sotto-decisioni davvero aperte (binding v8→v9, quali widget dopo l'MVP, se/quando isolare l'"engine" da `sws-web` per un domani con target headless puri).
- Copia di questo piano in `docs/plans/2026-08-07-lvgl-engine.md` (per continuità multi-sessione/multi-macchina, come da convenzione del progetto).

**Fase 2 — MVP motore di rendering (sessioni successive)**:
- `sws-lvgl-viewer` disegna su **simulatore SDL2** (scelto dal maintainer per iterazione rapida senza hardware).
- Client REST per leggere `/api/project` + `/api/synoptics/:name` di un progetto esistente.
- Client WebSocket su `/ws/tags` (snapshot + delta) per i valori live.
- Porting minimo della logica di `resolveObject()`/soglie/format da `SvgCanvas.tsx` a Rust.
- Sottoinsieme iniziale di tipi widget (indicativo, da confermare in corso d'opera): `rect`, `text`, `button`, `led`, `slider` — le primitive più semplici da mappare 1:1 su widget LVGL nativi (`lv_obj`, `lv_label`, `lv_btn`, `lv_led`, `lv_slider`).
- Obiettivo di verifica: aprire un progetto SWS reale (es. `examples/templates/`) e vedere almeno un bottone/led che riflette lo stato di un tag, aggiornato in tempo reale, nella finestra SDL2.

**Fase 3 — wizard di creazione progetto esteso** (dopo che la Fase 2 ha una demo funzionante, come deciso):
- Nuovo step nel `NewProjectModal`/`WelcomeScreen.tsx`: scelta target (Web vs LVGL), e se LVGL, parametri HW (framebuffer/DRM vs Wayland; in futuro ESP32).
- Estensione generale (per tutti i target, non solo LVGL) con pre-configurazione di area di lavoro, colori, opzioni principali oggi impostate a mano dopo la creazione.
- Filtro della palette oggetti (`LeftPanel.tsx` → `PALETTE_GROUPS`) in base al target del progetto, così l'editor stesso impedisce di piazzare widget non supportati da LVGL.
- Nuovo campo `target`/`platform` in `ProjectInfo` (schema Rust `sws-web/src/projects.rs` + TS `types/index.ts`) per persistere la scelta.

**Fase 4 — backend hardware reali**:
- Framebuffer/DRM su device reale (o QEMU con framebuffer virtuale) — verifica del binding scelto in Fase 2 su hardware vero, cross-compile con lo stesso toolchain Yocto già maturo (`scripts/yocto/build.sh`).
- Wayland come client, per allinearsi al setup Weston già in campo sui Pixsys — sostituto naturale del kiosk-browser attuale.

**Fase 5 — container podman multi-arch**:
- Stesso pattern già in uso in `deploy/container/` (Containerfile per arch), ma per `sws-lvgl-viewer`: presumibilmente immagine più leggera del runtime principale (niente PyO3/libpython), `linux/amd64` + `linux/arm64`, device/socket passati a runtime (`--device /dev/fb0` o `/dev/dri`, mount del socket Wayland).

**Fase 6+ (futuro, fuori scope per ora)**: ampliamento del catalogo widget LVGL verso parità con la palette web; esplorazione ESP32 (territorio `no_std`/`esp-idf`, stack completamente diverso da quello Tokio/PyO3 attuale — richiederà una propria analisi di fattibilità quando si arriverà lì).

## Workflow Git (deviazione consapevole dal default)

Il flusso `feat/T-XX` → squash-merge in `main` descritto in `CLAUDE.md` è pensato per task singoli di poche ore. Questo è un epic multi-sessione: si usa invece un **ramo di lunga durata `feature/lvgl`**, con merge periodici da `main` (`git merge main` dentro `feature/lvgl`, non rebase, per non riscrivere history condivisa tra macchine) per assorbire funzionalità nuove nel frattempo, e riunificazione a `main` solo quando il motore sarà abbastanza stabile — modalità di riunificazione (squash unico vs merge commit che preserva la history interna) da decidere più avanti, quando si arriva a quel punto.

## File e percorsi critici

- `sws-runtime/crates/sws-lvgl-viewer/` — nuovo crate (da creare in Fase 1).
- `sws-web/src/synoptic.rs` — schema `SynopticObject`/`SynopticPage` da cui il client LVGL leggerà (sola lettura, nessuna modifica prevista qui nel breve termine).
- `sws-web/src/router.rs` — endpoint `/ws/tags` (riga ~3157), `/ws/alarms` (riga ~1609), `/api/synoptics/:name` (riga ~2613) da cui `sws-lvgl-viewer` consumerà dati (nessuna modifica prevista, solo lettura del contratto esistente).
- `sws-editor/src/canvas/SvgCanvas.tsx` — riferimento da cui portare la logica di resolve/soglie/format (funzione `resolveObject()` riga 359, dispatcher `SvgObject()` da riga 2225) quando si scriverà l'interprete Rust in Fase 2.
- `sws-runtime/crates/sws-runtime/src/main.rs` (righe 869-904) — pattern di spawn di un binario viewer separato (`--kiosk-wayland`), da cui prendere ispirazione per un futuro `--lvgl-viewer` analogo (non nel Fase 1, solo da tenere a mente).
- `docs/adr/`, `docs/OPEN_QUESTIONS.md`, `docs/plans/`, `STATUS.md` — documentazione da aggiornare in Fase 1 (vedi sopra).

## Verifica end-to-end (Fase 1)

- `cargo check` verde sul nuovo workspace member `sws-lvgl-viewer` (anche se inizialmente vuoto/hello-world).
- Il branch `feature/lvgl` esiste, punta da `main`, primo commit con lo scaffolding + i documenti.
- `docs/adr/0002-lvgl-rendering-engine.md`, la voce in `docs/OPEN_QUESTIONS.md`, e `docs/plans/2026-08-07-lvgl-engine.md` sono leggibili e coerenti con questo piano.
- `STATUS.md` aggiornato con una nuova sezione di sessione che spiega cosa è stato fatto e cosa riprendere (branch, decisioni prese, prossimo passo = spike SDL2 in Fase 2).

Non è previsto, in questa Fase 1, nessun test funzionale del rendering (arriva in Fase 2) — l'obiettivo di questo blocco è architetturale e documentale, con uno scaffolding di crate che compila come unico artefatto di codice.
