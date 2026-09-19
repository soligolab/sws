# L'immagine di boot del pannello: disegnarla nell'IDE, e installarla al deploy

> **Come si legge questo piano.** Nasce dalla scheda Q13 di `docs/OPEN_QUESTIONS.md`, spostata
> qui il 18-09-2026 come seme. **Lo stesso giorno, in una sessione di plan col maintainer, il seme
> è diventato un piano d'esecuzione**: §1 misura il codice, §2 fissa il design, §3 spezza il lavoro
> in fasi da una sessione ciascuna. Le **note D-Bus del maintainer** sul launcher Pixsys stanno in
> Appendice A e **vanno lette prima di scrivere lo script**: contengono una trappola che non si vede
> provando. La scheda Q13 originale è in Appendice B, integrale.
>
> **Stato**: **T-72 chiuso il 19-09-2026** (F1-F6, sul codice e sulla documentazione). Questo piano resta come referto:
> dice perché le cose sono fatte come sono fatte. Il «non fatto» è in `docs/plans/2026-09-19-*` (sette semi).

## Contesto

Il seme chiedeva tre cose: *cos'è una pagina statica*, *chi rasterizza*, *dove sta il pezzo D-Bus*.
Il 18-09 il maintainer ha aggiunto quattro requisiti che le rispondono in parte e ne aprono di
nuove:

1. L'immagine di boot **è un tipo di pagina** dell'IDE. Non viene mostrata dal pannello: al più
   viaggia col progetto e viene installata via D-Bus se il dispositivo espone la chiamata.
2. Le pagine di boot possono essere **più d'una**, ma **una sola è «abilitata»**: quella deployata.
3. Il **progetto vuoto nasce con una pagina di boot e una pagina sinottica** vuota.
4. **La prima delle due che viene modificata definisce lo stile** (dimensioni e impostazioni
   grafiche) delle pagine generate dopo.

Decisioni prese dal maintainer nella sessione di plan (18-09-2026):

| Tema | Decisione |
|---|---|
| Regola «prima modificata» | **Default di progetto visibile** in Impostazioni pagine, riempito automaticamente alla prima impostazione esplicita, modificabile a mano |
| Oggetti ammessi su una pagina di boot | **Solo vettoriali statici** (forme, tubo, testo senza a-capo, immagine, simbolo). Widget «congelati» rimandati |
| Deploy senza pagina abilitata | **Non tocca nulla**. `ResetBackgroundImage` sarà un'azione esplicita futura |
| Quando si produce il PNG | **Al salvataggio**, nel browser, con anteprima e «Scarica PNG» |
| `/run/media` non scrivibile da `user` | **Ripiego sul path assoluto**, con stato `percorso=assoluto` visibile nell'IDE |
| Striscia di tab sopra il canvas | **Solo pagine sinottiche**; le pagine di boot vivono nell'elenco del pannello sinistro |
| Progetti da template | **Ricevono anche loro** una pagina di boot vuota alla creazione |
| Fase F0 (questo documento) | Fatta subito, come meta commit su `main` |

---

## 1. Cosa dice il codice oggi (misurato il 18-09-2026)

Fatti che vincolano il design. I numeri di riga sono quelli di quel giorno.

**Modello pagina.** `SynopticPage` è specchiata in tre posti: TS `sws-editor/src/types/index.ts:784`,
Rust `sws-web/src/synoptic.rs:8` (un campo assente qui **si perde in silenzio** al round-trip,
commento a `synoptic.rs:31-41`), e `synoptic_schema.rs:268` (`PAGE_FIELDS`, **generato** da
`scripts/gen_synoptic_schema.py`, guardato da `check_synoptic_schema.sh`; `validate.rs:122` rifiuta
i campi fuori elenco). Il modello LVGL `sws-lvgl-viewer/src/model.rs:42` è più stretto, tollera i
campi sconosciuti, e la parity check confronta solo `SynopticObject`. **Non esiste alcun `kind` di
pagina**: sinottico/griglia/faceplate sono tipi di *oggetto*; faceplate e ricette sono documenti a
sé con directory propria (`faceplates/`, `recipes/`) — il precedente giusto.

**Disco.** Una pagina = un YAML in `synoptics/`, senza indice: l'elenco è la directory
(`router.rs:4509`, `list_synoptics`), l'ordine è alfabetico e **non è persistito**.
`DESIGN_ARTIFACTS = ["project.yaml","synoptics","images"]` (`projects.rs:983`) decide cosa il
deploy cancella. Il bundle ZIP (`router.rs:3871`) porta `project.yaml`, `synoptics/`,
`faceplates/`, `recipes/`, `images/`, `users.yaml`.

**Flag di pagina.** «Pagina iniziale» è un puntatore **di progetto** (`page_layout.home_page_id`,
`project.rs:1242`) mostrato come badge 🏠 nell'elenco (`LeftPanel.tsx:316`): unicità gratis. Per
pagina esistono `auto_rotate_skip`, `zones`, `locked`.

**Formato pagina.** `PageLayoutConfig { size_mode, aspect_ratio, home_page_id, hide_viewer_chrome }`.
Una pagina nuova nasce **senza** `width/height` (`makePage`, `store/index.ts:118`) tranne in modalità
`ratio`, dove Q38 materializza la risoluzione di riferimento (`addPage` :947,
`useMaterializzaRatio` `EditorShell.tsx:1907`). Non esiste tema, font o stile di progetto: il tema
chiaro/scuro è preferenza del browser, il branding è per installazione, i default dei widget sono
letterali in `handleAddObject`.

**Progetto vuoto.** `create_project` (`projects.rs:463-505`) scrive **solo** `project.yaml`, zero
pagine; è l'editor a inventare «Page 1» al volo. Il ramo template copia la cartella intera e
bypassa qualunque seeding.

