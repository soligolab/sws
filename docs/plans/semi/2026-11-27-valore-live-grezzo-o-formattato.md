# Il «Live value» di Tags: il valore grezzo o il valore con le regole del tag (27-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una sessione di plan dedicata e approfondita,
> che definisce ogni dettaglio. Il testo qui sotto è l'idea e le misure del giorno, non il progetto.

## L'idea

Il maintainer, 27-11-2026, durante il collaudo della 2.28.0-dev.4 (screenshot della scheda Tags del progetto
`tiny-ty`): «in testa alla colonna "Live value" aggiungi un flag per mostrare il dato raw (quello che si vede ora) o il
dato condizionato con tutte le regole applicate al tag (unità di misura, espressione etc...)».

Oggi la colonna mostra, per esempio, `4.818258762359619` per `ty.cpu_pct` e `1155.84765625` per
`ty.ram_disponibile_mb`: il numero intero, senza decimali scelti e senza unità.

## Le misure di oggi

- La cella è `{String(tv.value)}` in `sws-editor/src/config/schede/TagsTab.tsx` (riga 637 circa). `tv` viene da
  `tagValues[tag.id]`, cioè dal WebSocket del runtime.
- Il valore che arriva dal runtime è **già** quello dopo la scalatura raw→eng (`raw_min`/`raw_max`/`eng_min`/
  `eng_max`) e dopo l'espressione λ: il runtime le applica prima di pubblicare. Il valore «raw» del maintainer è quindi
  il valore **non formattato**, non il valore del protocollo prima della scalatura. Il valore del protocollo oggi non
  arriva all'IDE.
- Le regole di presentazione del tag stanno nella meta (⚙): `unit`, `decimals`. Il formato dei widget è in
  `formatValue` (`sws-editor/src/canvas/SvgCanvas.tsx`, riga 552 circa). Un tag `string` o `bool` non ha decimali.

## Le opzioni visibili oggi

1. **Un interruttore nell'intestazione della colonna**, «grezzo / formattato», che vale per tutta la tabella e si
   ricorda per persona (preferenza dell'IDE). Il formattato usa `decimals` e `unit` del tag; senza `decimals`, il
   numero com'è.
2. **Tutte e due le cose insieme**: il valore formattato nella cella e il grezzo nel `title` (al passaggio del mouse).
3. **Anche il valore del protocollo, prima della scalatura**: chiede che il runtime pubblichi il valore grezzo accanto
   a quello ingegneristico. È lavoro sul runtime e sul WebSocket, non solo sull'IDE.

Da decidere nella sessione di plan: quale opzione; se l'interruttore vale anche per le foglie delle variabili
strutturate (che hanno l'unità nei membri del tipo); se il formattato rispetta i limiti (colore Lo/Hi).
