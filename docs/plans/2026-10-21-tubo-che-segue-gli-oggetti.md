# Il tubo che segue gli oggetti mossi da una variabile — seme

> Nato il 21-10-2026: era il **punto 6 del ramo B** del piano
> [tubazioni, bocche e stili](../archive/2026-10-15-tubazioni-bocche-e-stili.md), scritto come
> condizionale — «se il maintainer lo conferma». Il 21-10 il maintainer lo ha confermato, e il
> piano è andato in archivio con i due rami fatti: la cosa confermata esce qui, da sola.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui c'è l'idea e le misure di quando è nata, non un progetto.

## L'idea

Un tubo agganciato alla bocca di un simbolo segue il simbolo quando lo si sposta **nell'editor**.
Non lo segue quando a spostarlo è una **variabile** a runtime: un carrello su una rotaia, un
braccio, una paratoia che scorre. Il tubo resta disegnato dov'era e si stacca da ciò che collega.

## Cosa diceva il piano del 15-10-2026

> Seguire gli oggetti mossi da una variabile: sul web il percorso usa le posizioni risolte dai
> binding; su LVGL si ricalcola quando cambia la posizione di un oggetto agganciato.

Due strade già intraviste, una per motore, ed è esattamente il punto da cui la sessione di plan
deve ripartire — misurando prima com'è fatto **oggi** il percorso nei due posti, che dal 15-10 è
cambiato: il 20-10 il tubo ha imparato il tracciato a punti (`Tappa`, `Capo.dritto`,
`instrada` in `sws-editor/src/canvas/tubazioni.ts` e `sws-core/src/tubazioni.rs`), quindi il
percorso non è più solo «fra due bocche».

## Domande per la sessione di plan

- Il ricalcolo è per fotogramma o solo quando la posizione cambia davvero? Su LVGL un tubo a
  strati 2.5D non è gratis da ridisegnare.
- Cosa succede alla calamita: il tubo resta attaccato alla bocca, o alla posizione in cui la
  bocca era quando l'hai agganciato?
- Vale anche per i punti intermedi disegnati a mano, o solo per i due capi?
- Serve la parità web/LVGL dal primo giorno, o si parte dal web (dove le posizioni risolte dai
  binding ci sono già) e LVGL segue?