**Editor.** Palette già filtrata per contesto (`paletteForTarget`, `LeftPanel.tsx:659`); sezioni del
pannello proprietà spente per gruppo (`CollapsibleSection` `gruppo`, `EditorShell.tsx:1549`) e per
tipo (43 `obj.type ===` inline); `<fieldset disabled>` di pagina per `locked`. `PageTabs` e
`PagesSection` **non condividono** il renderer di riga. Circa 30 punti iterano `pages` per
navigazione (elenco in §4.3).

**Rasterizzazione.** Il canvas è **un solo `<svg>`** con `viewBox` (`SvgCanvas.tsx:1570`). Ma metà
della palette è `<foreignObject>` o `<canvas>` (testo con `text_wrap`, slider, setpoint, checkbox,
radio, tabella, trend, text_list, data_log, kpi_tile, sparkline, allarmi, ricette) e le immagini
sono `<image href="/api/project/images/…">` esterne. Lato Rust `resvg` è compilato **senza il
feature text** (`svg_raster.rs:224`) e `istantanea.rs` fotografa con **LVGL**, non col web: nessuno
dei due può fare da esportatore fedele. Nessun rasterizzatore SVG→PNG esiste nell'editor.

**Deploy e dispositivo.** Il deploy è: ZIP → `POST /api/projects/upload` → `open_project` →
`signal_project_changed` → `display_target::publish` (spawnato, scrive
`<config_dir>/display-target` **solo se cambiato**). Sul dispositivo `config_dir` è
`/data/user/sws/config`, la stessa directory che `sws-display.path` osserva
(`PathChanged=…/display-target`) per far partire `sws-display-apply.sh` come utente `user`
(non sudoer). Quello script **finisce sempre riavviando viewer o browser**: riusarlo per lo splash
farebbe sfarfallare lo schermo a ogni deploy. `busctl` è già usato con gate «non è un Pixsys → salto»
in `install-container.sh:588` e `sws-display-apply.sh:75`. **Nessun canale host→runtime** esiste.
Il runtime non sa di essere su un Pixsys; `os_id=pixsys` passa solo nella sonda SSH pre-install.

**Limite body.** axum 0.7 senza `DefaultBodyLimit`: il default di **2 MiB** vale per ogni
estrattore `Bytes`, quindi `upload_project_image` (cap dichiarato 5 MiB, `router.rs:4853`) e
`upload_project_zip` rifiutano già oggi corpi oltre 2 MiB. Nessun test o esempio lo esercita.
Un PNG 1920×1080 con sfumature li supera facilmente.

**`/run/media`.** L'Appendice A raccomanda «copia sotto `/run/media` e passa il path relativo»,
ma **non c'è nessuna evidenza che `user` possa scrivere lì**. Da verificare sul WP630 prima di
scrivere lo script (F5).

---

## 2. Design

### 2.1 La pagina di boot è una pagina nell'IDE, un documento a sé sul disco

- **In memoria (editor)**: un solo array `pages`, con `kind?: "boot"` su `SynopticPage`. Il canvas,
  gli oggetti, undo, duplica, rinomina funzionano senza toccare niente.
- **Su disco**: `boot/<nome>.yaml` (stesso YAML di una pagina, con `kind: boot`) e accanto
  `boot/<nome>.png` (l'immagine rasterizzata). Il runtime, il viewer web, il kiosk e il viewer LVGL
  leggono solo `synoptics/`: **non vedono mai** le pagine di boot. Niente filtri nel runtime,
  niente parity LVGL, niente rischio che «Boot» ordinato prima di «Page 1» detti la risoluzione al
  viewer LVGL (`model.rs:35`).
- `kind` entra nella struct Rust (`Option<String>`, serializzato solo se presente) e si rigenera
  `PAGE_FIELDS`: così il YAML è autodescrittivo e l'import di una singola pagina sa dove metterla.
  `save_synoptic` **rifiuta** `kind: boot`, gli endpoint boot lo **richiedono**.
- Endpoint nuovi (modulo `sws-web/src/boot.rs`, clonati da `list/get/save/delete_synoptic`):
  `GET/PUT/DELETE /api/boot-pages[/:name]`, `GET/PUT /api/boot-pages/:name/png`,
  `POST /api/boot-pages/import`. Montati sul router IDE; sul dispositivo bastano upload e ZIP.
- `DESIGN_ARTIFACTS` += `"boot"`; `build_export_zip` += `boot/*.yaml` e `boot/*.png`; backup
  (`BACKED_UP`) idem; il fingerprint di progetto (`router.rs:6481`) include `boot/` così una modifica
  allo splash marca il deploy come non aggiornato.
- Validatore: per `kind: boot` i tipi oggetto devono stare in `BOOT_TYPES` (§2.4); un campo `tag`
  è un *warning*, non un errore.

### 2.2 «Abilitata» è un puntatore di progetto

`page_layout.boot_page_id: Option<String>`, gemello di `home_page_id`: una sola pagina per
costruzione, salvato dallo stesso `PUT /api/project/page-layout` (nessun endpoint nuovo, nessun
ritocco a `PATH_VERSIONATI`). Nell'elenco pagine la riga di boot ha un radio «abilitata» (badge ⭐,
stesso meccanismo del 🏠). Eliminare la pagina abilitata azzera il puntatore e cancella il PNG.
Se il puntatore indica una pagina che non esiste più, il deploy non installa nulla.

### 2.3 Formato predefinito di progetto (la regola «prima modificata»)

`PageLayoutConfig` guadagna `default_width`, `default_height`, `default_background`,
`default_background_dark` (tutti opzionali). Regole:

