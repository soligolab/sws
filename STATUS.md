# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).

**Last session**: 2026-07-27 — **Gestione pagine synoptic (dimensionamento/lock/home/collegamenti) + pannelli editor ridimensionabili + fix drag "Lingua ▾"**. Validato dal maintainer in browser. Squash-merge dell'intera catena `fix/T-40-regressions` in `main` in corso.

- **Sessione 2026-07-27 — gestione pagine + pannelli ridimensionabili + fix lang_selector (branch `fix/T-40-regressions`)**:
  - **Dimensionamento pagina** (project-wide): Fisso (1:1 no-scaling)/Solo proporzioni (scale-to-fit su risoluzione standard)/Fluido; `PageSizeMode`/`PageLayoutConfig` su `Project`, endpoint `PUT /api/project/page-layout`; passare a "Proporzioni" propaga la risoluzione a tutte le pagine. Clamp rigido ai confini in editor. Preset dispositivo (5 Pixsys WebPanel + 4 standard) in Proprietà pagina. Pannello "Impostazioni pagine progetto" (⚙): modalità + rapporto + home page.
  - **Home page**: fallback automatico se fuori zona ABAC; rotazione kiosk riparte dalla home.
  - **Riordino drag&drop** pagine + **miniature** live nella lista.
  - **Report "Verifica collegamenti"** (🔗): navbutton con target inesistente + pagine orfane.
  - **Lock pagina** (🔒/🔓): canvas e pannello proprietà read-only via `fieldset[disabled]`, non blocca duplica/elimina.
  - **Fix collaterale**: `auto_rotate_skip` mancava dal mirror Rust `synoptic.rs` → perso ad ogni GET (round-trip) — corretto.
  - **Pannelli editor ridimensionabili** (sinistra 160–480px, destra 220–560px), persistiti in localStorage.
  - **Fix bug**: oggetto "Lingua ▾" (`lang_selector`) non trascinabile in editor — `<select>` HTML dentro `foreignObject` montato anche in edit mode intercettava il mousedown; riallineato al pattern slider (preview SVG in editor, widget reale solo a runtime).
  - **Verifica**: `cargo build` (sws-core/-web/-runtime) + `pnpm build` verdi; e2e manuale via API (round-trip locked/auto_rotate_skip/page_layout, audit trail) su runtime reale; **validato dal maintainer in browser** (pannelli + drag lang_selector confermati funzionanti).

- **Sessione 2026-07-26 (2) — Q8: isolamento runtime↔IDE — modalità operator-only + audit log (branch `fix/T-40-regressions`)**:
  - **Contesto**: analisi della history del progetto su richiesta del maintainer → identificati task abbandonati (nessuno critico) e il gap architetturale più rilevante: runtime e IDE/admin condividono lo stesso processo (`AppState` unico, due router sulla stessa istanza). Documentato come **Q8** in `docs/OPEN_QUESTIONS.md` con roadmap A(operator-only)/B(gating)/C(reload granulare)/D(audit)/E(split processi)/F(python out-of-process).
  - **Pulizia repo**: eliminato branch remoto `feat/T-37-build-deploy` (verificato integrato in `main`) e locale `feat/light-dark-theme` (superato, colori hardcoded ormai sostituiti da `var(--brand-*)`). Riconciliata Phase 5 in `docs/CONTEXT.md`: two-terminal/mDNS/multi-device/installer verificati completi; sito Docusaurus superato dal manuale (16 capitoli); resta solo il video demo (task maintainer).
  - **A — modalità `--no-admin`** (`sws-runtime/src/main.rs`, `sws-web/src/router.rs`): non binda la porta admin/IDE (richiede `--viewer-port`); riduce la superficie a viewer + funzioni bound.
  - **B — gating**: in quella modalità `/api/script/exec` (codice arbitrario) non è registrato sul viewer; `/api/script/run/:name` (bottoni) resta.
  - **D — audit log reale** (`sws-audit`, prima uno stub): hash-chain SHA-256 + HMAC opzionale (`SWS_AUDIT_KEY`), JSONL append-only, `verify()` rileva manomissioni. Cablato su login/logout/tag-write/script-exec/script-run/modifiche-config (tags/sources/alarms/notifications/global_scripts). Endpoint `GET /api/audit` + `/api/audit/verify` (Admin). Vista read-only in Configurazione → Sistema.
  - **Verifica end-to-end fatta** (non solo build): runtime avviato, tag write + script exec → `GET /api/audit` mostra le entry con hash-chain corretta, `verify` → `ok:true`; alterata a mano una entry nel file → `verify` rileva `broken_at` corretto. `cargo build` (sws-audit/-web/-runtime) + `pnpm build` verdi.
  - **Nota**: durante questa sessione c'è stato un blackout elettrico a metà lavoro — verificato dopo la ripresa che nessuna modifica su disco fosse andata persa (tutto il working tree era intatto); solo la compilazione andava rifatta.
  - **DA FARE (browser/runtime)**: validare la vista Audit in Configurazione → Sistema; provare `--no-admin` su un device reale (richiede `--viewer-port` impostato, es. `start_runtime.sh`).

