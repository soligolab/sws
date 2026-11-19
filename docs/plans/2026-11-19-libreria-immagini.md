# Le immagini del progetto: caricare, scegliere, piazzare, gestire

> Piano del 19-11-2026 (notte), sessione di plan col maintainer. Ramo `feat/image-library`, **annidato su
> `feat/symbol-anim`** (regola «un ramo alla volta», opzione 2: i tre rami aperti aspettano il collaudo). Codice nuovo
> in inglese, documenti in italiano.

## Contesto
Il maintainer: «non esiste un metodo ordinato per caricare una immagine e piazzarla tramite il componente immagine.
Mi aspetterei che quando piazzo una immagine si apra l'Image Library e la prima opzione sia il caricamento».

Com'è oggi (esplorazione del codice):
- Strumenti ▸ «Immagine» apre `ImageBrowser` (`sws-editor/src/components/ImageBrowser.tsx`), che mostra **solo le
  icone incluse** (`/images/catalog.json`, quattro schede). Non ha upload, non mostra le immagini del progetto.
- L'oggetto nasce 120×80 con `stretch` (un'icona quadrata esce schiacciata), con l'angolo e non il centro sul centro
  della vista, senza i predefiniti (`EditorShell.tsx:1236`, `:1301-1310`).
- L'upload c'è, ma solo nei campi di **sfondo** (sfondo dell'oggetto `EditorShell.tsx:6316-6373`, sfondo dell'area
  `CampoSfondoArea.tsx`), con la stessa logica copiata due volte. Sull'oggetto Immagine l'upload della sezione «Sfondo»
  scrive `bg_image`: la foto finisce **dietro** a un'immagine vuota.
- Il server (`sws-web/src/router.rs:8558-8760`): `images/` del progetto, 5 MB a file, nessun limite di pixel;
  **un file con lo stesso nome si sovrascrive senza avviso**; esistono lista, lettura (anche `?w=&h=`), cancellazione
  (che nessuna interfaccia usa). Niente rinomina, niente «dove si usa», niente pulizia.
- Il deploy manda tutto in uno zip da **al più 8 MB** (`remote.rs:3408`): due foto da 5 MB lo bloccano. Sul TY570 una
  foto grande costa quasi 2 s di decodifica a ogni visita della pagina (gli oggetti immagine non hanno le varianti alla
  misura degli sfondi di pagina).
- Niente trascinamento di file, niente incolla di immagini (Ctrl+V è solo per gli oggetti).

## Decisioni del maintainer (19-11-2026)
1. **Ottimizzazione all'upload proposta e accesa di default**: «Ottimizza per il pannello» già spuntato, con la misura
   prima e dopo; lato lungo al più 1920 px, le foto in JPEG, i PNG con trasparenza restano PNG, SVG (e GIF) intatti.
2. **Scorciatoie**: file trascinato sul canvas, e immagine incollata dagli appunti.
3. **Gestione completa ora**: rinomina (gli oggetti seguono), sostituisci, elimina con l'elenco di dove si usa, le non
   usate segnalate, il totale rispetto al limite del deploy; nome già usato → sostituisci / tieni tutte e due / annulla.
4. **Sull'oggetto Immagine si toglie l'immagine di sfondo** (resta il colore): un dato, un posto. Un progetto che la
   usa la vede in sola lettura, con «Togli».

## Come funziona per chi usa l'IDE
1. **Strumenti ▸ Immagine** → si apre la libreria «Inserisci immagine» sulla scheda **«Del progetto»** (prima, e
   predefinita). La prima casella è **«+ Carica immagine…»**: un clic apre la scelta dei file (anche più d'uno), oppure
   ci si trascina sopra i file (anche su tutta la finestra).
2. **Caricando** si apre una piccola scheda: anteprima, nome (modificabile), misura in pixel e KB, «Ottimizza per il
   pannello» spuntato con la misura dopo. Se il nome c'è già: **Sostituisci** (ovunque si usa), **Tieni tutte e due**
   (`nome-2.png`), **Annulla**.
3. L'immagine caricata è **già scelta**: «Inserisci» (o doppio clic) la mette in pagina **con le sue proporzioni**
   (lato lungo 240 px, o la sua misura se più piccola), **centrata** nella vista, `image_fit: contain`, coi
   predefiniti. Le icone del catalogo entrano 64×64.
4. Ogni immagine del progetto nella griglia mostra miniatura, nome, pixel, KB e quanti oggetti la usano; scelta, ha
   **Rinomina**, **Sostituisci**, **Elimina**, **Dove si usa** (pagina e oggetto, cliccabili). In fondo: «Immagini del
   progetto: 3,2 MB di 8 MB del deploy», quante non usate, e i **riferimenti a immagini mancanti**.
5. **Scorciatoie**: un file trascinato sul canvas apre la stessa scheda di caricamento e poi mette l'immagine dove è
   caduto; Ctrl+V con un'immagine negli appunti fa lo stesso al centro della vista (nome `incollata-<data-ora>.png`).
6. **Pannello proprietà** dell'immagine: in «Parametri» la miniatura con nome e **«Cambia…»** (la stessa libreria,
   modo «scegli»); l'URL resta sotto, legabile a un tag come oggi. La sezione «Sfondo» non ha più l'immagine.
7. La libreria si apre anche da Configurazione ▸ Risorse («Immagini del progetto»), per gestirle senza piazzarle.

