# Un faceplate si disegna, non si scrive in JSON — piano d'esecuzione

## Context

Nato come seme il 27-10-2026 collaudando lo slider sul WP630: un faceplate si modifica scrivendo
JSON in una textarea (`FaceplatesTab.tsx`, 305 righe), il maintainer vuole disegnarlo come una
pagina, col JSON raggiungibile da un pulsante. Sessione di plan il 28-10-2026; decisioni del
maintainer:

1. **Strada B**: il faceplate diventa una pagina `kind: "faceplate"` — quarta ripetizione dello
   schema di cornici (15-10), pagine di boot (T-72) e finestre (P1). La scheda Faceplates in
   Configurazione **sparisce**, sostituita da una sezione in LeftPanel accanto a Cornici e Boot.
2. **Misura dichiarata**: `width`/`height` opzionali in `FaceplateDef`, nati = bbox derivato alla
   conversione, poi modificabili. `faceplateDefBBox` li preferisce quando ci sono → le istanze
   con `faceplate_scale` esistenti non cambiano di un pixel.
3. **JSON = definizione intera** (label, parametri, oggetti) in una modale, da un pulsante.
4. **Niente faceplate dentro faceplate nell'editor**: la palette non offre il tipo, add/paste lo
   rifiutano. LVGL già lo vieta nel render; il web runtime continua a disegnare l'annidamento dei
   progetti esistenti (nessuna rimozione a runtime).

### Perché la strada B costa meno (misurato il 28-10-2026)

Tutto ciò che è chiavato su `currentPageId` si eredita gratis: selezione multipla, CRUD oggetti,
copia/incolla, allineamenti, griglia/snap, undo/redo (snapshot globale di `pages`), pannello
proprietà. I punti di aggancio espliciti per un nuovo `kind` sono una lista corta e nota, già
percorsa tre volte. La strada A avrebbe richiesto di far lavorare canvas+selezione+undo su uno
stato che pagina non è, senza ereditare niente.

## Misurato il 28-10-2026 (i punti di aggancio)

| Pezzo | Dove | Cosa fare |
|---|---|---|
| Unione `kind` | `sws-editor/src/types/index.ts:926` | aggiungere `"faceplate"` |
| Conversioni | — (nuovo `src/faceplate/modello.ts`, gemello di `src/cornici/modello.ts`) | `faceplateAPagina`/`paginaAFaceplate`, `eFaceplateDef`, `pagineFaceplate`, prefisso `"faceplate:"` |
| Caricamento | `src/api/client.ts:1492` `loadAllPages` | quarto blocco: `listFaceplates`+`getFaceplate` → `faceplateAPagina` |
| Salvataggio | `src/store/index.ts:2890` dispatch di `saveAll` | `eFaceplateDef(p) ? api.saveFaceplate(paginaAFaceplate(p))` — **solo se cambiato** (vedi built-in) |
| Chiavi/delete | `src/boot/tipi.ts:50` `chiavePagina`; store:2908 | prefisso `faceplate/<id>` → `api.deleteFaceplate` |
| Ordinamento | store:932 `conOrdineAlbero`, `boot/tipi.ts:43` `sinotticiPoiBoot` | faceplate in coda, dopo le cornici |
| Fuori navigazione | `boot/tipi.ts:24` `paginePerNavigazione` | filtrare **qualunque `kind` valorizzato** (più robusto di elencare i tre); gemello Rust `da_navigare` (`validate.rs:492`) |
| Palette | `LeftPanel.tsx:1010` `paletteForTarget` | su pagina faceplate: togliere il tipo `faceplate` (annidamento vietato); il resto intero (meno filtro LVGL se target lvgl) |
| Gate store | store:1867 `addObject`, :2112 `pasteClipboard` | rifiutare `type: "faceplate"` su pagina faceplate (come i gate BOOT_TYPES) |
| Sezione LeftPanel | `LeftPanel.tsx:644-654` | quarta `RamoPagine` «Faceplates» |
| Condizionali EditorShell | `EditorShell.tsx:1346-1361` | PageProps per kind faceplate; `sizeMode="fixed"` |
| deletePage | store:1459 | la guardia «ultima pagina» non deve contare/bloccare i faceplate; i built-in si «ripristinano», non si eliminano |
| scalaProgetto | store:1558 | **salta** le pagine faceplate (scalare il modello romperebbe le istanze) |
| API | `client.ts:1548-1557` | già esistente, con header versione Q30 — invariata |
| Rust def | `sws-web/src/synoptic.rs:853-862` `FaceplateDef` | `width`/`height: Option<f64>` con serde default; schema (`synoptic_schema.rs`, `schema_api.rs`) rigenerato, guardia `check_synoptic_schema` |

