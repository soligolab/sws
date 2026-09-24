# Il viewer LVGL non legge `size_mode` — seme

> Misurato il 24-09-2026 sul WP630, mentre il maintainer collaudava la navigazione a schermo:
> «sul pannello c'è un sinottico LVGL a centro schermo (relativamente piccolo)».
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** La scalatura tocca ogni oggetto
> interpretato, i font e le coordinate del touch: un disegno scritto oggi, prima di sapere quali
> pannelli useremo davvero, sarebbe un disegno che mente.

## Quello che il maintainer ha visto NON è il difetto

Il progetto di collaudo ha pagine 800×480 e lo schermo era 1920×1080, con `size_mode: fixed`. In
quella modalità il cap a 1 è **voluto e documentato** in entrambi i viewer — si rimpicciolisce, non
si ingrandisce, perché ingrandire sfoca il disegno ([`viewerFitScale`](../../sws-editor/src/pageLayout.ts),
e il letterbox neutro `#0f172a` di Q37 su LVGL). Il web, nello stesso caso, disegna identico.

## Il difetto è sotto

`grep -rn "size_mode\|SizeMode" sws-runtime/crates/sws-lvgl-viewer/src/` → **nessuna occorrenza**.
Il viewer LVGL disegna sempre 1:1 alle misure della pagina, qualunque cosa dica il progetto.

| modalità | web | LVGL |
|---|---|---|
| `fixed` | 1:1, cap a 1, margine neutro | 1:1, margine neutro — **uguali** |
| `ratio` | `viewBox` + `preserveAspectRatio="xMidYMid meet"`, scala a riempire con letterbox | **1:1**, nessuna scalatura — **divergono** |
| `fluid` | nessun `viewBox`, 100%×100% | **1:1** sulle misure della pagina — **divergono** |

Un progetto in `ratio` — la modalità pensata proprio per non legarsi a un pannello — riempie lo
schermo sul web e resta un francobollo su LVGL. È l'unica parità web/LVGL rimasta scoperta dopo il
lavoro dei mesi scorsi, e non la copre nessuna guardia.

## Perché non è una riga di codice

LVGL non ha uno zoom di display: non si moltiplica una matrice e si è finito.

- Ogni geometria è in pixel interi al momento della creazione dell'oggetto (`interpret_page`);
  scalare vuol dire moltiplicare **tutte** le coordinate e tutte le misure, con gli arrotondamenti
  che ne seguono.
- **I font non scalano**: LVGL non ridimensiona una face, ne apre una nuova
  (`lvgl_font.rs`, «una face FreeType per dimensione»). Un fattore 2,4× significa aprire tutte le
  taglie corrispondenti, e le taglie intermedie non esistono.
- **Il touch va scalato all'inverso**: `touch_indev.rs` mappa il range del digitalizzatore su
  `hor_res`/`ver_res`. Se la pagina è scalata, quei due numeri non sono più le misure della pagina.
- Il backend DRM ha già `page_offset` per centrare: lì la scalatura si innesterebbe in un punto
  solo, ma il backend SDL2 (quello davvero in uso sui pannelli, vedi Q19) passa dal compositore.

## Le opzioni già visibili

- **A — LVGL impara `ratio`**: fattore unico calcolato all'avvio, applicato alle geometrie e alle
  taglie dei font, inverso sul touch. Parità piena, costo alto.
- **B — LVGL dichiara di supportare solo `fixed`**: l'IDE avvisa quando il target è LVGL e il
  `size_mode` non è `fixed`. Costo basso, la divergenza resta ma smette di essere silenziosa.
- **C — il deploy materializza**: quando il target è LVGL, il deploy riscrive le pagine alle misure
  reali del pannello. Sposta il problema dal runtime al deploy, e richiede di conoscere lo schermo.

## Da misurare quando si comincia

- Che risoluzioni hanno davvero i pannelli Pixsys in gioco (il seme
  [preset-pixsys-catalogo](2026-09-19-preset-pixsys-catalogo.md) dice che i modelli non sono nel
  repo: è la stessa lacuna).
- Quante taglie di font servirebbero in B e in A, e quanta memoria costano sul pannello più piccolo.
