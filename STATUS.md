# SWS — Current Status

> This file is the **session-to-session memory** for Claude Code. Update it at the end of every session before stopping work. Read it at the start of every session before touching code.

**Last session**: 2026-05-19 (sessione 26: S-27 UX bundle — drag&drop tree LeftPanel + context menu + righelli/guide draggabili canvas — più bonus: `/metrics` Prometheus reale, test integrazione system+metrics, export/import singola pagina YAML)
**Current phase**: Phase 2. Demo working out-of-the-box su fresh clone, import/export progetto per backup/condivisione, pannello log live + persistenza su disco, gestione utenti multi-account. Da S-22→S-26 il runtime può servire la SPA da sé (`--www`), puntare a un runtime remoto via `VITE_RUNTIME_URL`/`localStorage`, spawnare un browser kiosk (`--kiosk-browser`), e la stessa SPA bundle può saltare tra runtime diversi. S-27 ha chiuso 3 UX gap nell'editor: drag&drop con grouping nel tree, context menu tasto destro, righelli con guide draggabili + snap. Bonus: `/metrics` Prometheus ora reale (CPU/RAM/disco/tag/allarmi sample-on-scrape), test integrazione `/api/system` + metrics (41 unit test verdi), export/import singola pagina YAML (oltre al ZIP intero).
**Last commit**: `2194936 feat: single-page YAML export + import`. 3 commit della sessione 26 NON ancora pushati a `origin/main` — push da fare al prossimo intervento.

### Handoff per la prossima sessione

1. **`git pull` su `main`** + verifica i 3 commit sessione 26: `bfb8496` S-27 UX, `37508d2` /metrics + test, `2194936` per-page YAML.
2. **`git push origin main`** quando confermi tutto OK.
3. **Smoke-test S-27 + bonus** (~10 min):
   - `./scripts/dev.sh` → editor su 5173.
   - **Drag&drop tree** (LeftPanel "OGGETTI PAGINA"): aggiungi 4-5 oggetti, selezionane 2+ in canvas, clicca "+ Raggruppa selezionati". Apri il gruppo (▼). Trascina un oggetto fuori sulla zona "⤓ Senza gruppo" (visibile solo durante drag) → diventa ungrouped. Trascina un altro oggetto sulla header del gruppo → entra. Trascina due oggetti dentro lo stesso gruppo per riordinarli (indicatore blu sopra/sotto). Tasto destro su qualsiasi riga → menu contestuale (Rinomina/Duplica/Sposta in gruppo→/Elimina; per gruppi: Rinomina/Separa).
   - **Rulers canvas**: in edit mode controlla i righelli 20 px sopra e a sinistra del canvas. Click+drag dalla ruler superiore → guide verticale ambra tratteggiata; dalla ruler sinistra → guide orizzontale. Sposta un oggetto verso la guide → vedi snap (linea ciano + magnete). Trascina una guide indietro sul righello → diventa rossa → release → eliminata. Click sull'angolo ⟂ → nasconde righelli (persistito in localStorage `sws.canvas.showRulers`); il piccolo ⟂ in alto-sinistra li riporta.
   - **YAML per-page export/import** (PagesSection): clicca il `⬇` accanto a `⧉` di una pagina → scarica `<Page Name>.yaml`. Apri il file, modifica il `name:` (o lascialo invariato per test), clicca "⬆ YAML" → file picker → seleziona il file → pagina importata con id fresh, navigata automaticamente. Se il nome collide, viene rinominata "<Page Name> (2)".
   - **Metrics Prometheus**: `curl -k https://localhost:8443/metrics` → vedi gauge `sws_uptime_seconds`, `sws_tag_count`, `sws_cpu_usage_pct`, `sws_memory_used_bytes`, `sws_disk_used_bytes`, ecc. Formato testo Prometheus v0.0.4. Scrapeable da un Prometheus reale.
4. **Trio ARCH chiuso + S-27 chiuso**. Resta solo S-25 (test PX30 fisico) come blocker tra noi e "deploy PX30 unattended pronto".
5. **Prossimi step raccomandati** (uno qualunque, in ordine di complessità crescente):
   - **1.5 Drag-resize handle proporzionale** con Shift (mantieni aspect ratio) — ~30 min, frontend-only.
   - **6.3 Script parametri live** (~1h, frontend) — UI per sovrascrivere `on_press_args` al volo in RuntimeView.
   - **3.4b Counter Prometheus aggiuntivi** — `sws_http_requests_total{path,status}`, `sws_script_exec_total{status}`, `sws_alarm_transitions_total{severity}` (~2h).
   - **7.2 Backup automatico** ogni N minuti con cartella `.bak/` + rollback (~2h).
   - **BL-005 OPC-UA client** (Phase 4, 6-8h splittato in 2-3 blocchi) — demo industriale "serio". Servirebbe simulatore tipo `node-opcua` o un server reale.

