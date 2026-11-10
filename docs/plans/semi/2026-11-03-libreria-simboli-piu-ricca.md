# La libreria dei simboli, più ricca di dettaglio — seme

> **Stato: seme — decisione.** Nato il 03-11-2026 guardando le prime bozze dell'assistente che disegna i simboli
> (piano [`2026-11-03-assistente-genera-simboli-e-sinottici.md`](../../archive/2026-11-03-assistente-genera-simboli-e-sinottici.md)):
> il maintainer le ha trovate «molto semplificate e prive di dettaglio», e alla domanda su quale livello volesse ha
> risposto «alzare anche la libreria».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 03-11-2026.

## L'idea

Le bozze dell'assistente sono semplici quanto la libreria, perché è la libreria che gli si dà come misura. Per avere
simboli più ricchi va alzata la libreria stessa (195 disegni di `scripts/simboli/disegni*.py`), e l'assistente la segue:
i suoi esempi si generano dalla libreria (`gen_synoptic_schema.py`, `SYMBOL_EXAMPLES_JSON`).

## Le misure di oggi

- 195 simboli, **mediana 16 operazioni** di disegno; i più «ricchi» (69–75: `chain-conveyor`,
  `air-cooled-condenser`, `chiller`) lo sono per ripetizione (maglie, alette), non per dettaglio costruttivo.
- Il vocabolario: 4 forme (rect, circle, ellipse, path), 42 materiali, 12 veli bianchi e neri, contorno per strato.
  Niente testo, filtri, raster: il pannello LVGL non li disegna (resvg senza font, filtri saltati).
- I limiti che contano per un disegno più ricco:
  - **LVGL**: ogni strato è una bitmap; più forme = più tempo di preparazione (rotore: fino a 120 fotogrammi). Da
    misurare su TC620/WP630 e sul TY (256 MB) prima di decidere quanto si può alzare;
  - **lo stile del progetto**: volume 0 (ISA-101, piatto) deve restare leggibile anche con più dettaglio;
  - **la leggibilità a 60–120 px**, la misura tipica in pagina.

## Un requisito in più (03-11-2026)

Il maintainer: «può essere che mi servano sinottici con pochi oggetti che coprono buona parte di uno schermo HD». Il
vettoriale scala senza perdere (e dal 03-11-2026 anche il pannello LVGL disegna i simboli fino a 2048 px, commit
`e4842c02`), ma un disegno pensato per 80 px, ingrandito a 800, è nitido e **vuoto**. Il dettaglio va pensato anche per
simboli grandi un terzo o metà dello schermo — forse con dettagli che compaiono solo sopra una certa misura.

## Il vocabolario si allarga (decisione del maintainer, 03-11-2026)

Al punto 3 della revisione delle prime bozze («come allarghiamo quello che un simbolo può esprimere?») il maintainer
ha scelto **tutti e due**: il vocabolario della descrizione cresce, e resta anche l'SVG libero (fase F7 del piano
dell'assistente). La parte che sta qui è la prima: veli nuovi (ombra portata, gradienti a più angoli), più materiali
(ottone, ghisa, vernici industriali), opacità per forma, motivi ripetuti (grata, lamiera striata). Cresce in
`genera.py` e in `simboli_prj.rs` insieme — la parità `compila_come_genera_py` lo tiene onesto — e ogni aggiunta va
provata sul pannello LVGL (`check_simboli_lvgl.sh`) e a volume 0.

## Le domande per la sessione di plan

- Che cosa vuol dire «più dettaglio»: dettagli costruttivi (bulloni, carter, nervature, basamenti), ombre portate,
  più veli, un materiale in più per le parti scure? Una tavola di prova su 5–6 simboli, prima di toccarne 195.
- Si alza tutta la libreria o una famiglia per volta (macchine e processo prima)?
- Due livelli (essenziale per ISA-101 e pannelli piccoli, ricco per il resto), scelti dallo stile del progetto?
- Il costo su LVGL, misurato.
- La parità con `simboli_prj.rs` resta automatica (il test `compila_come_genera_py`), ma il vocabolario può crescere
  (veli nuovi, materiali nuovi): va aggiunto ai due lati.
