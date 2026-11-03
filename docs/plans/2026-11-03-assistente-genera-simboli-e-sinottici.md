# Seme — l'assistente IA che disegna i simboli del progetto e ci compone il sinottico

> Richiesta del maintainer, 03-11-2026: «va migliorato l'assistente IA per poter generare oggetti grafici svg per
> adattarsi al progetto al di là della libreria standard. L'idea è che l'utente possa usare prompt semplici tipo
> "Genera il sinottico di un impianto industriale di generazione di tubi di acciaio" e l'assistente generi i singoli
> oggetti grafici conformi al nostro ambiente (connettori, tag etc) e poi una pagina della risoluzione del progetto con
> la grafica fatta istanziando gli oggetti generati.»
>
> **Questo è un seme, non un piano d'esecuzione.** Quando si comincia questo lavoro, il primo passo è una **sessione di
> plan approfondita** per sviscerarne tutti i dettagli. Quello che segue è l'idea e quello che il codice fa oggi, misurato
> il 03-11-2026: non è un progetto, e non va preso come tale.

## L'idea in due tempi

1. **Gli oggetti.** Da una descrizione dell'impianto l'assistente ricava le macchine che servono (per i tubi d'acciaio:
   forno, laminatoio, saldatrice, taglierina, rulliere…), e per quelle che la libreria non ha disegna un **simbolo del
   progetto**: SVG che rispetta le stesse regole dei simboli di libreria — bocche per agganciare i tubi, parti vive
   legate ai tag, stile del progetto, disegnabile anche su LVGL.
2. **La pagina.** Con i simboli nuovi e quelli di libreria compone una pagina alla risoluzione del progetto: disposizione,
   tubi agganciati alle bocche, tag proposti (o legati a quelli che esistono), etichette. Passa dalla stessa proposta che
   l'utente vede come diff e accetta o no.

## Cosa c'è oggi (03-11-2026)

- **L'assistente** (`sws-web/src/ai/`, ~3200 righe; chat in `sws-editor/src/chat-main.tsx`, `src/ai/`): 13 strumenti in
  `tools.rs` — `elenca_pagine`, `leggi_pagina`, `leggi_progetto`, `elenca_tag`, `schema_oggetto`, `schema_sorgente`,
  `schema_tag`, `valida`, `proponi_modifica`, `leggi_script`, `schema_python`, `controlla_python`, `istantanea_pagina`.
  `proponi_modifica` manda progetto e pagine interi come diff da accettare; `istantanea_pagina` gli fa vedere quello che
  ha disegnato. Lo schema degli oggetti è generato (`scripts/gen_synoptic_schema.py`, guardia
  `check_synoptic_schema.sh`). **Non ha uno strumento per i simboli**: oggi può solo usare quelli che ci sono.
- **I simboli di libreria** (195, `sws-editor/public/symbols/lib/`, generati da `scripts/simboli/genera.py` con la
  classe `Simbolo`): materiali e veli, **parti vive** (`lamp`, `rotor`, `lever`, `needle`, `level`) legate ai tag in
  Collegamenti, **bocche** sul bordo del viewBox per i tubi, manifesto `manifest.json`, guardia `check_simboli_lvgl.sh`
  che controlla che LVGL li sappia disegnare. Sono generati da codice Python scritto a mano, non da un modello.
- **I simboli del progetto** (`CustomSymbol` in `sws-core/src/project.rs:1671`): `id`, `label`, `url` **o** `svg`
  inline, `colorable_ids` (elementi ricolorati con lo stato), attribuzione. LVGL li legge da `/api/project`
  (`sws-lvgl-viewer/src/svg_assets.rs`). **Non hanno bocche né parti vive**: un simbolo disegnato dall'assistente oggi
  sarebbe un'immagine con un colore di stato, non un oggetto «conforme» nel senso della richiesta.
- **Stile del progetto**: `project.symbol_style` (volume 0–100) vale per la libreria; un simbolo del progetto non lo segue.

## Le domande che la sessione di plan deve chiudere

- **Il formato.** Allargare `CustomSymbol` a bocche e parti vive (la stessa struttura del manifesto di libreria), o
  scrivere i simboli generati come voci di una libreria del progetto con lo stesso manifesto? In tutti e due i casi web,
  LVGL, Collegamenti e tubi devono trattarli come quelli di libreria, e la guardia LVGL deve valere anche per loro.
- **Chi garantisce che il disegno sia buono.** Un SVG libero di un modello può usare quello che LVGL non disegna, avere
  bocche fuori dal bordo, scale sbagliate. Serve un validatore (lato server, come `valida`) con le regole di `genera.py`,
  e forse un sottoinsieme di SVG ammesso. Da decidere se l'assistente scrive SVG o una descrizione più stretta che SWS
  traduce in SVG.
- **Lo stile.** I simboli generati devono sembrare della stessa famiglia della libreria (tratti, materiali, veli,
  volume). Si passa all'assistente un modello di riferimento, o i suoi disegni passano da un «normalizzatore»?
- **La pagina.** Disposizione e tubi su una pagina vuota sono un problema a sé (dove va cosa, come corrono i tubi): uno
  strumento che compone, o il modello che scrive coordinate e poi guarda l'istantanea e corregge?
- **I tag.** Proporre variabili nuove (con tipi del progetto, per esempio un tipo «laminatoio») o legarsi solo a quelle
  che esistono? E le sorgenti: lasciate vuote, o proposte col catalogo dei dispositivi?
- **Costi e tempi.** Una pagina con dieci simboli nuovi è una conversazione lunga e cara. Misurare token e tempo su un
  caso vero prima di promettere il «prompt semplice».
- **Dove vivono le cose generate.** Solo nel progetto, o anche riusabili da altri progetti (una libreria dell'azienda nel
  cloud)?

## Un caso da usare per misurare

L'esempio del maintainer: «il sinottico di un impianto industriale di generazione di tubi di acciaio». Va tenuto come
banco di prova dall'inizio alla fine: quanti simboli servono, quanti la libreria ha già, quanto costa e quanto dura
generarli, e se il risultato regge su un pannello LVGL.
