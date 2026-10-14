# Strumenti riorganizzati, simboli nella palette, e il simbolo che comanda

> **Piano d'esecuzione, approvato il 14-10-2026**, nato dalla sessione di plan sui semi
> [menù Strumenti e icone](../archive/2026-10-14-menu-strumenti-e-icone.md) e
> [bottone come nella realtà](../archive/2026-10-14-bottone-come-nella-realta.md). Stato: tre rami, nessuno iniziato.

## Context

Due semi del 14-10-2026 — `docs/archive/2026-10-14-menu-strumenti-e-icone.md` (gerarchia, filtro, icone del menù
Strumenti) e `docs/archive/2026-10-14-bottone-come-nella-realta.md` (il bottone che sembri la cosa vera: levette,
pulsanti, selettori) — più un'osservazione del maintainer che li unisce: «il pulsante symbol è un pulsante chiave di
uno SCADA, potrebbe valere la pena trasformarlo in un menù di oggetti organizzati per tipologia».

Con la libreria di simboli (138, quattro famiglie, 18 tipologie, nomi tradotti nel manifesto) la tipologia esiste già;
e se gli interruttori diventano simboli che sanno comandare, il secondo seme si risolve dentro il primo: «bottone» e
«interruttore a levetta» sono lo stesso concetto con due aspetti, e trovano posto nello stesso ramo della palette.

I due semi sono in archivio, con un rimando a questo piano.

## Scelte del maintainer (14-10-2026)

| Domanda | Scelta |
|---|---|
| Interruttori e pulsanti «veri» | **il simbolo impara a comandare**: le modalità e le assegnazioni del bottone anche sui simboli; famiglia nuova «Comandi» nella libreria. Il bottone di oggi resta |
| Simboli nella palette | **albero con anteprima**: Strumenti ▸ Simboli ▸ famiglia ▸ tipologia ▸ una riga per simbolo, clic = nasce già scelto |
| Icone degli strumenti | **SVG nostri**; la dimensione (16 px o più) si decide su una tavola di prova |
| Ordine | **prima Strumenti, poi i comandi** |

## Misurato oggi (main `3e3d0be6`)

- Palette: `PALETTE_GROUPS` in `sws-editor/src/editor/LeftPanel.tsx:655`, 5 gruppi, 38 tipi; «Display» ne ha 18,
  «Layout» 1. Riga = `t("editor.palette.item.<type>")`; il campo `label` non lo legge nessuno. Clic → `handleAddObject`
  (`EditorShell.tsx:650`); per `symbol` apre `SymbolPickerModal` (`:245`), che crea l'oggetto con le proporzioni del
  manifesto (`trovaSimboloLib`). Filtri per contesto: pagine di boot (`BOOT_TYPES`) e progetti LVGL
  (`LVGL_SUPPORTED_TYPES`) a `LeftPanel.tsx:846-853`.
- Icone: 9 emoji + 29 glifi Unicode; `≣` doppione (`data_log`, `text_list`).
- Libreria: `sws-editor/public/symbols/lib/manifest.json` → `symbols[]` con `family`, `kind`, `label` (chiave i18n),
  `viewBox`, `parts` (`lamp` 27, `rotor` 20, `level` 12, `lever` 5, `needle` 3). Anteprima già pronta:
  `AnteprimaLib` (`EditorShell.tsx`), `SimboloLibSvg`.
- Simboli con leva oggi: tre valvole, `electrical/circuit-breaker`, `machines/limit-switch`. **Nessun simbolo scrive.**
- **LVGL ignora `button_mode`**: il campo è in `model.rs:528` ma `render_button` scrive solo `write_value` (dall'11-10
  anche le assegnazioni). Toggle, momentaneo, set/reset, incremento/decremento oggi **non funzionano sul pannello**.
- Inventari che reagiranno: `tests/pannelloProprieta.test.tsx:96`, `tests/predefinitiCampi.test.ts:17`,
  `tests/fixtures/campiPannelloProprieta.json`.

## Ramo 1 — `feat/strumenti-riorganizzati` (solo editor)

1. **Gerarchia nuova** (proposta, da confermare a schermo):
   Forme (rect, ellipse, line, polyline, polygon) · Testo e immagini (text, image) · Comandi (button, checkbox, radio,
   slider, setpoint) · Indicatori (led, state_lamp, gauge, progress_bar, kpi_tile) · Grafici (trend, sparkline,
   xy_plot, bar_chart, pie_chart) · Tabelle e registri (table, data_log, text_list, recipe_panel) · Allarmi
   (alarm_viewer, alarm_banner, alarm_bell, alarm_history) · Navigazione e lingua (navbutton, page_navigator,
   lang_selector, lang_button) · Impianto (pipe, faceplate, grid) · **Simboli** (ramo sotto).
   Nessun `type` cambia: i test d'inventario restano validi. Il campo morto `label` sparisce.