- **Sessione 2026-07-26 (1) — Notifiche Telegram + uniformazione tasto Salva (branch `fix/T-40-regressions`, pushato, NON mergiato)**:
  - **Telegram** (canale allarmi + funzione script `send_telegram`): nuovo `TelegramConfig` in `NotificationConfig`; `sws-web/src/telegram.rs` (`TelegramSender` drainer + `reqwest`, config hot-swappabile); allarmi `ActiveUnacked`/escalation → chat globali Telegram (in `notifications.rs`); binding `send_telegram("testo")` iniettato negli script globali (pyscript HTTP-free, spinge su canale mpsc drenato da sws-web); `bot_token` mascherato nelle GET. **UI** in Notifiche: toggle/token/chat + **"Invia test"** e **"Rileva chat"** che chiamano la Bot API **direttamente dal browser** (funzionano dal solo editor), con auto-retry sul rilevamento. Endpoint `POST /api/notifications/test-telegram` (server-side, non più usato dal frontend). **Scope**: `send_telegram` attivo negli script globali (nelle funzioni esiste ma "non configurato" — follow-up).
  - **Fix persistenza Notifiche**: `NotificationsTab` non aggiornava lo store dopo il save → config spariva al cambio tab. Nuovo setter `updateProjectNotifications`.
  - **Uniformazione tasto Salva**: `SaveBar` verde, in alto a destra, sticky, con feedback "✓ Salvato", applicata a tutte le tab con salvataggio (Tags/Protocolli/Allarmi/Notifiche/Script/Datastore/Lingue); Faceplate/Ricette ricolorate a verde; aggiunto feedback dove mancava (Datastore).
  - **Verifica**: `cargo build -p sws-runtime` + `pnpm build` verdi. **DA FARE (browser/runtime)**: rebuild+restart runtime per attivare allarmi Telegram + `send_telegram` negli script (config/test già funzionano dall'editor); validare uniformazione Salva.

- **Sessione 2026-07-24 — fix MQTT + palette + feature "Estrai da JSON" (branch `fix/T-40-regressions`, pushato, NON mergiato)**:
  - **MQTT packet size**: nessun client impostava `set_max_packet_size` → default rumqttc 10 KB → un retained da 29 KB rompeva browse + ricezione live. Fix: costante `MAX_PACKET_SIZE_BYTES = 5 MB` su `connect`/`browse`/sparkplug ([sws-plugin-mqtt](sws-runtime/crates/sws-plugin-mqtt/)).
  - **MQTT browse durata**: default 30 s (era 8), cap 120 s (era 15) — [router.rs](sws-runtime/crates/sws-web/src/router.rs) + input frontend.
  - **Fix palette su progetto vuoto**: `addObject` non aveva pagina corrente → nessun oggetto aggiunto. Ora crea la pagina al volo ([store/index.ts](sws-editor/src/store/index.ts)).
  - **Feature "Estrai da JSON"** ([ConfigView.tsx](sws-editor/src/config/ConfigView.tsx)): pulsante nella card MQTT → incolli un payload JSON → appiattimento a variabili foglia (dot-path annidati, tipo dedotto), selezione → genera righe `TopicMapping` + opzionale creazione `TagDef`. Interamente frontend (il plugin naviga già i json_path).
  - **Verifica**: `cargo build -p sws-runtime` + `pnpm build` verdi; logica flatten testata sul payload reale (14 variabili, nidificati/null gestiti).
  - **DA FARE (maintainer, browser)**: riavvio runtime per cap durata 120 s (packet size già live); hard-refresh per palette + Estrai-JSON; poi validare tutto e procedere allo squash-merge in `main`.

- **Sessione 2026-07-21 — anteprima lingua editor + filtro/ordinamento tabella Lingue (branch `fix/T-40-regressions`, pushato, NON mergiato)**:
  - **Sintomo (maintainer)**: nell'editor, cambiando lingua, i testi degli oggetti sul canvas non cambiavano. **Causa**: `EditorShell` cablava l'anteprima sulla lingua predefinita del progetto e il corpo (righe 206–968) non sottoscriveva nulla di reattivo alla lingua → il memo `canvasObjects` non ricalcolava. La chrome cambiava perché ogni sotto-componente usa `useTranslation` per conto proprio.
  - **Decisioni maintainer**: (1) anteprima canvas indipendente dalla lingua UI; (2) i due selettori (Progetto + Editor) stanno nel tab Configurazione → Lingue; «Lingua progetto» = sorgente/predefinita (`table.default`), «Lingua Editor» = anteprima; (3) tabella messaggi filtrabile + ordinabile.
  - **Implementato**: nuovo `editorPreviewLang` nello store (`sws.editorPreviewLang`, helper in `projectI18n.ts`); `EditorShell` legge `previewLang` dallo store (fallback a default); `LanguagesTab` con 2 selettori + filtro per colonna (case-insensitive) + ordinamento per colonna (asc→desc→off, solo visuale); vista index-safe (`origIdx`) così le modifiche colpiscono la riga giusta con filtro/ordine attivi; rimozione lingua/import CSV azzerano filtri stale; nuove chiavi i18n IT/EN.
  - **Verifica**: `pnpm build` verde (tsc + vite); bundle servito da `:8460` contiene le modifiche; body tabella confermato index-safe. **DA FARE (maintainer, browser)**: hard-refresh `:8460` → tab Lingue: 2 selettori + filtro/ordinamento; «Lingua Editor»=en → canvas oggetti in inglese.

- **Sessione 2026-07-13 — T-39 + T-40 + fix regressioni + template (branch `fix/T-40-regressions`, contiene T-39+T-40+fix, pushato, NON mergiato)**:

- **Sessione 2026-07-13 — T-39 + T-40 + fix regressioni + template (branch `fix/T-40-regressions`, contiene T-39+T-40+fix, pushato, NON mergiato)**:
  - **T-39 — IDE/Runtime bilingue IT/EN** (11 commit `e454d6b`…`b786b99`): infra react-i18next (IT base + EN, lingua da `localStorage sws.uiLang` → browser → it, fallback en), `UiLangSelect` in header IDE e nav viewer, **~667 chiavi** estratte da tutta la chrome (App shell, viewer, LeftPanel, auth, WelcomeScreen, componenti minori, EditorShell ~190 label, ConfigView 14 tab). Asse UI indipendente dai contenuti di progetto.
  - **T-40 — tabella lingue di progetto** (`79825df`, `895dbfe`): Rust `LanguageTable {default, langs, entries:[{key,values}]}` + campo `Project.languages` (`#[serde(default)]`, viaggia con export/import ZIP) + `PUT /api/project/languages`. Frontend: `src/i18n/projectI18n.ts` (`resolveMsg` risolve `{{token}}` nella lingua corrente; `localizeObjects` applicato a monte di SvgCanvas nel viewer/editor), store `projectLang`, tab **"Lingue"** in ConfigView (griglia + CSV export/import), oggetti canvas `lang_selector`/`lang_button` + token-picker nel pannello proprietà. Round-trip e2e verde (`e2e/lang-table.spec.ts`).
  - **Fix 2 regressioni T-40** (`4a0f8a2`, e2e `e2e/bugcheck.spec.ts`): (1) **crash su selezione oggetto** — selettore Zustand instabile in `ObjectProps` (`…entries?.map()` → nuovo array a ogni render → loop infinito) → risolto con `useMemo` su `entries`; (2) **nuovo progetto vuoto mostrava il contenuto del precedente** — il mount-effect in `App.tsx` usciva senza `setPages([], "")` sui synoptic vuoti → aggiunto azzeramento pagine/faceplates.
  - **Template conformi IT/EN** (`42094b3`): **479** stringhe `label`/`text`/`pipe_label` tokenizzate `{{token}}` + tabella `languages` (it/en) in tutti i 9 template (homeassistant-pro 154 voci, casa-locale 135, ecc.; s7/enip/sparkplug-demo tabella vuota). `lang_selector` in Page 1 dei 6 con contenuto. **Insidia risolta**: key `on`/`off` quotate (altrimenti booleani YAML rompono il load). Script in scratchpad (non committato). Verificato: runtime carica i template, viewer risolve it→"◀ Precedente"/en→"◀ Previous".
  - **Verifica**: `pnpm build` + `cargo check` (core/web/runtime) verdi; e2e `import-tags`, `lang-table`, `bugcheck` verdi; screenshot IT/EN OK.
  - **Capitolo manuale "Multilingua"** (`docs/manual/15_multilingua.md`, sul branch `fix/T-40-regressions`): copre entrambi gli assi (lingua UI IT/EN via `sws.uiLang`; tabella lingue di progetto via tab Lingue, token `{{chiave}}`, CSV export/import, oggetti `lang_selector`/`lang_button`, `sws.projectLang`); riga aggiunta all'indice in `MAIN.md`.
  - **DA FARE (ufficio)**: 1) validazione browser di T-39/T-40 (switch lingua UI header, tab Lingue, `lang_selector` in un template, no-crash su selezione, nuovo progetto vuoto pulito). 2) Se ok → **squash-merge in ordine** `feat/T-39-ide-i18n` → `feat/T-40-project-i18n` → `fix/T-40-regressions` su `main` (o un unico squash del tip `fix/T-40-regressions`, che contiene tutto) + push. ~~3) Aggiornare capitolo manuale "Multilingua"~~ ✅ fatto (vedi sopra).

