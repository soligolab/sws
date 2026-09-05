# T-52 sessioni B→E — il limite della pagina è morbido

> Copia del piano scritto in modalità piano il **2026-09-05**, committata perché
> il lavoro attraversa due macchine. Il piano *del lavoro* è
> [2026-09-04-limite-pagina-morbido.md](2026-09-04-limite-pagina-morbido.md);
> questo è il piano della **giornata**, e vale soprattutto per la tabella delle
> nove correzioni: il piano del 4 è stato scritto contro un codice che nel
> frattempo era cambiato, e quei nove punti sono le differenze verificate.
>
> **Eseguito per intero.** L'esito sta in `STATUS.md`; questo file non è stato
> riscritto a posteriori, quindi dove dice «da fare» va letto al passato.

## Context

Il piano di riferimento è già scritto, verificato e approvato: **`docs/plans/2026-09-04-limite-pagina-morbido.md`**.
Le decisioni di design sono congelate lì e **non si riaprono**. Questo file è solo
il piano *della giornata*: dice da dove si riparte, cosa cambia rispetto al piano
committato (l'ho riverificato contro il codice e nove punti sono invecchiati), e
come si verifica il lavoro **senza il maintainer davanti allo schermo**, che è la
condizione di oggi.

Stato: la **sessione A** (il colore della pagina si ferma al bordo, incluso il
gemello nel viewer `ratio`) è su `origin/feat/T-52-limite-pagina-morbido`
(`3c03a93`), pushata, **non mergiata**, e il ramo **non esiste in locale**.
Restano B (resistenza al bordo), C (`isOffPage` in TS), D (gemello Rust +
guardia), E (documenti).

Deciso dal maintainer oggi:
- si arriva fino a **E**, **senza push e senza merge**: il ramo resta pronto da confermare a schermo;
- le bande del letterbox nel viewer `ratio` restano **`--brand-bg`** — confermato, non si tocca niente;
- **R8 sì**: `Finding::warn` a livello pagina + una riga in `PageProps`;
- i casi manuali 3.36-3.43 diventano **una guardia con browser vero**, oltre agli unit test.

## Correzioni al piano committato, trovate rileggendo il codice

Il piano ha già sbagliato una formula una volta (`paintableFill = !!background`,
corretta in sessione A con `pageFillEnabled`). Queste sono le altre, verificate:

| # | Il piano dice | Il codice dice |
|---|---|---|
| 1 | sessione A su cui costruire | il ramo **non c'è in locale**: primo passo `git checkout -b … origin/…` |
| 2 | «7 guardie statiche verdi» | sono **9** (`check_static.sh:29-39`). Non scrivere numeri: scrivere «tutte verdi» |
| 3 | «campo in `RenderSummary` e nella sua stampa» | la stampa è in **4 punti**: `lvgl-viewer/src/main.rs:291`, `:651`, `:896`, `:947` |
| 4 | i due adattatori Rust sono simmetrici | **no**: nel web `x`/`y` sono `f64` nudi e `points` è `Option<serde_json::Value>`; in LVGL sono `Option<f64>` e `Option<Vec<PipePoint>>`. Il web deve estrarre i punti dal `Value` a mano |
| 5 | `Finding::warn` disponibile | è **privata** (`validate.rs:64-73`): il gate e il warn vivono dentro `validate.rs`, e va bene così |
| 6 | commento «gap dichiarato» in sessione D che cita Q36 | Q36 nasce in E ⇒ **le voci Q35-Q39 si scrivono all'inizio della sessione C**, così ogni `TODO(open-question)` cita qualcosa che esiste |
| 7 | «base 318 test» | è del 2026-08-31 e da allora sono entrati test nuovi: il numero base **si misura all'inizio**, non si cita |
| 8 | `check_off_page.sh` diffa due tabelle | il lato TS nasce in C: la guardia va scritta in **D**, dopo C, come già ordinato |
| 9 | `scripts/README.md:227-266` da aggiornare | quella tabella è **già incompleta** (8 righe per 9 guardie, manca `check_session_start`): si sistema mentre si è lì |

## Passo 0 — il ramo

```bash
git checkout -b feat/T-52-limite-pagina-morbido origin/feat/T-52-limite-pagina-morbido
cd sws-runtime && cargo test --workspace 2>&1 | tail -3   # il numero base di oggi, annotato in STATUS
```

---

## Sessione B — resistenza per distanza

**`sws-editor/src/pageLayout.ts`** — accanto a `clampToPage` (`:131-143` sul ramo):
`PAGE_EDGE_RESIST_PX = 24`, `softEdgeAxis`, `softClampToPage`, esattamente con le
firme di §2a del piano committato. Assi indipendenti; la soglia si misura sul
**puntatore**, non sulla posizione snappata.

**`sws-editor/src/canvas/SvgCanvas.tsx`**:
- `DragState` (`:115-131`): aggiungere `cage: { offX, offY, w, h }`, `freedX`, `freedY`.
- `startDrag` (`:1323-1368`): unione di `objBBox(ancora)` e degli `objBBox` dei
  seguaci; `offX/offY` **relativi all'origine che usa la matematica del drag** —
  `obj.x/obj.y`, ma `points[0]` per le pipe (`:1345-1347` calcola già lì
  `offsetX`). `freedX/freedY` inizializzati a **true se la gabbia era già fuori**,
  o alla prima mossa l'oggetto verrebbe risucchiato dentro.
- `handleMouseMove` (`:1215-1220`): il blocco `clampToPage` diventa la chiamata a
  `softClampToPage`, **dopo** tutta la cascata di snap e `setSnapLines` (`:1213`)
  — lo snap propone, il limite morbido dispone. Sparisce il caso speciale
  `dx2 === undefined && !startPoints`: la gabbia è una bbox, quindi **line e pipe
  vengono trattenute come tutto il resto** (oggi non lo sono affatto). Il ramo di
  gruppo (`:1241-1255`) **non si tocca**: il delta rigido parte da un'ancora già
  trattenuta sulla gabbia dell'unione.
- resize (`:1133-1136`): via il clamp → `onMove(objId, { x, y, width, height })`.
  Corregge il difetto per cui allargando oltre il bordo destro il **bordo
  sinistro si sposta** (x=1000 w=200 su pagina 1280, w→400 ⇒ x=880).
- `clampToPage` resta senza chiamanti (verificato: sono solo questi due) ⇒ **si
  cancella** nello stesso commit, portando la sua motivazione — no-op in fluido —
  nel commento di `softEdgeAxis`.

**Verifica di B**
- `sws-editor/tests/pageLayout.test.ts`: tabella su `softEdgeAxis`/`softClampToPage`
  — trattenuto, sganciato oltre soglia, sganciato resta sganciato, asse X libero
  e Y trattenuto, pagina fluida no-op, oggetto più grande della pagina.
- **`scripts/check_soft_edge.sh` + `sws-editor/scripts/soft_edge_measure.mjs`**,
  copiati nella forma da `check_multiselect_drag.sh` + `multiselect_drag_measure.mjs`
  (runtime usa e getta su `$APORT`, progetto creato via API, pagina 1280×800 con
  due `rect`, poi il measure guida il browser e rilegge x/y dall'API). Misura:
  (a) mouse 10 px oltre il bordo destro ⇒ x fermo a `pageW - w`;
  (b) mouse 40 px oltre ⇒ x segue il puntatore;
  (c) stessa prova **al 400% di zoom** ⇒ la soglia in pixel-schermo non cambia;
  (d) multi-selezione oltre il bordo ⇒ la distanza fra i due rect è invariata.
  Una riga in più rispetto ai gemelli: `chromium.launch(process.env.SWS_E2E_CHROMIUM ? {executablePath: …} : {})`,
  che nessuno degli altri measure onora (difetto n. 3 di STATUS).
- Registrare `check_soft_edge` in **`CON_STACK`** di `check_static.sh:43-48`
  (serve runtime + browser), o `check_static.sh` esce 1 per guardia non classificata.
- `pnpm --dir sws-editor build`, `pnpm --dir sws-editor test`, `./scripts/check_multiselect_drag.sh`.

Commit, **arresto pulito**.

---

## Sessione C — `isOffPage`, lato TypeScript

Prima cosa: le **cinque voci** in `docs/OPEN_QUESTIONS.md` (Q35-Q39), tutte
`Decided: not yet`, nel formato esistente — così i `TODO(open-question)` del
codice citano qualcosa che esiste. Contenuti in §E del piano committato.
(Regola CLAUDE.md n. 3: si **aggiunge**, non si risolve.)

**`pageLayout.ts`**: `export interface BBox`, `export function objectBBox(obj)`
— il corpo della closure `SvgCanvas.tsx:846-864` spostato **invariato** — e
`isOffPage` come §3a: intervalli **chiusi**, `false` in fluido, `false` per pipe
con `from_obj_id`/`to_obj_id`. Più `export const CASI_FUORI_PAGINA` a colonna 0,
la tabella di ~12 casi che in D verrà diffata col gemello Rust.

**`SvgCanvas.tsx`**: cancellare la closure e
`import { objectBBox as objBBox } from "@/pageLayout"` — le **6 chiamate**
(`:762`, `:1086`, `:1171`, `:1311`, `:1694`, `:1811`) non si toccano.
Gate viewer dopo `:1552` (`if (!visible && !inEdit) return null`), e in `gStyle`
(`:1581-1588`) `offPage` **dopo** il ramo `!visible && inEdit`, così il grigio
vince sull'opacità 0.35 e non passa da `previewEffects`. Commento contestuale su
F11 (perché il `min_role` in editor **non** è attenuato mentre il fuori-pagina sì).

**R8, metà editor**: riga in `PageProps` (`EditorShell.tsx:1373`) sotto i campi
dimensioni quando `n > 0` oggetti fuori pagina.

Verifica: build + `pnpm test` (tabella di verità); a occhio i casi 3.37 e 3.42
restano per il maintainer. **Arresto pulito con divergenza dichiarata**: il
browser salta gli oggetti fuori pagina, LVGL e validatore ancora no — un rigo in
STATUS se la giornata finisse qui.

---

## Sessione D — gemello Rust, validatore, guardia

**`sws-runtime/crates/sws-core/src/geometry.rs`** (nuovo) + `pub mod geometry;`
fra `alarm` e `logbus` in `lib.rs:1-4` e un `pub use` nel blocco `:6-17`.
Firma **numerica** (ADR 0002: non accoppiare i due mirror):
`BBox`, `bbox_of(obj_type, x, y, w, h, x2, y2, points: &[(f64,f64)])`,
`is_off_page(&BBox, Option<f64>, Option<f64>)`, più
`pub const CASI_FUORI_PAGINA` con la stessa tabella del TS e i `#[cfg(test)]`
che la percorrono.

**Adattatori** — sottili, non ridefiniscono niente, e **non sono simmetrici**
(correzione n. 4):
- `sws-web/src/synoptic.rs`: `impl SynopticObject { fn bbox(&self); fn is_off_page(&self, page: &SynopticPage) }`, con l'estrazione dei punti da `Option<serde_json::Value>`;
- `sws-lvgl-viewer/src/model.rs`: lo stesso con `unwrap_or(0.0)` e `Option<Vec<PipePoint>>`.
  Entrambi **dopo** la chiusura della struct, che `check_lvgl_parity.sh` non guarda.

**Validatore** (`validate.rs`): `if o.is_off_page(p) { continue; }` nel **secondo**
ciclo (`:559-562`), non nel primo — gli id duplicati restano accesi. Più il
**warn di pagina** di R8, modellato su `:534-545` (path `format!("pages[{}]", p.name)`,
tre argomenti, `hint` che dice la conseguenza). Test: oggetto fuori con `tag`
inesistente ⇒ zero rilievi per-oggetto e un warn di pagina; lo stesso dentro ⇒ il
rilievo torna.

**LVGL** (`lvgl_render.rs`): il gate va **fra `:6119` e `:6120`** — dopo il
destructuring id/type, **prima** di `apply_bindings` (`:6127`) e `punti_ancorati`
(`:6133`), perché dopo quelle due righe `obj` è ombreggiato e misurerebbe in
silenzio la cosa sbagliata; un commento in loco lo dice, perché nessun compilatore
lo direbbe. Campo `skipped_off_page` in `RenderSummary` (`:70-74`) e nelle **4**
stampe di `main.rs`. Nello stesso passaggio, il commento **«gap dichiarato»**
accanto a `model.rs:454-456` (F1), nella forma già usata a `:179-185` / `:604-611`,
con rimando a Q36.

**`scripts/check_off_page.sh`** (nuovo, in **`STATICHE`**): estrae le due
`CASI_FUORI_PAGINA` (delimitatore = la dichiarazione stessa, come
`check_lvgl_symbols.sh:35`), normalizza, `diff`; e tratta «dichiarazione non
trovata» come **errore esplicito** con il messaggio di `check_lvgl_types.sh:36-45`
(«la guardia è cieca», non «il dato è sparito»). Verifica anche che i due crate
**chiamino** `is_off_page` invece di reimplementarlo. Nota nel messaggio di commit
sul precedente F9 (`textOnBackground.test.ts` ↔ `lvgl_render.rs:7284-7290`, tabella
duplicata senza guardia), senza allargare la sessione.

Registrazione in `check_static.sh:29-39` **e** in `scripts/README.md` (`:227`,
`:229`, `:249` e una riga in tabella dopo `:260`), sistemando l'incoerenza
preesistente del conteggio.

Verifica: da `sws-runtime/`, `cargo check --workspace --all-targets`,
`cargo test --workspace`, `./scripts/check_static.sh` (tutte verdi),
`./scripts/check_lvgl_parity.sh` (nessun campo nuovo: **deve** restare verde, ed è
la dimostrazione).

---

## Sessione E — documenti

`docs/TESTING_GUIDE.md`: nuova sottosezione **`### Limite pagina — bordo morbido`**
in coda alla §3 con i casi 3.31-3.45 del piano committato (3.35 resta marcato «da
confermare a schermo» solo per la conferma finale del maintainer; il colore è deciso).
`docs/manual/04_editor_guide.md`: un paragrafo «Il limite della pagina» dopo LAYOUT (`:107`).
`CHANGELOG.md` sotto `[Unreleased]`. `STATUS.md`: sostituire il blocco T-52 con
l'esito, il numero base dei test misurato oggi, e la lista dei casi manuali che
restano da guardare prima del merge.
Se le schermate del manuale mostrano il canvas, rilanciare `e2e/screenshots.spec.ts`.

## Cosa non faccio

- **Niente push, niente merge, niente `main`** oltre ai commit meta. Il ramo resta
  `feat/T-52-limite-pagina-morbido`, pronto per la tua conferma a schermo.
- **Niente questioni fuori scope**: F2, F6, F8 restano per il branch di
  manutenzione dopo T-52; F3/F4/F7/F10 restano Q37-Q39.
- **Niente riparazione dei tre difetti dei giudici** trovati in sessione A
  (`check_viewer_layout.sh` col template inesistente, l'uscita muta senza
  `LD_LIBRARY_PATH`, i measure che ignorano `SWS_E2E_CHROMIUM`) — tranne la riga
  `SWS_E2E_CHROMIUM` nel measure **nuovo** che scrivo io, che è gratis.
- **Nessuna decisione presa da solo su OPEN_QUESTIONS**: si registrano, non si risolvono.

## Verifica end-to-end

Alla fine, dal repo:

```bash
pnpm --dir sws-editor build && pnpm --dir sws-editor test
cd sws-runtime && cargo check --workspace --all-targets && cargo test --workspace && cd ..
./scripts/check_static.sh
./scripts/check_off_page.sh
./scripts/check_soft_edge.sh          # browser vero: trattenuto/sganciato/zoom/gruppo
./scripts/check_multiselect_drag.sh
./scripts/check_wysiwyg.sh
```

Restano **a te**, prima del merge: i casi 3.35 (bande nel viewer), 3.37-3.40
(la sensazione al tatto del trattenimento), 3.43 (confronto pannello LVGL ↔ browser).

## File critici

- `sws-editor/src/pageLayout.ts` — `softEdgeAxis`/`softClampToPage`/`objectBBox`/`isOffPage`/`CASI_FUORI_PAGINA`, via `clampToPage`
- `sws-editor/src/canvas/SvgCanvas.tsx` — `DragState` `:115`, `startDrag` `:1323`, drag `:1138-1255`, resize `:1133`, `objBBox` `:846`, gate `:1546-1557`, `gStyle` `:1581`
- `sws-editor/src/EditorShell.tsx` — `PageProps` `:1373` (riga R8)
- `sws-editor/tests/pageLayout.test.ts`, `sws-editor/scripts/soft_edge_measure.mjs` (nuovo)
- `sws-runtime/crates/sws-core/src/{geometry.rs (nuovo),lib.rs}`
- `sws-runtime/crates/sws-web/src/{synoptic.rs,validate.rs}`
- `sws-runtime/crates/sws-lvgl-viewer/src/{model.rs,lvgl_render.rs,main.rs}`
- `scripts/{check_off_page.sh (nuovo),check_soft_edge.sh (nuovo),check_static.sh,README.md}`
- `docs/{OPEN_QUESTIONS.md,TESTING_GUIDE.md,manual/04_editor_guide.md}`, `STATUS.md`, `CHANGELOG.md`
