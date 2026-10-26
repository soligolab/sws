# Il corpo del testo su tutti i tipi, e i testi che LVGL non disegna

**Stato: FATTO il 25-10-2026** (da collaudare sul pannello) sul ramo `feat/corpi-e-parita-lvgl` (annidato sui rami del
25-10). Chiude il **ramo 5** del [piano dei residui](../archive/2026-10-19-chiusura-dei-residui.md) (decisione
del maintainer: «tutti» i tipi) e le divergenze fra i due motori trovate misurando.

Decisioni del maintainer (25-10-2026):
- **tutto insieme**: corpi e testi mancanti su LVGL in un ramo solo;
- **l'unità ha un campo suo**, `unit_font_size`, per la regola già decisa «un campo per testo».

Valgono le regole del secondo giro (22-10):
- un campo per testo;
- le misure derivano dal corpo (`geometria_testo.rs` / `geometriaTesto.ts`, fixture
  `tests/fixtures/geometria-testo.json`);
- dove i motori divergono, **prima si allinea** (il pannello al web);
- i predefiniti sono **i numeri di oggi del web**, quindi nessun progetto cambia aspetto sul web.

## La misura (25-10-2026)

Un agente ha letto i due motori, tipo per tipo. Su LVGL "eredita 14" vuol dire che il testo non
imposta un font e prende i 14 px dello schermo.

| Tipo | Web | LVGL | Divergenza |
|---|---|---|---|
| gauge | tacche 9, min/max 10, valore 20, unità 11, etichetta 11 | etichetta 11, tacche e valore ereditano 14 | **valore e unità in una label** |
| kpi_tile | etichetta 11, valore 26, unità 12, delta 11 | 11 / 26 / 11 cablati | **valore e unità in una label** |
| data_log | 11 (etichetta, barra pagine, tabella) | 11 | **niente barra delle pagine** |
| lang_selector | 13 | eredita 14 | codici in minuscolo, il web li mostra in maiuscolo |
| symbol | etichetta di stato 11 | — | **niente etichetta di stato** |
| alarm_viewer | 11 (ACK 9, accantona 10) | eredita 14, solo modo elenco | **niente modi banner e tabella** |
| alarm_banner | 13 (pillola 11, ACK 12), un elenco | eredita 14, un allarme solo | **niente pillola ISA né ACK** |
| alarm_bell | 12 (badge e righe 11) | eredita 14 | **niente icona della campana** |
| alarm_history | 11 (titolo, tabella, pagine), dettagli 10 | tabella 11 | **niente titolo, sottoriga, pillole, pagine** |
| recipe_panel | 11 (pulsante ed esito 10) | eredita 14 | **niente stato vuoto né esito** |
| clock | `font_size` 16 senza predefinito | legge `font_size`, eredita 14 se manca | il ripiego |
| page_navigator | `font_size` 13 senza predefinito | idem | il ripiego |
| sparkline | ultimo valore 9 | — | **niente ultimo valore** |
| grid, faceplate | nessun testo proprio a runtime | — | niente da fare |

## Strato 1 — i corpi nei predefiniti e sul web

Per ogni tipo, la voce in `tests/fixtures/predefiniti-campi.json` e in `predefinitiCampi.ts`, il
letterale del web che diventa `predefinito(tipo, campo)`, il campo nel pannello proprietà e la voce
in `campiPannelloProprieta.json`.

| Tipo | `font_size` | `label_font_size` | `unit_font_size` | Derivati |
|---|---|---|---|---|
| gauge | 20 (valore) | 11 (etichetta) | 11 | tacche `corpo_annotazione(etichetta)`=9, min/max `corpo_secondario(etichetta)`=10 |
| kpi_tile | 26 (valore) | 11 (etichetta e delta) | 12 | — |
| data_log | 11 (tabella e pagine) | 11 (etichetta) | — | — |
| lang_selector | 13 | — | — | — |
| symbol | — | 11 (etichetta di stato) | — | — |
| alarm_viewer | 11 | — | — | ACK `corpo_annotazione`=9, accantona `corpo_secondario`=10 |
| alarm_banner | 13 | — | — | pillola `corpo_annotazione`=11, ACK `corpo_secondario`=12 |
| alarm_bell | 12 | — | — | badge, messaggio e ACK `corpo_secondario`=11 |
| alarm_history | 11 | — | — | dettagli `corpo_secondario`=10, attesa `corpo+1` |
| recipe_panel | 11 | — | — | pulsante ed esito `corpo_secondario`=10 |
| clock | 16 | — | — | solo la voce dei predefiniti |
| page_navigator | 13 | — | — | solo la voce dei predefiniti |
| sparkline | 9 (ultimo valore) | — | — | — |

