# Il setpoint sul pannello LVGL come sul web: la scheda del tastierino, la conferma, il colore del ✓

> Piano del 19-11-2026, anomalia che pesa sull'uso (regola del 09-11: si chiude quello che è in corso e si corregge
> subito). Ramo `fix/setpoint-lvgl`, **annidato** su `feat/nav-links` (a sua volta su `feat/symbol-def`). Codice nuovo
> in inglese.

## Cosa ha visto il maintainer

Sul TY570, pagina «Idrico - Parametri» di `DemoTY570_fiera`, i due `setpoint` della colonna «SOGLIE ALLARMI»:
1. **l'aspetto è tutt'altro che quello del web**: il campo largo quanto il numero, i due pulsanti attaccati al bordo
   destro con ~260 px di vuoto in mezzo, blu del tema LVGL con ombra e angoli a pillola, l'unità dentro il campo,
   «0.0» quando il valore non c'è;
2. **il tastierino si apre mezzo coperto** dagli oggetti disegnati dopo (la colonna «COMANDI IMPIANTO», il `navbutton`
   quasi invisibile in basso a destra): l'overlay è figlio della pagina, nasce nascosto in `render_setpoint`
   (`lvgl_render.rs`) e si mostra togliendo `HIDDEN`, quindi ogni oggetto creato dopo gli sta sopra e prende i tocchi.

Trovato nello stesso giro: su LVGL il ✓ scrive **senza** la conferma (`require_confirm`, `critical`) e senza
controllare min/max; il web passa da `guardedWrite` e il tastierino del web valida min/max.

## Decisioni del maintainer (19-11-2026)

1. **Il tastierino è una scheda centrata come quella del web** (`NumericKeypad.tsx`): etichetta, numero con l'unità,
   «min · max», errore, griglia 7-8-9 / 4-5-6 / 1-2-3 / ± 0 . / C ⌫ ✓, «Annulla»; la conferma **scrive in un passo**.
   Ribalta la decisione 2 del 22-10 (tastierino a schermo intero, bozza nel campo e ✓ accanto per scrivere,
   `docs/archive/2026-10-22-setpoint-i-due-motori-non-combaciano.md`): sul pannello il campo non si digita, quindi il
   ✓ della riga resta attenuato come sul web senza bozza.
2. **Conferma e min/max anche su LVGL**: la scrittura passa dalla stessa regola dei pulsanti (`regola_conferma`:
   finestra di conferma, password dei comandi critici); un valore fuori da min/max non si scrive e la scheda lo dice.
3. **Il colore del ✓ è configurabile**, campo nuovo `confirm_fill`, predefinito **`#DD5D21`** su tutti e due i motori
   (tabella `colori-predefiniti.json`). Vale per il ✓ della riga e per quello della scheda. Sul web prima era il colore
   del marchio: con il marchio Pixsys il ✓ passa da rosso ad arancio, salvo impostarlo.

## Il lavoro

**Logica del tastierino condivisa** (le due gemelle e una fixture, come il navigatore)
- `tests/fixtures/tastierino-numerico.json`: sequenze di tasti dal valore iniziale (il primo tasto sostituisce il
  valore precaricato, `C`, `⌫`, `±`, il secondo `.` ignorato) e conferme (vuoto o non numero → non valido, sotto il
  minimo, sopra il massimo, buono).
- TypeScript: `sws-editor/src/components/numericKeypadLogic.ts` (`press`, `confirm`), usata da `NumericKeypad.tsx`.
- Rust: `sws-lvgl-viewer/src/numeric_keypad.rs`, la stessa logica e la scheda LVGL.
- Testi: «Valore non valido», «Sotto il minimo ({min})», «Sopra il massimo ({max})» diventano **testi di sistema**
  (cinque lingue, lingua dei contenuti) in `testi-sistema.json`, `sws-core/src/testi_sistema.rs`, `testiSistema.ts`; il
  tastierino del web li usa al posto di `keypad.*` dell'IDE, e «Annulla» viene da `annulla`.

**La scheda LVGL** (`numeric_keypad.rs`)
- Sul **layer superiore**: velo nero al 65 % su tutto lo schermo (un tocco fuori dalla scheda annulla, come sul web),
  scheda 280 px centrata con le misure e i colori del web. Se lo schermo è basso i tasti si accorciano.
- Una sola scheda aperta alla volta; si chiude cambiando pagina (gli oggetti del layer superiore sopravvivono al
  cambio di schermo).

**Il setpoint LVGL** (`render_setpoint`)
- Le righe del web: margine 4 in alto, 3 fra le righe, etichetta, «Attuale: …» (con «—» se il valore non c'è), riga
  col campo che **riempie** la larghezza, ✓ e ⌨ larghi quanto il glifo più i margini del web (10 e 8 px per lato),
  tutti alti quanto il campo, 4 px fra loro.
- Campo: il numero nudo come `<input type=number>` (niente unità, niente decimali fissi; vuoto se non c'è valore),
  `#0f172a`, bordo `#334155`, raggio 4. ✓: `confirm_fill`, testo bianco, attenuato al 50 %, raggio 4, niente stile
  del tema. ⌨: `#334155`. In sola lettura il ✓ resta (attenuato) e il ⌨ sparisce, come sul web.
- Il tocco sul campo o sul ⌨ apre la scheda; la conferma della scheda passa da `regola_conferma`.
- Via la bozza (`SetpointCtx.bozza`) e l'overlay vecchio.

**Web**
- `SvgCanvas.tsx`: il ✓ della riga usa `confirm_fill`; `NumericKeypad` riceve il colore e i testi di sistema.
- Pannello proprietà del setpoint: «Colore del ✓» (`colorInput("confirm_fill")`), it/en.
- Modelli: `synoptic.rs`, `model.rs` (LVGL), `types/index.ts`; schema dell'assistente rigenerato.

**Documenti**: manuale 05 (setpoint), CHANGELOG, voce di collaudo; `NOVITA.yaml` da decidere col maintainer (blocco
2.26.0 pieno).

## Verifica

1. Definition of done completa e i controlli della CI.
2. `sws-lvgl-viewer --istantanea` della pagina della fiera (copia in `~/sws_projects/`): riga del setpoint come sul
   web; con `--tocca` sul ⌨ la scheda sta **sopra** la colonna «COMANDI IMPIANTO» e il `navbutton`.
3. Prova a mano: valore fuori da min/max rifiutato con il testo; un setpoint `critical` chiede la password.
4. Collaudo del maintainer sul TY570.
