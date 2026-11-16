# L'assistente: i punti brevi rimasti dal secondo giro

> Seme, non piano. Raccolti il 16-11-2026 archiviando il piano
> [l'assistente, secondo giro](../../archive/2026-11-10-assistente-secondo-giro.md) prima della rc.20: tutte e cinque
> le fasi sono fatte, questi sono i punti che i revisori e gli agenti hanno lasciato aperti. Nessuno blocca l'uso.
> Le prove vere e il collaudo non stanno qui ma in `docs/COLLAUDI_IN_SOSPESO.md`.
> **Quando si riprende uno di questi punti, il primo passo è una sessione di plan dedicata per vederne i dettagli.**

## Da decidere (maintainer)

- **Mistral predefinito nel cloud?** Oggi, se una persona ha più chiavi, vince Anthropic, poi Kimi, poi Mistral
  (`ai/mod.rs`). Mistral è l'unico fornitore europeo dell'assistente: si può volerlo per primo su `sws.soligo.net`.
- **Le richieste FLUX fermate dal filtro dei contenuti** si contano nel tetto al costo dichiarato all'invio, perché il
  riferimento di Black Forest Labs non dice se le addebita. Con la prima prova vera si vede, e si corregge in
  `bfl.rs` (`Charge`).

## Da misurare con la prova vera

- **Mistral**: `max_tokens` è fermo a 32768, la cache non si pilota (`prompt_cache_key`) e il ragionamento non si
  chiede (`reasoning_effort`). Si decide coi numeri del banco dei tubi.
- **Prezzi Mistral**: Medium, Magistral, Devstral e Pixtral non hanno prezzo sul listino letto il 16-11 e si contano
  ai prezzi di Opus 5 (stima prudente). Sono modelli deprecati.
- **SVG libero (G3)**: valori con `&` o `\` negli attributi sono rifiutati del tutto, più stretto del necessario. Se un
  modello vero scrive spesso entità, si ammettono le cinque entità predefinite di XML.

## Piccoli difetti noti

- **Planimetria e sfondo (G2)**: se la planimetria cambia poi nel suo editor, lo sfondo SVG fatto dall'assistente non
  si rigenera da solo. Oggi lo rifà l'assistente (`floor_plan` con l'`id`).
- **Annullare una proposta applicata** (Ctrl+Z) non toglie la planimetria e il disegno in attesa del Salva
  (`ai:floor_plans:<id>`): il Salva li scrive lo stesso, non usati. Vale già per gli sfondi generati (`ai:sfondi`).
- **Una bozza con lo stesso id** di una planimetria creata a mano dopo, nella stessa conversazione, la sostituisce. Il
  diff la segna con `~`.
- **Le bocche dei simboli custom** (G3): la scheda Risorse non le mostra e non le modifica. Una bocca sbagliata scritta
  a mano in `project.yaml` blocca il Salva dell'IDE (PUT rifiutata con 400) finché non si corregge il file. Un runtime
  più vecchio ignora le bocche: il tubo cade sul centro del riquadro.
- **Il copione del banco «--vero»** riconosce Mistral solo per nome (`mistral|codestral|ministral` in
  `sws-editor/e2e/fixtures.ts`): senza test suo, coperto solo da `tsc`.