Fatti rilevanti dal codice:
- `FaceplatesTab.tsx`: grammatica parametri `nome:tipo(rif)=predefinito!` serializzata/parsata
  inline — muore con la scheda, nessun altro la usa. `usageOf` (istanze + `open_faceplate`) si
  sposta in `faceplate/modello.ts`.
- Rust: params/objects di `FaceplateDef` sono `Value` opachi (passthrough) — i due campi misura
  sono l'unica modifica di struttura. `save_faceplate` forza l'id dal path e ha il caso speciale
  per la prima personalizzazione di un built-in (niente 409). Export/deploy/istantanea/impronta
  coprono già `faceplates/`.
- I 3 built-in (`sws-runtime/assets/faceplates/*.yaml`, `include_str!` in router.rs:7294) hanno
  params in forma storica (stringhe nude) e nessuna misura.
- `substituteFaceplateParams` esclude `id`/`type`/`group_id`/`faceplate_id` → selezione/drag per
  id funzionano su oggetti sostituiti.
- `validate.rs:109` considera già valido un tag con `{` (`e_segnaposto`).
- LVGL `render_faceplate` (lvgl_render.rs:12590) ignora misura/scale/overrides e sostituisce solo
  tag/label/text: niente da toccare su LVGL in questo piano.
- `faceplateDaSelezione.ts` («Crea faceplate dalla selezione», testato) oggi salva subito via API:
  passerà a creare la pagina `kind: "faceplate"` nello store (ciclo di salvataggio normale, undo
  compreso).

## Il modello

- `SynopticPage` guadagna `faceplate_parametri?: FaceplateParamDef[]` (come `cornice_testata`:
  vive solo sulla pagina-faceplate aperta, mai su `synoptics/`).
- `faceplateAPagina(def)`: id `faceplate:<id>`, `name = label`, `kind: "faceplate"`,
  `width/height = dichiarate ?? faceplateDefBBox(def)`, `objects`, `faceplate_parametri =
  normalizeFaceplateParams(def)`.
- `paginaAFaceplate(p)`: inverso; i parametri si scrivono in forma tipizzata (la forma a stringhe
  nude dei built-in si normalizza al primo salvataggio — già accettata ovunque).
- L'**id** non si modifica più dall'editor (oggi la scheda lo mutava in place senza integrità
  referenziale): visibile in sola lettura nelle proprietà. Il rename cambia `label`.
- Fonte unica nell'editor = `pages`: EditorShell calcola `faceplates` derivati
  (`useMemo(pagineFaceplate(pages).map(paginaAFaceplate))`) e li passa dove già passano come prop
  (SvgCanvas, pannello proprietà, ricerca, tagUsage/findObjects). Così **modificare il faceplate
  aggiorna live le istanze sulle altre pagine**, come il sottofondo delle cornici.
  `RuntimeViewer`/`RuntimeView` continuano a caricare da API in `store.faceplates`, invariati.
  Il percorso AI (`applyAiProposal`, store:2771, `faceplateCambiati`) si adatta a scrivere le
  pagine corrispondenti.

### I built-in e il salvataggio

Le cornici si risalvano tutte a ogni `saveAll`; qui no: risalvare un built-in identico lo
materializzerebbe come file di progetto. Al load si tiene una firma per faceplate
(`JSON.stringify` della def, come `bootPngFirme`); `saveAll` salva solo i cambiati. La × su un
built-in personalizzato = «Ripristina il predefinito» (DELETE dell'override, il built-in
ricompare); su un built-in mai toccato la × non c'è.

## Canvas: visti sostituiti, scritti come riferimento

- Quando `eFaceplateDef(currentPage)`, EditorShell passa al canvas
  `objects.map(o => substituteFaceplateParams(o, anteprima))` con
  `anteprima[p.name] = p.default ?? p.name` (la regola dell'anteprima di oggi: il parametro senza
  default si sostituisce col proprio nome, segnaposto visibile). Lo **store resta coi riferimenti
  `{param}`**; il pannello proprietà legge l'oggetto raw e mostra `{p}.level`.