2. **Ramo Simboli**: famiglia ▸ tipologia ▸ simbolo, letti dal manifesto; ogni riga ha l'anteprima (riuso di
   `AnteprimaLib`) al posto dell'icona; clic = `addObject` con `symbol_id` e proporzioni (stessa logica di oggi in
   `SymbolPickerModal`, estratta in una funzione). I simboli custom del progetto in una famiglia «Del progetto». Il
   riquadro di scelta resta per «cambia simbolo» nelle proprietà.
3. **Filtro** in cima a Strumenti: cerca nelle etichette tradotte (chiavi i18n, non `label`) di strumenti e simboli,
   e nei nomi di famiglia/tipologia; con testo attivo mostra un elenco piatto dei risultati (gruppo come
   sottotitolo); `Esc` lo svuota. Rispetta i filtri di contesto (boot, LVGL); un gruppo vuoto non si disegna.
4. **Icone SVG**: un file `editor/iconeStrumenti.tsx` con un componente per tipo (tratto, `currentColor`, viewBox
   unico). **Prima**: una tavola di prova con le 38 icone a 16, 20 e 24 px in chiaro e scuro, per decidere la misura;
   poi tutte. Guardia nuova `check_icone_strumenti.sh`: ogni tipo della palette ha la sua icona, nessuna emoji.
5. Test: vitest per gerarchia (nessun tipo perso, nessun gruppo vuoto sotto i filtri), ramo Simboli (clic crea con
   `symbol_id`), filtro (lingua, elenco piatto, contesto); inventari aggiornati.

## Ramo 2 — `feat/simbolo-che-comanda` (web + LVGL + validatore)

1. **Le sette modalità su LVGL** per il bottone (oggi solo `write`): `toggle`, `momentary` (pressione/rilascio),
   `set`/`reset`, `increment`/`decrement` con `step`/`min`/`max` — parità con `SvgCanvas.tsx:4124`. Generalizzare
   `scritture_del_bottone`/`ButtonClickCtx` (`lvgl_render.rs`) in un «comando» che legge il valore corrente dove serve.
2. **Il simbolo comanda**: `button_mode`, `write_value`, `release_value`, `step/min/max`, `assegnazioni`,
   `require_confirm`, `critical` validi anche su `type: symbol`. Web: il ramo `symbol` di `SvgCanvas` usa lo stesso
   `guardedWrites`; LVGL: il contenitore del simbolo diventa cliccabile solo se ha un comando, stesso contesto del
   bottone. Un simbolo senza comando resta com'è (non cliccabile).
3. Editor: la sezione «Al clic» (modalità + assegnazioni) del bottone, estratta in un componente, anche nelle
   proprietà del simbolo; una spunta «questo simbolo comanda» la mostra. Regola UI 2: un campo per dato.
4. Specchi del modello: `synoptic.rs`, `model.rs` (LVGL), schema rigenerato, validatore (valori nel tipo come per il
   bottone), `check_lvgl_parity`, inventario dei campi.
5. Test Rust (modalità LVGL, simbolo cliccabile solo con comando), vitest (clic su simbolo scrive), e dal vivo:
   runtime di prova + browser senza schermo + `--istantanea --tocca` LVGL (che stampa i comandi prodotti).

## Ramo 3 — `feat/simboli-comandi` (libreria, a lotti)

Famiglia nuova **«controls» / Comandi** nel generatore della libreria (stesso formato, manifesto generato), con le
parti vive esistenti: pulsante (normale, luminoso con `lamp`), pulsante a fungo / emergenza, interruttore a levetta
(`lever`), selettore a 2 e 3 posizioni (`lever` a più posizioni), a chiave. Ogni voce nasce con un comando di
partenza sensato (es. levetta = `toggle`, fungo = `set`, selettore = assegnazioni). Elenco definitivo con il
maintainer davanti a un impianto, primo lotto 6 simboli. Il resto della libreria non cambia.

## Fuori da questo piano

- Il bottone di oggi non si tocca nell'aspetto: i progetti esistenti si disegnano come prima.
- Gerarchia e icone valgono per la palette; altri punti che nominano un tipo (albero degli oggetti, ricerca) le
  adotteranno dopo, se servono.

## Verifica (per ogni ramo)

`cargo check`, `cargo test` (sws-web, LVGL), `pnpm build`, vitest, `./scripts/check_static.sh`; per i rami 2 e 3 la
prova dal vivo descritta sopra e il collaudo sul TC620 (raggiungibile da `ufficio`). Merge solo dopo l'ok del
maintainer, un ramo alla volta.
