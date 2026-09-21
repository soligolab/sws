# R2 colori coerenti — chiusura del ramo + proposte correlate

## Contesto
`origin/fix/colori-coerenti` (`7f92a3fd`, 19 file, +1203/−318) implementa R2 del piano
`docs/archive/2026-09-21-colori-e-pannello-destro.md` (D1 auto, D2 normalizzazione, tabella condivisa,
LVGL, guardia `check_colori.sh`, prompt IA). Non è mergiato né collaudato. Regola «un ramo alla volta»:
si chiude questo prima di aprire altro. (Il piano definitivo va copiato in `docs/plans/` a fine plan mode.)

## A. Chiusura (perimetro del ramo, nessuna aggiunta)
1. `git checkout fix/colori-coerenti` (tracking su origin), rilettura del diff contro il piano.
2. DoD: `cargo check`, `cargo test -p sws-lvgl-viewer colori_predefiniti`, `pnpm test`, `pnpm build`, `./scripts/check_static.sh` (dentro c'è `check_colori.sh`).
3. Collaudo dal vivo (4 punti del piano: creazione, sfondo chiaro, progetto vecchio, LVGL).
4. STATUS/CHANGELOG, squash merge, verifica alberi, `git branch -D`. Push solo su richiesta.

## B. Proposte correlate (da scegliere; ognuna è un seme o un ramo successivo, non dentro R2)
1. **Residui `var(--brand…)` nel canvas** — SvgCanvas ne ha ancora ~46 e la guardia controlla solo `oggettiNuovi.ts`, `colorInput(` e i template. Audit: quali sono chrome legittimo e quali default di oggetto sfuggiti; estendere `check_colori.sh` con una lista di eccezioni dichiarate.
2. **Gauge su LVGL: `obj.color` ignorato** (gap noto, annotato ma non toccato). Il web lo disegna, LVGL no → parità web/LVGL rotta proprio sul colore. Piccolo fix + riga in tabella con `"lvgl": true`.
3. **Le due celle griglia (`EditorShell` ~:781/:793) e il selettore testo di `text_list` (~:2588)** usano ancora `<input type="color">` diretto con `estraiHex` e ripieghi propri: portarli su `CampoColore` e togliere le eccezioni dalla guardia.
4. **`check_f7.sh` misura contro `--brand-text` invece di `--synoptic-text`** (noto, fuori ramo): allinearlo, altrimenti misura un colore che gli oggetti non usano più.
5. **Normalizzazione anche lato server** — oggi solo l'IDE ripulisce all'apertura; il viewer web disegna `var()` senza danni ma LVGL li ignora, quindi un progetto vecchio non aperto nell'IDE resta sbagliato sul pannello. Opzione: passata one-shot in `sws-core` al caricamento (o comando «Migra colori», sullo stampo di «Migra i testi…»). Va deciso: seme «decisione».
6. **Colori per tema/marchio (`--brand-*`) vs hex fissi** — con D1/D2 gli oggetti non seguono più il marchio del cliente. Serve capire se il maintainer vuole un «colore di marchio» selezionabile nel pannello (palette del progetto) — seme «decisione», con sessione plan dedicata.
7. **Contrasto automatico** — `check_contrasto.sh` esiste per la chrome; estenderlo a «oggetto di default su sfondo pagina» (testo/linea/tubo su chiaro e scuro) usando `coloreEffettivo`, così il tono «sottile» del tubo è verificato numericamente.
8. **Prompt IA / schema** — verificare che `check_synoptic_schema.sh` e gli esempi harvested non reintroducano `var(--`; aggiungere un test che una risposta IA con `var(...)` viene normalizzata da `setPages`.
9. **Manuale** — le schermate del pannello proprietà cambiano («auto», ↺): annotare nel seme screenshot-del-manuale, senza rigenerare ora.

## C. Verifica richiesta dal maintainer: colori dentro trend / xy_plot (CONFERMATA, entra in R2)
Misurato su `origin/fix/colori-coerenti`:
- `PREDEFINITI` ha `axis_color`/`grid_color` **solo per `bar_chart`**; per `trend` (pannello `EditorShell` ~:3561-3782, `colorInput("axis_color"/"grid_color")`) non c'è regola → il pannello non mostra il colore che il canvas disegna.
- `TrendCanvas.tsx` ha ripieghi cablati **e incoerenti per lo stesso campo**: `axis_color` = `#334155` (cornice :622) e `#64748b` (etichette :746/:785); `grid_color` `#1e293b` (:723); sfondo `#0f172a` (:608, coincide con `*.bg_color`); testi legenda/cursori `#475569/#cbd5e1/#e2e8f0` fissi. `TrendExpanded` (SvgCanvas :1548) usa ancora `line_color ?? "var(--brand-primary, …)"`.
- `XyPlotCanvas.tsx`: sfondo `#0f172a`, cornice `#334155`, etichette `#64748b`, palette serie fissa; nessuna regola in tabella.
- Tutto è **scuro cablato**: su pagina chiara il trend resta un riquadro nero con assi scuri (coerente al suo interno, ma non segue la pagina come testo/linea). LVGL: da controllare `render_trend` (:4107) per gli stessi campi.

Aggiunte al ramo (stessa tabella, stessi test/guardia):
1. `PREDEFINITI`: `trend.axis_color` (etichette `#64748b`; la cornice diventa campo/derivato dichiarato, non un secondo default per lo stesso campo), `trend.grid_color` `#1e293b`, `trend.bg_color`, `trend.line_color` (`#3b82f6`, via `var(--brand-primary)` eliminato), stessi per `xy_plot`; righe `"lvgl": true` dove il motore li legge.
2. `TrendCanvas`/`XyPlotCanvas`/`TrendExpanded`: ripieghi da `predefinito()`; pannello mostra l'hex effettivo (placeholder), coincide col canvas.
3. Decisione da NON prendere qui: rendere trend/xy **auto rispetto alla pagina** (chiaro/scuro) è comportamento nuovo → seme «decisione», default PoC = resta scuro fisso e coerente pannello↔canvas.
4. Estendere `check_colori.sh`: nessun ripiego `#hex` nei prop `axisColor/gridColor/bgColor` di trend/xy fuori dalla tabella.

## Ordine consigliato
A (chiusura) → 2, 3, 4 come un unico piccolo ramo «rifiniture colori» (stessi file, taglia ~1h) → 1 e 7 come guardie → 5, 6 come semi (decisione) in `docs/plans/README.md` → poi Passo 2 (segreti).

## Verifica
Comandi al punto A + collaudo dal vivo del piano.
