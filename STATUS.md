# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.

**Last session**: 2026-07-27 (3) — **Migliorie editor, 4 blocchi**: stato "modifiche non salvate" + Ctrl+S, controlli di zoom + toolbar contestuale, header a due livelli, creazione cartelle + copia progetto sul PC. **Nessuno testato in browser.**

> ⚠️ **Mappa dei branch aperti (2026-07-27)** — nessuno testato in browser, tutti da validare:
>
> | # | Branch | Base | Contenuto |
> |---|--------|------|-----------|
> | A | `feat/project-location-and-brand-presets` | `main` | percorso progetto a scelta, progetti recenti, preset per brand *(lavoro del mattino)* |
> | A1 | `feat/fs-mkdir` | **A** | `POST /api/fs/mkdir` + "Nuova cartella" + "Apri da file ZIP" |
> | B | `feat/dirty-state-and-save` | `main` | stato "non salvato", Ctrl+S, `saveAll()` |
> | B1 | `feat/editor-zoom-toolbar` | **B** | zoom (adatta pagina/100%/slider) + toolbar editor |
> | B2 | `feat/slim-app-header` | **B1** | header a due livelli + copia sul PC trovabile |
>
> Due catene **indipendenti fra loro**: A→A1 tocca WelcomeScreen/backend, B→B1→B2 tocca editor/header. Testare i due tip (`feat/fs-mkdir` e `feat/slim-app-header`); ogni catena si può mergiare con un unico squash del suo tip. L'incatenamento serve a evitare conflitti quasi certi su `App.tsx`/`EditorShell.tsx`/`WelcomeScreen.tsx`.

- **Sessione 2026-07-27 (3d) — cartelle + copia sul PC (branch `feat/fs-mkdir`)**:
  - **`POST /api/fs/mkdir`** accanto a `browse-dirs`: parte pura `resolve_new_dir()` (testabile senza `AppState`, riusa `safe_project_name`), `create_dir` e **non** `create_dir_all` — un refuso in `parent` non deve materializzare un albero. 409 su esistente, 403 su permessi.
  - **Postura di sicurezza**: la route entra nel gruppo **pre-auth** `project_lifecycle` come `browse-dirs`, perché il selettore serve prima che esista una sessione. Non aggiunge capacità nuove (`POST /api/projects` con `parent_path` fa già `create_dir_all` arbitrario), ma la superficie `/api/fs/*` pre-auth è ora annotata in `docs/OPEN_QUESTIONS.md` sotto Q8 come debito da chiudere al passaggio a prodotto.
  - **UI**: "＋ Nuova cartella" nel `DirectoryBrowser` con input inline (Invio/Esc) — non `prompt()`, che non è traducibile né stilabile ed è soppresso in alcune webview kiosk (questa app gira su WebPanel). Dopo la creazione si entra nella cartella nuova.
  - **"📂 Apri da file ZIP…"** nella WelcomeScreen: esisteva già dietro "Nuovo progetto → Da ZIP", ora ha un ingresso proprio. È **non distruttivo** (nuovo progetto), a differenza della voce nel ☰.
  - **Verifica**: `cargo check -p sws-web` + `cargo test -p sws-web` (17 test, 2 nuovi) + `pnpm build` verdi. **Non testato in browser.**