- **Sessione 2026-07-09 — fix tema chiaro: righelli canvas + pannello LOG** (branch `fix/light-theme-ruler-log`, squash-mergiato in `main` e pushato):
  - **Sintomo (maintainer)**: col tema chiaro attivo, le strisce dei righelli del canvas e il pannello LOG restavano scuri, col testo grigio a basso contrasto.
  - **Causa**: colori hardcoded del tema scuro (`#0f172a`, `#334155`, `#64748b`, `#0b1220`) invece delle CSS var `--brand-*` del tema (T-36). Il testo era già tematizzato → dark-on-dark in tema chiaro.
  - **Fix** [SvgCanvas.tsx](sws-editor/src/canvas/SvgCanvas.tsx) (blocco righelli ~1485-1566) + [LogPanel.tsx](sws-editor/src/components/LogPanel.tsx): righello e pannello leggono `var(--brand-bg/surface/surface-2/text-muted)`; nel righello `fill`/`stroke` spostati da attributi SVG a `style` inline (var() affidabile su tutti i browser). Corretto anche il testo `<mark>` della ricerca log (fissato `#0f172a`: sfondo giallo non tematizzato). **Superficie canvas lasciata invariata**: è lo sfondo pagina del progetto (dato utente), non chrome.
  - **Non toccato**: colore `DEBUG` del log (`#0ea5e9`, ~2.9:1 su chiaro, ma off di default) — segnalato al maintainer, non richiesto.
  - `pnpm build` verde; confermato in browser dal maintainer.


- **Sessione 2026-07-08 — T-38 brand Pixsys white-label** (squash-mergiato in `main` come `cfee5f1`):
  - **Obiettivo**: il cliente Pixsys vuole editor+viewer sotto il proprio marchio, usando i colori del sito pixsys.net. Sfrutta l'infrastruttura white-label di T-35 + tema chiaro/scuro di T-36 → **solo asset statici + JSON, nessun codice, runtime Rust intatto**.
  - **Colori ufficiali** estratti dal logo `pixsys-1.svg`: rosso `#D2232A` (mark) → accento `primary` (hover `#b01d23`); blu `#25408F` (anello) usato nel mark. Slogan "Elevate your process".
  - **Nuovo brand** [sws-editor/public/branding/pixsys/](sws-editor/public/branding/pixsys/): `brand.json` (name "Pixsys — Elevate your process", shortName "Pixsys", 10 token — neutri = default SWS, accento = rosso Pixsys), `logo.svg` (mark autentico: asterisco rosso in anello ellittico blu + wordmark "pixsys" **in rosso** — leggibile sia su tema scuro sia chiaro, dato che il logo è un `<img>` che non eredita `currentColor`), `favicon.svg` (mark su tile bianco arrotondato).
  - **`active.json` → `pixsys`** (brand attivo di default), ora su `main`.
  - **Verifiche fatte**: `pnpm build` verde; `git status` → **nessuna modifica sotto `sws-runtime/`**; script Node di validazione (10 token presenti, asset esistono, SVG ben formati con i colori Pixsys, switch acme→pixsys cambia title + `--brand-primary`).
  - **Merge + pulizia**: squash-merge in `main` (`cfee5f1`) su richiesta del maintainer; eliminati i branch già mergiati (`feat/T-34-…`, `feat/T-35-branding`, `feat/tls-optional`, `feat/T-38-pixsys-branding`). Subito dopo, su richiesta, **anche `feat/T-37-build-deploy` squash-mergiato** (`2a991e9`) — i 6 file `scripts/build_deploy.sh` + `deploy/{editor,yocto,generic-linux}/*` sono ora in `main`; `main` pushato su `origin`. **Tenuti**: `archive/office-line-2026-05-21`, `backup/friday-phase-a1` (il branch `feat/T-37-build-deploy` locale/origin resta, ma è ora mergiato — eliminabile a discrezione del maintainer).
  - **DA FARE (maintainer, in browser)**: `./scripts/start_editor.sh` (8460) e viewer via `start_runtime.sh` (8443) → verificare logo/accento rosso/titolo/favicon Pixsys, in **tema chiaro e scuro** (il logo deve restare leggibile in entrambi).