1. **Nuova pagina** (sinottica o di boot) nasce con i valori del default, se presenti. In modalità
   `ratio` continua a valere Q38 (risoluzione di riferimento); in `fluid` si copia solo lo sfondo.
2. **Prima impostazione esplicita**: quando l'utente imposta dimensioni o sfondo su una pagina e il
   default corrispondente è vuoto, l'editor lo riempie con quel valore **e lo materializza subito
   sulle pagine che non hanno un valore proprio** (tipicamente l'altra pagina nata col progetto).
   Questo è, letteralmente, «la prima modificata definisce lo stile dell'altra».
3. **Modifica successiva del default** (in Impostazioni pagine): non tocca le pagine esistenti;
   un pulsante «Applica alle pagine senza formato proprio» lo fa su richiesta, come fa già
   `useMaterializzaRatio` per Q38.
4. Il pannello pagina mostra «1280×800 — predefinito di progetto» finché il valore non è
   sovrascritto a mano.

Perché **materializzare** invece di risolvere al volo: il viewer LVGL legge `width/height` dalla
pagina, non dal progetto. Se le pagine «intonse» restassero senza valore, web e LVGL divergerebbero
— proprio la regola WYSIWYG-su-entrambi che vogliamo tenere. Con la materializzazione le pagine
salvate hanno sempre valori espliciti e il runtime resta intatto.

Le pagine di boot hanno **sempre** `width/height` espliciti (= risoluzione del PNG): default di
progetto se c'è, altrimenti 1280×800 (`ASPECT_RATIOS[0]`), indipendentemente da `size_mode`. Solo
`background` conta (il PNG è uno): `background_dark` è nascosto per le pagine di boot.

### 2.4 Palette e pannello proprietà per una pagina di boot

- `BOOT_TYPES` (allowlist, in `LeftPanel.tsx` accanto a `LVGL_SUPPORTED_TYPES`): `rect`, `ellipse`,
  `line`, `pipe`, `text`, `image`, `symbol`, più i poligoni se il tipo esiste nell'unione
  `SynopticObjectType`. Da confermare tipo per tipo in F2. Regole: `text` senza `text_wrap` (che è
  `<foreignObject>`); `symbol` builtin inline sempre, custom solo se l'SVG viene incorporato;
  `image` incorporata come data URI.
- `paletteForPage(kind, isLvgl)` estende `paletteForTarget`: i gruppi svuotati scompaiono, un hint
  spiega «pagina di boot: solo oggetti statici». `addObject` e incolla rifiutano i tipi fuori
  allowlist con un avviso.
- Pannello proprietà: `gruppiPerTipo` prende anche il `kind` di pagina → per il boot restano
  `oggetto`, `testo`, `resa`; le sezioni Tag/Qualità/Azioni/Comportamento fanno `return null`
  quando `paginaBoot`. Il test d'inventario `tests/pannelloProprieta.test.tsx` guadagna il caso
  «pagina di boot».
- `PageProps` per il boot: nome, radio «Immagine di boot abilitata», **Risoluzione** (preset
  dispositivo + larghezza/altezza, sempre editabile), sfondo, **anteprima del PNG** (con
  cache-bust), «Scarica PNG», «Rigenera PNG». Nascosti: `background_dark`, `zones`,
  `auto_rotate_skip`. `locked` resta.
- **Elenco pagine** (`PagesSection`): sezione «Immagini di boot» sotto le pagine, con icona 🖼,
  radio ⭐ e pulsante «+ Nuova immagine di boot». **`PageTabs` non mostra le pagine di boot**
  (decisione del maintainer): la striscia elenca solo ciò che il pannello mostrerà; la pagina di
  boot si apre dall'elenco a sinistra e resta la pagina corrente finché non se ne sceglie un'altra.

### 2.5 Rasterizzazione nel browser, al salvataggio

Nuovo `sws-editor/src/boot/rasterizza.ts`:

1. Monta un `<SvgCanvas>` in modalità viewer (senza `onMove`), `previewEffects=false`, in un
   contenitore staccato, alla scala 1:1 della pagina; attende il caricamento delle immagini.
2. Clona l'`<svg>`, fissa `width`/`height`, **incorpora** ogni `<image href>` (fetch con credenziali →
   data URI) e sostituisce ogni `var(--brand-*)` col valore calcolato del tema chiaro (in un SVG
   caricato via `<img>` le risorse esterne sono bloccate e le variabili CSS valgono il fallback).
3. `XMLSerializer` → blob → `Image` → `<canvas>` a `devicePixelRatio` 1 → `toBlob("image/png")`.
4. `saveAll`: per ogni pagina di boot sporca, `PUT` del YAML poi del PNG. Un errore di
   rasterizzazione **non blocca** il salvataggio del YAML: compare come avviso «PNG non aggiornato».
5. Se il PNG supera i 5 MiB, avviso e nessun upload.

Le funzioni pure (incorporamento href, sostituzione `var()`) hanno unit test; la resa si verifica a
mano confrontando anteprima e canvas. Vincoli da documentare: i font sono quelli della macchina che
esporta; niente `text_wrap`.

### 2.6 Dispositivo: canale file + unità dedicate, nessun riavvio

Si copia il meccanismo `display-target` **senza riusarne lo script**:

- Runtime: `sws-web/src/boot_image.rs::publish(config_dir, project_dir)`, chiamato accanto a
  `display_target::publish` in `signal_project_changed` e all'avvio (`main.rs:1024`). Se
  `boot_page_id` punta a una pagina con PNG: copia il PNG in `<config_dir>/boot-image/boot.png` e
  scrive il trigger `<config_dir>/boot-image` con lo SHA-256 del file. Altrimenti scrive `none`.
  Idempotente: riscrive solo se il contenuto cambia.