- PageProps per kind faceplate: misura (= misura dichiarata), sezione **Parametri** (estensione
  del pattern `ProprietaFinestra`: nome, tipo tag/string/number/color/istanza con `type_ref`,
  default, required → scrive `faceplate_parametri` via `updatePageProps`, undo compreso),
  «Usato in…» (da `usageOf`), pulsante **JSON** → modale con la definizione intera
  (`paginaAFaceplate` della pagina corrente, stringify 2 spazi); «Applica» solo se il JSON è
  valido e senza figli `type: "faceplate"`, riscrive la pagina in **un** passo di history.
  Niente sfondo/cornice/zone/rotazione/finestra (come cornice/boot).
- Niente live data nel foglio del faceplate: i tag sono riferimenti `{p}.x`, il canvas li tratta
  come tag senza valore (stesso comportamento dell'anteprima di oggi). WYSIWYG rispettata: ogni
  figlio usa il proprio rendering, «Anteprima effetti» funziona già.

## Validatore e ricerca

- `validate.rs`: rilievo nuovo «faceplate dentro un faceplate» (warn; sui progetti `target: lvgl`
  dice che il pannello non lo disegna). Il server resta passthrough al salvataggio (coerente; un
  rifiuto romperebbe il salvataggio dei progetti esistenti con annidamento).
- Ricerca globale: i faceplate escono dal mondo «impostazioni» (`RicercaGlobale.tsx:130`) ed
  entrano come pagine (verificare come il mondo «pagine» tratta cornici/boot e allinearsi); foglia
  via da `AlberoConfigurazione.tsx:77`, voce via da `SCHEDE` (`config/schede.ts:79`), SaveBar e
  `elenchiConfig` della scheda rimossi; i18n ripulita (`check_i18n_ui`).

## Rami (uno alla volta)

1. **`feat/faceplate-pagina`** — modello e trasporto: unione `kind`, `faceplate/modello.ts` con
   conversioni e round-trip su fixture condivisa (come `tests/fixtures/cornici.json`),
   `loadAllPages`, dispatch `saveAll` con firme, delete, ordinamento, `paginePerNavigazione`/
   `da_navigare`, campi misura in Rust + schema, `scalaProgetto` salta, guardia `deletePage`.
2. **`feat/faceplate-editor`** — UI: sezione LeftPanel, palette e gate, canvas sostituito,
   PageProps (parametri, misura, usato-in, JSON), rimozione FaceplatesTab e voci collegate,
   ricerca globale, `faceplateDaSelezione` → pagina, i18n it/en.
3. **`feat/faceplate-rifiniture`** — rilievo validatore, manuale (04 editor, 05 widget),
   CHANGELOG + NOVITA (it+en), verifica gemelli demo (nessun cambiamento atteso:
   `check_demo_templates.sh` copre il tipo genericamente), **CasaDomotica**: ridisegnare
   `tank_level` dal canvas e collaudarlo sul WP630 (regola del 16-10).

## Fuori da questo piano

- Il gap LVGL della sostituzione (solo tag/label/text contro il walker completo del web) — già
  documentato in `parametri.rs`; se serve, seme suo.
- `faceplate_overrides` resta senza UI (write-only da file, com'è oggi).
- Una guardia di ciclo nel render web per l'annidamento pre-esistente: l'editor ora impedisce di
  crearlo, il runtime resta com'è.
- Editing dell'id di un faceplate (rinomina referenziale): se servirà, seme suo.

## Verifica

- Definition of done completa: `cargo check` + `cargo test` + `pnpm build` + vitest +
  `./scripts/check_static.sh`, e conferma del maintainer.
- vitest nuovi: round-trip conversioni; `anteprima` default ?? nome preserva gli id; gate palette/
  add/paste su pagina faceplate; `saveAll` salva solo i cambiati (un progetto coi 3 built-in non
  li materializza); chiavi/delete; JSON apply valido/invalido/annidato; `faceplateDaSelezione`
  crea la pagina.
- cargo: round-trip YAML dei campi misura; rilievo annidamento; built-in con misura assente.
- Dal vivo (IDE 8460): aprire `tank_level`, trascinare un figlio, vedere l'istanza su una pagina
  normale aggiornarsi live, undo, JSON, salvare, ricaricare; collaudo sul WP630 con CasaDomotica.
