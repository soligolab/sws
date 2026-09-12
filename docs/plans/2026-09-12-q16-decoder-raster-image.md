# Q16 — Decoder raster per il widget `image` su LVGL

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q16) il 2026-09-12. Non ancora riverificato nel
> codice per questa sessione — la domanda risale al 2026-08-25/2026-09-06: rileggere la
> scheda originale e ricontrollare `lv_conf.h` prima di iniziare, un piano di settimane fa
> non è garantito accurato.

## Contesto

Il widget `image` su LVGL ha due metà, e solo una è fatta:

- **Metà SVG** (catalogo icone bundlato, `symbol_id`/URL SVG): **fatta e rilasciata in 2.3.0**
  — `resvg`+`tiny-skia`, rasterizzazione a runtime, stessa soluzione di Q15. Verificato che sia
  in `Cargo.toml` del viewer con un commento che lo dichiara.
- **Metà raster** (un URL che punta a un PNG/JPEG vero, che il campo testo libero del widget
  permette comunque): **ancora assente**. `lv_conf.h` aveva `LV_USE_PNG/BMP/SJPG/GIF` a 0
  l'ultima volta che è stato controllato (2026-09-06) — nessun decoder raster compilato nella
  LVGL vendorizzata.

## Cosa deciso, cosa resta

**Deciso**: nessuna decisione definitiva sulla metà raster — il default PoC era "non
supportato" (opzione C nella scheda originale), in attesa di un bisogno reale.

**Opzioni della scheda originale**:
1. Abilitare `LV_USE_PNG`/`LV_USE_SJPG` nel build C, scaricare i byte via HTTP lato viewer e
   scriverli in un file temporaneo (LVGL legge da filesystem). Aggiunge una dipendenza C nativa
   al build (verificare su entrambe le pipeline: generic/SDK, e ora anche il cross-build Q53).
2. Non supportato per ora (stato di fatto) — coerente con `symbol`/Q15 per i casi non coperti.

## Prima di scrivere codice

1. Rileggere `lv_conf.h` attuale (`sws-lvgl-viewer/lv_conf/lv_conf.h`) per confermare che
   `LV_USE_PNG`/`SJPG`/`BMP`/`GIF` siano ancora a 0 — potrebbe essere cambiato nel frattempo.
2. Chiedere al maintainer se è emerso un bisogno reale (un progetto con immagini raster vere,
   non solo il catalogo SVG) che giustifichi il costo di una dipendenza C nuova nel build.
3. Se sì: misurare il costo (dimensione binario, tempo di build sulle pipeline container) prima
   di committare, come fatto per `resvg` in Q15/Q16-SVG.

## File coinvolti (di massima)

`sws-lvgl-viewer/lv_conf/lv_conf.h`, `sws-lvgl-viewer/src/svg_assets.rs` (o un modulo affine per
il raster), eventualmente i Containerfile del cross-build (Q53) se serve una libreria C in più
nell'immagine builder.

## Verifica

`cargo check`/`test` sul viewer, una pagina di prova con un `image` che punta a un PNG vero,
confronto browser vs istantanea LVGL.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

**Decided (2026-08-25)** — **rasterizzazione a runtime**, stessa scelta di Q15 e per lo stesso motivo: il catalogo bundlato è SVG e il campo `src` resta testo libero, quindi servono entrambi i percorsi. Vale la stessa misura preliminare di peso e memoria.

**Context**: emerso durante una sessione di lavoro autonomo mirata a chiudere il gap "`image` è
l'unico widget rimasto non supportato in LVGL" (31/32 tipi, per il lavoro fatto su `sws-lvgl-viewer`
in sessioni precedenti). Un'analisi preliminare (non ancora un'implementazione) lo classificava
come "caso semplice": `obj.src` nel motore web è un URL raster, e LVGL ha supporto nativo `lv_img`
— sembrava non servire un renderer SVG come per `symbol` (Q15). Verificando il codice prima di
scrivere qualunque riga, il quadro è diverso.