- **Sessione 2026-07-07 — T-37 build pacchetti distribuibili editor + runtime** (squash-mergiato in `main` il 2026-07-08 come `2a991e9`; `main` pushato su origin):
  - **Obiettivo**: un solo script che compila e crea in `dist/` i pacchetti distribuibili sia dell'editor sia del runtime. Deciso col maintainer: output in `dist/`, editor **portabile** (scompatta ed esegui), compilare **anche aarch64**.
  - **Nuovo** [scripts/build_deploy.sh](scripts/build_deploy.sh): compila SPA + binario `sws-runtime` (release) **una volta per arch**, poi stagia **4 tarball** in `dist/`: `sws-runtime-<v>-linux-{x86_64,aarch64}` e `sws-editor-<v>-linux-{x86_64,aarch64}`. Editor e runtime = stesso binario, differiscono solo per launcher/installer incluso. aarch64 via `scripts/yocto/build.sh` in **sottoprocesso** (l'env dell'SDK non contamina la shell host); se l'SDK manca → skip con avviso (o errore se `--aarch64-only`). Flag: `--host-only`, `--aarch64-only`, `--no-rust`, `--no-spa`, `--out DIR`. `scripts/package.sh` (backend T-28) **lasciato intatto**.
  - **Pacchetto editor**: nuovi [deploy/editor/run-editor.sh](deploy/editor/run-editor.sh) (IDE-only su :8460, dati portabili in `./data/`, no root/systemd, no-auth come `start_editor.sh`) + [deploy/editor/README.md](deploy/editor/README.md).
  - **Pacchetto runtime aarch64**: nuovo [deploy/yocto/install.sh](deploy/yocto/install.sh) — installer self-contained che installa sotto `/data/user/sws` (rootfs read-only Pixsys, **non** `/opt`) con service systemd + `runtime.env` seed. Modellato sul blocco on-device di `scripts/yocto/deploy.sh`. Il runtime x86_64 usa l'installer `deploy/generic-linux/` (→ `/opt/sws`).
  - **Fix incluso**: [deploy/generic-linux/sws-runtime-launch.sh](deploy/generic-linux/sws-runtime-launch.sh) e [deploy/yocto/sws-runtime-launch.sh](deploy/yocto/sws-runtime-launch.sh) non passavano `--viewer-port`/`--admin-port` → un runtime installato era IDE-only su 8444 e non serviva mai il viewer su 8443. Aggiunti `--viewer-port 8443 --admin-port 8444`. Senza questo, "runtime" ed "editor" sarebbero identici.
  - **Verifiche fatte (locale, SDK presente)**: `./scripts/build_deploy.sh` → 4 tarball (~13-14 MB). Binario aarch64 confermato `ELF … ARM aarch64`, editor x86_64 `x86-64`. Contenuti: runtime porta `install.sh`+`.service`+launch (viewer-port presente), editor porta `run-editor.sh`+`README` senza installer. aarch64 install.sh → `/data/user/sws`. **Editor eseguito**: scompattato, `run-editor.sh` → `/health` = `ok`, `/` serve la SPA admin, log conferma "IDE-only mode", `./data/{config,projects}` creati. `cargo build --release` + `pnpm build` verdi (dentro build_deploy).
  - **DA FARE (maintainer)**: su un device Pixsys reale, scp del tarball `sws-runtime-*-linux-aarch64.tar.gz`, `tar xzf` + `sudo ./install.sh`, verificare viewer su `https://<device>:8443` e IDE su `:8444`. Su PC: scompattare `sws-editor-*` e `./run-editor.sh`. Se ok → squash merge in `main`.

- **Sessione 2026-07-06 — T-35 branding / white-label** (branch `feat/T-35-branding`, non ancora mergiato):
  - **Obiettivo**: distribuire editor+viewer sotto marchi diversi (SWS madre + OEM demo ACME, Giorgino & Giorgetti). Deciso con il maintainer: selezione via file JSON a runtime, re-theme completo, ambito editor **e** viewer, runtime Rust intatto.
  - **Cartella** [sws-editor/public/branding/](sws-editor/public/branding/): `active.json` (`{ "brand": "sws" }`) + una sottocartella per brand con `brand.json` (nome, logo, favicon, 10 token colore), `logo.svg`, `favicon.svg` (loghi placeholder da sostituire).
  - **Loader** [sws-editor/src/branding/index.ts](sws-editor/src/branding/index.ts): `loadBranding()` (active.json → brand.json, fallback SWS), `applyBranding()` (CSS var `--brand-*` su `:root` + `document.title` + favicon), `getBrand()`. Agganciato in [admin-main.tsx](sws-editor/src/admin-main.tsx) e [main.tsx](sws-editor/src/main.tsx) prima del render. Token di default (palette SWS) definiti in `:root` in `index.html`/`index-admin.html` (no flash).
  - **Logo**: header IDE ([App.tsx](sws-editor/src/App.tsx), componente `BrandLogo` con fallback testo) + nav viewer ([RuntimeView.tsx](sws-editor/src/runtime-view/RuntimeView.tsx)).
  - **Re-theme completo**: ~977 colori di chrome negli stili inline → `var(--brand-*, #fallback)` via sed protetto. **Protetti (restano letterali)**: colori-dato oggetti canvas (`fill`/`stroke`/`*_color`/serie in `EditorShell`), rendering widget SVG (`fill=`/`stroke=` in `SvgCanvas`), colori stato/allarme. Nessun `var()` finito in attributi SVG.
  - **Verifiche fatte**: `pnpm build` verde su ogni fase; `git status` → **nessuna modifica sotto `sws-runtime/`**; script Node che valida i 3 brand (logo/favicon esistono, 10 colori presenti) e dimostra lo switch (title + `--brand-surface` cambiano per brand). Token referenziati == token definiti.
  - **DA FARE (maintainer, in browser)**: `./scripts/start_editor.sh` → verificare logo/palette/titolo SWS; poi editare `public/branding/active.json` → `acme` / `giorgino-giorgetti`, hard-refresh, verificare che cambino logo, colori, titolo, favicon; verificare il viewer (8443) via `start_runtime.sh`. Se ok → squash merge in `main`.