- **Sessione 2026-07-27 (2) — percorso progetto a scelta + progetti recenti + preset brand (branch `feat/project-location-and-brand-presets`)**:
  - **Registro `known_projects.json`** (nuovo `sws-web/src/project_registry.rs`): mappa `nome → {path, last_opened_ms}`, persistito in `config_dir`, caricato in `AppState.known_projects`. Toccato automaticamente da `create_project`, `open_project` e `upload_project_zip` — copre sia i progetti in `projects_root` sia quelli a percorso custom.
  - **Percorso a scelta in creazione**: `CreateProjectRequest.parent_path` (+ query `?parent_path=` su upload ZIP) opzionale, path assoluto validato/creato con `create_dir_all`; assente = comportamento invariato (`projects_root`). Nessuna whitelist di radici (scelta esplicita del maintainer — PoC, LAN fidata).
  - **`list_projects`** ora unisce la scansione legacy di `projects_root` con lo snapshot del registro, **ordinata per `last_opened_ms` decrescente** (elenco "progetti recenti"); nuovi campi DTO `path`, `last_opened_ms`, `external`.
  - **`rename`/`duplicate`/`delete`**: risoluzione via registro; comportamento differenziato per le voci **esterne** (path fuori da `projects_root`) — rename non sposta la cartella (solo `meta.name` + chiave registro), duplicate crea una cartella sorella nello stesso genitore, delete **de-registra soltanto** senza toccare i file (mai cancellare a sorpresa dentro Documenti/backup del maintainer).
  - **Nuovo endpoint `GET /api/fs/browse-dirs`**: mini file-browser server-side (elenca sottocartelle, naviga su/giù), nessuna whitelist, default `$HOME`/`projects_root` se `path` assente.
  - **Frontend**: `WelcomeScreen.tsx` → `NewProjectModal` ha una sezione "Cartella di destinazione" (comune alle 3 tab: vuoto/template/ZIP) con campo testo + pulsante "Sfoglia…" che apre il nuovo componente `DirectoryBrowser`; anteprima live del path finale. Ogni card progetto mostra il `path` come sottotitolo/tooltip, badge "esterno" e — per le voci esterne — l'azione "Elimina" diventa "Rimuovi dall'elenco".
  - **Preset dispositivo legati al brand**: `Brand.devicePresets` (letto da `meta.device_presets` in `brand.json`); i 5 modelli Pixsys (WP570/WP800/WP815-615/WP820-620/WP830-630) spostati da `pageLayout.ts` (hardcoded) a `public/branding/pixsys/brand.json`. `DEVICE_PRESETS` → `STANDARD_DEVICE_PRESETS` + nuova `getDevicePresets()` = standard + preset del brand attivo; dropdown raggruppato in due `<optgroup>`.
  - **Verifica**: `cargo build -p sws-core -p sws-web -p sws-runtime` + `cargo test -p sws-web` (15 test) + `pnpm build` verdi. **Non ancora testato in browser/end-to-end.**
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
  - **Verifica**: `pnpm build` verde; nuovo `tests/dirtyState.test.ts` 6/6 verde (undo fino al salvato, redo, undo oltre il salvato, bozze indipendenti dal canvas, resetDirty). **Non testato in browser.** Nota: `pnpm lint` non parte sulla dev box (manca `eslint-plugin-react-hooks` in `node_modules`) — preesistente.
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

> **Piano "migliorie editor" (2026-07-27)**: 4 blocchi decisi col maintainer — (1) stato "non salvato" ✅, `feat/dirty-state-and-save`; (2) zoom + toolbar contestuale ✅, `feat/editor-zoom-toolbar`; (3) header a due livelli ✅, `feat/slim-app-header`; (4) creazione cartelle nel picker + copia progetto sul PC ✅ fatto, branch `feat/fs-mkdir` sopra `feat/project-location-and-brand-presets`. Piano completo in `~/.claude/plans/ci-sono-alcune-migliorie-keen-key.md`.

**Validazioni in sospeso (browser / runtime reale)**

- [ ] **Catena B: `feat/dirty-state-and-save` → `feat/editor-zoom-toolbar` → `feat/slim-app-header`** (testare il tip: contiene tutti e tre):
  - *Stato salvataggio*: pallino "non salvato" + `●` nel titolo scheda; `Ctrl+S` in Editor **e** in Configurazione; disegna→salva→undo torna sporco, redo torna pulito; F5 con canvas sporco chiede conferma; "Chiudi progetto → scarta" poi F5 **non** chiede nulla; modifica un tag in Configurazione → pallino acceso.
  - *Zoom*: Ctrl+rotella poi slider → la percentuale concorda; Ctrl+0; Ctrl+Shift+0 adatta la **pagina**; pan col tasto centrale senza scatti nella toolbar; cambio pagina; progetto in modalità **fluida** → "Adatta pagina" disabilitato; righelli commutati dall'angolo del canvas e dalla toolbar → stesso stato.
  - *Header*: Admin/Supervisor/Operator → Esporta/Importa solo Admin, Start/Stop/Reboot solo con permessi di configurazione, menu 👤 identico per tutti; import ZIP dal ☰ funzionante (issue #2); `pnpm exec playwright test e2e/import-tags.spec.ts e2e/editor.spec.ts`.
- [ ] **Catena A: `feat/project-location-and-brand-presets` → `feat/fs-mkdir`** (testare il tip, contiene entrambi):
  - Percorso progetto a scelta, elenco progetti recenti, preset dispositivo per brand.
  - Sfoglia → **＋ Nuova cartella** → creata, ci si entra, "Usa questa cartella" → il progetto nasce lì e compare con badge "esterno". Provare nome duplicato (409) e nome non valido (es. `a/b`, `..`) → errore leggibile sotto la lista.
  - WelcomeScreen → **📂 Apri da file ZIP…** → crea un progetto nuovo senza toccare quello attivo.
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
- [ ] **mDNS discovery non attraversa subnet diverse** (by design — link-local). Bridge inter-subnet solo post-PoC.
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