**Cosa c'è davvero da rendere** (verificato, non assunto dal tipo dichiarato):
- Il pannello proprietà di `image` (`EditorShell.tsx:2788-2812`) è un campo testo libero
  ("https://… o /images/…") più un bottone "Sfoglia immagini" che apre `ImageBrowser.tsx` — il
  quale legge `/images/catalog.json`, un catalogo di icone bundlate nel frontend
  (`sws-editor/public/images/{mdi,tabler,equinor,electrical}/*.svg`). **Tutte le voci del catalogo
  sono file `.svg`**, non raster — lo stesso identico problema di `symbol`/Q15 (LVGL 8.x non ha
  renderer SVG), non un caso a parte.
- Il campo resta comunque testo libero: un utente può incollarci un URL PNG/JPG esterno, che
  quello sì sarebbe un caso "raster puro" risolvibile con un decoder nativo — ma non è il percorso
  che l'UI stessa incoraggia (il bottone porta al catalogo SVG).
- Verificato nel `lv_conf.h` di progetto (`sws-lvgl-viewer/lv_conf/lv_conf.h`, non solo il
  template vendorizzato): `LV_USE_PNG 0`, `LV_USE_SJPG 0`, `LV_USE_GIF 0` — **nessun decoder
  immagine è compilato nella LVGL vendorizzata usata da questo motore**, quindi nemmeno il caso
  raster funziona oggi senza toccare la configurazione di build C e aggiungere una dipendenza
  nativa (`libpng`/libjpeg equivalente) al toolchain di cross-compilazione (sia generic via QEMU
  sia SDK Yocto) — un cambio che va verificato con una build reale prima di contarci, non
  eseguibile senza `sudo` (bloccato dalla policy permessi di questa sessione) né senza il
  maintainer.

**Options**:
- **A — Abilitare `LV_USE_PNG`/`LV_USE_SJPG`, coprire solo URL raster espliciti**: risolve il
  sottoinsieme "utente incolla un URL PNG/JPG esterno", richiede scaricare i byte via HTTP lato
  `sws-lvgl-viewer` e scriverli in un file temporaneo (LVGL legge da filesystem, non da URL),
  aggiunge una dipendenza C nativa al build — da verificare su entrambe le pipeline
  (generic/SDK). **Non copre affatto il catalogo SVG bundlato**, cioè il percorso che l'editor
  stesso propone di default via "Sfoglia immagini".
- **B — Come Q15, opzione C**: rasterizzazione a runtime via crate Rust (`resvg`+`tiny-skia`) —
  unica opzione che copre sia il catalogo SVG bundlato sia URL SVG/raster esterni in modo
  uniforme. Stessi costi già descritti in Q15 (dipendenza nuova, pipeline di decodifica,
  implicazioni memoria/prestazioni su hardware embedded) — se mai si decidesse di percorrerla, ha
  senso farlo **una volta sola per entrambi i widget** (`symbol` e `image` condividono lo stesso
  problema di fondo), non due implementazioni separate.
- **C — Non supportato per ora** (stato di fatto): `image` resta assente da `SUPPORTED_TYPES` in
  `sws-lvgl-viewer`, oggetto silenziosamente saltato — coerente con come già si comporta `symbol`.

**Default for PoC**: **C** — nessuna implementazione fatta in questa sessione. Il problema è
sostanzialmente lo stesso di Q15 (mancanza di un renderer SVG in LVGL 8.x), non un gap separato
più semplice come inizialmente ipotizzato: non ha senso decidere/implementare una soluzione
parziale (opzione A, che lascerebbe comunque "muto" il catalogo icone bundlato) senza prima
sapere se/quando si affronta Q15 nel suo complesso — le due domande vanno probabilmente risolte
insieme, con la stessa scelta di rasterizzazione.

### Riverificata il 2026-09-06 — metà è fatta, e la scheda non lo diceva

Il blocco «Decided (2026-08-25) — rasterizzazione a runtime» in testa **è stato realizzato**:
`resvg` è nel `Cargo.toml` del viewer col commento *«D2 (Q15+Q16): rasterizzazione SVG a
runtime»*, e il widget `image` con `src` SVG passa da lì (`svg_assets.rs`). Quello che resta
aperto è la metà **raster**: `LV_USE_PNG/BMP/SJPG/GIF` sono ancora a 0 in `lv_conf.h`
(verificato), quindi un `src` che punta a un PNG resta muto sul pannello. La riga qui sotto vale
per questa metà.

**Decided**: not yet.
