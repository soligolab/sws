# Piano — P1, finestre popup generiche (una pagina aperta come finestra, con parametri)

## Context

Il P1 dell'onda 1 del [piano prima fascia e CRA](docs/plans/2026-10-15-piano-prima-fascia-e-cra.md) è la mancanza HMI
più visibile rispetto agli SCADA professionali. Il gesto da coprire: clic sulla pompa → si apre la sua finestra di
dettaglio, la stessa finestra per pompa 1 e pompa 2 con parametri diversi.

Oggi esiste solo il popup dei faceplate (`FaceplatePopup`, `sws-editor/src/canvas/SvgCanvas.tsx:3360`), aperto
dall'azione `open_faceplate` dentro il canvas: è già un modale completo (sfondo, ✕, Esc, clic fuori), ma il contenuto
è un faceplate, non una pagina.

Decisioni del maintainer:
- **16-10**: modale o non modale lo sceglie la pagina; una finestra alla volta; prima il web (su LVGL il popup non
  esiste, nemmeno quello dei faceplate).
- **17-10**:
  - una pagina-finestra **è solo finestra**: esce da navigatori, tab del viewer e rotazione kiosk;
  - parametri **come i faceplate**, `{nome}` con un default dichiarato dalla pagina;
  - la non modale si apre **centrata e si trascina dal titolo**;
  - su **LVGL** il bottone «Apri finestra» **naviga alla pagina a schermo pieno**, come ripiego.

## Il modello

- **Pagina** (`SynopticPage`, TS e mirror Rust `sws-web/src/synoptic.rs`):
  - `finestra?: { modale: boolean; titolo?: string }`: presente = la pagina si apre come finestra;
  - `finestra_parametri?: { name: string; default?: string }[]`: stessa forma dei parametri dei faceplate.

  Il mirror Rust li conserva come `Option<Value>`, opachi, come già fa con `button_action`.
- **Azioni del bottone** (`ButtonAction`, `types/index.ts:234`; in Rust è già un `Value`):
  - `{ type: "open_popup"; page: string; params?: Record<string, string> }`, con `page` = id della pagina;
  - `{ type: "close_popup" }`, per un bottone «Chiudi» dentro la finestra.
- **Fuori dalla navigazione**: un helper `pagineNavigabili(pages)` in `src/boot/tipi.ts`, cioè
  `paginePerNavigazione` meno le pagine-finestra. Lo usano:
  - il navigatore web (`canvas/PageNavigatorView.tsx:44`);
  - le tab del viewer (`runtime-view/RuntimeView.tsx:393`);
  - la rotazione kiosk (`RuntimeView.tsx:154`);
  - lato Rust, `pages_nav` (`router.rs` ~6638, che serve il navigatore LVGL), che salta le pagine con `finestra`.

  L'albero e le tab dell'**editor** continuano a mostrarle, con un segno 🪟, perché lì si modificano.
- **Cornici**: una pagina-finestra non ne ha mai. Lo dicono `corniceDellaPagina` (TS) e `cornice_della_pagina`
  (Rust), come per le pagine di boot.
- **Pagine orfane**: `findOrphanPageIds` (`pageLayout.ts`) conta come collegate le pagine aperte da un `open_popup`,
  e non segnala mai una pagina-finestra come orfana perché non è nei navigatori.

## Web: la finestra

- **Dove vive**: in `RuntimeView.tsx` (lui conosce le pagine; il canvas no), lo stato
  `finestra: { pageId, params } | null`.
  - `handleButtonAction` gestisce `open_popup`: imposta lo stato, e una seconda apertura sostituisce la prima;
  - gestisce `close_popup`: chiude.
  - Il canvas inoltra le due azioni a `onButtonAction` (`SvgCanvas.tsx:1907`, come fa già per `navigate`), dopo
    l'eventuale `on_press_fn`.
- **Componente nuovo** `src/runtime-view/PaginaFinestra.tsx`:
  - barra del titolo (`finestra.titolo` o il nome della pagina) con ✕;
  - corpo: un `SvgCanvas` in sola vista con la misura della pagina, gli oggetti con i parametri sostituiti da
    `substituteFaceplateParams` + `effectiveFaceplateParams` (`SvgCanvas.tsx:3294`, `3329`), riusati sui parametri
    della pagina, e gli stessi `onWriteTag`/`onScript`/`onButtonAction` del viewer;
  - **modale**: sfondo scuro, Esc e clic fuori chiudono, come `FaceplatePopup`;
  - **non modale**: niente sfondo, la pagina sotto resta usabile; centrata all'apertura, si trascina tenendo la
    barra del titolo (pointer events), senza uscire dallo schermo;
  - un `navbutton` dentro la finestra naviga la pagina principale e chiude la finestra.
- **Tag**: `pageTagIds` (`RuntimeView.tsx:204`) aggiunge `collectTagIds` degli oggetti della finestra già
  sostituiti. Senza, i suoi tag riceverebbero lo snapshot e poi si congelerebbero.

## LVGL: il ripiego

Nel bottone (`render_button`, `lvgl_render.rs`), se `button_action.type == "open_popup"`, il tocco manda l'id
della pagina su `nav_tx`, come il navbutton. Va passato `nav_tx` a `render_button`. I parametri non si applicano.
Il validatore (`validate.rs`) dice, per i progetti con `target: lvgl`: «sul pannello la finestra si apre come pagina
intera».

## Editor

- **Proprietà della pagina** (`PageProps`, `EditorShell.tsx`), sezione «Finestra»:
  - casella «Si apre come finestra»;
  - modale / non modale;
  - titolo;
  - elenco dei parametri (nome, default), come i faceplate.
- **Azione del bottone** (`EditorShell.tsx` ~3706, accanto a «Apri faceplate»):
  - «Apri finestra»: menu delle pagine-finestra, più i valori dei loro parametri, uno per riga;
  - «Chiudi finestra».
- **Albero**: 🪟 accanto al nome delle pagine-finestra.
- i18n it/en; manuale (`04_editor_guide.md`, nuova sezione; `05_widget_reference.md`, azioni del bottone);
  CHANGELOG e NOVITÀ (unire una voce se servono posti).

## Prova

- **vitest**:
  - `pagineNavigabili`;
  - parametri sostituiti negli oggetti della finestra;
  - una pagina-finestra non è orfana e non entra nelle voci del navigatore;
  - nessuna cornice su una pagina-finestra;
  - i campi del pannello (inventario T-56).
- **cargo test**: `pages_nav` salta le finestre; `cornice_della_pagina` restituisce None; round-trip YAML dei due
  campi; il bottone LVGL `open_popup` collega la navigazione.
- `cargo check`, `pnpm build`, `./scripts/check_static.sh`.
- **Dal vivo** (runtime di prova poi fermato, demo web), con Playwright e screenshot:
  - una pagina «Dettaglio pompa» non modale con parametro `{tag}`;
  - due bottoni che la aprono con tag diversi;
  - verifico titolo, valori vivi, trascinamento, sostituzione e chiusura;
  - poi la stessa pagina modale con Esc.
- **Istantanea LVGL**: il bottone naviga alla pagina.

## Ramo

`feat/finestre-popup` da `main`. Nessun ramo aperto oggi.
