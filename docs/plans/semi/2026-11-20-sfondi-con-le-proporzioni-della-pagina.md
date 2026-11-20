# Sfondi generati con le proporzioni della pagina — oggi sono sempre orizzontali, e in verticale se ne vede poco

> Seme del 20-11-2026, dal maintainer: «il generatore di sfondi deve considerare l'orientamento della pagina e le
> proporzioni perché ora genera una immagine landscape e poi la taglia ma il risultato è parziale».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita e dedicata**, per sviscerarne
> tutti i dettagli.

## Il difetto
L'assistente genera gli sfondi fotografici sempre a **1536×1024**, orizzontali. In pagina l'immagine copre l'area
con `image_fit: cover`, che ritaglia quello che avanza. Su una pagina verticale come quella del TY570 (600×1024) resta
visibile circa il **40 % della larghezza**: la parte centrale. Quello che il modello ha messo a sinistra e a destra
non si vede.

## Cosa c'è nel codice (misurato il 20-11-2026, su `main`)
- **La misura è fissa**: `DIMENSIONE = "1536x1024"`, `WIDTH`, `HEIGHT` in `sws-web/src/ai/immagini.rs` (righe 34-36).
  La usano `genera` (la base, righe 182 e 188), `varia` (le varianti di luce, righe 218-230) e la stima del costo
  (`estimated_usd`, riga 57). Il commento in testa al file dice la scelta: «Non si ritaglia: l'oggetto `image` lo
  copre con `image_fit: cover`».
- **Il modello non sa com'è fatta la pagina**: lo strumento `genera_sfondo` (`ai/tools.rs`, riga 473) ha solo
  `descrizione` e `quante`, e il testo gli dice «1536×1024». Gli chiede anche di dire dove stanno le cose
  («sinistra, centro, destra»), che in una pagina verticale sono proprio le parti tagliate.
- **La misura della pagina si sa già calcolare**: `page_area` in `ai/floor_plan_tool.rs` dà l'area dove va lo sfondo
  di una pagina (fra intestazione e piè di pagina della cornice, oppure la pagina intera; per una pagina che non
  esiste ancora, la misura predefinita del progetto). La usano le planimetrie disegnate dall'assistente.
- **L'orientamento del progetto** è `page_layout.orientation` (`sws-core/src/project.rs`, riga 2728), con
  `default_width`/`default_height`.
- **I due fornitori accettano misure diverse**: FLUX (`ai/bfl.rs`) prende qualunque misura multipla di 16, e il
  prezzo dipende dai megapixel. OpenAI accetta poche misure fisse (per gpt-image-1: 1024×1024, 1536×1024 e
  1024×1536; per gpt-image-2 va verificato).
- **Le varianti di luce** modificano la base: devono avere la sua stessa misura, o gli oggetti si spostano.

## Le domande per la sessione di plan
1. **Quale misura**: l'area dello sfondo della pagina (`page_area`), la pagina intera, o la misura predefinita del
   progetto? `genera_sfondo` riceve la pagina a cui è destinato?
2. **Con OpenAI**: la misura fissa più vicina (1024×1536 per una pagina verticale) e poi `cover` taglia poco, oppure
   un ritaglio fatto dal server alle proporzioni esatte?
3. **Con FLUX**: le proporzioni esatte, arrotondate a 16; la stima del costo cambia con la misura.
4. **Il testo per il modello**: dirgli il formato («verticale, 600×1024») così compone la scena per quello (in alto,
   in basso, non solo a sinistra e a destra).
5. **Una base usata su pagine diverse** (una verticale e una orizzontale, o cornici diverse): si avvisa, o si genera
   per la pagina?
6. Gli sfondi già generati restano come sono.