- Host (`deploy/container/`): `sws-boot-image.path` (`PathChanged=/data/user/sws/config/boot-image`),
  `sws-boot-image.service` (oneshot) e `sws-boot-image-apply.sh`, aggiunti a `DISPLAY_UNITS` in
  `install-container.sh` e agli `include_str!` di `packaging.rs:814` (col test di identità byte).
  Lo script: gate `command -v busctl` + sonda **in lettura** `GetBackgroundImage` (come
  `politica_browser_disponibile`); se il trigger è `none` → stato `nessuna_immagine`, esce; se lo
  SHA coincide con `.applied` → esce; prova la via **relativa** (`mkdir -p /run/media/sws-boot`,
  `cp`, `SetBackgroundImage s "sws-boot/boot.png"`); se non può scrivere lì, **ripiega sulla via
  assoluta** (`/data/user/sws/config/boot-image/boot.png`) segnando `percorso=assoluto` nello stato
  — decisione del maintainer: lo splash si installa comunque, e l'IDE dice che si appoggia a un
  comportamento non documentato (Appendice A). Verifica con `GetBackgroundImage`; **non riavvia**
  `pixsys-launcher` (l'immagine compare al prossimo avvio del pannello, e lo stato lo dice).
  Supporta `--dry-run` come lo script gemello.
- Stato di ritorno: lo script scrive `<config_dir>/boot-image.status` (`esito=installato|
  non_supportato|nessuna_immagine|errore`, `sha256=`, `quando=`, `percorso=relativo|assoluto`,
  `messaggio=`). È il **primo file scritto dall'host che il runtime legge**: `get_system_status` lo
  espone come `boot_image: Option<…>` (assente = nessun dato, mai un errore), e la scheda Runtime
  dell'IDE lo mostra dopo la connessione: «Immagine di boot: installata il … (path assoluto) /
  non supportata su questo dispositivo / errore: …».
- I dispositivi già installati ricevono le unità nuove solo rieseguendo `install-container.sh`.
  Funziona **solo nel deploy a container**; il percorso `deploy/yocto/` non ha il canale e resta
  fuori, dichiarato nei docs.

### 2.7 Progetto vuoto e template

`create_project`, dopo **entrambi** i rami (vuoto e template): se manca `boot/`, scrive
`boot/Immagine di boot.yaml` (`kind: boot`, 1280×800, sfondo neutro); nel ramo vuoto scrive anche
`synoptics/Page 1.yaml`. I template nel repo restano com'erano e `check_templates.sh` continua a
guardare solo `synoptics/`: è il seeding a runtime a coprirli. Il default di progetto resta
**vuoto** alla nascita: lo riempie la prima modifica (§2.3).

### 2.8 Migliorie oltre la richiesta

1. **Limite body**: `DefaultBodyLimit::max(8 MiB)` sulle rotte di upload (immagini, PNG di boot,
   ZIP) su **entrambi** i router, con un test che invia 3 MiB. Oggi è un difetto latente del deploy.
2. **Preset Pixsys**: aggiungere a `public/branding/pixsys/brand.json` le risoluzioni della tabella
   di `BRAND_SWS.md` che mancano (480×272, 800×480, 1280×768, 1366×768), dopo conferma sul catalogo.
3. **Sonda dispositivo**: `sonda-dispositivo.sh` riporta `ls -ld /run/media` e la presenza di
   `net.pixsys.Config1.Launcher`, così l'IDE sa *prima* dell'installazione se lo splash sarà gestito.
4. **Ripristino di fabbrica** come azione esplicita nella scheda Runtime (fase futura, non ora).
5. `docs/branding/boot-backgrounds/README.md` e `BRAND_SWS.md` vanno aggiornati: il meccanismo
   che dicevano inesistente ora esiste (per il launcher; l'OS-level resta aperto).

---

## 3. Fasi d'esecuzione (un ramo per fase, una sessione ciascuna)

Ogni fase segue il ciclo per task di `CLAUDE.md`: ramo da `main`, definition of done, squash
merge, cancellazione del ramo.

| Fase | Contenuto | Verifica |
|---|---|---|
| **F0 — fatta il 18-09** | Questo documento; riga README, STATUS, CHANGELOG; meta commit su `main` | `check_static.sh` (check_documenti) |
| **F1 — modello e server** | `kind` su `SynopticPage` (TS+Rust) e rigenerazione schema; `boot.rs` con CRUD + PNG + import; `DESIGN_ARTIFACTS`, ZIP, backup, fingerprint; seeding in `create_project` (entrambi i rami); `DefaultBodyLimit` | test Rust: CRUD boot, `save_synoptic` rifiuta `kind: boot`, deploy `preserve_state` cancella `boot/` stantio, progetto vuoto ha due pagine e progetto da template ha `boot/`, upload 3 MiB passa; `check_synoptic_schema.sh` verde |
| **F2 — editor: pagine di boot** | store (`kind`, `saveAll` per kind, `persistedPageKeys` per `(kind,nome)`, `deletePage` conta solo sinottiche, `paginePerNavigazione`); elenco pagine con sezione «Immagini di boot», radio abilitata, `+ Nuova immagine di boot`; `PageTabs` filtra le boot; `PageProps` boot; `paletteForPage` + `BOOT_TYPES`; gating pannello oggetti; filtri nei punti di §4.3; i18n it/en | vitest: store, `pageLayout`, `pannelloProprieta` con caso boot; `pnpm build`; prova manuale: la pagina di boot non compare nel viewer 8443, nel kiosk né nelle tab |
| **F3 — formato di progetto** | `default_*` in `PageLayoutConfig` (TS+Rust); regola prima impostazione + materializzazione; pulsante «Applica»; `addPage`/nuova boot leggono il default; UI in Impostazioni pagine | vitest sulle regole pure; manuale: progetto vuoto → imposto 1024×600 su Page 1 → la pagina di boot la eredita; il contrario idem |
| **F4 — rasterizzazione** | `rasterizza.ts`; upload al salvataggio; anteprima, «Scarica PNG», «Rigenera»; avviso su fallimento e su >5 MiB | unit test delle funzioni pure; manuale: PNG aperto a fianco del canvas, immagine e simbolo custom presenti, colori del tema chiaro |
| **F5 — dispositivo** | **Prima**: sonda sul WP630 (chiedere prima di SSH) per `/run/media`, versione PixsysOS, `GetBackgroundImage`. Poi `boot_image.rs::publish`, tre unità + script, `install-container.sh`, `packaging.rs`, stato in `/api/system`, riga nella scheda Runtime; `check_systemd_units.sh` verde | sul WP630: deploy → `GetBackgroundImage` = `boot.png`, file in `/etc/pixsys/pixsys-launcher/assets/`, riavvio → splash nuovo; deploy senza abilitata → nessuna chiamata; PC senza busctl → stato `non_supportato` |
| **F6 — docs e code** | HOWTO capitolo «Immagine di boot»; manuale 04 sezione «Immagini di boot»; TEST_SETUPS (launcher, esito `/run/media`); BRAND_SWS + README boot-backgrounds; preset Pixsys; aggiornamento sonda | `check_static.sh`; lettura del maintainer |

Dipendenze: F2 usa 1280×800 fisso finché F3 non arriva; F4 richiede F2; F5 richiede F1 e F4
(serve un PNG da installare). F3 è indipendente e può anticipare F2 se conviene.

---

### F1 — nota di esecuzione (19-09-2026)

Fatta come da piano, con due scarti. **(1)** La logica su disco sta in funzioni di `boot.rs` che
prendono la cartella del progetto (`salva`, `elimina`, `scrivi_png`, `semina`, `sincronizza_da_zip`…): gli
handler sono sottili, e i test usano una cartella temporanea invece di uno `AppState`, che nel repo
non ha un'infrastruttura di test HTTP. **(2)** Il test del limite di corpo apre una vera porta locale e
manda 3 MiB: senza il layer il server li rifiuta (è il difetto), con il layer passano. Provato dal vivo su
un'istanza di scarto: progetto vuoto → `boot/Immagine di boot.yaml` + `synoptics/Page 1.yaml`; da
template → solo la pagina di boot, le pagine del template intatte; PNG da 3 MiB caricato e riscaricato;
PNG non valido → 400; `save_synoptic` con `kind: boot` → 400; lo ZIP di export porta `boot/`.

### F2 — nota di esecuzione (19-09-2026)

Fatta come da piano, con questi scarti: **(1)** `boot_page_id` (§2.2) è entrato qui e non in F1 — il modello
Rust lo richiedeva solo ora — e il salvataggio delle Impostazioni pagine lo **conserva** (senza, ogni
salvataggio lo avrebbe azzerato). **(2)** Le pagine di boot stanno sempre **in coda** all'array `pages`
(`sinotticiPoiBoot`): gli indici dell'elenco sinottici restano quelli dell'array. **(3)** `BOOT_TYPES` è
controllato anche dal server al salvataggio (`TipoNonAmmesso` → 400), non solo dalla palette. **(4)** Le
pagine si caricano con `api.loadAllPages()` (sinottici + boot): tre punti di caricamento passano da lì.
**(5)** `impostaBootAbilitata` scrive `project.yaml` fuori da «Salva»: emette `sws:project-switched` per
rifissare la baseline del watcher, o compariva «il progetto sul runtime è cambiato». Provata dal vivo in
un browser headless su un'istanza di scarto: sezione, creazione, palette ridotta (Forme: rettangolo,
ellisse, linea, testo, immagine + Scada), abilitazione (radio e interruttore d'accordo, `boot_page_id`
sul disco), niente tab per le pagine di boot, «Salva» che scrive `boot/`.
**Non fatto, per piano**: PNG (F4), formato di default di progetto (F3). La `guardia` di
`check_versione_progetto.sh` ora capisce le famiglie di rotte con il trattino.

### F3 — nota di esecuzione (19-09-2026)

Regole pure in `formatoProgetto.ts`, azioni in `formatoProgettoAzioni.ts`. Due scelte: **(1)** la pagina di
boot con cui nasce un progetto è già a 1280×800 (§2.7), quindi non ha «nessun valore»: per far funzionare la
regola fra le due pagine iniziali una pagina di boot **ancora ai valori di nascita** conta come «senza formato
proprio» — caso limite dichiarato: una boot lasciata di proposito a 1280×800 prende il predefinito la
prima volta. **(2)** Il predefinito va nello store subito e sul server dopo, così una seconda modifica
prima della risposta non rifà la «prima impostazione». Provata dal vivo: 1024×600 su Page 1 → la pagina di
boot le eredita, `default_*` in `project.yaml`, nota «predefinito di progetto» nel pannello.

### F4 — nota di esecuzione (19-09-2026)

`boot/rasterizza.ts`: monta `SvgCanvas` in un contenitore fuori schermo, clona l'`<svg>`, incorpora le immagini,
sostituisce le variabili, disegna in un `<canvas>` e `toBlob`. Scarti dal piano: **(1)** le `var(--brand-*)`
prendono il valore calcolato dall'app, altrimenti il **fallback scritto accanto** (non il tema chiaro: non c'è un
modo economico di calcolarlo, e il fallback è stabile); **(2)** lo sfondo della pagina si dipinge sul `<canvas>`
sotto l'SVG, perché un `background` sull'`<svg>` radice non è affidabile fra browser; **(3)** senza un
`font-family` esplicito il testo usciva in serif (un SVG staccato non eredita il font dell'app): il nodo radice
porta uno stack sans. Il PNG si rifà solo se la pagina è cambiata dall'ultimo (firma della pagina nello store);
c'è un tetto di 15 s sul caricamento dell'SVG, o «Salva» resterebbe in sospeso. Provata dal vivo in Chromium
headless su un'istanza di scarto: rettangolo con bordo, testo, immagine di progetto e simbolo tutti nel PNG
1280×800; «Salva» dopo aver cambiato lo sfondo rigenera il PNG.

### F5 — la sonda sul dispositivo (19-09-2026, `tc620-a-p3-c6-07aff9`, PixsysOS 2.1.1, appena formattato)

Fatta come `user` (l'utente con cui girano il runtime e lo script host), solo con `busctl` e letture, più una
prova di scrittura **reversibile** (`SetBackgroundImage` poi `ResetBackgroundImage`). Risultati:

| Domanda | Esito |
|---|---|
| `user` può scrivere sotto `/run/media`? | **No.** `drwxr-xr-x root root`, tmpfs vuota. La via «copia sotto `/run/media` e passa il path relativo» **non è percorribile** senza root: resta il **ripiego sul path assoluto**, come deciso il 18-09. |
| `user` può invocare `SetBackgroundImage` con un path assoluto? | **Sì**, nessun polkit, esito 0. `GetBackgroundImage` restituisce **solo il nome del file** (`sws-probe.png`). |
| Dove finisce il file? | Copiato in `/etc/pixsys/pixsys-launcher/assets/<nome originale>`; `pixsys-launcher.toml` → `[customization] background_image_path = "/etc/pixsys/pixsys-launcher/assets/<nome>"`. **Il nome è quello del file sorgente**: per avere `boot.png` va copiato con quel nome. |
| `ResetBackgroundImage`? | Funziona, riporta `"Default"` e **toglie** il file da `assets/`. Il dispositivo è tornato com'era. |
| Chi serve `net.pixsys.Config1`? | **`wp-config.service`** (root), non `pixsys-launcher`. Il launcher gira a `sysinit`, non compare fra le unità attive. Dal bus si vedono `Launcher`, `USBDrives`, `WebBrowser/MainApp`, `Display`, `FactoryReset`. |
| Effetto immediato? | No: il launcher legge il TOML all'avvio (già noto). Non provato al reboot. |

Conseguenza per lo script (F5): niente `mkdir /run/media/…` — si copia il PNG in una cartella scrivibile da `user`
(`<config_dir>/boot-image/boot.png`, come nel piano §2.6) e si passa **il path assoluto**, con `percorso=assoluto`
nello stato. Il ripiego diventa il caso normale, non l'eccezione: la sonda relativa si può togliere.

### F5 — nota di esecuzione (19-09-2026)

**Scarto dal piano §2.6**: il trigger e la cartella non possono chiamarsi entrambi `boot-image`. Ora è una
cartella `boot-image/` con `boot.png`, `trigger` e `status`; la `.path` osserva `boot-image/trigger`. Il resto come
da piano: `boot_image.rs::publish` accanto a `display_target::publish` (apertura, segnali di progetto,
all'avvio) **e** nel PUT di `page-layout` (abilitare una pagina non passa da `signal_project_changed`); il ripiego
sul percorso assoluto è il caso normale su `user` (la sonda relativa resta solo se `/run/media` è scrivibile).
`installato` richiede che `GetBackgroundImage` risponda `boot.png` (il launcher copia col nome originale); lo SHA
applicato sta in `boot-image/applied`, così una stessa richiesta non richiama il launcher, e `--force` reinstalla.

**Provata sul dispositivo vero** (`tc620-a-p3-c6-07aff9`, PixsysOS 2.1.1, appena formattato, come `user`):
unit installate con `/data/user/sws/config` **ancora inesistente** → la `.path` parte lo stesso e scatta alla prima
creazione di `boot-image/trigger`; un PNG 1280×800 → `installato`, percorso `assoluto`, `GetBackgroundImage` =
`boot.png`, `/etc/pixsys/pixsys-launcher/assets/boot.png` presente e TOML aggiornato, nessuna unit fallita.
**Non provato**: cosa si vede al riavvio del pannello, e il giro completo con il runtime nel container
(l'immagine del container non è stata ricostruita: la parte runtime è coperta dai test di `boot_image.rs`).
Ripristino sul dispositivo: `busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher
net.pixsys.Config1.Launcher ResetBackgroundImage`.

### F6 — nota di esecuzione (19-09-2026)

Scritti: `HOWTO.md` §17, manuale 04 (sezione «Immagini di boot»), `BRAND_SWS.md`, README di `boot-backgrounds`,
`CONTEXT.md` (riga T-72); `TEST_SETUPS.md` era già stato aggiornato con la sonda di F5. La sonda
(`sonda-dispositivo.sh` + `valuta_sonda`) riporta `run_media`, `run_media_scrivibile`, `launcher_pixsys` e la
verifica pre-installazione mostra «Immagine di boot» come informazione, mai come ostacolo: su una scheda
generica senza launcher dice solo che l'immagine non verrà installata. **Preset Pixsys**: aggiunto solo il
**TD710 800×480**, l'unico «confermato» nella tabella di `BRAND_SWS.md`; 480×272, 1280×768 e 1366×768 restano
«da confermare» e **non sono stati aggiunti** (servirebbe inventare il nome del prodotto). **Non fatto**:
`docs/manual/screenshots/` non è stato aggiornato (le schermate sono anteriori a T-52).

## 4. Dettagli per chi implementa

### 4.1 File critici
- `sws-runtime/crates/sws-web/src/router.rs` (rotte, ZIP, fingerprint, body limit)
- `sws-runtime/crates/sws-web/src/projects.rs` (`DESIGN_ARTIFACTS`, `create_project`, upload)
- `sws-runtime/crates/sws-web/src/synoptic.rs`, `synoptic_schema.rs`, `validate.rs`
- `sws-runtime/crates/sws-core/src/project.rs` (`PageLayoutConfig`)
- `sws-runtime/crates/sws-web/src/display_target.rs` (modello per `boot_image.rs`), `system.rs`
- `sws-editor/src/store/index.ts`, `types/index.ts`, `pageLayout.ts`
- `sws-editor/src/editor/LeftPanel.tsx`, `EditorShell.tsx`, `PageTabs.tsx`
- `sws-editor/src/canvas/SvgCanvas.tsx` (solo lettura per la rasterizzazione)
- `sws-editor/src/config/ConfigView.tsx` (`RuntimeConnectionTab`, helper `downloadBlob`)
- `deploy/container/install-container.sh`, `sws-display-apply.sh` (modello), `packaging.rs:814`
- `scripts/gen_synoptic_schema.py`, `check_systemd_units.sh`, `check_templates.sh`

### 4.2 Da riusare
- `list_synoptics`/`get_synoptic`/`save_synoptic`/`delete_synoptic` (`router.rs:4509-4796`) come
  stampo; `safe_filename`; il controllo di versione ottimistica (Q30).
- `paletteForTarget` (`LeftPanel.tsx:659`), `CollapsibleSection gruppo`, `gruppiPerTipo`.
- `useMaterializzaRatio` (`EditorShell.tsx:1907`) come precedente della materializzazione.
- `downloadBlob` (`ConfigView.tsx:8262`) per «Scarica PNG»; `XMLSerializer` già in `customSvg.ts:86`.
- `display_target::publish` come modello (idempotenza, spawn, `config_dir`).
- `politica_browser_disponibile()` in `sws-display-apply.sh` come modello di sonda D-Bus in lettura.

### 4.3 Punti dell'editor che devono ignorare `kind === "boot"`
Store: `setPages` (pagina iniziale), `addPage` (contatore nome), `deletePage` (regola «ultima
pagina»), `reorderPage`/`movePage`, merge IA per nome (`:1893`), `saveAll` (`:2148`, `:2164`).
Componenti: `EditorShell.tsx:862,871` (destinazioni nav), `:2053` (select pagina iniziale),
`:3191-3206` (target navbutton); `LeftPanel.tsx:150` (orfane), `:348`, `:411` (`LinkReportModal`);
`PageTabs.tsx:26`; `pageLayout.ts:102` (`pickInitialPageId`), `:386`, `:407`; `App.tsx:490`;
`MainMenu.tsx:84`; `ai/riassunto.ts:102`. Un helper unico `paginePerNavigazione(pages)` in
`pageLayout.ts`, con test.

### 4.4 Rischi residui e come si chiudono
| Rischio | Mitigazione |
|---|---|
| `user` non può scrivere in `/run/media` | Sonda in F5 prima di scrivere lo script; ripiego sul path assoluto con stato `percorso=assoluto` visibile nell'IDE |
| Pixsys normalizza l'input di `SetBackgroundImage` | Il ripiego smette di funzionare, la via relativa no; lo stato lo segnala e si sa dove guardare |
| Collisione di nome tra pagina di boot e sinottica | Persistenza per `(kind, nome)`; le directory sono separate |
| PNG diverso dal canvas (font, `var()`, risorse esterne) | Allowlist + incorporamento + anteprima nel pannello prima del deploy |
| Deploy risponde prima che l'host abbia agito | Lo stato arriva dal file, non dalla risposta HTTP; la scheda Runtime lo rilegge |
| Polkit assente sul metodo | Solo da documentare (non è un difetto nostro) in TEST_SETUPS |

### 4.5 Fuori perimetro, dichiarato
Splash **OS-level** (psplash): resta la domanda Q13 originale, invariata (Appendice B). Widget
«congelati» sulla pagina di boot: seconda fase, se servirà. `ResetBackgroundImage` dall'IDE: azione
futura. Rasterizzazione lato server con `resvg`: scartata finché `resvg` è senza feature text.

---

## 5. Verifica end-to-end (al termine di F5)
1. Nuovo progetto vuoto nell'IDE 8460 → due pagine: «Page 1» e «Immagine di boot», default vuoto.
2. Imposto 1024×600 e sfondo su «Page 1» → il default di progetto si riempie, la pagina di boot
   adotta 1024×600 e lo sfondo.
3. Disegno logo (simbolo + testo + rettangolo) sulla pagina di boot, salvo → `boot/Immagine di
   boot.png` esiste, l'anteprima coincide col canvas; «Scarica PNG» produce lo stesso file.
4. Duplico la pagina di boot, abilito la copia → una sola ⭐; il viewer 8443, il kiosk e la striscia
   di tab non mostrano nessuna delle due.
5. Deploy sul WP630 → `GetBackgroundImage` = `boot.png`; scheda Runtime «installata il …»; riavvio
   del pannello → splash nuovo. Secondo deploy identico → nessuna chiamata (SHA uguale).
6. Disabilito la pagina, deploy → stato `nessuna_immagine`, splash del pannello intatto.
7. Deploy sul dev server (senza busctl) → stato `non_supportato`, nessun errore nel log.
8. `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi.

---

## Appendice A — Le note D-Bus del maintainer (18-09-2026)

> «Nei casi in cui il prodotto lo permetta (tipicamente prodotti Pixsys) implementare la funzione
> dBus per configurare l'immagine di boot al deploy dello strumento.»

Il maintainer ha già trovato e verificato il meccanismo sul dispositivo. Le note qui sotto sono
sue, e **vanno lette prima di scrivere lo script**: contengono una trappola che non si vede
provando.

### Il comando che funziona

```sh
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher SetBackgroundImage s "/tmp/boot.png"
```

Funziona, **ma non per il motivo che sembra**, e vale la pena saperlo prima di metterlo in uno
script.

### Il dettaglio che cambia tutto

Il metodo non accetta un path del filesystem: è progettato per prendere un path **relativo al
mount point USB**. Nel codice del launcher:

```rust
let mut usb_image_path = main_config.config.usb_storage.mount_point.clone();  // "/run/media"
usb_image_path.push(path);
```

Quindi l'uso previsto è `SetBackgroundImage s "sda1/branding/boot.png"`, cioè quello che
restituisce `USBDrives.GetImages`.

Il caso con un path assoluto funziona perché **`PathBuf::push` in Rust, con un path assoluto,
sostituisce l'intero path** invece di concatenarlo. Verificato compilando:

```
push("boot.png"          ) -> /run/media/boot.png
push("/tmp/boot.png"     ) -> /tmp/boot.png            <-- esce dal mount point
push("../../tmp/boot.png") -> /run/media/../../tmp/boot.png
```

**È comportamento non voluto, non una feature documentata**: nessuno ha scritto quel metodo
pensando di accettare path assoluti. Se un domani qualcuno normalizza l'input — ed è una
correzione ragionevole, visto che oggi si può leggere qualsiasi file del filesystem — uno script
che si appoggia a questo smette di funzionare senza preavviso.

> **Conseguenza per noi**: lo script di deploy deve **copiare il file sotto `/run/media/…` e
> passare il path relativo**, non passare un path assoluto. Costa una riga in più e non dipende da
> un difetto altrui.
>
> *Nota della sessione di plan (18-09):* resta da verificare che `user` possa scrivere sotto
> `/run/media`. Se non può, il maintainer ha deciso di **ripiegare sul path assoluto** segnandolo
> nello stato che l'IDE mostra (§2.6), così se Pixsys corregge l'input si capisce subito perché.

### Cosa succede davvero

Il file viene copiato in `/etc/pixsys/pixsys-launcher/assets/boot.png` e il path della copia
finisce in `pixsys-launcher.toml`. Quindi il fatto che `/tmp` sia tmpfs non è un problema:
l'originale può sparire al reboot, la copia sta sull'overlay persistente di `/etc`. L'eventuale
immagine precedente viene cancellata.

Tre vincoli reali:

1. **Estensione** `png`, `jpg` o `jpeg`, maiuscole/minuscole indifferenti. Controlla solo
   l'estensione, **non il contenuto**: un file non-PNG rinominato passa il check e poi il launcher
   non lo mostra.
2. **Nessun controllo polkit** su questo metodo: lo può invocare qualunque utente locale sul
   system bus.
3. **Non ha effetto immediato**: `pixsys-launcher` legge il TOML all'avvio.

### Sequenza completa

```sh
# 1. imposta
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher SetBackgroundImage s "/tmp/boot.png"

# 2. verifica: ritorna SOLO il nome file, non il path
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher GetBackgroundImage
# s "boot.png"        ("Default" se non c'è nessuna immagine custom)

# 3. conferma che la copia esista
ls -l /etc/pixsys/pixsys-launcher/assets/
grep background_image_path /etc/pixsys/pixsys-launcher.toml

# 4. applica
systemctl restart pixsys-launcher.service     # oppure un reboot pulito
```

Per tornare all'immagine di fabbrica (cancella anche il file copiato):

```sh
busctl --system call net.pixsys.Config1 /net/pixsys/Config1/Launcher \
    net.pixsys.Config1.Launcher ResetBackgroundImage
```

### Resta la domanda originale

Tutto quanto sopra copre lo splash **del launcher Pixsys**. La scheda originale parlava del boot
splash **OS-level** (psplash o equivalente), che è un'altra cosa e arriva prima: quella parte
resta senza risposta, e resta legata alla stessa condizione di allora — il maintainer con il
pannello sotto mano.

---

## Appendice B — Dalla scheda Q13: Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

**Context**: emerso il 2026-08-01 preparando lo scaffold per gli export PNG del brief (6 risoluzioni,
`docs/branding/boot-backgrounds/`). Sono pensati per il boot splash **OS-level** del pannello Pixsys,
ma nessun meccanismo del genere esiste oggi in questo repo — verificato con grep su `docs/`,
`deploy/`, `scripts/`, `sws-editor/src/`: nessun riferimento a psplash o equivalente. Il kiosk SWS
(`sws-kiosk`) apre solo una URL fullscreen dopo che il sistema è già partito; non gestisce lo splash
di boot.

**Options**:
1. Consegna manuale al maintainer, che li carica con lo strumento di configurazione Pixsys — nessuna
   integrazione in questo repo, mai.
2. Se Yocto/Pixsys espone una recipe per il boot splash, documentarla in `docs/YOCTO_CROSSCOMPILE.md`
   e versionare gli asset finali lì invece che in `docs/branding/`.

**Default for PoC**: opzione 1 — richiede la conoscenza del maintainer sul tooling Pixsys reale, non
deducibile dal codice.

**Decided**: not yet — il maintainer ha scelto (2026-08-21) di **rimandare**: la domanda resta
aperta finché non avrà il pannello sotto mano per verificare il meccanismo reale.

> *Aggiornamento 18-09-2026: il pannello l'ha avuto sotto mano, e la parte «launcher» ha una
> risposta — sta in Appendice A e nel design di §2.6. La parte OS-level no.*
