# Seme — più font, e font che emulano i display a segmenti

> **Seme — decisione.** Richiesta del maintainer, 15-10-2026, mentre nasceva l'oggetto «Data e ora»
> ([piano cornici](../archive/2026-10-15-cornici-di-pagina.md)): «estendere il set di font disponibili, tra quelli da aggiungere
> ne servono alcuni che emulino il display a segmenti».
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**
> Qui ci sono l'idea e le misure di oggi, non il progetto.

## L'idea

Un elenco di font scelti da SWS, uguale sul web e sul pannello LVGL, da cui il progettista sceglie con un menu
invece di scrivere un `font_family` a mano. Fra questi, alcuni **a segmenti** (7 e 14 segmenti, matrice di punti)
per valori, contatori e orologi che devono sembrare lo strumento da quadro.

## Misurato oggi (ramo `feat/oggetto-data-e-ora`)

- **Web**: `font_family` è un campo di testo libero (`EditorShell.tsx`, sezione Testo, segnaposto
  `system-ui, sans-serif, 'SWS Emoji'`); il browser usa quello che trova, quindi un font non installato ricade in
  silenzio su un altro.
- **LVGL**: `font_family` è letto nel modello (`model.rs`) ma **ignorato** dal disegno. FreeType apre un font solo,
  per corpo, in `lvgl_font.rs` (`at_size`, 6…200 px, cache per corpo); in `assets/fonts/` c'è solo Noto Emoji.
  Non esiste il grassetto (`font_weight` ignorato anche lui).
- Quindi oggi qualunque font diverso dal predefinito è **solo web**: è una divergenza WYSIWYG già presente.

## Domande per la sessione di plan

- Quali font: licenze (OFL o simili, da includere con il testo della licenza come Noto Emoji), peso sull'immagine
  del pannello, copertura dei caratteri (accentate, °, µ).
- Il modello: un elenco chiuso di nomi (`font_family: "segmenti7"`) con una tabella condivisa TS/Rust e una fixture,
  come i colori predefiniti, invece del testo libero.
- LVGL: cache per (font, corpo) invece che per corpo; grassetto come file a parte.
- I font a segmenti hanno cifre e pochi simboli: cosa succede a una lettera che il font non ha.
- Una guardia di parità: ogni font dell'elenco esiste nei due motori.