- **Sessione 2026-06-20 (sera) — GitHub issue #2: import progetto non funzionava**:
  - **Causa radice reale** (non era il backend, né la cache, né il rendering): l'`<input type=file>` dell'import progetto viveva dentro il dropdown del MainMenu (`{open && …}`). Il bottone "Importa progetto" fa `fileInputRef.current?.click(); setOpen(false)`: chiudendo il menu, React **smontava l'input** mentre il file-dialog nativo era ancora aperto → alla selezione del file l'`onChange` non scattava più → `handleImport` e la `PUT /api/project/import` **non venivano mai eseguiti**. Il sintomo "i tag non vengono importati" nasceva perché l'import non partiva affatto. I test curl funzionavano perché bypassavano la UI.
  - **Diagnosi**: scritto un test Playwright headless che guida la UI reale (apri menu → Importa progetto → scegli ZIP) — ha riprodotto il bug (nessun `POST /api/project/import` nella rete).
  - **Fix** ([App.tsx](sws-editor/src/App.tsx)): spostato l'`<input type=file>` e il toast di stato export/import **fuori** dal blocco `{open && …}` così l'input resta sempre montato e l'esito resta visibile dopo la chiusura del menu.
  - **Regression test**: [sws-editor/e2e/import-tags.spec.ts](sws-editor/e2e/import-tags.spec.ts) — self-contained, verifica che il tag compaia in Configurazione → Variabili dopo import via menu. Verde. Confermato dal maintainer in browser.
  - Squash merge su `main` (`bdd50b8`), branch `fix/issue2-import-input-unmount` eliminato su richiesta.

- **Sessione 2026-06-20 — Bugfix vari + pulizia branch**:
  - **Grid paste/cut in sub-celle**: `EditorShell.tsx` — Ctrl+V e Ctrl+X ora gestiscono anche `selectedSubCell` (prima funzionavano solo sulla cella top-level). Usa `resolveSubCellEntry` + `updateSubCellAt`.
  - **TagInput — pulsante ▾ esterno funzionante + filtro**: riscrittura completa del componente, rimosso `onBlur+setTimeout` (causava chiusura immediata per race con `autoFocus`), sostituito con click-outside pattern (`document.addEventListener("mousedown", ...)`). Aggiunto campo filtro nel dropdown. Rimosso `<datalist>` nativo (eliminata freccia interna). Fix applicato a tutti gli usi di `TagInput` nel codebase.
  - **"Valore live" in Configurazione → Variabili si aggiorna**: due fix: (1) aggiunto `useTagStream()` in `App.tsx` (l'hook WebSocket `/ws/tags` non era chiamato nell'IDE SPA); (2) fix `tagStream.ts` — `getStream()` ora ricrea il WebSocket quando cambia `remoteConnected` (URL diverso) e invia `{"type":"subscribe","tags":["*"]}` all'apertura (relay `/ws/remote/tags` ne aveva bisogno, il locale no ma non fa male).
  - **Auto-deploy al salvataggio**: quando `remoteConnected`, ogni salvataggio riuscito (Ctrl+S) fa `POST /api/remote/deploy` in background. Pulsante "Deploy" in App.tsx mostra lo stato: "⟳ Sync…" / "✓ Synced" / "✗ Sync err"; torna a idle dopo 3 s. Campo `remoteDeployStatus` aggiunto allo store Zustand.
  - **Pulizia branch locale**: eliminati tutti i 17 branch locali — erano tutti già mergiati su `main` (squash precedenti). Rimane solo `main`. Note: `origin/feat/pyenv-support` (15 righe in `start_runtime.sh` per supporto pyenv LD_LIBRARY_PATH) è ancora nel remote non mergiato — decidere se integrare.
  - `cargo check` + `pnpm build` **verdi**.

