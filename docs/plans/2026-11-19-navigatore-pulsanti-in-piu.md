# Il navigatore di pagine con i pulsanti in più: ingresso a un sotto-menù e uscita

> Piano del 19-11-2026, da chiudere in **una sessione** (lavoro urgente, chiesto dal maintainer per la demo della
> fiera). Primo passo dell'esecuzione: copiarlo in `docs/plans/2026-11-19-navigatore-pulsanti-in-piu.md`, con la riga
> in `docs/plans/README.md`. Codice nuovo in inglese, testi in it/en.

## Contesto

Nel progetto `DemoTY570_fiera` (cloud) la cornice «Frame» ha un `page_navigator` con `nav_source: roots`: mostra
Sistema, HVAC, Test, SystemInfo. Sotto **Sistema** nell'albero ci sono le sei pagine «Idrico - …». Queste pagine non
hanno cornice: hanno la loro testata e un menù a sinistra fatto di **sei `navbutton`** (Sinottico, Trend, Data Logger,
Consumi, Allarmi, Parametri), **senza un'uscita**.

Il maintainer vuole:
1. nel navigatore della cornice, un pulsante che **entra nel sotto-menù Idro**: si sceglie la **pagina d'inizio** e il
   **nome** del pulsante;
2. dentro le pagine Idro, il menù delle pagine Idro con un pulsante d'**uscita** configurabile.

Oggi non si può: ogni voce del navigatore viene dall'albero e porta alla pagina che rappresenta (`voci_navigatore`,
`sws-core/src/page_tree.rs:237`, gemella di `vociNavigatore` in `sws-editor/src/pageNavigator.ts`). `nav_items` cambia
solo etichetta, posizione e visibilità delle voci che ci sono già. Nessuno dei due motori ha una storia delle pagine.

**Decisioni del maintainer (19-11-2026):**
- l'uscita porta a **una pagina scelta**, come l'ingresso (niente storia delle pagine);
- il pulsante d'ingresso si accende **su tutte le pagine del sotto-menù**;
- ramo **annidato su `feat/symbol-def`** (`feat/nav-links`): entra nella rc.22 con l'editor dei simboli. Se il ramo
  dell'editor riceve correzioni dal collaudo, `feat/nav-links` si riallinea su di lui prima dello squash. Si lavora in un
  **worktree** a parte: il checkout `/home/ut1/sws` e l'IDE 8460 servono al collaudo dell'editor;
- il progetto della fiera lo aggiorna **il maintainer dall'IDE**, coi passi scritti qui sotto.

## La soluzione: «Pulsanti in più» in ogni navigatore

Un campo nuovo del `page_navigator`, **`nav_links`**: un elenco di pulsanti che non vengono dall'albero, ognuno con
- `page_id`: dove porta;
- `label`: il testo (vuoto = nome della pagina; `{{token}}` ammessi, come in `nav_items`);
- `order`: la posizione fra le voci visibili, 1 = prima (vuoto = in fondo), con la stessa regola di `nav_items`.

Lo stesso meccanismo copre i due casi:
- **ingresso**: nel navigatore della cornice, «Idro» → `idrico_sinottico`;
- **uscita**: nel menù delle pagine Idro (un `page_navigator` verticale `children_of: sistema` al posto dei sei
  `navbutton`), «← Sistema» → `sistema`.

