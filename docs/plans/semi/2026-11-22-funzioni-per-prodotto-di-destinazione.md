# Le funzioni per prodotto di destinazione (seme)

> Nato il 22-11-2026 durante la fase 8 dell'editor dei simboli (gli effetti), dalle parole del maintainer: «abbiamo
> già la lettera L per indicare i componenti che sono portabili su lvgl, possiamo eventualmente definire dei limiti
> simili per il prodotto di destinazione. Se delle funzioni sui prodotti web possono essere fatte decisamente meglio
> definiremo di volta in volta se scendere a compromessi o limitare a prodotti web o con CPU più performanti».

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e
dedicata, per sviscerarne tutti i dettagli. Qui ci sono l'idea e le misure di oggi, non un progetto.

## La regola, già decisa
Una funzione che nel browser si può fare **decisamente meglio** non si appiattisce per forza su quello che regge il
pannello più piccolo: **si decide caso per caso** se scendere a un compromesso uguale ovunque, o limitarla ai
prodotti web o a quelli con una CPU più capace.

Il primo caso è stato deciso così il 21-11-2026: gli effetti dei simboli (bollicine, fumo, fiamma) sono **nativi per
motore**, cioè animazioni continue nel browser e fotogrammi sul pannello, con le stesse formule
(`sws-core/src/symbol_fx.rs`, `sws-editor/src/symbols/lib/effects.tsx`).

## Cosa c'è oggi (22-11-2026)
- **La «L»** nell'albero degli strumenti: per **tipo di oggetto**, `LVGL_SUPPORTED_TYPES` in
  `sws-editor/src/editor/LeftPanel.tsx` (riga 1188); in un progetto LVGL i tipi senza «L» non si offrono.
- **Il motore del progetto**: `target` in `project.yaml` (`ProjectTarget`, web o LVGL), non il prodotto.
- **Le capacità del runtime**: il deploy legge `/api/system` e si ferma se manca una capacità
  (`segreti_separati`, dal 22-11 `symbol_photos`): dice cosa sa fare il **software** del pannello, non la sua CPU.
- **Il budget delle animazioni** per pagina sul pannello (`ANIM_BUDGET_DEFAULT`, 6 MB, `SWS_ANIM_BUDGET_KB`): un
  limite unico, oggi uguale per TY570, TC620 e WP630.
- Le parti di simbolo e gli effetti non hanno nessun segno nell'editor che dica «sul pannello è diverso / non c'è».

## Le opzioni già visibili
1. **Classi di prodotto** dichiarate (per esempio: web, pannello capace — TC620, WP630 —, pannello piccolo — TY570) e
   un segno per funzione, oltre che per tipo di oggetto: la «L» diventa una o più lettere, o una nota.
2. **Il prodotto nel progetto**: il progetto dice per quale classe è (accanto a `target`, o dedotto dal pannello
   ricordato, `last_device`), e l'editor avvisa — o nasconde — quello che lì non c'è o è ridotto.
3. **Il pannello dice la sua classe** in `/api/system` (modello, CPU, memoria) e il deploy avvisa, come per le
   capacità del software; il budget delle animazioni prende il valore della classe.

Le misure sul TY570 (lunedì 24-11) e sul TC620 degli effetti della fase 8 sono il primo dato per tarare le classi.
