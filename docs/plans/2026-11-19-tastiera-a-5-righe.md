# La tastiera a 5 righe sul pannello LVGL

> Piano del 19-11-2026. Il maintainer, sul TY570 in verticale: «la tastiera diventa con i tasti alti e strettissimi,
> sono difficilissimi da usare, servirebbe un layout alternativo a 5 righe da poter scegliere». Anomalia che pesa
> sull'uso: passa davanti (regola di `CLAUDE.md` del 09-11-2026). Ramo `fix/lvgl-keyboard-5-rows`, annidato su
> `fix/lvgl-stale-lib-layers`.

## Cosa c'è
Le tastiere di testo del viewer LVGL sono la `lv_keyboard` di LVGL con le sue mappe: 12 tasti nella prima riga, larga
quanto lo schermo e alta metà. In verticale (600 px di larghezza sul TY570) un tasto è largo circa 45 px e alto oltre
120. Tre punti la aprono, tutti in `lvgl_render.rs`: il comando con testo (`lv_keyboard_create(radice)`), il tastierino
delle tabelle (`apri_tastiera`) e l'accesso (`apri_credenziali`). Il tastierino numerico non cambia.

## Decisioni del maintainer (19-11-2026)
1. **Alfabetica**: quattro righe di lettere da 7 (`a`…`g`, `h`…`n`, `o`…`u`, `v w x y z . -`) più una riga di comandi.
2. **Si sceglie con un tasto sulla tastiera**, e il pannello ricorda l'ultima scelta.

## Come
- `sws-lvgl-viewer/src/keyboard_layout.rs` (nuovo): le mappe come dati (righe di tasti con il loro controllo), per due
  disposizioni (`Standard`, `Alphabetic`) e tre modi (minuscole, maiuscole, simboli). La standard è quella di LVGL con
  un tasto **«A-Z»** nell'ultima riga; l'alfabetica ha **«QWE»** per tornare indietro. Simboli a 5 righe da 7.
- `lv_keyboard_set_map` scrive la tabella globale di LVGL per ogni modo; i cambi di modo (`ABC`, `abc`, `1#`) restano
  quelli di LVGL. Un gestore nostro prende il posto di `lv_keyboard_def_event_cb`: intercetta «A-Z» e «QWE», per il
  resto chiama quello di LVGL. `install(kb)` nei tre punti che aprono una tastiera.
- La scelta si salva in `cartella_stato()/lvgl_keyboard`, come la lingua (`lvgl_lang`): best-effort.
- Test puri: per ogni disposizione e modo, controlli e tasti in numero uguale, al massimo 7 tasti per riga
  nell'alfabetica, tutte le lettere una volta sola, i tasti di cambio presenti; la lettura del file.

## Verifica
`cargo test -p sws-lvgl-viewer`, clippy, poi sul TY570 in verticale: accesso, cella di tabella, comando con testo; «A-Z»
e «QWE», riavvio del viewer e la scelta ricordata.