**Quando si accende** (colore della pagina corrente): un pulsante in più è acceso se la pagina corrente è la sua
destinazione **oppure una sorella della destinazione** (stesso genitore nell'albero, e il genitore esiste). Così
«Idro» resta acceso su tutte le pagine Idro; «← Sistema» (destinazione alla radice) si accende solo su Sistema.

Un pulsante verso una pagina che non esiste, o verso una pagina-finestra, non si disegna (come le eccezioni di
`nav_items` verso pagine sparite).

## Modifiche

**Logica condivisa (le due gemelle e la fixture comune)**
- `sws-runtime/crates/sws-core/src/page_tree.rs`: `NavLink { page_id, label, order }`, `NavConfig.links`; in
  `voci_navigatore`, dopo l'inserimento delle voci con posizione, si inseriscono i link (ordinati per `order`, a parità
  nell'ordine scritto; senza `order` in coda), con la regola d'accensione sopra. `NavVoce` riceve `extra: bool`
  (pulsante in più), che serve anche come chiave distinta da una voce dell'albero verso la stessa pagina.
- `sws-editor/src/pageNavigator.ts`: lo stesso, e `VoceNavigatore.extra`.
- `tests/fixtures/navigatore-pagine.json`: casi nuovi (ingresso con accensione sulle sorelle, uscita alla radice,
  posizione, link verso pagina inesistente o finestra, etichetta tradotta, link e voce dell'albero verso la stessa
  pagina). Li leggono già `page_tree.rs:479` e `sws-editor/tests/pageNavigator.test.ts`.

**Modello**
- `sws-web/src/synoptic.rs` (`nav_links: Option<Value>`, accanto a `nav_items`), `sws-lvgl-viewer/src/model.rs`
  (`Option<Vec<NavLink>>`, la guardia `check_lvgl_parity.sh` lo vuole), `sws-editor/src/types/index.ts`
  (`nav_links?: NavLink[]`).
- Rigenerare `synoptic_schema.rs` con `scripts/gen_synoptic_schema.py` (`check_synoptic_schema.sh`).

**I due motori**
- Web: `sws-editor/src/canvas/PageNavigatorView.tsx`, chiave `${extra ? "x" : percorso ? "p" : "v"}-${i}-${id}`; il
  clic naviga come oggi (`onNavigate`). In modifica stesso disegno del runtime (regola WYSIWYG).
- LVGL: `lvgl_render.rs`, `nav_impostazioni` (5454) passa i link a `NavConfig`; `render_page_navigator` (5497) li
  disegna come le altre voci (`Navigazione::Pagina(id)`). `/api/pages/nav` non cambia: i link puntano a pagine che
  quell'elenco ha già.

**IDE**
- `sws-editor/src/editor/NavigatorProperties.tsx`: sotto «Pagine di questo navigatore», la sezione **«Pulsanti in
  più»**: una riga per pulsante con la pagina (menù a tendina delle pagine navigabili), l'etichetta
  (`CampoTestoTradotto`), la posizione (`CampoNumero`, min 1) e «Togli»; sotto, «+ Pulsante». Testo d'aiuto:
  «Per entrare in un sotto-menù o per uscirne: un pulsante che porta alla pagina scelta. Si accende anche sulle pagine
  sorelle della destinazione».
- i18n `nav.*` in `it.json` ed `en.json`; `tests/fixtures/campiPannelloProprieta.json` rigenerato
  (`SWS_RIGENERA_INVENTARIO=1`).
- `pageLayout.ts` `findOrphanPageIds`: niente da fare se usa `vociNavigatore` (i link contano come raggiungibilità);
  da verificare col test.

**Documenti**
- Manuale `docs/manual/05_widget_reference.md` (voce `page_navigator`, 202-234): i pulsanti in più, con l'esempio
  ingresso/uscita (`check_manuale_widget.sh`).
- `CHANGELOG.md`; `NOVITA.yaml`: il blocco 2.26.0 è pieno a 15, si fonde con la voce più vicina (da proporre al
  maintainer insieme alle due dell'editor dei simboli).
- **CasaDomotica** (regola di `CLAUDE.md`): il pulsante in più va messo dove ha senso, oppure si scrive perché no.

## Progetto della fiera (lo fa il maintainer dall'IDE, dopo il rilascio)

In `DemoTY570_fiera`:
- cornice «Frame» → navigatore → «Pulsanti in più» → «+ Pulsante»: pagina «Idrico - Sinottico», etichetta «Idro»,
  posizione 2 (dopo Sistema);
- in ognuna delle sei pagine Idro: tolti i sei `navbutton`, un `page_navigator` nello stesso rettangolo (x 10, y 76,
  130×492), verticale, voci «Figli di una pagina» → Sistema, etichette brevi da «Pagine di questo navigatore»
  (Sinottico, Trend…); «Pulsanti in più» → pagina Sistema, etichetta «← Sistema», posizione vuota (in fondo). Basta farlo
  su una pagina e copiarlo nelle altre cinque.

## Verifica

1. `cargo check`, `cargo test` (con il viewer LVGL), `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`;
   quelli della CI (`cargo fmt --check`, `clippy -D warnings`, `cargo audit`, `pnpm lint`, `pnpm type-check`).
2. Un IDE dal worktree su una porta sua (l'8460 resta al collaudo dell'editor): in un progetto di prova in
   `~/sws_projects/` con l'albero della fiera (Sistema con tre figlie), il navigatore della cornice con «Idro» acceso
   sulle figlie, il menù verticale con «← Sistema»; anteprima e runtime web uguali.
3. LVGL: `sws-lvgl-viewer --istantanea` della stessa pagina, i pulsanti negli stessi pixel del web (fixture della
   geometria invariata: i link sono voci come le altre).
4. Collaudo del maintainer sul pannello della fiera (voce nuova in `docs/COLLAUDI_IN_SOSPESO.md`).