- **T-34 — Runtime mono-progetto, versionamento progetto, no-auth fix** (commesso su `main` non testato; il test verrà completato a casa):
  - **Causa del "login ancora richiesto"**: NON era il repo (i commit no-auth c'erano). Il `dist/` del frontend era stantio (9 giu, pre-no-auth) perché gli script ricompilano il backend ma **non** il frontend. Fix: `pnpm build` rigenerato + **hardening** di `start_editor.sh`/`start_runtime.sh` (ora ricostruiscono `dist/` se mancante o più vecchio dei sorgenti). "admin" non funzionava perché in no-auth non esiste alcun utente.
  - **Runtime mono-progetto** (`main.rs`, `projects.rs`): auto-apertura risolta in ordine `--project` → marker persistente `.active-project` (scritto a ogni open, **non più consumato**) → `.last-opened` legacy → unico progetto presente (`single_project_dir`). Rimosso l'hardcoding di `default` dagli script. Marker ripulito su delete.
  - **Versionamento progetto** (`sws-core/project.rs`): campo `saved_by` + `runtime_version()`/`needs_update()`/`stamp_and_serialize()`/`save_to()`; tutti i writer di `project.yaml` instradati attraverso lo stamp. `/api/system` espone `project_saved_by` + `project_needs_update`; nuovo `POST /api/project/migrate` (re-save). Banner "⚠ Aggiorna progetto" in `App.tsx` (RuntimeCtrl). ⚠️ Tutti i crate condividono `0.1.0-dev` → il warning scatta solo quando si bumpa la versione del workspace.
  - **Deploy sovrascrive tutto** (`remote.rs`): `remote_deploy` ora cancella **tutti** i progetti remoti prima dell'upload (coerente col mono-progetto).
  - **Elimina progetto sul runtime** (`remote.rs`, `router.rs`, `ConfigView.tsx`, `client.ts`): nuovo relay `POST /api/remote/project/delete` (risolve il progetto attivo da `/api/system` del target, close+delete) + bottone rosso nel tab Runtime→Connetti.
  - `cargo check -p sws-runtime` + `pnpm build` **verdi**.
  - **Da fare a casa**: test end-to-end (vedi sezione "Verifica T-34" sotto). Se ok, nessuno squash necessario (già su main); altrimenti correggere e ricommittare.

- **Server-side deploy relay + no-auth frontend + WebSocket remote bridge** (branch `feat/websocket-remote-bridge`, pronto per squash merge su main):
  - Backend (`sws-web`): `remote.rs` — `POST/DELETE /api/remote/connect` (autentica contro il runtime remoto, salva token in AppState), `GET /api/remote/status`. `remote_relay.rs` — `GET /ws/remote/{tags,alarms,logs}` pipe bidirezionale tokio-tungstenite con `AcceptAnyCert` rustls verifier per target `wss://`. Tutto Admin-only via `system_ctrl_routes`.
  - Frontend: `api/client.ts` — `remoteConnect / remoteDisconnect / remoteStatus`. Store Zustand — `remoteConnected`, `remoteUrl`, `setRemoteConnected`. `wsUrl.ts` — quando `remoteConnected`, `buildWsUrl()` restituisce `/ws/remote/{sub}` (relay) invece dell'URL diretto.
  - `RuntimeConnectionTab`: `handleConnect()` usa `api.remoteConnect()` (server-side relay), polling `remoteStatus` ogni 5 s, pannello variabili live via `/ws/remote/tags` (max 50 tag, delta 50 ms).

- **Fix architettura auth (stessa sessione, stesso branch):**
  - **Script puliti**: rimosso da `start_runtime.sh` e `start_editor.sh` il blocco `SWS_ADMIN_*` e `SWS_SUPERVISOR/OPERATOR/VIEWER_PASSWORD`. Gli script ora sono solo build + avvio.
  - **No-auth mode**: `require_auth` in `router.rs` ora verifica `auth.has_users()` — se non ci sono utenti (nessun progetto, o progetto senza `users.yaml`) tutte le route sono aperte senza token.
  - **`sws-auth`**: rimosso `bail!` in `new_persistent()` e `swap_store()` quando `users` è vuoto (era `"no users available — set SWS_ADMIN_PASSWORD"`). Un progetto senza utenti è uno stato valido (no-auth mode). Aggiunto metodo pubblico `has_users()`.
  - **`connect_remote` credenziali opzionali**: `ConnectBody.username/password` → `Option<String>`. Se vuoti: relay senza token (per runtime in no-auth mode). `run_relay()` omette `?token=` se token è vuoto.
  - **Fix `RT_CONN_KEY` bug**: `status` ora parte sempre come `"idle"` (non da localStorage). Mount effect pulisce la chiave legacy e sincronizza dal server. Rimosso `localStorage.setItem(RT_CONN_KEY, "1")` da `handleConnect`.
  - **Form credenziali opzionali**: campi Utente/Password con placeholder "opzionale" + default vuoto.
  - `cargo check` + `cargo test -p sws-auth` (11 test OK, corretti anche 5 test stantii con `allowed_zones`) + `pnpm build` verdi.
  - **Fix no-auth frontend (stessa sessione):** `App.tsx` — dopo apertura progetto in no-auth mode, il frontend mostrava LoginScreen perché `clearAuth()` svuotava `authToken` e non c'era modo di ottenerlo. Fix: `onProjectOpened` ora chiama `whoami()` first; se risponde 200 (no-auth: admin sintetico) setta token sentinella `"no-auth"` che il backend ignora. Stesso fix al bootstrap iniziale (`getProject().then()`). `pnpm build` verde.
  - **Deploy relay**: `POST /api/remote/deploy` — backend locale esporta ZIP, carica sul target via reqwest AcceptAnyCert, gestisce conflitto 409, attiva progetto. Frontend `RuntimeConnectionTab.handleDeploy` ora legge flusso streaming da `/api/remote/deploy` (nessun fetch diretto browser→remote). Risolve "Failed to fetch" per certificati self-signed.
  - **No-auth mode frontend**: `App.tsx` — `bootstrapping` flag (no flash iniziale), `onProjectOpened` chiama `whoami()` prima di `setNoActiveProject(false)` (no LoginScreen flash), token sentinella `"no-auth"`.
  - **Da fare**: squash merge in `main` + test end-to-end con due istanze locali (runtime su 8444 + editor su 8460).

- **TLS opzionale — HTTP di default, HTTPS su richiesta** (branch `feat/tls-optional`):
  - Il runtime parte in **HTTP plain** se manca `config/tls.crt`; la **presenza** del cert all'avvio determina la modalità (accept loop su `Option<TlsAcceptor>`, percorso plain con `serve_connection_with_upgrades` → i WebSocket funzionano anche in HTTP). Nessun flag `--no-tls`.
  - Endpoint admin (solo admin app, `require_admin`): `GET /api/system/tls` (stato), `POST /api/system/tls/generate` (self-signed rcgen + reboot), `PUT /api/system/tls` (carica cert+key PEM, validati con `with_single_cert` prima di scrivere, + reboot), `DELETE /api/system/tls` (rimuove + reboot). Switch via riavvio (`system_reboot` ri-exec con stesso argv, riapre il progetto).
  - UI: `ConfigView → Stato → Certificato TLS` (Admin): genera self-signed / carica cert+key (file o paste PEM) / disabilita.
  - Script: `--http-port` ora condizionale alla presenza del cert (companion off in modalità HTTP).
  - **Base**: il grosso era già stato implementato a casa (commit `1ede756`, cherry-pick su main attuale); in questa sessione aggiunto **upload cert+key** (PUT + validazione + UI), test unitari `validate_cert_key`, fix test stantii in `system.rs`, doc aggiornati (scripts/README, manual/10_deployment).
  - **Verificato**: `cargo test -p sws-web` verde (15), `pnpm build` verde, avvio live HTTP-default (`/health` http 200, https ko) e HTTPS con cert presente (`/health` https 200, http ko), gating admin su `/api/system/tls`.
  - **Da fare**: squash merge in `main` quando il maintainer conferma; verifica browser end-to-end (genera → riconnetti su https → carica cert CA → disabilita). Nota: su questo dev server `.run/config/` può avere già `tls.*` → parte in HTTPS; per testare HTTP `rm .run/config/tls.{crt,key}`.

- **Split dev.sh → start_runtime.sh + start_editor.sh** (branch `feat/split-runtime-editor-scripts`):
  - `scripts/dev.sh` eliminato.
  - `scripts/start_runtime.sh` — runtime su dispositivo: viewer 8443 + IDE 8444 + HTTP companion 8080, auto-apre progetto `default`.
  - `scripts/start_editor.sh` — IDE locale su 8460 + HTTP companion 8090 senza viewer; porte separate dal runtime per coesistere sulla stessa macchina.
  - Rust `main.rs`: `--viewer-port` ora è `Option<u16>`; `--http-port Option<u16>` aggiunto per il companion server.
  - **HTTP companion server**: pagina plain HTTP (no cert) che guida all'accettazione del certificato TLS. Opzione A: copia URL `/health` da incollare nella barra del browser; polling JS rilevea accettazione e reindirizza. Opzione B: download `sws.crt` da route `/cert` (MIME `application/x-x509-ca-cert`) per installazione permanente.
  - Fix OOM: `cargo build -j 1` in entrambi gli script (pyo3 + linking esaurisce la RAM quando il runtime è già in esecuzione).
  - Docs aggiornati: CLAUDE.md, scripts/README.md, docs/CONTEXT.md, docs/TEST_SETUPS.md, kiosk.sh.
  - **Prossimo passo urgente**: implementare `--no-tls` sul binario Rust per `start_editor.sh`. `localhost` è sempre un "secure context" nei browser moderni — non serve TLS, eliminando il problema del certificato lato editor completamente.

- **T-29…T-33 — 5 nuovi widget canvas** (squash unico su main):
  - **T-31 Text List**: mappa valore → etichetta testuale (lookup-table). Pannello: voci val/label/colore, testo default, font, allineamento.
  - **T-29 Bar Chart**: SVG puro, verticale/orizzontale, n serie multi-tag, linee soglia warn/alarm.
  - **T-33 Pie/Donut Chart**: SVG con path archi, modalità pie/donut, raggio interno, percentuali, legenda, testo/tag centro donut.
  - **T-32 Sparkline**: mini-trend senza assi in foreignObject SVG, finestra mobile live, fill area, mostra ultimo valore.
  - **T-30 Alarm Viewer**: lista/banner allarmi attivi embedded nel sinottico, filtro prefisso/severità, ACK inline (Operator+), banner ticker CSS.
  - Tutti: palette LeftPanel gruppo Display, default palette, pannello proprietà EditorShell. Nessuna modifica backend.

- **T-28 — IDE Package Builder + SSH Device Deployer** (`feat/T-28-ide-package-deploy` → squash main):
  - Backend: `packaging.rs` con 3 endpoint Admin: `POST /api/build/package` (streaming), `GET /api/build/packages`, `POST /api/deploy/device` (streaming SCP+SSH).
  - AppState: `+build_running` (mutex build unica), `+repo_root` (Some se `scripts/package.sh` esiste vicino al CWD, None su device deployati).
  - Frontend: due nuove sezioni in RuntimeConnectionTab — "Pacchetto runtime" (3 pulsanti build + log + lista tarball) e "Installa su dispositivo" (form SSH + log deploy streaming).

- **T-27 — Generic Linux packaging** (`feat/T-27-generic-linux-package` → squash main):
  - `scripts/package.sh`: build tarball `sws-<version>-linux-<arch>.tar.gz` (flags: `--no-rust`, `--no-spa`).
  - `deploy/generic-linux/install.sh`: installa in `/opt/sws/` (binario+assets), `/var/lib/sws/` (dati), `/etc/sws/runtime.env` (credenziali, solo primo install). Supporta upgrade e `--uninstall`. Fa health-check dopo start.
  - `deploy/generic-linux/sws-runtime-launch.sh` + `sws-runtime.service`: avvio systemd per Linux generico.
  - **Note**: il commit T-27 ha assorbito anche una feature "pipe/tubazione" (SvgCanvas, EditorShell, LeftPanel, types) che era nel working tree da una sessione precedente. Funziona e non rompe nulla.

- **T-26 — Git commit/push** (`feat/T-26-git-commit-push` → squash main):
  - `git_deploy.rs`: `commit()`, `push()`, `unpushed_count()` aggiunti a `GitDeploy`; `GitStatus.unpushed_commits` aggiornato in ogni `status()`.
  - Nuove route: `POST /api/project/git/commit` (Supervisor+), `POST /api/project/git/push` (Admin).
  - Frontend: form inline commit + bottone "↑ Push (N)" in `GitOpsPanel`.

- **T-24 — Project Fingerprint + Device Dashboard** (`feat/T-24-fingerprint-dashboard` → squash main):
  - `GET /api/project/fingerprint` su entrambe le porte (8443/8444): SHA256 di `project.yaml` + `synoptics/*.yaml` ordinati per nome, codifica hex manuale.
  - `sha2 = "0.10"` aggiunto al workspace e `sws-web/Cargo.toml`.
  - Nuovo tab "Device" (Admin) in `ConfigView`: lista device salvata in localStorage (`sws.saved-devices`), auto-refresh 30 s, ping `/health` + fetch fingerprint, confronto con fingerprint locale.
  - `deployToTarget()` estratto come funzione standalone riusata da `RuntimeConnectionTab` e `DevicesTab`.
  - `AppConfigTab` e `ConfigTab` aggiornati per includere `"devices"`.

- **T-25 — Remote log viewer** (`feat/T-25-remote-logs` → squash main):
  - In `RuntimeConnectionTab` (quando connesso): login → `GET /api/logs` → mostra log colorati per livello.
  - Bottone "Aggiorna" + toggle "● Live" (poll ogni 5 s); auto-stop alla disconnessione.
  - Box scrollabile max 200 px, timestamp HH:MM:SS, colori INFO/WARN/ERROR/DEBUG.

**Branch corrente**: `main` (pushato su origin, 2026-07-08). Pulizia branch del 2026-07-08: eliminati i branch già mergiati `feat/T-34-runtime-single-project-versioning`, `feat/T-35-branding`, `feat/tls-optional`, `feat/T-38-pixsys-branding`. Restano in locale: `feat/T-37-build-deploy` (ora **mergiato** in `main`, presente anche su origin — eliminabile a discrezione del maintainer), `archive/office-line-2026-05-21`, `backup/friday-phase-a1` (tenuti apposta).

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

- [x] **Verifica T-34** — ✅ automatizzata con `scripts/test_t34.sh` (18/18 test verdi, 2026-06-20). Copre: no-auth, auto-open, versionamento+migrate, remote deploy, elimina remoto.
- [x] **TLS opzionale** — ✅ in main.
- [x] **`feat/pyenv-support`** — ✅ già integrato in `main` (`ba6e3c8`, `start_runtime.sh` righe 54-60). Branch remoto ridondante rimosso (2026-06-22).
- [x] **T-37 build_deploy** — ✅ squash-mergiato in `main` (`2a991e9`, 2026-07-08) su richiesta del maintainer; `main` pushato su origin. **Resta consigliato** il test su device reale: install del tarball `sws-runtime-*-linux-aarch64.tar.gz` su un Pixsys (`sudo ./install.sh` → `/data/user/sws`), viewer su `:8443` + IDE su `:8444`; su PC scompattare `sws-editor-*` e `./run-editor.sh`.
- [ ] **Verifica browser T-35 branding** — su `feat/T-35-branding`: logo/palette/titolo per brand + switch via `active.json`, IDE (8460/8444) e viewer (8443). Se ok → squash merge in `main`.
- [x] **T-38 brand Pixsys** — ✅ squash-mergiato in `main` (`cfee5f1`, 2026-07-08). Verifica browser (logo/accento rosso/favicon in tema chiaro e scuro) resta consigliata al maintainer al prossimo avvio.
- [ ] **Verifica manuale T-27** — packaging tarball + installer. Comandi sotto.
- [ ] **Verifica manuale T-24/T-25/T-26** — fingerprint/device dashboard, remote logs, git commit/push. Comandi sotto.
- [ ] **Debito: `sws-kiosk` non rispetta `--viewer-port`** (hardcoded `https://localhost:8443` nel wayland spawn). Fix triviale in `main.rs` se/quando si usa il kiosk su device multi-istanza.
- [ ] **Debito: `stop_existing()` in `scripts/start_runtime.sh` usa `fuser`** — su macOS o sistemi senza `fuser` non funziona. Non prioritario (sviluppo su Linux).
- [ ] **Debito: mDNS discovery non attraversa subnet diverse** (by design — link-local). Bridge inter-subnet solo post-PoC.

### TLS opzionale — dettaglio approccio (da progettare in Plan Mode)

- Default: HTTP plain su tutte le porte (nessuna generazione cert automatica)
- Se l'utente carica/genera un cert in Configurazione → il processo si riavvia (o ricarica) in TLS
- `start_editor.sh` e `start_runtime.sh` semplificati: nessun HTTP companion server necessario per il primo accesso
- Il runtime su dispositivo LAN potrà comunque usare TLS configurandolo esplicitamente

### Verifica manuale T-34 da fare (riprendere da qui)

```bash
# 1. no-auth: l'editor non deve chiedere login creando un progetto
./scripts/start_editor.sh          # ricompila backend + rigenera dist se stantio
# → browser http://<host>:8460, hard refresh (Ctrl-Shift-R), crea progetto → nessun login
grep -rl "no-auth" sws-editor/dist/assets/*.js   # deve trovare la stringa

# 2. auto-open mono-progetto: con UN solo progetto in projects-root
./scripts/start_runtime.sh         # riavvio → deve riaprire quel progetto da solo
#    (log "auto-opening …"; /api/system riporta active_project non-null)

# 3. versione: salvare un progetto → project.yaml contiene `saved_by: 0.1.0-dev`
#    Per testare il banner "Aggiorna": editare a mano saved_by (es. "0.0.1") nel
#    project.yaml e riaprire → header IDE mostra "⚠ Aggiorna progetto" → click → re-save.

# 4. deploy overwrite: con un progetto diverso già sul runtime, deploy dall'IDE
#    (ConfigView → Runtime → Connetti → Deploy) → sul runtime resta solo il deployato.

# 5. elimina remoto: ConfigView → Runtime → Connetti → "Elimina progetto sul runtime"
#    → /api/system del runtime riporta active_project: null.
```

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

## Feature set consegnato (PoC completo T-01…T-27)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N` (start_runtime.sh), mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live |
| **Canvas** | Pipe/tubazione multi-waypoint (flat/tube/wire), SVG path animato, drag waypoint |
| **Widget avanzati** | Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline |
| **Packaging** | `scripts/package.sh` → tarball `.tar.gz`; `deploy/generic-linux/install.sh` → systemd |
| **IDE deploy** | Build tarball + deploy SSH su device direttamente da Configurazione → Runtime |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, audit log, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q2/Q3/Q4/Q6 ora decise. Nessuna questione aperta bloccante.
