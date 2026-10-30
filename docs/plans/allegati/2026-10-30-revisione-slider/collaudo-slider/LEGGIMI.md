# Collaudo dello slider — fasi 1-6

Un progetto con tutti i tipi di slider, da provare **sul web e sul pannello LVGL**. Generato da
`../genera_collaudo_slider.py` (rigenerarlo invece di ritoccarlo a mano):

```bash
python3 docs/plans/allegati/2026-10-30-revisione-slider/genera_collaudo_slider.py <cartella-di-destinazione>
```

## Come aprirlo

- **IDE**: copiare la cartella `collaudo-slider` nella radice dei progetti dell'IDE (per esempio
  `.run-editor/projects/` con `start_editor_develop.sh`) e aprirlo dall'elenco. Serve un IDE costruito da questo ramo.
- **Pannello LVGL**: dall'IDE, Connessione → deploy sul pannello, come un progetto qualunque.
- **Web**: il viewer del runtime, o «Viewer» dall'IDE.

## I tag

- `c.*` sono **scrivibili** e partono da zero: si trascina, e la riga grigia «scritto: …» sotto alcuni slider mostra
  cosa è arrivato al runtime.
- `s.rampa` (0..100 in 40 s) e `s.temperatura` (18..26 °C in 60 s) **si muovono da soli**: fanno da PV, da bande «in
  allarme» e da sola lettura.

## Cosa guardare, pagina per pagina

1. **Stili**: classico, pillola, ISA-101, colori e spessore, traccia al 30 %; piastre con icona (luce, ventola,
   volume, senza icona) che si trascinano ovunque; verticali (tapparella a piastra, classico, pillola, ISA con
   tacche). Col dito, col mouse, e sul web anche con Tab e le frecce.
2. **Valore e tacche**: valore sotto, sopra, dentro, sul cursore (il fumetto compare solo mentre si trascina), senza
   valore; tacche 10/2; aggancio alle tacche da 5; bande sempre; bande solo fuori dai limiti sulla rampa (compaiono
   sopra 70); frazione 0..1 col passo 0,05 (la riga «scritto» deve avere i decimali, anche dal pannello); scrittura
   continua con deadband 5; conferma al rilascio.
3. **Bipolare, PV, molla**: offset −50..50 riempito dallo zero; termostato con PV che si muove (triangolino e «PV …»
   accanto al valore), anche a piastra; leva a molla: tenendola la riga «scritto» cambia al massimo 5 volte al
   secondo, lasciandola torna a 0 e scrive 0; molla verticale al minimo; bipolare verticale con PV.
4. **Chiaro**: gli stessi stili su sfondo chiaro.

In tutte: dopo aver lasciato il cursore, finché il tag non conferma, il cursore resta dov'è (sul web col bordo
tratteggiato).