### Cosa è andato online in queste sessioni (in ordine di commit)
- (sessione 2026-05-19, sessione 26) **Single-page YAML export + import** (task 7.1+7.3) — `GET /api/synoptics/:name/export` (Viewer+) streama il file dal disco come `application/x-yaml` con `Content-Disposition: attachment`. `POST /api/synoptics/import` (Operator+) accetta YAML raw, alloca un id nuovo (`imported-<ts_ms>`), risolve collisioni nome aggiungendo " (2)", " (3)", … Frontend: API `exportSynopticYaml`/`importSynopticYaml` in `api/client.ts`, bottone `⬇` per riga pagina + `⬆ YAML` in footer PagesSection. Caso d'uso: backup/condivisione di una singola synoptic senza esportare il ZIP intero.
- (sessione 2026-05-19, sessione 26) **/metrics Prometheus reale + test integrazione system** (task 3.4 + 9.2) — nuovo modulo `sws-web::metrics` installa un `PrometheusHandle` global tramite `OnceLock` (idempotente sui test). `GET /metrics` renderizza Prometheus text v0.0.4 con gauge sample-on-scrape: `sws_uptime_seconds`, `sws_tag_count`, `sws_alarm_active_count`, `sws_alarm_total`, `sws_cpu_usage_pct`, `sws_memory_used_bytes`/`_total_bytes`, `sws_disk_used_bytes`/`_total_bytes`. Niente ticker background — costo solo sullo scrape. Refactor `system.rs`: extracted `compute_system_status(db, alarms, project_dir, started_at)` pure helper per test unitari senza spinning up PyEngine. 5 nuovi unit test (workspace 30 → 41).
- (sessione 2026-05-19, sessione 26) **S-27 UX bundle: tree drag&drop + context menu + canvas rulers** — 3 task UX indipendenti chiusi in un commit. (1) **Drag&drop nel tree**: ogni object row è `draggable`; drop sopra/sotto sibling = riordina nello stesso gruppo; drop su group header = inserisce come ultimo membro; drop sulla zona "⤓ Senza gruppo" (visibile solo durante drag) = rimuove dal gruppo. Group row anche draggable per riordinare i gruppi. Indicatore blu 2px sopra/sotto + box inset blu per "inside". Store: `moveObjectAdjacent`/`moveObjectToGroupEnd`/`moveGroupAdjacent` (`moveObjectToGroup` ora pusha history). (2) **Context menu** tasto destro: menu floating con click position clamped al viewport, auto-close su click outside / Esc. Object: Rinomina, Duplica, Sposta in gruppo→ (sub-elenco), Raggruppa selezione (se 2+ sel + row inclusa), Elimina. Group: Rinomina gruppo, Separa gruppo. (3) **Rulers canvas + guides**: 20 px ruler strips top/left con tick spacing adattivo (1/2/5 progression, ≥50 screen-px tra label) a qualsiasi zoom. Click+drag dalla ruler → guide su asse ortogonale. Drag guide → riposiziona; release sulla ruler (linea rossa) → elimina. Persistite per pagina in `localStorage["sws.canvas.guides.<pageId>"]`, NON in project.yaml. Snap pipeline drag oggetto include ora le posizioni guide (stesso threshold `8/zoom`). Angolo `⟂` toggle visibilità (persistito).
- (sessione 2026-05-19, sessione 25) **ARCH-004 — Multi-runtime WelcomeScreen** — la stessa SPA bundle ora può connettersi a runtime diversi senza rebuild. (1) Runtime CORS in `sws-web/router.rs`: `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` come outermost layer. (2) `api/client.ts` BASE_URL diventa `getBaseUrl()` dinamico che legge `localStorage["sws.runtimeBaseUrl"]` > `VITE_RUNTIME_URL` > same-origin. (3) `ws/wsUrl.ts` stesso resolver per le WS. (4) `WelcomeScreen` footer + `RemoteRuntimeModal` (URL input, bottone Test che chiama `<url>/health` con CORS, bottone Connetti abilitato dopo OK, "Torna al locale" se già remoto). On connect/disconnect → `window.location.reload()` per reset pulito. (5) App.tsx header pillola `📡 host:port` quando si è connessi a remoto, click per disconnettersi con confirm. Gotcha noto e documentato nel modal: il cert self-signed va accettato manualmente in una tab al primo connect altrimenti `fetch()` fallisce con "Failed to fetch" muto.
- (sessione 2026-05-18, sessione 24) **ARCH-003 — Kiosk-mode browser spawn** — nuova CLI arg `--kiosk-browser <shell-cmd>`. Dopo che il listener HTTPS è up e `/health` risponde OK (poll reqwest con `danger_accept_invalid_certs(true)`, 50×100ms), il runtime fa `tokio::process::Command::new("sh").arg("-c").arg(cmd).spawn()` fire-and-forget. La morte del child non ferma il runtime; il runtime exit non killa il child. Entrypoint.sh ha commento con esempi. `docs/DEPLOY_PX30.md` §4c documenta il setup con chromium/epiphany/firefox/cage. La stock image non include un browser — installazione lato host.
- (sessione 2026-05-18, sessione 23/24) **Grid sub-cell ricorsione + breadcrumb cliccabile + ObjectProps accordion** — 6 commit di iterazione su S-23. (1) `SubCellEntry.sub: SubGrid` ricorsivo senza limite, `selectedSubCell.path: ("a"|"b")[]`, helper traversal `updateSubGridAtPath`/`updateSubCellEntryAtPath`, render canvas via `renderSubArea` ricorsivo, drag handles per ogni sub-divider. (2) Bug fix: `resolveSubCellEntry` ritorna `{}` per slot vuoti (era `null`, panel cadeva in "page props"). (3) Bug fix: sub-slot click chiama `p.onSelect(gridObjId)` PRIMA di `p.onSelectSubCell` per evitare che il pannello mostri page props. (4) Pannello sub-cell con "+ Aggiungi" UI completa (era assente). (5) Child di sub-cella ora ha rettangolo selezione teal + overlay cliccabile. (6) **PanelBreadcrumb chip cliccabili**: ogni chip non-leaf con `onClick` diventa un link blu, l'utente può navigare grid→cella→sub-cella all'indietro pulendo la selezione del livello. Sblocca l'accesso alle proprietà generali della griglia (prima irraggiungibile da canvas perché celle coprono tutto). (7) **ObjectProps accordion redesign**: nuovo `CollapsibleSection` con localStorage persist; Trasformazione/Layer/Eventi/Binding/Qualità collapsed di default; rimossi slider duplicati da rotation/opacity/transition; Identità compatta su 1 riga `[type · id]`; ~480 px collapsed vs ~900 px prima.
- (sessione 2026-05-18, sessione 23) **Grid: resize bordi righe/colonne con drag + snap interno** — quando il `grid` è selezionato in edit mode, `SvgCanvas` rende ora dei `<rect>` trasparenti 6 px centrati su ogni bordo interno (col-resize / row-resize cursor). `gridBorderRef` traccia il drag in `handleMouseMove`: delta convertito da screen→SVG via zoom, applicato come `[startA + delta, startB - delta]` sulle due tracce adiacenti, clamp min 8 px ciascuna. Snap: candidati = posizioni cumulative degli altri bordi interni dello stesso grid; threshold `8/zoom`; quando agganciato, snap-line ciano riusa l'esistente `setSnapLines`. Update tramite `updateObject(id, { col_widths: [...] })` o `{ row_heights: [...] }`. Coalescenza undo via `openInteraction("Ridimensiona colonna N")`.
- (sessione 2026-05-18, sessione 23) **Grid: multi-cell selection + merge** — shift+click su una cella del grid già selezionato chiama `onSelectCellRange(objectId, r1,c1, r2,c2)` → store `setSelectedCellRange` (normalizza r1≤r2, c1≤c2). Overlay teal tratteggiato sopra l'unione dei rect. Pannello a destra mostra `CellRangeMergeActions` con bottoni "🔗 Unisci celle" e "Annulla selezione". Store action `mergeCellRange(...)`: valida che le celle merged interne non sborderebbero; ruota a top-left cell con `rowspan/colspan` corretti, droppa le entries non-origine. `unmergeCell` strippa rowspan/colspan preservando le altre proprietà.
- (sessione 2026-05-18, sessione 23) **Grid: split locale di una cella (ibrido)** — il `GridCell` TS guadagna `sub?: SubGrid { orientation: "rows"|"cols", ratio: number, a?: SubCellEntry, b?: SubCellEntry }`. Bottoni "⬓ Dividi orizzontalmente" / "⬔ Dividi verticalmente" appaiono nel pannello quando una singola cella senza span e senza split è selezionata. Action `splitCell`: imposta `cell.sub = { orientation, ratio: 0.5, a: { child: existingChild?, ... }, b: undefined }` e migra l'eventuale `cell.child` in `sub.a.child`. Renderer della cella detecta `cellDef.sub` e disegna 2 sub-rect (alto/basso o sinistra/destra a seconda di orientation) con bg_color, bg_image, child centrato in ciascuno. Click su sub-cella → `selectedSubCell: { slot: "a"|"b" }`. `joinSplitCell` rimuove `sub` e re-lifta `sub.a.child` (o `sub.b.child` se a è vuoto) come child di cella. Ricorsione su sub-cell intenzionalmente disabilitata (KISS).
- (sessione 2026-05-18, sessione 23) **Grid: resize del bordo interno di una cella split** — `subBorderRef` traccia il drag del divider tra slot a/b. Posto a livello SvgCanvas (sopra le celle del grid) come 6 px corridor sul bordo. `resizeSubBorder` action aggiorna solo `cell.sub.ratio`, clamp `[8/cellPx, 1-8/cellPx]` per evitare slot < 8px. `cellPxSize` salvato al drag-start; orientation determina asse (clientX o clientY). Nessun snap cross-livello (per ora).
- (sessione 2026-05-18, sessione 23) **Pannello sub-cella** — quando `selectedSubCell` è settato, il `GridCellEditor` mostra colore sfondo per lo slot + `ObjectProps` completo per `entry.child` (riusa lo stesso componente già usato per `selectedCellChild`). Per ora niente UI di "trascina/copia un oggetto qui" (post-MVP — l'utente può comunque editare YAML o aggiungere `child` via Ctrl+V dentro la cella prima di splittare).
- (sessione 2026-05-18, sessione 23) **Modello dati: zero modifiche Rust** — `grid_cells: Option<Value>` in `synoptic.rs` è già un blob JSON opaco. La nuova forma `sub` viaggia round-trip serde alla cieca (commento documentale aggiunto in `synoptic.rs` per ricordarlo). 36+ test cargo workspace tutti verdi.
- (sessione 2026-05-18, sessione 22) **ARCH-001 — Runtime serve la SPA via `ServeDir + --www`** — nuova CLI arg `--www <path>` in `sws-runtime` che monta `tower_http::ServeDir` come fallback service del router (404 dentro `ServeDir` cadono su `index.html` per SPA routing). Workspace `tower-http` ora con feature `fs`. `compose.yaml` riporta variante single-container commentata; `docs/DEPLOY_PX30.md` documenta la nuova shape di deploy (no più container Nginx separato).
- (sessione 2026-05-18, sessione 22) **ARCH-002 — `VITE_RUNTIME_URL` configurabile** — un singolo env var orienta la proxy Vite, il `BASE_URL` di `api/client.ts` e tutte le WS URL. Refactor: i tre helper `buildWsUrl` duplicati nei file `ws/*Stream.ts` consolidati in un singolo `ws/wsUrl.ts` con scheme-swap `http→ws`. Override per-stream (`VITE_RUNTIME_WS_URL`, …) preservati.
- (sessione 2026-05-18, sessione 22) **Undo singolo per drag/resize** (task 4.1) — nuove action store `beginInteraction(label)` / `endInteraction()` con depth counter. `updateObject/updateObjects` saltano `pushHistory` durante un'interazione in corso. `SvgCanvas` apre l'interaction in `startDrag` + endpoint handle + resize handle, la chiude in `endDrag`. Era buggato: un drag da 200 px generava 200 voci nella cronologia.
- (sessione 2026-05-18, sessione 22) **Copy-paste cross-page con source-page tracking** (task 4.3) — `clipboardSourcePageId` aggiunto allo store; `copySelection` lo imposta a `currentPageId`. Paste su stessa pagina: comportamento storico (offset +20, preserva `group_id`). Paste cross-page: coord originali, `group_id` strippato (i gruppi sono per-page). ShortcutHelp annotato "(anche cross-page)".
- (sessione 2026-05-18, sessione 22) **Snap to page border** (task 4.4) — refactor della logica di snap-edge in helper `trySnapX/trySnapY`. Dopo il loop sugli object-edge, se nessun edge ha agganciato si testano gli edge della pagina (0, w/2, w; 0, h/2, h) con stesso threshold. Grid snap rimane il default ultimo.
- (sessione 2026-05-18, sessione 22) **Pannello allarmi RuntimeView con ACK per riga** (task 6.1) — nuovo `AlarmPanel` floating top-right in `RuntimeView`. Badge 🔔 con count, bordo rosso se ci sono non-confermati, ambra altrimenti. Dropdown con lista completa: dot severità, id, messaggio, bottone ACK per riga; bottone "ACK tutti" se ≥2 non confermati. Live via `useAlarmStream` (WS singleton condiviso con `AlarmBanner`).
- (sessione 2026-05-18, sessione 22) **Log export JSONL** (task 6.2) — bottone "⬇ Scarica" nel header del `LogPanel`. Serializza gli eventi visibili (rispettando i filtri) come `sws-logs-YYYY-MM-DD.jsonl` via Blob + anchor download. Funziona in modalità live (data = oggi) e storica (data = file caricato). Disabilitato se la lista è vuota.
- (sessione 2026-05-18, sessione 22) **Fix test alarm.rs preesistente** — l'helper `def()` in `crates/sws-core/src/alarm.rs:211` non era stato aggiornato dopo `524cc61` (campo `notify_url` su `AlarmDef`), faceva fallire `cargo test -p sws-core`. Una riga `notify_url: None` ed è verde.
- (sessione 2026-05-18, sessione 21) **Navigazione inter-view store-based** — `appMode` e `configTab` spostati da `useState` locale in `App.tsx`/`ConfigView.tsx` a Zustand store (`store/index.ts`). Tipi esportati `AppMode` e `AppConfigTab`. Action `navigateToConfig(tab)` imposta atomicamente `appMode: "config"` e `configTab`. `SourcesSection` in `LeftPanel.tsx` riscritta: ogni sorgente è una riga cliccabile con badge tipo (`MQTT`/`MBUS`), click → `navigateToConfig("protocols")`; hint "Vai alla configurazione →" in fondo. `ConfigView.tsx` legge il tab iniziale da store + `useEffect` per sincronizzare quando cambia dall'esterno.
- (sessione 2026-05-18, sessione 21) **Palette oggetti categorizzata con icone** — `OBJECT_TYPES` (array flat) e il vecchio `ObjectPalette` sostituiti con `PALETTE_GROUPS` (5 categorie: Forme, Controlli, Display, SCADA, Layout) e componente `PaletteGroupAccordion`. Ogni categoria ha colore distintivo e icona Unicode per tipo (▭○╱T per forme, ⊡↗☑◉↔ per controlli, ◔●▰≡∿ per display, ⚙ SCADA, ⊞ layout). "Forme" aperta di default; le altre chiuse.
- (sessione 2026-05-18, sessione 21) **Tab "Stato" in ConfigView + endpoint sistema** — crate `sysinfo = "0.30"` aggiunto al workspace Rust. `started_at: std::time::Instant` in `AppState`. Nuovo modulo `sws-web/src/system.rs` con `SystemStatus` + handler `get_system_status`. Route `GET /api/system` in `operator_routes`. Frontend: `getSystemStatus()` in `api/client.ts`; tab `"system"` (`"Stato"`) in `ConfigView.tsx` con componente `SystemTab` che fa polling ogni 10 s: card metriche (versione runtime, progetto attivo, uptime `Xh Ym`, tag count, sorgenti, allarmi attivi, campioni storico) + barre progresso CPU%, RAM, disco.
- (sessione 2026-05-17, sessione 20) **Cronologia visuale undo/redo** — `HistoryEntry { pages, label }` sostituisce `SynopticPage[][]` per `past/future` nello store. `HISTORY_LIMIT` portato a 200. `pushHistory(label)` accetta un'etichetta descrittiva; tutti i 17+ siti di chiamata aggiornati con label contestuali (es. `"Aggiungi rect"`, `"Elimina selezione"`, `"Allinea (left)"`). Nuove action `jumpToPast(index)` e `jumpToFuture(index)` per salto diretto. `undo()` e `redo()` preservano la label nel passaggio tra stack. `HistorySection` in `LeftPanel.tsx` sostituisce `UndoRedoBar`: lista scorrevole con "Stato iniziale", voci passate (cliccabili), riga "▶ CORRENTE" (teal), voci future (grigie/italic, cliccabili per redo), auto-scroll al corrente ad ogni cambio. Bottoni ↶/↷ rimangono in basso.
- (sessione 2026-05-17, sessione 20) **Gruppi oggetti utente** — `ObjectGroup { id, name }` in `types/index.ts`; `group_id?: string` su `SynopticObject`; `groups?: ObjectGroup[]` su `SynopticPage`. Store: `groupObjects(ids, name?)`, `ungroupObjects(groupId)`, `renameGroup(groupId, name)`, `moveObjectToGroup(objId, groupId|null)`. `ObjectsSection` in LeftPanel riscritta con `buildTree()` → tree gerarchico: cartelle 📁 collassabili (toggle ▶/▼) con conteggio membri, click su cartella → seleziona tutti i membri, doppio-click nome → rename inline, pulsante ⊔ per ungroup. Quando 2+ oggetti sono selezionati appare bottone "+ Raggruppa selezionati (N)" sopra la lista. Auto-expand gruppo quando un suo membro è selezionato (useEffect su `selectedId`). Ctrl+G raggruppa la selezione corrente. `CTRL+G` aggiunto a ShortcutHelp. Rust `synoptic.rs`: `locked` e `group_id` su `SynopticObject`, `groups` su `SynopticPage`. Tutto persistito nel YAML.
- (sessione 2026-05-17, sessione 19) **Keyboard shortcut help** — `?` (qualsiasi posizione fuori da un input) apre/chiude un modale overlay con tutte le scorciatoie da tastiera raggruppate per categoria (canvas, selezione, modifica, z-order). Click fuori o × per chiudere. Componente `ShortcutHelp` in `EditorShell.tsx`.
- (sessione 2026-05-17, sessione 19) **Object edge snapping** — durante il drag di un oggetto, `SvgCanvas` calcola le bbox di tutti gli altri oggetti e, se il bordo sinistro/centro/destro/alto/medio/basso del trascinato è entro `8/zoom` px da un edge o centro di un altro oggetto, scatta alla posizione di snap. Le linee di snap (ciano, 1px) compaiono nella direzione che si è agganciata. Lo snap agli oggetti ha priorità sullo snap alla griglia; viene disattivato sulla metà dell'asse corrispondente se già agganciato.
- (sessione 2026-05-17, sessione 19) **Page reorder + duplicate** — ogni riga pagina nel LeftPanel ha ora ↑/↓ (spostamento su/giù, visibili solo quando applicabile) e ⧉ (duplica). Store: `reorderPage(id, dir)` e `duplicatePage(id)` con `pushHistory`. La pagina duplicata appare subito dopo l'originale e diventa la pagina corrente.
- (sessione 2026-05-17, sessione 19) **Zoom to fit** — `Ctrl+Shift+0` e pulsante ⊡ in cima al canvas calcolano il bbox di tutti gli oggetti della pagina e impostano zoom+pan per adattarli alla vista con 40px di margine. Se la pagina è vuota, reset a 100%.
- (sessione 2026-05-17, sessione 19) **Mouse position display** — durante il movimento del mouse sul canvas in edit mode, l'angolo in basso a sinistra mostra `X:NNN Y:NNN` in coordinate SVG (spazio di disegno, non pixel schermo). Aggiornato in tempo reale tramite `setMousePos` in `handleMouseMove`.
- (sessione 2026-05-17, sessione 18) **Object lock** — campo `locked?: boolean` su `SynopticObject`. Se `true` in edit mode, l'oggetto ignora i click (non selezionabile né trascinabile). Toggle "Bloccato" nella sezione LAYER del pannello proprietà (checkbox ambra). Indicatore 🔒 in LeftPanel ObjectsSection accanto al tag del tipo.
- (sessione 2026-05-17, sessione 18) **LeftPanel object filter** — input "Filtra per nome / tipo…" in cima alla sezione "OGGETTI PAGINA". Filtra per `o.name`, `o.type` e `o.id` in real-time (case-insensitive). Messaggio "Nessun oggetto corrisponde al filtro." quando vuoto. Il titolo della sezione mostra il conteggio totale (non filtrato).
- (sessione 2026-05-17, sessione 18) **Canvas zoom + pan** — `SvgCanvas`: rotella → zoom centrato sul cursore (Ctrl + rotella); scroll mouse → pan verticale; Shift + scroll → pan orizzontale; Ctrl+0 → reset 100%. Click medio (button 1) + drag → pan libero. Tutti i contenuti del canvas sono dentro `<g transform="translate(panX,panY) scale(zoom)">`. Badge zoom percentuale visibile quando ≠ 100%. Il grid pattern usa un rect enorme (100 000×100 000) per coprire l'area panata. Handle resize e endpoint linea scalati inversamente (`size / zoom`) per restare invarianti allo zoom. Coordinate mouse → SVG user space tramite `toSvg(screenX, screenY)` = `(x - panX) / zoom`. Listener `wheel` aggiunto via `useEffect` con `{passive: false}` per poter chiamare `preventDefault`.
- (sessione 2026-05-17, sessione 18) **Arrow key nudge** — in edit mode con un oggetto selezionato, i tasti freccia muovono l'oggetto di 1 px (plain) o `gridSize` px (Shift+freccia). Le linee aggiornano anche `x2/y2` per preservare la forma. Nessuna azione se il focus è in un input o textarea.
- (sessione 2026-05-17, sessione 17, commit 5fe5665) **Line endpoint handles** — selezione di una linea mostra due cerchi bianchi/gialli sugli endpoint. Trascinare p1 aggiorna (x,y), p2 aggiorna (x2,y2). Snap-to-grid attivo. `ResizeState.startObj` esteso con x2/y2 opzionali.
- (sessione 2026-05-17, sessione 17, commit fa09ed9) **Z-order reorder + Ctrl+A** — `ZOrderBar` nel pannello proprietà (4 pulsanti ⬆⬆/↑/↓/⬇⬇). Shortcuts: Ctrl+]/[ avanti/indietro, Ctrl+Shift+]/[ primo/ultimo piano. Ctrl+A seleziona tutto. Store: `reorderObject(id, dir)` con pushHistory.
- (sessione 2026-05-17, sessione 17, commit 67ddb6d) **Visual resize handles** — selezionando un oggetto singolo (non linea, non griglia, non ruotato) compaiono 8 maniglie bianche/gialle agli angoli e ai punti medi dei lati. Trascinarle ridimensiona l'oggetto in tempo reale via `onMove`. Angoli cambiano posizione + dimensione; lati cambiano solo una dimensione. Minimo 4px, snap-to-grid attivo. `ResizeState` interface + `resizeRef` in SvgCanvas, strato SVG separato sopra tutti gli oggetti, mutuamente esclusivo con drag e selection-rect.
- (sessione 2026-05-17, sessione 17, commit f510dbf) **Context-sensitive properties panel** — il pannello destra mostra ora solo il livello rilevante: griglia senza cella → ObjectProps griglia; cella selezionata → GridCellEditor (chip col tipo del figlio + Taglia/Rimuovi + hint "clicca nel canvas"; nessuna cella → type picker + Aggiungi); figlio sub-selezionato → ObjectProps del figlio con breadcrumb `griglia › R,C › tipo`. `PanelBreadcrumb` component inline. `GridCellEditor` semplificato: rimosso ObjectProps annidato e prop `pages` ora inutilizzata.
- (sessione 2026-05-17, sessione 17) **Grid child mouse selection** — click su cella griglia seleziona la cella; secondo click su oggetto figlio sub-seleziona il figlio con highlight teal tratteggiato. Transparent overlay rect attivo solo quando `isCellSel`. `selectedCell` / `selectedCellChild` spostati nello Zustand store (erano `useState` locale in EditorShell). Keyboard handler aggiornato a `useAppStore.getState().selectedCell` per evitare stale closure. Props `selectedCellChild` / `onSelectCellChild` aggiunti a SvgCanvasProps e ObjProps, passati lungo la catena `SvgCanvas → SvgObject`. `selectObject` / `clearSelection` / `setCurrentPage` / `undo` / `redo` ora azzerano entrambi i nuovi campi.
- (sessione 2026-05-17, sessione 17) **LeftPanel collapsible object tree** — sezione "OGGETTI PAGINA" ora mostra un toggle ▶/▼ per gli oggetti griglia con celle che hanno figli. Click sul toggle espande/comprime i sotto-rami; ogni sotto-ramo mostra tipo + nome del figlio + coordinate cella (R,C). Click sul sotto-ramo seleziona la griglia, la cella e il figlio nel canvas. Selezionare un figlio via canvas auto-espande il branch nel tree (useEffect su `selectedCellChild.objectId`). Implementato con `expandedGrids: Set<string>` locale + `React.Fragment` per interleave righe principali e sub-righe.
- (sessione 2026-05-17, sessione 17, commit 75db313) **Multi-selection common properties panel** — quando 2+ oggetti sono selezionati il pannello destra mostra le proprietà comuni: stesso tipo → `ObjectProps` completo con valori pre-filled (vuoto con placeholder "(vari)" se misti); tipi diversi → `CrossTypeProps` con sezioni universali (POSIZIONE, ASPETTO, TRASFORMAZIONE, VISIBILITÀ, TAG, QUALITÀ, EVENTI). Modifica applica a tutti gli oggetti selezionati. Undo (Ctrl-Z) ripristina tutti gli oggetti in un solo step (singolo `pushHistory` in `updateObjects`).
- (sessione 2026-05-17, sessione 17, commit 963d3e0) **Design-reference borders** — in edit mode tutti gli oggetti hanno un bordo contenitore tratteggiato (`stroke="#475569"`, `strokeDasharray="4 3"`, `opacity=0.5`, `pointerEvents="none"`). Per la griglia, ogni cella ha il proprio border tratteggiato (giallo se selezionata, grigio altrimenti). Visibile solo nell'editor, mai a runtime.
- (sessione 2026-05-17, sessione 17) **GridCellEditor con ObjectProps completo** — il pannello di editing per il figlio di una cella ora usa `<ObjectProps>` completo (stesso componente usato per gli oggetti di pagina) invece dei campi limitati. Aggiunti `CELL_CHILD_TYPES`, `makeDefaultChild()`, type picker a dropdown e bottone "Aggiungi". La prop `pages` è passata tramite `GridCellEditor` per i navbutton.
- (sessione 2026-05-16, sessione 16) **Template bug fix** — DDS661 slug corretto da `contatore-rack-piano-superiore` a `contatore-rack-pianosuperiore` (4 topic in `project.yaml`). Nav home sovrapposto ai titoli di pagina in Page 3/4/5 spostato a x=155 w=55 con label "⌂".
- (sessione 2026-05-16, sessione 16) **Quality dot per-oggetto** — campo `quality_dot?: boolean` (default true, false nasconde il cerchio) + tre colori opzionali `quality_dot_good_color / bad / uncertain` su `SynopticObject`. `qualityColor()` e `QDot` in `SvgCanvas.tsx` aggiornati; tutti i 5 siti di render (rect/ellipse/text/progress_bar/gauge) aggiornati. Pannello "INDICATORE QUALITÀ" in `EditorShell.tsx` (checkbox + 3 color picker; appare solo se `obj.tag` è impostato). Round-trip YAML garantito da 4 nuovi optional field in `synoptic.rs`.
- (sessione 2026-05-16, sessione 16) **Project management nella WelcomeScreen** — elimina (DELETE + window.confirm, 409 se progetto aperto), rinomina (inline input nella card, Enter/Esc/onBlur), duplica (riga extra sotto la card con nome copia). Backend: `delete_project / rename_project / duplicate_project` in `projects.rs`; 3 nuove route nel router (+ import `delete` da axum::routing). Frontend: 3 nuovi metodi API in `client.ts`; WelcomeScreen aggiornata con `EditingState` + handler.
- (sessione 2026-05-16, sessione 15) **MQTT broker browse + quick-create variabili + layout responsive**. `Sfoglia broker` apre un modal che si connette al broker, sottoscrive `#` per 2–15 s e mostra i topic rilevati con anteprima payload e dropdown JSON path. Importazione massiva in un click. `＋` accanto a ogni TagInput in MQTT e Modbus apre `QuickCreateTagModal` (ID / descrizione / tipo); i tag creati vengono salvati insieme alle sorgenti al prossimo "Salva". Body della ConfigView ora usa tutta la larghezza disponibile (rimosso `maxWidth: 900`); colonna "Topic in" allargata. Backend: `browse()` in sws-plugin-mqtt + `POST /api/sources/mqtt/browse` (Operator+) in sws-web con risoluzione automatica della password mascherata dal project.yaml. `cargo check` + `pnpm build` verdi.
- (sessione 2026-05-16, blocco 4) **Template "Casa Locale"** — secondo template SWS, console di controllo domestica a 5 pagine su broker MQTT locale (192.168.1.6). Pagine: Panoramica (flusso energia + status sicurezza), Impianto Solare (PV + batteria + rete), Contatori Energia (3 DDS661 con gauge + tabella), Sicurezza (12 sensori Zigbee + 3 PIR perimetrali + presenza lux), Domotica (tapparelle Shelly con 3 pulsanti + PDC + ESPHome). Sorgenti: Zigbee2MQTT (16 topic), dds661 (17 topic), Solarman bridge HA (12 topic), Shelly (4 topic con publish_topic). 50+ tag, 6 allarmi. 8 nuove icone SVG Material Design Icons (Apache 2.0) scaricate come asset colorati in `public/symbols/`. Guide in `CREDITS.md` e `SETUP.md` (incl. automation HA per bridge Solarman → MQTT).
- `3631c37` BL-002 — MQTT auth/TLS/last-will/QoS + password masking
- `964e67b` BL-003 — CodeMirror Python editor full-screen per FunctionDef
- `dda777e` BL-001 — persistent multi-user store + admin CRUD + must_change_password gate
- `375c1cc` Runtime log panel (drawer in basso, filtri, highlight) + demo MQTT echo
- `e4a61f5` Fix `/api/auth/users` 404: App.tsx ora carica `/api/project` in tutte le modalità
- `b455f6b` Project import/export ZIP + seed `examples/demo/` in repo
- `05ffc74` Widget Image abilitato + simboli custom con tracking licenza
- (sessione 2026-05-14) Log persistence su disco — `runtime-YYYY-MM-DD.jsonl` rotato per data, retention 7 gg configurabile
- (sessione 2026-05-14) Fix critico salvataggio + multi-page UX polish + symbol rotation/flip
- (sessione 2026-05-15) Header dropdown menu (Salva/Esporta/Importa/Esci) + Grid dropdown + fix symbol hit-area + BindableInput z-index fix + Demo Page 3 Showcase completa
- (sessione 2026-05-15, blocco 2) Universal binding follow-up #8 — `transition_duration_ms` per-oggetto per animazione CSS dei prop bindati (fill/stroke/opacity/transform). UI in ObjectProps TRASFORMAZIONE + batch in MultiSelectionProps. Rust mirror per round-trip YAML.
- (sessione 2026-05-16, sessione 12) **`2581fee` Page dimensions + Grid layout object (Session 1)**. `SynopticPage.width/height` opzionali: il canvas editor mostra un bordo tratteggiato blu ai limiti della pagina. Nuovo tipo di oggetto `"grid"`: griglia N×M con per-cella bg_color/bg_image, visible/visible_tag, on_press_fn/on_release_fn, rowspan/colspan. Due-livelli di hit-test nel canvas: clic sulla cella seleziona la griglia + la cella, `GridCellEditor` compare nel pannello destra. Bordi togglable (`grid_show_borders`). `updatePageProps` estesa con width/height; nuova action `updateGridCell`. Rust `synoptic.rs` mirror completo.
- (sessione 2026-05-16, sessione 16) **Symbol library v2 — SymbolGallery + 5 nuovi builtin + 7 vendored**. `library.tsx`: 5 nuovi render functions builtin (heat_pump, temperature_sensor, boiler, agitator con CSS spin animation quando ON, cooling_tower). 7 nuovi entry vendored da SVG esistenti in `public/symbols/` (solar_panel, battery, transmission_tower, home_lightning, garage, window_open, roller_shade). Totale simboli: 22 (16 builtin + 6 vendored). `SYMBOL_LIST = Object.values(SYMBOLS)` esportato. `SymbolSelect` (dropdown plain) sostituito da `SymbolGallery`: griglia CSS 4 colonne, maxHeight 260px scrollabile, ogni tile mostra mini-preview SVG (builtin via render()) o `<img>` (vendored/custom), bordo blu quando selezionato, label 8px sotto. `pnpm build` verde.
- (sessione 2026-05-16, sessione 14) **Grid Session 2 — child objects + cut/paste**. `GridCell.child?: SynopticObject` aggiunto ai tipi. Canvas: ogni cella renderizza il figlio centrato nella cella (`(cellW-cw)/2, (cellH-ch)/2`); in edit mode `pointerEvents:none` (clic cade sulla cella), in runtime interattivo. Store: nuova action `setClipboard(objs)`. Editor: `selectedCellRef` per keyboard handler senza stale closure. Ctrl+X taglia il figlio dalla cella selezionata (o taglia gli oggetti di pagina se nessuna cella con figlio); Ctrl+V incolla il primo elemento del clipboard come figlio della cella selezionata (o incolla a livello pagina se nessuna cella selezionata). `GridCellEditor` mostra tipo del figlio + pulsante "Rimuovi" + hint Ctrl+V.
- (sessione 2026-05-16, blocco 3) **Script output toast** — quando un `on_press_fn` / `on_release_fn` produce stdout, stderr o un errore (incluso timeout), RuntimeView mostra una card toast bottom-right (max 4 visibili, auto-close 5 s successo / 10 s errore, × manuale). stdout bianco, stderr amber, errore rosso. Output silenzioso non genera toast.
- (sessione 2026-05-16, blocco 2) **Fix runtime panic Rustls CryptoProvider** — aggiungendo `reqwest` con feature `rustls-tls` veniva portato `hyper-rustls` che abilitava `aws-lc-rs` mentre `rcgen` abilitava `ring`. Rustls 0.23 panica se trova entrambi senza un provider esplicito. Fix: `rustls = { version = "0.23", features = ["ring"] }` nel workspace Cargo.toml + `rustls::crypto::ring::default_provider().install_default().ok()` all'inizio di `main()`.
- (sessione 2026-05-16, blocco 2) **Script preemption** — `sys.settrace` + `KillSwitch` PyO3 class + timer thread (`std::thread::spawn`). Infinite loops in Python scripts vengono interrotti al prossimo confine di bytecode dopo `SWS_SCRIPT_TIMEOUT_MS`. Il timer thread setta un `AtomicBool`; la trace function lo legge e lancia `KeyboardInterrupt`; il harness la cattura e la converte in stringa `TimeoutError`. Il Tokio-level timeout rimane come backstop per le C extension bloccanti. `sys.settrace(None)` in `finally` lascia il thread del pool in stato sano.
- (sessione 2026-05-16, blocco 2) **`RuntimeUnavailableError`** — `api/client.ts` distingue ora "runtime non avviato" da "password errata". `fetch()` wrappato in try/catch; 502/504 → `RuntimeUnavailableError`. `LoginScreen` mostra "Runtime non raggiungibile. Avvia ./scripts/dev.sh e riprova." invece del fuorviante "Credenziali non valide". Stesso in `ReAuthModal`.
- (sessione 2026-05-16) **Alarm webhook notifications** — `notify_url?: string` aggiunto ad `AlarmDef` (Rust + TS). Dispatcher task in `main.rs`: subscribe to `AlarmDb.subscribe()`, HTTP POST via `reqwest 0.12 rustls-tls` (5 s timeout, best-effort) su ogni transizione ACTIVE. Payload: `{id, message, severity, tag, ts_ms, value}`. UI in ConfigView: input URL sotto il campo messaggio. `reqwest` aggiunto a workspace Cargo.toml.
- (sessione 2026-05-16) **Re-auth modal** — quando il token scade mid-session viene mostrato un overlay modale "Sessione scaduta" che chiede solo la password (username pre-compilato). Su successo il nuovo token viene salvato e il lavoro in corso è preservato (Zustand store intatto). Su dismiss → logout + LoginScreen. Implementazione: `reAuthNeeded` store flag, evento DOM `sws:session-expired` da `api/client.ts` quando 401+TOKEN, listener in `App.tsx`, componente `ReAuthModal.tsx`.
- (sessione 2026-05-16) **dev.sh bug fix** — il ramo `both` non passava `--projects-root` e `--templates-root`; la WelcomeScreen vedeva sempre zero progetti e zero template.
- (sessione 2026-05-15, blocco 3) Pulizia demo — `examples/demo/synoptics/{Page 1..Page 4}.yaml` riscritte con id stabili `page1..page4` (prima random `mp2n48800ucav`, `mp472aq9q3yzc`). Ogni pagina ha un header coerente con due navbutton `◀ Precedente` / `Successiva ▶` per navigazione circolare (1↔2↔3↔4↔1) + titolo. `.run/project/synoptics/` rifresh completo (cancellati 5 file inclusi `Page 3.yaml` + `Page 3 – Showcase.yaml` duplicati con stesso id). Vecchi navbutton orfani rimossi da Page 1; p3_navbutton (widget showcase) ora punta correttamente a `page1`.
- (sessione 2026-05-15, blocco 7) **Multi-Project IDE — Phase A2 (upload ZIP)**. Backend: `POST /api/projects/upload` pre-auth in `projects.rs` (manifest.json per nome, `?name=` override, estrae ZIP in `projects_root/<name>/`, rollback su errore). Frontend: `api.uploadProjectZip()` + tab "Da ZIP" nella `NewProjectModal` con file picker, nome auto-filled dal filename, fallback al manifest.
- (sessione 2026-05-15, blocco 6) **Multi-Project IDE — Phase A1 frontend complete**. `NoProjectError` + API wrapping (`listProjects/createProject/openProject/closeProject/listTemplates`), `noActiveProject` in store, `WelcomeScreen` (lista + modal nuovo progetto + template gallery), mount flow `App.tsx` (503→WelcomeScreen, 401→LoginScreen, 200→app), "Chiudi progetto" nel MainMenu. `pnpm type-check` + `pnpm build` verdi.
- (sessione 2026-05-15, blocco 4) **Multi-Project IDE — Phase A1 foundations**. Piano completo in `/home/ut1/.claude/plans/prosegui-il-lavoro-quali-snoopy-muffin.md` (stima totale 6-8h, splittato A1+A2). Solo le fondamenta non-breaking sono in questa sessione: `examples/demo/` → `examples/templates/demo-items/` (git rename + `template.yaml`), `sws-core::TagDb::clear()`, `sws-auth::AuthState::{swap_store, clear, empty}` + `store_path: RwLock<Option<PathBuf>>`. Tutto il resto (AppState refactor, nuovi endpoint `/api/projects/*`, WelcomeScreen, MainMenu Apri/Chiudi, dev.sh migration a `.run/projects/dev/`, upload ZIP) rinviato.
- (sessione 2026-05-15, blocco 5) **Multi-Project IDE — Phase A1 backend complete**. Backend pronto end-to-end (frontend ancora vecchio, WelcomeScreen rinviata).
  - `AppState.project_dir` → `Arc<RwLock<Option<PathBuf>>>` con helper `active_dir(state)`. Tutti i ~10 handler che lo usavano (get_project, patch_project callsites, list_synoptics, save_synoptic, import/export ZIP, custom_symbols) ritornano 503 quando il progetto è chiuso.
  - Nuovi CLI args runtime: `--projects-root` (lista progetti), `--templates-root` (template gallery), `--project` ora opzionale (auto-open legacy).
  - Nuovi endpoint pre-auth montati nel layer "open": `GET/POST /api/projects`, `POST /api/projects/:name/open`, `POST /api/projects/close`, `GET /api/templates`. Tutti pre-auth — la WelcomeScreen pesca senza session token.
  - Nuovi moduli `sws-web::projects` (list/create/open/close + `safe_project_name`) e `sws-web::templates` (list + `copy_dir_all` recursive con skip-list).
  - `scripts/dev.sh` ora layout `.run/projects/dev/` (auto-migra `.run/project/` esistente al primo run). Lancia runtime con `--projects-root --templates-root --project` (l'ultimo per auto-open legacy).
  - 33 unit test workspace verdi (+3 nuovi).

---

## What's working

- Monorepo scaffold (`sws-runtime/` Rust workspace + `sws-editor/` Vite+React)
- All Phase 1 community files (README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, `.gitignore`, ADR 0001)
- GitHub Actions CI (DCO, lint, build, test, audit, SBOM, multi-arch container build)
- GitLab CI mirror pipeline
- Rust workspace: `cargo check --workspace` passes
  - 10 library crates (`sws-core`, `sws-web`, `sws-auth`, `sws-historian`, `sws-audit`, `sws-pyscript`, `sws-plugin-api`, `sws-plugin-modbus`, `sws-plugin-opcua`, `sws-plugin-mqtt`)
  - Bin crate `sws-runtime` with working `/health`, `/metrics` (placeholder), self-signed TLS via rcgen, HTTPS on `0.0.0.0:8443`, graceful shutdown
- Rust Dockerfile (multi-stage, debian-bookworm-slim, non-root user, healthcheck)
- TypeScript editor: `pnpm install`, `pnpm type-check`, `pnpm build` all pass
  - App shell (header, alarm banner, mode toggle), `EditorShell`, `RuntimeView`, `SvgCanvas`, Zustand store, tag stream hook stub, i18n English baseline
- Editor Dockerfile (multi-stage, nginx:alpine serving SPA + reverse-proxying `/api` and `/ws` to runtime)
- `.claude/settings.json` configured with project-scoped permissions (`acceptEdits` default, allow list for cargo/pnpm/git/filesystem, ask for push/publish, deny for secrets/sudo/ssh)
- **sws-core tag engine**: `TagId`, `TagValue` (Bool/Int/Float/Str), `TagQuality`, `TagState`, `TagUpdate`, `TagDb` (Arc<RwLock<HashMap>> + tokio broadcast). `cargo test -p sws-core` passes (2 tests).
- **sws-web router**: `GET /api/tags` (JSON snapshot), `GET /api/tags/:id` (single tag or 404), `GET /ws/tags` (WebSocket stream — snapshot on connect + live updates). `TagDb` passed as Axum state.
- **sws-runtime**: creates `Arc<TagDb>`, loads `project.yaml`, hands DB to `sws_web::router::build()`.
- **sws-core project loader**: `Project::load(dir)` parses `project.yaml`; `populate_tags()` seeds TagDb with `Float(0.0)/Uncertain` for every defined tag. Missing file → warning, empty DB.
- **sws-core project format**: `sources` list with `kind: modbus_tcp` entries; each maps holding registers to tag IDs via `address` + `scale`.
- **sws-plugin-modbus**: `run(cfg, db)` polls holding registers at `poll_interval_ms`, writes `Float(raw * scale) / Good` into TagDb, marks tags `Bad` on error, reconnects after 5 s.
- **sws-core TagValue**: `#[serde(untagged)]` — serializes as native JSON (42.5, true, "hello") instead of `{"Float": 42.5}`.
- **sws-editor IDE (complete object palette)**:
  - Objects: rect, ellipse, line, text, button (write tag), navbutton (page nav), image (stub)
  - Drag-to-move all objects; lines preserve endpoint delta during drag
  - Delete key / button; Backspace supported too
  - Properties panel: per-type fields (fill, stroke, stroke_width, x2/y2 for line, target_page for navbutton, label/write_value for button)
  - Page properties when nothing selected: name, background color
- **Canvas grid**: SVG pattern grid with configurable size (Off/5/10/20/40 px), snap-to-grid toggle
- **LeftPanel (project tree sidebar)**:
  - Pages section: click to switch, add/delete
  - Objects palette: all object types with add buttons
  - Tags section: shows all defined tags with quality dot and live value
  - Sources section: shows Modbus TCP connections and register mappings (read-only)
  - Grid/snap settings, Save button
- **sws-web `GET /api/project`**: returns full project JSON (meta + tags + sources)
- **RuntimeView page nav tabs**: operator tab bar when multiple pages exist, click to switch
- **Navbutton**: navigates to target page in view mode via `onNavigate` callback
- **Page background**: configurable per page, applied to canvas SVG background

- **ConfigView** (mode "Configurazione" in header):
  - Tab *Variabili*: CRUD tabella tag (ID + descrizione), valore live se runtime attivo, PUT /api/project/tags
  - Tab *Protocolli*: CRUD sorgenti Modbus TCP, ogni sorgente mostra host/port/unit_id/poll_interval con mappatura registri inline (tag → indirizzo → scala × float), PUT /api/project/sources
  - Pulsanti OPC-UA e MQTT presenti ma disabilitati (prossimamente)
- **sws-web**: `PUT /api/project/tags` e `PUT /api/project/sources` — leggono project.yaml, aggiornano il campo, riscrivono; creano la directory se mancante
- **store**: `updateProjectTags`, `updateProjectSources` per aggiornamento ottimistico dopo salvataggio
- **App.tsx**: terza modalità "Configurazione" nel header
- **sws-editor: object palette estesa** — 7 nuovi tipi SCADA ispirati ad atvise:
  - `gauge`: arco 270° con needle SVG, soglie cromatiche (warn/alarm), tick marks, qualità dot
  - `slider`: `<input type="range">` in view mode, SVG statico in edit mode
  - `checkbox`: div + checkmark SVG in view mode, box SVG in edit mode; on/off value configurabili
  - `radio`: radio HTML in view mode, cerchi SVG in edit mode; lista opzioni editabile
  - `led`: cerchi concentrici con glow ring on/off, colori configurabili
  - `progress_bar`: rettangolo riempito con marcatori soglia, valore opzionale
  - `table`: righe dati con tag/etichetta/formato editabili, zebra-shading, qualità dot
- **LeftPanel**: tutti i 7 nuovi tipi in palette
- **EditorShell**: defaults per ogni tipo in `handleAddObject`; `ObjectProps` esteso con sezioni per-tipo; `RadioOptionsEditor` e `TableRowsEditor` sub-component
- **TagInput component** (`sws-editor/src/components/TagInput.tsx`): `<input list>` + `<datalist>` con autocomplete dei tag definiti nel progetto. Usato in `ObjectProps` (tutti i campi Tag), `TableRowsEditor` (righe tabella), `ModbusSourceCard` (mapping registri), `MqttSourceCard` (mapping topic).
- **TagDef.data_type**: nuovo campo `"bool" | "int" | "float" | "string"` (default `"float"`) in Rust `TagDef` e TS `TagDef`. `populate_tags()` semina il `TagValue` iniziale corretto. ConfigView Variabili: nuova colonna "Tipo" con select.
- **sws-plugin-mqtt**: subscribe loop con `rumqttc::AsyncClient`, exact-topic match, riconnessione 5 s, decoding payload euristico (bool/int/float/string) o via `json_path` dot-separated.
- **SourceDef::Mqtt** variant in `sws-core` con `MqttConfig { id, host, port (def 1883), client_id, topics }` e `TopicMapping { tag, topic, json_path? }`. `sws-runtime/main.rs` spawn task MQTT per ogni `mqtt` source.
- **MqttSourceCard** in ConfigView (host/port/client_id + tabella topic↔tag con TagInput e JSON path opz.). `LeftPanel` SourcesSection renderizza anche MQTT. Pulsante "+ Aggiungi MQTT" attivo.
- **TagWriteBus** (`sws-core`): registry mpsc tag→plugin. `PUT /api/tags/:id` instrada al plugin owner; fallback diretto a TagDb per tag virtuali. Modbus plugin scrive `write_single_register` con scala inversa + clamp u16. Test unitari coprono routing e NoWriter.
- **Alarm engine** (`sws-core/alarm.rs`): `AlarmDef` + `AlarmCondition::{Above, Below, BoolEquals}` + `AlarmSeverity` + `AlarmDb` con broadcast. Evaluator task in `sws-runtime` consuma il broadcast TagDb e re-valuta gli alarm. `GET /api/alarms`, `POST /api/alarms/:id/ack`, `WS /ws/alarms`. Configurato via `project.yaml`: campo `alarms: [...]` (backwards compatible).
- **AlarmBanner live**: hook `useAlarmStream` (snapshot HTTP + WS), badge active/unack, tinta per severità, messaggio più recente, pulsante ACK inline.
- **Hot-reload tag**: `PUT /api/project/tags` esegue diff con `TagDb` corrente — seed nuovi, evict orfani, valori esistenti preservati. Niente restart per CRUD variabili.
- **Hot-reload alarm**: `PUT /api/project/alarms` invoca `AlarmDb::load` completo dopo il persist. In-flight active alarms si resettano; il prossimo update li rivaluta.
- **ConfigView tab "Allarmi"**: CRUD `AlarmDef` con TagInput autocomplete, select condizione (above/below/bool_equals), soglia o bool, severità, messaggio, e colonna stato live (ON / ACK / —).
- **LICENSE**: file AGPL-3.0 completo già presente in repo, Q7 in OPEN_QUESTIONS marcato come deciso.
- **Log file v2** — `GET /api/logs/files` lista i file JSONL storici con data e dimensione; `GET /api/logs/file?date=YYYY-MM-DD` legge e restituisce gli eventi di un file storico come `Vec<LogEvent>`. LogPanel aggiornato: dropdown date + pulsante "Carica", modalità storica (header ambra, sorgente statica), "← Live" per tornare al ring live. Tutti i filtri (livelli, cerca, target) funzionano anche sullo storico.
- **Fix dev.sh both-mode** — il ramo `both` non passava `--projects-root` e `--templates-root` al runtime; la WelcomeScreen vedeva sempre zero progetti e zero template. Fix: aggiunti i due flag al blocco di lancio in background.
- **Fix rename-page** — `save_synoptic` ora rimuove il file YAML stale quando una pagina viene rinominata (confronto per `id` interno, non per nome file).
- **Historian v2** (`sws-historian`): Ring-buffer in-memory (5000 samples × tag) + optional SQLite backing. `query()` falls back to SQLite for ranges older than the ring (prepends the gap). Uniform-stride decimation when result > 1000 samples (keeps first + last). `prune_older_than_ms()` deletes SQLite rows outside the retention window. Runtime spawns a 24 h prune task; retention controlled via `SWS_HISTORIAN_RETENTION_DAYS` (default 30). 7 unit tests in `sws-historian` (incl. decimation, ring-drop, SQLite-fallback shape).
- **GET /api/history/:tag**: query string `from`/`to`/`limit`; ritorna `Vec<Sample>` (ts_ms + value + quality).
- **Trend object** nell'editor: `<foreignObject>` con `<canvas>` 2D. Poll ogni 2 s, autofit Y, badge valore corrente, edit-mode placeholder statico per drag senza fetch. Property panel: tag, window_s, y_min/y_max (entrambi 0 → autofit), line_color.
- **Selection rectangle** (`SvgCanvas.tsx`): drag on empty canvas background (left-button, edit mode only) draws a blue dashed rect overlay and selects all objects whose bounding boxes intersect it. Lines use min/max of their two endpoints for the bbox. A `suppressClick` ref prevents the SVG `onClick` from deselecting immediately after a successful rect-selection. Wired via `onSelectMany` prop → `store.selectMany()` in `EditorShell.tsx`. Compatible with existing shift-click multi-select.
- **Z-index / visibility cross-cutting**: ogni `SynopticObject` ha `z_index` (sort prima del render, ties per ordine array), `visible` statico e `visible_tag` (override truthy via tag). UI nella properties panel con pulsanti ▲/▼ per bump del z-index e TagInput per il binding visibilità.
- **Event handler Python**: campi `on_press` e `on_release` su ogni oggetto. `sws-pyscript::Engine` con PyO3 0.23, esegue gli script in `spawn_blocking`. Bindings: `tags.read(id) -> bool|int|float|str|None`, `tags.write(id, value)` (routing via TagWriteBus → fallback TagDb). `POST /api/script/exec` dal `RuntimeView` su mousedown/mouseup. **Sandboxing rinviato** (Q1 OPEN_QUESTIONS).
- **Bug fix**: Rust `SynopticObject` non aveva `window_s/y_min/y_max/line_color` per il trend — venivano persi al salvataggio. Aggiunti.
- **Auth skeleton** (`sws-auth` + `sws-web`): Argon2id hash/verify, in-memory session map `token → username`, `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/whoami`. Middleware `require_auth` su tutti gli `/api/*` (eccetto login) e su `/ws/*` (token via `?token=...` per il WS upgrade). Admin credenziali seeded da `SWS_ADMIN_USER` / `SWS_ADMIN_PASSWORD` env (runtime rifiuta lo start con password vuota).
- **Frontend auth**: store `authToken/authUser` con persistenza `localStorage`, `LoginScreen` mostrato senza token, `Authorization: Bearer` automatico su tutte le richieste, WS riapre con nuovo `?token=...` se cambia il token (login/logout), header con "Esci".
- **dev.sh**: esporta `PYO3_PYTHON=python3` (Debian non ha `/usr/bin/python` di default → pyo3-build-config falliva) e `SWS_ADMIN_USER=admin` / `SWS_ADMIN_PASSWORD=admin` per dev locale.
- **Text object esteso**: campo `text` statico, `font_size`, `font_family`, `font_weight` (string o number), `font_style`, `text_anchor` (start/middle/end), `color`. Precedenza render: tag+format vince sul testo statico. UI in ObjectProps con select per peso/stile/anchor + color picker.
- **Campo `name` su ogni oggetto**: alias human-friendly distinto dall'id auto-generato. Mostrato nella nuova `ObjectsSection` del LeftPanel.
- **ObjectsSection (LeftPanel)**: lista oggetti pagina corrente con click per selezionare, ✎/doubleclick per rinominare inline, ⧉ per duplicare (clone con `(copia)`, offset +20px, selezionato), × per eliminare.
- **Bug fix**: il vecchio rendering text usava `stroke_width` come fontSize (misuso storico) — ora usa `font_size` con default 14. Aggiunti i campi mancanti al Rust `SynopticObject` per sopravvivere al round-trip YAML.
- **CodeMirror Python editor (BL-003)**: `PythonEditor` con `@codemirror/lang-python`, tema one-dark, line numbers, history/undo. `FunctionEditor` full-screen (header + aside parametri + editor): apre quando in LeftPanel si seleziona una function, snippet dropdown (increment/toggle/conditional/reset_many/diagnostic/skeleton), indicatore "modifiche non salvate", save bloccato finché clean.
- **MQTT esteso (BL-002)**: `MqttConfig` con `username/password/password_env` (env wins), `keep_alive_secs`, `clean_session`, `qos` (default 0), `tls: MqttTlsConfig { enabled, ca_cert_path, insecure_skip_verify }` — rumqttc 0.24 richiede `ca_cert_path` obbligatorio per TLS (no Native variant). `last_will: MqttLastWill { topic, payload, qos, retain }`. Per-topic `qos` opzionale. `MqttSourceCard` in ConfigView: sezioni Autenticazione / Connessione / TLS / Last Will, collassabili.
- **Password masking (BL-002)**: `GET /api/project` maschera le password MQTT come `"********"`; `PUT /api/project/sources` carica il project precedente dal disco e conserva la vecchia password se l'incoming contiene la sentinel.
- **Persistent user store (BL-001)**: `sws-auth` ora persiste in `users.yaml` (project dir). `AuthState::new_persistent(path, seed, ...)` carica esistenti o seeda dagli env. Admin seeded → `must_change_password: false`. Endpoint admin-only: `GET/POST /api/auth/users`, `PUT/DELETE /api/auth/users/:username`. Self-service: `POST /api/auth/change-password`. Middleware `require_password_changed` blocca tutto tranne whoami/logout/change-password con 403 + `{ error: "password_change_required" }`.
- **Frontend BL-001**: `ChangePasswordScreen` mostrato al posto dell'app quando `mustChangePassword === true`. Nuova tab *Utenti* in ConfigView (solo Admin) con tabella ruolo/forza-cambio-pwd/reset-pwd/elimina + form "+ Nuovo utente".
- **Test coverage**: 11 unit test in sws-auth (incl. last-admin protection, demote-last-admin protection, change-password clears flag, create/update/delete CRUD); 22 unit test totali nel workspace.
- **LogBus + pannello log**: `sws-core::LogBus` (ring 1000 + `tokio::broadcast`) + `sws-runtime/log_layer.rs` (custom `tracing_subscriber::Layer`) catturano ogni evento `tracing::info!/warn!/error!`. `GET /api/logs` per snapshot, `GET /ws/logs` per tail live — entrambi in `operator_routes` (Operator+). Pannello `LogPanel` come drawer in fondo all'editor (toggle "Log" nell'header, stato persistito in `localStorage`): timestamp ms, colore per livello, filtri checkbox per i 5 livelli (TRACE/DEBUG off di default), filtro substring sul target, ricerca full-text con `<mark>` di highlight, Pausa per congelare la vista, Cancella, auto-scroll che si stacca se l'utente scrolla su. Viewer vede solo un messaggio "permesso insufficiente". 24 unit test totali nel workspace (+2 per LogBus).
- **Demo MQTT round-trip**: `.run/project/project.yaml` ha due nuovi tag bool (`demo.button`, `demo.led`) mappati sul topic `sws/demo/echo` di `broker.freemqtt.com`. Pulsante "MQTT Echo" scrive `demo.button=true` → plugin pubblica → broker rimbalza → entrambi i tag ricevono il valore → la LED si accende. Niente bridging esterno, dimostra il publish/subscribe completo via MQTT 3.1.1.
- **Demo seedato nel repo**: `examples/demo/{project.yaml, synoptics/Page 1.yaml}` è uno snapshot versionato del progetto dev (5 tag, MQTT echo, alarm, 2 funzioni Python, synoptic con 11+ oggetti incl. buttons UP/DOWN, MQTT LED ON/OFF, slider, gauge, pump symbol). `scripts/dev.sh` lo copia in `.run/project/` solo se `project.yaml` non esiste, così un fresh clone parte con un editor pieno e i clone esistenti non vengono trampled.
- **Project import/export (Admin)**: due bottoni "Esporta" / "Importa" in header (solo Admin). Bundle ZIP `{manifest.json, project.yaml, synoptics/<page>.yaml}` con `format_version: "1.0"`. Le password MQTT sono **strippate** (mai esportate); le re-immetti in Configurazione → Protocolli dopo l'import. Replace mode con confirm dialog: synoptic orfani vengono eliminati. Hot-reload completo dopo import (TagDb diff, AlarmDb.load, supervisor.reload, functions registry swap) — niente restart. Endpoints `GET /api/project/export` + `PUT /api/project/import`, entrambi in `admin_routes` con `require_admin` + `require_password_changed` + `require_auth`.
- **Bug fix gauge hit-area**: il `<g>` del gauge non riceveva eventi pointer perché tutti i figli avevano `pointerEvents: "none"` (l'arco è geometria stroke-only, niente fill). Aggiunto `<rect fill="transparent">` come primo figlio → gauge ora selezionabile e draggabile da qualsiasi punto del bounding box. (`sws-editor/src/canvas/SvgCanvas.tsx`)
- **Widget Image abilitato**: il tipo `image` era segnato "Prossimamente" in LeftPanel ma il rendering era già funzionante. Rimosso il flag `disabled`. Properties panel ora mostra un campo "URL immagine" per impostare `src`. Supporta qualsiasi URL assoluto o path `/symbols/…`.
- **Simboli custom progetto (`PUT /api/project/custom-symbols`)**: nuovo endpoint REST (Rust) + campo `custom_symbols: Vec<CustomSymbol>` in `project.yaml`. Ogni simbolo ha `{ id, label, url, attribution: { author, source, license } }`. Viene incluso nel ZIP di export/import.
- **Tab "Risorse" in ConfigView**: elenco simboli già aggiunti con tabella url/licenza/autore + pulsante rimuovi. Form di aggiunta: URL SVG, etichetta, licenza (select CC0/CC-BY/Apache/MIT/BSD/PD), autore, fonte. L'id viene derivato automaticamente dall'etichetta. Salvataggio via `PUT /api/project/custom-symbols`.
- **SymbolSelect component**: il dropdown "Simbolo" in EditorShell ora include un gruppo `<optgroup>` "Simboli progetto" con i simboli custom. I simboli custom hanno `symbol_id` prefissato `custom:`. Canvas li renderizza come `<image href={url}>` con badge stato (stesso meccanismo dei simboli vendored).
- **SvgCanvas/RuntimeView**: `customSymbols` passato come prop sia all'editor sia alla view runtime — i simboli custom appaiono anche in modalità operatore.
- **Log persistence su file** (`sws-runtime/log_file.rs`): nuovo modulo che si sottoscrive a `LogBus` (broadcast `LogEvent`) e scrive ogni evento come riga JSONL in `<logs_dir>/runtime-YYYY-MM-DD.jsonl`. Rotazione per data UTC: alla prima riga di un nuovo giorno chiude il file precedente e apre quello nuovo. CLI `--logs <path>` (default: `<project>/../logs` — sibling del project dir, dev.sh già crea `.run/logs/`). Retention via `SWS_LOG_RETENTION_DAYS` (default 7); allo startup elimina i `runtime-*.jsonl` con data < cutoff (mantiene la giornata di cutoff). Errori del writer (disk full, dir non scrivibile, etc.) escono su `stderr` con `eprintln!` — mai via `tracing` — per evitare feedback loop attraverso `LogBus`. Subscribe sincrono prima di `tokio::spawn` per non perdere i primi eventi. Format file = identico a `GET /api/logs` (stesso `LogEvent` JSON), così `tail -f *.jsonl | jq .` mostra ciò che vede l'editor. Nessuna modifica frontend: i file servono per post-mortem dopo crash/restart e per container deploy dove podman/journald wrappano. Coabita con `dev.sh` che già redirige stdout in `.run/logs/runtime.log` (nome distinto, no collisione).
- **Test coverage**: workspace ora a 30 unit test (4 nuovi in `sws-runtime`: `date_from_ts_ms_is_deterministic`, `date_minus_days_handles_month_and_year_boundaries`, `prune_old_keeps_recent_and_removes_old`, `writer_appends_jsonl_lines`).
- **"Salva tutto" (sostituisce il vecchio "Salva")**: il bottone in `LeftPanel` ora persiste in parallelo OGNI synoptic page + (se Admin) tag, sources, alarms, funzioni Python, custom symbols. Prima salvava SOLO la pagina corrente — modifiche al `FunctionEditor` o ad altre pagine andavano perse se l'utente non passava dalla tab giusta di ConfigView. Feedback chip: "Salvataggio…" / "✓ Salvato" (2 s) / "❌ Errore — clicca per ritentare" con tooltip + banner dettaglio errori. Non-Admin (Operator+): salva solo le synoptic; gli endpoint admin-only vengono saltati silenziosamente.
- **Multi-page UX**: rinomina pagina via doppio click o icona ✎ con input inline (Enter/Esc), conferma su delete che ricorda l'undo (Ctrl-Z). Navbutton con `target_page` puntante a pagina eliminata → bordo rosso + chip warning "⚠ pagina inesistente" + opzione disabilitata nel select per non perdere l'id originale.
- **Symbol rotation + flip**: nuove proprietà `rotation` (deg), `flip_h`, `flip_v` sui simboli (built-in, vendored, custom). Slider -180/+180 + numeric + reset; checkbox flip h/v; trasformata SVG `rotate(R cx cy) scale(±1 ±1)` applicata solo al visual. Selection rect e status badge restano axis-aligned. Round-trip YAML garantito da `SynopticObject` Rust esteso.
- **Cross-cutting transform + bindings (Phase 1)**: `rotation/flip_h/flip_v/opacity` estesi a tutti i tipi visivi (rect/ellipse/text/image/gauge/led/progress_bar/table/button/navbutton/symbol); helper `applyTransform` + `resolveObject` in `SvgCanvas.tsx`; sezione "TRASFORMAZIONE" in ObjectProps panel; rotation/flip rimossi dal blocco symbol-specifico. Campo `bindings: Record<string,string>` aggiunto a TS `SynopticObject` e Rust mirror.
- **BindableInput component (Phase 2)**: toggle 🔗/🔓 su fill, stroke, text, color, label, rotation, opacity, src, on_color, off_color, min, max, unit e altri campi del pannello. Sezione "BINDING ATTIVI" in fondo al pannello per audit/rimozione rapida.
- **Demo Page 2 + Page 3 (Phase 3)**: Page 2 welcome fixa il navbutton orfano di Page 1 (id `mp472aq9q3yzc`). Page 3 "Demo Binding" con un widget per tipo agganciato a `demo.rotation`/`demo.opacity`; 2 slider per pilotarli. 4 nuovi tag in `examples/demo/project.yaml`.

## Roadmap — Task pendenti

> Organizzati per area. Ogni sub-item è sviluppabile indipendentemente salvo dipendenze indicate con →.
> Stime implementazione indicative. Chiusi = ✅.

---

### 1 — Editor UX / LeftPanel

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 1.1 | ✅ Gruppo rename (doppio-click + ✎) | — | — |
| 1.2 | ✅ Palette oggetti categorizzata + icone: accordion Forme/Controlli/Display/SCADA/Layout | — | — |
| 1.3 | Drag & drop oggetti nel tree LeftPanel (riordina, cambia gruppo) | 2 h | — |
| 1.4 | Context menu tasto destro su oggetto (Rinomina / Duplica / Elimina / Raggruppa) | 1 h | — |

---

### 2 — Navigazione inter-view

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 2.1 | ✅ Store `appMode` + `configTab` nel Zustand store; App.tsx li legge da store | — | — |
| 2.2 | ✅ Sorgenti LeftPanel come link → `navigateToConfig("protocols")` | — | → 2.1 |
| 2.3 | Deep-link da qualsiasi punto dell'app a qualsiasi tab ConfigView | — | → 2.1 |

---

### 3 — Stato sistema e monitoraggio

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 3.1 | ✅ Crate `sysinfo = "0.30"` + `started_at: Instant` in AppState | — | — |
| 3.2 | ✅ Endpoint `GET /api/system` (version, uptime, tag/alarm count, CPU%, RAM, disco) | — | → 3.1 |
| 3.3 | ✅ Tab "Stato" in ConfigView con card metriche + polling 10s | — | → 3.2 + 2.1 |
| 3.4 | `/metrics` endpoint Prometheus reale (usa crate `metrics-exporter-prometheus` già incluso) | 1 h | → 3.1 |

---

### 4 — Canvas avanzato

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 4.1 | ✅ Undo singolo per drag/resize (bracketed `beginInteraction`/`endInteraction`) | — | — |
| 4.2 | Ruler/guide lines: righelli px con guide orizzontali/verticali draggabili | 2 h | — |
| 4.3 | ✅ Copy-paste cross-page (source-page tracking, strip `group_id` cross-page) | — | — |
| 4.4 | ✅ Snap to page border (0, w/2, w; 0, h/2, h con stesso threshold dell'edge snap) | — | — |
| 4.5 | ✅ Grid: drag-resize bordi righe/colonne + snap interno | — | — |
| 4.6 | ✅ Grid: shift+click multi-cell selection + merge/unmerge | — | — |
| 4.7 | ✅ Grid: split locale cella in 1×2/2×1 con drag bordo interno | — | — |
| 4.8 | Grid: drag-to-range multi-cell (oggi solo shift+click) | 1.5 h | — |
| 4.9 | Grid: ricorsione split (sub-cell con sub) | 2 h | → 4.7 |
| 4.10 | Grid: merged cell splittable (auto-unmerge + split) | 1 h | → 4.7 |

---

### 5 — Deployment e architettura (ARCH-001..004)

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 5.1 | ✅ **ARCH-001** Runtime serve SPA via `ServeDir` + `--www <path>` (fallback service + SPA `index.html` 404 catch) | — | — |
| 5.2 | ✅ **ARCH-002** `VITE_RUNTIME_URL` configurabile (proxy Vite + `api/client.ts` + `ws/wsUrl.ts`) | — | — |
| 5.3 | ✅ **ARCH-003** Kiosk mode: `--kiosk-browser <cmd>` con poll `/health` + spawn fire-and-forget | — | — |
| 5.4 | ✅ **ARCH-004** Multi-runtime WelcomeScreen (CORS + dynamic baseUrl + modal + header pill) | — | — |
| 5.5 | Demo su PX30 hardware | — | → 5.1, hw fisico |

---

### 6 — Runtime e backend

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 6.1 | ✅ Alarm acknowledge UI: `AlarmPanel` floating top-right in RuntimeView con ACK per riga + ACK tutti | — | — |
| 6.2 | ✅ Log export: bottone "⬇ Scarica" in `LogPanel` (JSONL, rispetta i filtri, live/storico) | — | — |
| 6.3 | Script parametri live: UI per sovrascrivere i parametri di `on_press_fn` al volo | 1 h | — |
| 6.4 | WebSocket tag write bidirezionale (WS push + subscribe per scritture da runtime) | 3 h | — |

---

### 7 — Progetto e persistenza

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 7.1 | Export singola pagina YAML (oggi solo ZIP progetto completo) | 45 min | — |
| 7.2 | Backup automatico ogni N minuti con `.bak/` directory e rollback | 2 h | — |
| 7.3 | Import singola pagina YAML in un progetto esistente | 45 min | → 7.1 |

---

### 8 — Auth e sicurezza

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 8.1 | Refresh token + cookie httponly (oggi solo Bearer + localStorage) | 2 h | — |
| 8.2 | Lockout dopo N tentativi falliti | 1 h | — |
| 8.3 | LDAP / OAuth2 plugin | 4 h+ | — |

---

### 9 — Qualità e test

| ID | Task | Stima | Dipendenze |
|----|------|-------|------------|
| 9.1 | Test E2E Playwright per flusso login → add object → save → reload | 3 h | — |
| 9.2 | Test integrazione endpoint `/api/system` (mock sysinfo) | 30 min | → 3.2 |
| 9.3 | Verifica fresh clone: `rm -rf .run && ./scripts/dev.sh` deve seedare demo | — | verifica manuale |
| 9.4 | Verifica log JSONL: `.run/logs/runtime-YYYY-MM-DD.jsonl` creato al primo restart | — | verifica manuale |

---

### Sessioni raccomandate

| Sessione | Durata | Contenuto | Prerequisiti |
|----------|--------|-----------|--------------|
| ~~**S-22**~~ ✅ | ~6 h | ARCH-001 + ARCH-002 + 4.1 + 4.3 + 4.4 + 6.1 + 6.2 + fix test `alarm.rs` | — |
| ~~**S-23**~~ ✅ | ~4 h | Grid: resize bordi (4.5) + multi-cell + merge (4.6) + split locale (4.7) | — |
| ~~**S-24**~~ ✅ | ~3 h | Grid sub-cell recursion + breadcrumb cliccabile + ObjectProps accordion + ARCH-003 kiosk software | — |
| **S-25** | manual | Test ARCH-003 sul PX30 reale (chromium + cage) | hw fisico |
| ~~**S-26**~~ ✅ | ~2 h | ARCH-004 (multi-runtime WelcomeScreen + CORS) | — |
| **S-27** | ~3 h | 1.3 (drag&drop tree) + 1.4 (context menu) + 4.2 (rulers) | — |

---

## Backlog storico (chiusi — solo riferimento)

> **BL-001, BL-002, BL-003 chiusi in blocco autonomo 2026-05-13.** Si veda la sezione "What's working" sopra. Le descrizioni di backlog sotto restano come riferimento storico.

- **BL-001 ✅ DONE — Gestione utenti multi-account nella vista Configurazione (admin-only)**
  - **Goal**: in modalità *Configurazione*, un utente con ruolo `admin` deve poter vedere l'elenco degli account, crearne di nuovi, assegnare il ruolo (Viewer / Operator / Supervisor / Admin — i 4 ruoli RBAC esistenti) e forzare il cambio password al primo login del nuovo utente.
  - **Backend (`sws-auth` + `sws-web`)**:
    - Sostituire l'attuale singolo admin seeded da env con uno store utenti persistente (file su disco YAML/JSON nella project dir, oppure SQLite locale — decidere in OPEN_QUESTIONS se la scelta non è ovvia). L'admin seeded resta come bootstrap quando lo store è vuoto.
    - Modello `User { username, password_hash (Argon2id), role, must_change_password: bool, created_at, updated_at }`.
    - Endpoint (tutti gated da `role == admin` via middleware):
      - `GET /api/auth/users` — lista (senza hash).
      - `POST /api/auth/users` — crea con password iniziale + `must_change_password: true` di default.
      - `PUT /api/auth/users/:username` — aggiorna ruolo, reset `must_change_password`, reset password.
      - `DELETE /api/auth/users/:username` — rifiuta se è l'ultimo admin.
    - Endpoint self-service (qualsiasi utente loggato): `POST /api/auth/change-password` (old + new); pulisce `must_change_password` se vero.
    - Login: il `POST /api/auth/login` ritorna anche `must_change_password` nella risposta; finché è true, tutte le altre API rispondono 403 con un codice che il frontend riconosce.
  - **Frontend (`sws-editor`)**:
    - Nuova tab *Utenti* in `ConfigView`, visibile solo se `authUser.role === "admin"`.
    - Lista utenti con colonne: username, ruolo, "deve cambiare pw", azioni (modifica ruolo, forza cambio pw, reset pw, elimina).
    - Form "Nuovo utente": username, password iniziale, ruolo, checkbox "deve cambiare al primo login" (default on).
    - Schermata `ChangePasswordScreen` mostrata al posto dell'app se `authState.mustChangePassword === true` dopo il login.
  - **Test**:
    - Unit: hashing/verify, "ultimo admin non eliminabile", flag `must_change_password` resettato dopo change.
    - Integrazione: login → must_change_password → blocca API → change-password → sblocca.
  - **Out of scope** (volutamente non in BL-001): LDAP/OAuth, password policy (lunghezza/complessità), lockout dopo N tentativi falliti, 2FA, audit completo delle modifiche utente (basta audit-log v1 esistente). Vanno in BL successive se servono.

- **BL-002 ✅ DONE — Estendere la configurazione MQTT (Configurazione → Protocolli)**
  - **Motivo**: la `MqttConfig` attuale ([sws-runtime/crates/sws-core/src/project.rs:75-84](sws-runtime/crates/sws-core/src/project.rs#L75-L84)) espone solo `id / host / port / client_id / topics`. Manca tutto il resto, in particolare le credenziali — bloccante per provare broker pubblici con auth (es. https://freemqtt.com/en).
  - **Campi da aggiungere a `MqttConfig`** (tutti `#[serde(default, skip_serializing_if = ...)]` per restare retrocompatibili con i project.yaml esistenti):
    - `username: Option<String>` e `password: Option<String>` → `opts.set_credentials(u, p)` su `rumqttc::MqttOptions`.
    - `keep_alive_secs: Option<u16>` (default attuale hardcoded a 10, vedi [sws-plugin-mqtt/src/lib.rs:62](sws-runtime/crates/sws-plugin-mqtt/src/lib.rs#L62)).
    - `clean_session: Option<bool>` → `opts.set_clean_session(...)`.
    - `tls: Option<MqttTlsConfig>` con almeno `{ enabled: bool, ca_cert_path: Option<String>, insecure_skip_verify: bool }`. Quando `enabled`, port di default → 8883; usa `rumqttc::Transport::Tls`. Verificare il feature flag `rustls-tls` di `rumqttc` (probabilmente da aggiungere in `Cargo.toml` del plugin).
    - `last_will: Option<LastWill>` con `{ topic, payload, qos, retain }` → `opts.set_last_will(...)`.
    - `qos: Option<u8>` a livello sorgente (0/1/2) e/o `qos` per singolo `TopicMapping` → oggi è hardcoded `AtMostOnce` su subscribe (vedi [sws-plugin-mqtt/src/lib.rs:67](sws-runtime/crates/sws-plugin-mqtt/src/lib.rs#L67)) e probabilmente anche su publish. Mettere il default su `AtLeastOnce`.
  - **Sicurezza segreti**: la `password` finisce in `project.yaml` (sul disco, dentro `.run/`). Per il PoC è accettabile, ma:
    - Aggiungere supporto a `password_env: Option<String>` come alternativa: se valorizzato, leggere la password da quella env var a runtime invece che dal file. Permette di tenere il file pulito per la demo PX30.
    - Marcare `project.yaml` come file con segreti in `docs/CONTEXT.md` / `README` se non già fatto.
    - In `GET /api/project` mascherare le password (`"********"` o omettere il campo); il `PUT` deve gestire il "campo vuoto = lascia invariato" vs "campo nuovo = sovrascrivi".
  - **Frontend (`sws-editor` → `MqttSourceCard` in ConfigView)**:
    - Sezione "Autenticazione": username, password (input type=password, placeholder "lascia vuoto per non modificare" in edit), bottone "Mostra".
    - Sezione "Connessione": keep_alive_secs, clean_session, qos di default.
    - Sezione "TLS": enabled, ca_cert_path (textbox path lato server), insecure_skip_verify (con warning).
    - Sezione "Last Will": topic, payload, qos, retain (collassabile).
    - Sezione "Topic": colonna `qos` opzionale per ogni mapping.
  - **Test di accettazione**: configurare un broker freemqtt.com con utente+password, vedere arrivare valori in un tag, scrivere via `PUT /api/tags/:id` e vederli pubblicati. Annotare in `STATUS.md` come "verificato su broker pubblico".

- **BL-005 — Plugin OPC-UA client completo (Phase 4)**
  - **Contesto**: `sws-plugin-opcua` è uno scheletro vuoto. La crate `async-opcua 0.18` è già in `Cargo.toml` (workspace). Questa BL copre tutta la Phase 4 del piano in `docs/CONTEXT.md`.
  - **Backend (`sws-plugin-opcua` + `sws-core` + `sws-web`)**:
    - `OpcUaConfig` in `sws-core/src/project.rs`:
      ```yaml
      - kind: opcua_client
        id: machine1
        endpoint_url: "opc.tcp://192.168.1.100:4840"
        security_policy: None   # None | Basic128Rsa15 | Basic256 | Basic256Sha256
        auth: { anonymous: true }  # o { username, password / password_env }
        subscription_interval_ms: 500
        nodes:
          - node_id: "ns=2;s=Machine.CycleTime"
            tag: "machine1.cycle_time"
      ```
    - `sws-plugin-opcua::run(cfg, db, write_bus)`: connessione, `CreateSubscription`, loop `MonitoredItems` → `TagDb`. Riconnessione automatica 5 s. Write via `TagWriteBus` → `async_opcua::Client::write`.
    - `POST /api/sources/opcua/browse` (Operator+): browse ricorsivo del namespace, ritorna albero nodi (NodeId / DisplayName / DataType / Description). Usato da ConfigView per il browse modale.
    - `POST /api/sources/opcua/read-node` (Operator+): legge il valore istantaneo di un NodeId (diagnostica).
  - **Frontend (`OpcUaSourceCard` in ConfigView)**:
    - Campi: endpoint URL, security policy (select), auth (anonimo / user+password), subscription interval.
    - Tabella nodi: NodeId (input manuale o da browse), tag (TagInput autocomplete), descrizione.
    - Bottone "Sfoglia server" → modal con albero address space; click su foglia → aggiunge riga nella tabella.
    - Bottone "+ Aggiungi OPC-UA" attivo in ConfigView Protocolli.
  - **Exit criterion**: legge un nodo da un server OPC-UA reale (Siemens / B&R / simulatore `opcua-commander`), valore live nel browser. Write verso un nodo Bool funziona da pulsante canvas.

- **BL-005b — Euromap companion spec auto-discovery (dipende da BL-005)**
  - **Contesto**: Euromap 77 (injection molding machines) e Euromap 83 (temperature control units) sono companion specification OPC-UA con namespace e NodeId standardizzati. Le macchine conformi espongono un namespace riconoscibile dal tipo di ObjectType.
  - **Backend**:
    - `POST /api/sources/opcua/detect-euromap` (Operator+): browsa il server, cerca ObjectType/Instance derivanti da tipi Euromap noti (namespace URI `http://euromap.org/euromap77`), ritorna `{ euromap_version, machine_type, detected_variables: [{ node_id, name, description, unit, data_type }] }`.
  - **Frontend**: tab "Sfoglia Euromap" in `OpcUaSourceCard` → card con tipo macchina rilevato + lista variabili con checkbox → "Importa selezionati" → aggiunge righe nella tabella nodi + crea tag con nome/desc standard.
  - **Variabili Euromap 77 mappate** (nome standard → tag SWS):
    - `MachineState` → `{id}.machine_state` (int), `ActiveErrors` → `{id}.active_errors` (int)
    - `CycleTime` → `{id}.cycle_time` (float s), `InjectionTime` → `{id}.injection_time` (float s)
    - `MeltTemperature` → `{id}.melt_temp` (float °C), `ClampingForce` → `{id}.clamping_force` (float kN)
    - `ProductionActiveParts` → `{id}.parts_produced` (int), `ProductionActiveDefectiveParts` → `{id}.parts_defective` (int)
  - **Variabili Euromap 83** (temperature control unit):
    - `TbcActualTemperature` → `{id}.temp_actual`, `TbcSetTemperature` → `{id}.temp_set`, `TbcState` → `{id}.tcu_state`
  - **Template**: `examples/templates/euromap77-im/` — `project.yaml` + synoptic preconfigurato (gauge CycleTime, LED MachineState, tabella errori, bar ClampingForce).
  - **Documentazione**: `docs/EUROMAP_SETUP.md` — companion spec supportate, NodeId noti, come testare con server simulato `node-opcua`.
  - **Exit criterion**: auto-discovery su server Euromap 77 rileva 8+ variabili, crea tag, valori live in synoptic.

- **BL-003 ✅ DONE — Editor Python decente per `on_press` / `on_release` e funzioni di progetto**
  - **Motivo**: oggi i campi di codice Python sono `<textarea>` minuscole nella properties panel — niente syntax highlighting, niente indentazione automatica, e l'utente segnala che il ritorno a capo non funziona bene. Vale per sia gli handler per-oggetto (`on_press`, `on_release`) sia le nuove funzioni Python a livello progetto (vedi commit "reusable Python functions + symbol library doubled").
  - **Obiettivo UX**:
    - **Per le funzioni di progetto**: aprire un editor a tutto schermo nello spazio principale di lavoro (al posto del canvas, come una vista alternativa) invece che dentro una proprietà laterale. Salvataggio esplicito + indicatore "modifiche non salvate".
    - **Per gli handler per-oggetto** (`on_press` / `on_release`): mantenere il campo nella properties panel come anteprima/riepilogo a 1-2 righe, ma con un pulsante "Apri editor" che apre lo stesso editor a tutto schermo (o un modal grande, almeno 600×400) sul singolo handler.
  - **Componente editor**:
    - Usare **CodeMirror 6** con `@codemirror/lang-python` (più leggero di Monaco; bundle ~120 KB vs ~3 MB per Monaco). Conferma in `pnpm-lock.yaml` che non c'è già Monaco da altre parti — se sì, riusarlo. Decisione minore, lascio aperto.
    - Funzionalità minime: syntax highlight Python, indentazione automatica (4 spazi), bracket matching, line numbers, find/replace, font monospace.
    - Tema chiaro/scuro coerente col resto dell'app.
  - **Template / snippet preconfigurati**: dropdown "Inserisci template…" sopra l'editor con esempi che usano l'API `tags.read` / `tags.write` esistente ([sws-runtime/crates/sws-pyscript/src/lib.rs](sws-runtime/crates/sws-pyscript/src/lib.rs)). Inserire come testo nel cursore, sovrascrive selezione. Set iniziale:
    - **Incremento tag**: `v = tags.read("counter") or 0\ntags.write("counter", v + 1)` ← l'esempio richiesto.
    - **Toggle booleano**: `tags.write("light", not (tags.read("light") or False))`.
    - **Scrittura condizionale**: leggi A, se sopra soglia scrivi B.
    - **Reset multi-tag**: scrivi 0 a una lista di tag.
    - **Print/log diagnostico**: `print(...)` (lo stdout va già al pannello browser console via [sws-pyscript ExecOutput](sws-runtime/crates/sws-pyscript/src/lib.rs), vedi OPEN_QUESTIONS Q1).
    - Per le funzioni di progetto, aggiungere anche un template "scheletro di funzione con parametri" (la firma del `FunctionDef` esistente — vedi `parameters` in [project.rs](sws-runtime/crates/sws-core/src/project.rs)).
  - **Bug del "ritorno a capo" da investigare**: la textarea attuale potrebbe avere un handler `onKeyDown` che intercetta Enter (es. per "salva al primo enter") — controllare prima di rimpiazzare il componente, perché lo stesso bug potrebbe esistere anche in altri campi multi-linea.
  - **Out of scope**: autocomplete dei nomi tag dentro il codice Python (sarebbe figo ma è LSP-grade, troppo lavoro per il PoC), linting Python lato client, debugger. Vanno in BL successive.

## Note architetturali — IDE remoto + runtime autonomo + kiosk (analisi sessione 2026-05-18)

Analisi completa delle implicazioni dei 4 punti operativi desiderati. Piano in `.claude/plans/rivediamo-la-logica-di-encapsulated-scone.md`.

### Baseline attuale identificata
- Runtime espone solo REST + WS, zero file statici. La SPA viene servita dall'editor container (Nginx).
- IDE e runtime sono sempre co-locati (stessa macchina / stessa compose). Nessuna connessione remota possibile senza modifiche.
- Nessun supporto kiosk/Wayland.

### ARCH-001 — Runtime serve la SPA direttamente (`--www <path>`) — ✅ DONE (2026-05-18)
> **Obiettivo**: un browser può connettersi al solo runtime (senza il container editor) su `https://<device>:8443`.
> **Opzione scelta**: `tower_http::ServeDir` + CLI arg `--www`; nessun embedding nel binario.
- [x] `sws-runtime/crates/sws-web/src/router.rs`: `app.fallback_service(ServeDir::new(dir).not_found_service(ServeFile::new(index)))` quando `--www` è impostato
- [x] `sws-runtime/crates/sws-runtime/src/main.rs`: CLI arg `--www <path>` + log line + passaggio a `router::build`
- [x] `compose.yaml`: variante single-container commentata (4 righe `command:` + 4 volumes alternativi)
- [x] `sws-runtime/docker/Dockerfile`: invariato (volume è esterno)
- [x] `scripts/dev.sh`: invariato (la SPA continua a girare via Vite dev server in modalità `both`; variante single-container documentata in DEPLOY_PX30)
- [x] `docs/DEPLOY_PX30.md`: nuova sezione "4b. Alternative: single-container deployment"
- [x] `cargo check --workspace` verde; tutti i 36+ test verdi

### ARCH-002 — IDE con runtime URL configurabile (`VITE_RUNTIME_URL`) — ✅ DONE (2026-05-18)
> **Obiettivo**: `VITE_RUNTIME_URL=https://192.168.1.50:8443 ./scripts/dev.sh editor` fa parlare l'IDE con il PX30 remoto.
- [x] `sws-editor/vite.config.ts`: `RUNTIME_TARGET = process.env.VITE_RUNTIME_URL ?? "https://localhost:8443"`, `WS_TARGET` derivato via `replace(/^http/, "ws")` per `/api` e `/ws` proxy
- [x] `sws-editor/src/api/client.ts`: già esistente — usa `BASE_URL = import.meta.env.VITE_RUNTIME_URL ?? ""` come prefisso di `fetch()`
- [x] `sws-editor/src/ws/wsUrl.ts`: nuovo helper condiviso che deriva da `VITE_RUNTIME_URL` con scheme-swap, fallback su `window.location`. Override per-stream (`VITE_RUNTIME_WS_URL` etc.) come `overrideEnvKey` opzionale
- [x] `ws/tagStream.ts`, `ws/alarmStream.ts`, `ws/logStream.ts`: refattorizzati per chiamare `buildWsUrl(path, overrideKey)` — niente più duplicazione
- [x] `scripts/dev.sh`: header commento aggiornato con esempio `VITE_RUNTIME_URL=https://px30.local:8443 ./scripts/dev.sh editor` (Vite eredita env automaticamente)
- [x] `scripts/README.md`: nuova sezione "Pointing the editor at a remote runtime"
- [x] `pnpm type-check` + `pnpm build` verdi

### ARCH-003 — Kiosk mode (`--kiosk-browser <cmd>`) — ✅ DONE (2026-05-18)
> **Obiettivo**: sul PX30, all'avvio del runtime, il browser parte in kiosk senza intervento utente.
- [x] `sws-runtime/crates/sws-runtime/src/main.rs`: CLI arg `--kiosk-browser <shell-cmd>` (opzionale)
- [x] Dopo `/health` OK (poll reqwest con `danger_accept_invalid_certs(true)`, 50×100ms), spawn `tokio::process::Command::new("sh").arg("-c").arg(cmd).spawn()`
- [x] Child fire-and-forget (no monitor, no restart, no kill on runtime exit); morte del child non ferma il runtime
- [x] Log: `info!(kiosk = %cmd, "kiosk: spawning browser")` + warn su spawn failure o /health timeout
- [x] `sws-runtime/docker/entrypoint.sh`: commento con esempi (chromium / epiphany / firefox / cage)
- [x] `docs/DEPLOY_PX30.md` §4c: sezione "Kiosk mode (unattended boot)" con pacchetti Debian arm64 + Wayland kiosk option
- [x] `cargo check --workspace` + `cargo test --workspace` verdi
- [ ] Test sul PX30 reale — manuale, da fare dal maintainer (sessione S-25)

### ARCH-004 — Multi-runtime WelcomeScreen — ✅ DONE (2026-05-19)
> **Obiettivo**: stessa SPA bundle può puntare a qualsiasi runtime senza rebuild.
- [x] `WelcomeScreen`: footer cliccabile + `RemoteRuntimeModal` con URL input + bottone "Test" che chiama `GET <url>/health` + bottone "Connetti" abilitato solo dopo test OK
- [x] Persistenza in `localStorage["sws.runtimeBaseUrl"]`; `window.location.reload()` su connect/disconnect per reset pulito di auth + project state + WS
- [x] `api/client.ts`: `getBaseUrl()` legge localStorage > `VITE_RUNTIME_URL` > "" (same-origin). Esporta `getRuntimeBaseUrl`/`setRuntimeBaseUrl`. Tutti i call site di `BASE_URL` aggiornati.
- [x] `ws/wsUrl.ts`: stesso resolver per le WS (swap http→ws automatico)
- [x] Badge runtime remoto nell'header App.tsx (pillola `📡 host:port`); click → confirm + disconnetti
- [x] **CORS** in `sws-web/router.rs`: `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` come outermost layer. Necessario per cross-origin laptop→PX30.
- [x] `cargo check` + `cargo test --workspace` + `pnpm type-check` + `pnpm build` verdi
- Gotcha documentato nel modal: certificato self-signed va accettato in tab separata prima del primo connect (browser blocca fetch silenziosamente con "Failed to fetch")

### Sequenza raccomandata
| Sessione | Durata | Contenuto |
|---|---|---|
| **S-21** | ~3 h | ARCH-002 (30 min) + ARCH-001 (2 h) + test locale |
| **S-22** | ~2 h | ARCH-003 (1 h) + test su PX30 hardware |
| **S-23** | ~4 h | ARCH-004 (se S-21/22 stabili) |

---


### Bug aperti / da verificare a mano
- ✅ **Rinomina pagina lascia dietro il vecchio file** — risolto: `save_synoptic` ora rimuove i `.yaml` stale con lo stesso `id` interno ma filename diverso. (commit `ff32e40`)
- Nessun altro noto al momento del commit. La fix del 404 utenti (`e4a61f5`) è stata validata via curl + via UI in Configurazione → Utenti.
- Da verificare a freddo: `rm -rf .run/project && ./scripts/dev.sh` deve seedare `examples/demo/` (test non eseguito per via del permission gate su `rm -rf`, ma il codice è una `if [ ! -f ... ]; then cp -r ...; fi` lineare).
- Da verificare al prossimo restart dev.sh: il writer log JSONL crea effettivamente `.run/logs/runtime-YYYY-MM-DD.jsonl` (unit test passano, ma il path live va confermato a vista). Test manuale di retention: `touch -d '2020-01-01' .run/logs/runtime-2020-01-01.jsonl; ./scripts/dev.sh` → file rimosso da `prune_old`.

## Blockers / questions for the maintainer

- See `docs/OPEN_QUESTIONS.md` Q1 (Python embedding), Q2 (Sparkplug B), Q4 (state management) — all using defaults, revisit when their phase begins.

## Notes

- PyO3 was bumped from 0.21 (spec) to 0.23 because the system Python is 3.13 — recorded in CHANGELOG under `[Unreleased]`.
- `axum-server 0.6.0` was removed from the dependency list due to a hyper-util compatibility bug at the time of bootstrap; replaced with a direct `tokio-rustls + hyper-util` accept loop in `sws-runtime/src/main.rs`. Revisit if axum-server publishes a fix.
- `async-opcua` version corrected from spec's `0.12` (which doesn't exist on crates.io) to actual latest `0.18`.
- `pnpm` is installed in `~/.local/bin/pnpm` on the maintainer's machine (npm global prefix). The `.claude/settings.json` allow list covers both `pnpm *` and `~/.local/bin/pnpm *` to match either invocation.
- React 19 + Vite 6 + Vitest 3 + i18next 24 — all current stable as of bootstrap.
- `tsconfig.json` uses `skipLibCheck: true` because `react-i18next@15` ships with broken type declarations referencing nonexistent i18next exports. This is a known upstream issue; our own code remains strictly type-checked.
- `TagQuality` / `TagValue` in `sws-plugin-api` are `#[repr(C)]` FFI types (flat, f64-only). The types in `sws-core` are idiomatic Rust enums — separate concerns, no conflict.