**`unit_font_size` è un campo nuovo**, quindi tocca quattro posti: tipo TS, `sws-web/src/synoptic.rs`,
il modello LVGL, lo schema IA (rigenerato). Va anche in `CAMPI_SCALATI` (pixel, come `font_size`).

## Strato 2 — LVGL legge i corpi

- `apply_font_size_con_ripiego`, o `etichetta_piccola_corpo`, al posto dei 14 ereditati e dei letterali.
- **gauge e kpi_tile separano valore e unità** in due label, come il web («prima si allinea»).
- clock e page_navigator col ripiego dei predefiniti.

## Strato 3 — i testi che LVGL non disegna

- **symbol**: etichetta di stato sotto il simbolo.
- **sparkline**: ultimo valore (`spark_show_last`).
- **alarm_banner**: pillola di stato ISA e ACK, sulla riga.
- **alarm_history**: titolo e barra delle pagine; sottoriga del messaggio e pillole di stato nelle
  righe, se la tabella LVGL lo regge (altrimenti si dichiara qui perché no).
- **data_log**: barra delle pagine.
- **recipe_panel**: stato vuoto e riga d'esito.
- **alarm_bell**: l'icona (simbolo LVGL della campana).
- **lang_selector**: codici in maiuscolo.
- **alarm_viewer**, modi banner e tabella: il banner riusa il disegno di `alarm_banner`, la tabella
  quello di `alarm_history`.

## Verifica

- Test gemelli dei predefiniti (`predefinitiCampi.test.ts`, `check_predefiniti.sh`); test LVGL per ogni
  testo nuovo, sul modello di quelli esistenti in `lvgl_render.rs`.
- `cargo test`, vitest, `pnpm build`, `check_static.sh`.
- Collaudo sul pannello (TC620 in modalità LVGL, o WP630) con un progetto che usa tutti questi tipi:
  `demo-items-lvgl` li copre.

## Com'è andata (25-10-2026)

Sei commit, uno per strato o gruppo di tipi. Le scelte prese facendo:

- **I ripieghi del pannello hanno una tabella** (`CORPI_PREDEFINITI` in `lvgl_render.rs`) e un test che la
  confronta con la fixture (`i_corpi_del_pannello_sono_quelli_della_tabella`): prima su LVGL i numeri erano
  sparsi e nessuna guardia li guardava, come invece `check_predefiniti.sh` fa per il web.
- **kpi_tile**: valore e unità in una riga flessibile di LVGL, così l'unità segue il valore qualunque sia la sua
  larghezza (il `<tspan>` del web). **gauge**: due etichette, l'unità sotto il valore come sul web.
- **Le pagine dello storico allarmi e del registro dati diventano scorrimento**: sul pannello la tabella
  (`tabella.rs`) scorre col dito, e si caricano tutte le righe (200 eventi, i campioni di tutta la finestra).
  Tutte le righe sono raggiungibili come sul web con ◀ ▶; i pulsanti di pagina sul pannello non servono.
- **Lo storico allarmi su LVGL passa dalla `lv_table` al motore `tabella`** (scuro, scorrevole, col corpo), col
  titolo «STORICO ALLARMI». **Restano del web, e si dichiara**: la sottoriga del messaggio e le pillole di stato
  dentro le righe — una cella del motore `tabella` è un testo solo; il messaggio sta nella sua colonna e lo stato
  in quella dopo.
- **alarm_viewer**: il modo banner riusa il disegno di `alarm_banner`; il modo tabella usa l'elenco (stessi
  allarmi, stessi ACK). Le colonne ordinabili e filtrabili restano del web.
- **alarm_banner**: pillola ISA (piena e del colore della severità per l'attivo, col bordo per il rientrato) e ACK
  sulla riga visibile. Il web con l'altezza tipica di 32 px mostra anch'esso una riga per volta.
- **alarm_bell**: la campana è il `LV_SYMBOL_BELL` del Montserrat compilato, in un'etichetta sua (DejaVu non ha
  né l'emoji né i simboli di LVGL — stessa ragione di `restore_symbols_on`).
- **recipe_panel**: stato vuoto e riga d'esito; l'esito torna dal thread di rete in una cella condivisa che il
  disegno legge (`LiveKind::EsitoRicetta`, come il delta del kpi).
- **symbol**: l'etichetta dello stato attivo sotto il simbolo; **sparkline**: l'ultimo valore in alto a destra.
- Tolte le funzioni rimaste senza chiamanti: `tabella_scura`, `etichetta_piccola`, `set_cell`, `ora_utc`.