## Il lavoro
### Server (`sws-runtime/crates/sws-web/src/router.rs`, `api/client.ts`)
- La lista dà anche `width`/`height` (raster con la crate `image`, già usata da `sized_image.rs`; SVG dal `viewBox`).
- L'upload **non sovrascrive** più: 409 `{ "exists": true }` se il nome c'è, a meno di `?replace=1`. I chiamanti di oggi
  (salvataggio delle immagini IA, planimetrie) usano nomi unici; i due campi di sfondo passano al componente comune.
- Nuova `POST /api/project/images/:name/rename` `{ "to": … }`: 404 se manca, 409 se `to` c'è, stesse regole sul nome,
  voce d'audit `project.image_rename`. La cancellazione resta quella di oggi.
- Test Rust: `image_content_type`, upload senza e con `replace`, rinomina, lista con le misure.

### Il caricamento comune (`sws-editor/src/images/`, nuovo)
- `optimize.ts`: `createImageBitmap` → se il lato lungo supera 1920 px (o il file 1 MB) disegna su un canvas alla misura
  e fa `toBlob` JPEG 0,85; se l'immagine ha trasparenza (controllo dell'alfa sulla versione ridotta) resta PNG. SVG e
  GIF non si toccano. Funzione pura per le misure, provata a parte.
- `UploadImage.tsx`: la scheda di caricamento (anteprima, nome ripulito con la regola del server `[A-Za-z0-9._-]`,
  ottimizzazione, nome già usato). Restituisce l'URL `/api/project/images/<nome>`. La usano la libreria, il canvas,
  `CampoSfondoArea` e lo sfondo degli altri oggetti, al posto delle due copie di oggi.
- `usage.ts`: dove si usa un'immagine, dalle pagine, dai popup e dagli sfondi nello store; una ricerca generica delle
  stringhe uguali all'URL (anche con `?v=`), così copre `src`, `bg_image`, `sfondo_immagine`, le celle, i legami
  statici. `renameImageRefs` riscrive le stesse stringhe (sul modello di `tag/rinominaTag.ts`).

### La libreria (`components/ImageBrowser.tsx`, rifatta)
- Modi: `place` (titolo «Inserisci immagine»), `choose` (cambia l'immagine), `manage` (da Risorse). Schede: «Del
  progetto» prima, poi le quattro del catalogo. Miniature del progetto con `scaricaImmagine` di `canvas/ImmagineSvg.tsx`
  (token e prefisso del cloud). Testi nei file di lingua (oggi il piede è in italiano scritto nel codice).
- Gestione: rinomina (route + `renameImageRefs`), sostituisci (upload con `replace=1` + `dimenticaImmagine` per il
  `?v=`), elimina (con «Dove si usa»; se usata, chiede conferma e dice quanti oggetti restano senza immagine).

### Il piazzamento (`EditorShell.tsx`, `canvas/SvgCanvas.tsx`)
- `handleAddObject` per `image`: la libreria in modo `place`; alla scelta, misura dalle proporzioni, `centraSulPunto`,
  `riempiPredefiniti`, `image_fit: "contain"`.
- Trascinamento di file sul canvas (`onDragOver`/`onDrop` con `dataTransfer.files` di tipo immagine) e incolla
  (evento `paste` con `clipboardData` di tipo immagine; l'incolla degli oggetti resta quando negli appunti non c'è
  un'immagine, e non nei campi di testo).
- Pannello proprietà: il campo immagine con miniatura e «Cambia…»; `bg_image` tolto dalla sezione Sfondo per il tipo
  `image` (sola lettura con «Togli» se già c'è).

### Documenti
- Manuale: `05_widget_reference.md` (sezione Immagine, oggi scarna e sbagliata), `04_editor_guide.md` (palette e
  sfondi). CHANGELOG, voci di collaudo, `NOVITA.yaml` al rilascio.
- Seme `docs/plans/semi/2026-11-13-sfondi-pesanti-e-precarico.md`: aggiungere che gli oggetti immagine sul pannello
  non hanno le varianti alla misura (resta lì, non si fa qui).

## Le sessioni
| | cosa | dove ci si ferma |
|---|---|---|
| A | server (misure, niente sovrascrittura, rinomina); `optimize.ts` e `UploadImage.tsx`; libreria con «Del progetto» e «+ Carica»; piazzamento con proporzioni e centro; campo immagine nelle proprietà; sfondo tolto dall'immagine | si carica e si piazza in modo ordinato |
| B | gestione (rinomina, sostituisci, elimina, dove si usa, non usate, mancanti, totale); trascinamento e incolla; i due campi di sfondo sul componente comune; Risorse; manuale | pronto per `/test-changes` |

## Verifica
1. Definition of done e controlli della CI (`cargo fmt/clippy/test`, `pnpm lint/type-check/build`, vitest,
   `check_static.sh`).
2. Test: Rust sulle route; vitest su `optimize` (misure e scelta del formato), `UploadImage` (nome già usato: tre
   strade), la libreria (scheda del progetto prima, carica e scegli, rinomina che riscrive i riferimenti, elimina con
   l'uso), il piazzamento (proporzioni, centro, `contain`), il trascinamento e l'incolla.
3. Nel browser sull'IDE di prova: una foto da 5 MB del telefono → ottimizzata sotto 1 MB, piazzata con le sue
   proporzioni; rinominata, la pagina la mostra ancora; deploy sul pannello che passa, e l'immagine sul WP630/TY570.
4. Collaudo del maintainer con `/test-changes`; CasaDomotica con un'immagine caricata da qui (regola di `CLAUDE.md`).
