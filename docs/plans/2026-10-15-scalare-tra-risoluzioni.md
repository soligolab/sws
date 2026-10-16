# Seme — portare un progetto da una risoluzione a un'altra

> **Seme — decisione.** Idea del maintainer, 15-10-2026, rivedendo CasaDomotica portata da Full HD a 1280×800: la
> barra di navigazione della pagina «Finestre e porte» è rimasta a `y: 1030`, larga `1900`, fuori dalla pagina
> nuova. «Ricordarsi di implementare un modo per scalare un progetto tra due risoluzioni adattando gli oggetti di
> conseguenza.»
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**

## L'idea

Cambiando la risoluzione di una pagina o di tutto il progetto, oggi gli oggetti restano dove sono: chi è oltre il
nuovo bordo finisce fuori pagina (e a runtime si spegne, T-52), e il resto va riposizionato a mano. Serve una
conversione che riporti posizioni e dimensioni nella risoluzione nuova.

## Misurato oggi (main `443913f0`)

- Il formato della pagina si cambia col preset del dispositivo (`EditorShell.tsx`, `getDevicePresets`), che
  scrive solo `width`/`height` della pagina.
- Un oggetto la cui bbox non tocca la pagina è «fuori pagina» (`pageLayout.ts`, `isOffPage`) e il runtime lo
  esclude; nell'editor resta selezionabile dall'albero.
- Le geometrie da trasformare sono di più tipi: `x/y/width/height`, `x2/y2` delle linee, `points` di tubi e
  polilinee, il percorso di movimento, le celle delle griglie, i figli dei faceplate; più grandezze che non sono
  posizioni (dimensione del testo, spessori, raggi).

## Le prime domande

- Scala **uniforme** (il fattore minore, 0,667 da 1920×1080 a 1280×800) con centratura, oppure **separata** per
  asse (0,667 × 0,741, che deforma i simboli)? Probabilmente uniforme per i disegni, separata per le posizioni.
- Testi e spessori: si scalano o si lasciano leggibili?
- Una pagina sola, o tutto il progetto in un colpo con anteprima e annulla.
- Collegamento con l'adattamento automatico a runtime (`size_mode`, vedi il seme
  [lvgl ignora size mode](2026-09-24-lvgl-ignora-size-mode.md)): convertire il file o adattare la vista?
