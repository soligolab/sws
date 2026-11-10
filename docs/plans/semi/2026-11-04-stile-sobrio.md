# Uno stile grafico sobrio, dove il colore serve solo a dire che qualcosa conta — seme

> **Stato: seme — decisione.** Nato il 04-11-2026 da una richiesta del maintainer: «mi hanno contestato che la grafica
> di sws è troppo colorata e giocosa (a me piace), valuterei uno stile grafico aggiuntivo più sobrio e meno colorato
> dove il colore serva veramente solo per evidenziare le cose importanti».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.** Qui ci sono l'idea e le misure del 04-11-2026, non un progetto.

## L'idea

Uno stile **in più**, non al posto di quello di oggi: chi lo vuole lo sceglie, chi ama quello colorato lo tiene. Nello
stile sobrio il colore è un segnale — allarme, stato anomalo, il comando che si sta per dare — e tutto il resto è in
scala di grigi, come chiede ISA-101 / High Performance HMI.

## Le misure di oggi

| | |
|---|---|
| L'IDE | il marchio è in `sws-editor/public/branding/<marchio>/brand.json` (12 colori: `bg`, `surface`, `primary` arancio `#DD5D21`, `secondary` giallo, `accent` azzurro…), letto a ogni caricamento; il componente usa `var(--brand-…)` in circa 2240 punti |
| Colori scritti a mano | circa **590** colori esadecimali letterali nei `.tsx` dell'editor, fuori dal marchio (per esempio le intestazioni colorate di Strumenti: Forme, Controlli, Indicatori…) |
| Icone | le voci di Configurazione hanno un'emoji ciascuna (38 in `config/schede.ts`), e altre circa 300 emoji nei `.tsx` |
| I sinottici | non hanno temi: c'è `symbol_style` (volume da 0, piatto ISA-101, a 100) solo per i simboli, e i default dei colori in `tests/fixtures/colori-predefiniti.json`, letti dai due motori |
| Seme vicino | [`2026-10-30-stile-grafico-di-progetto.md`](2026-10-30-stile-grafico-di-progetto.md): uno stile di progetto che dia il default a tutti gli oggetti dei sinottici («tutto ISA-101») |

## Le due metà, da tenere distinte

1. **L'IDE** (chi progetta): uno stile sobrio dell'interfaccia — icone monocrome al posto delle emoji, intestazioni
   neutre, un solo colore d'accento. Probabilmente un'opzione nelle Preferenze IDE, accanto a chiaro/scuro, con i
   colori letterali portati sotto il marchio.
2. **I sinottici** (chi usa il pannello): un set di default sobrio per tutti i tipi — è il seme del 30-10, e questa
   richiesta gli dà una ragione in più e un nome. Da decidere se si lavorano insieme o in sequenza.

Domande per la sessione di plan: chi l'ha contestata guardava l'IDE, i sinottici o tutti e due? Lo stile sobrio è del
progetto (viaggia col deploy) o della persona (preferenza dell'IDE)? Le emoji spariscono o restano nello stile di oggi?

## La misura delle icone nello stile VS Code — fatta

Vista dal maintainer il 05-11-2026 e corretta lo stesso giorno: le due barre dello stile VS Code seguono la
«Dimensione icone». Il dettaglio è nel [piano archiviato dello stile VS Code](../../archive/2026-10-31-ide-stile-vscode.md),
sezione «Completamento». Quando lo stile sobrio rifarà le icone dell'IDE, la misura c'è già.

## La disposizione «Stile VS Code», cose lasciate fuori (annotate il 10-11-2026 da `Appunti.txt`)

> Punto di `Appunti.txt` del 31-10-2026, spostato qui il 10-11-2026 quando il maintainer ha chiesto di trasformare
> gli appunti in semi e piani e di eliminare il file. Il piano da cui viene è in archivio:
> [`2026-10-31-ide-stile-vscode.md`](../../archive/2026-10-31-ide-stile-vscode.md), sezione «Fuori da questo piano».

La disposizione «Stile VS Code» dell'IDE è entrata il 31-10-2026 e ha lasciato fuori tre cose. Stanno in questo
seme perché riguardano l'aspetto dell'IDE, la stessa metà che lo stile sobrio vuole rifare: la sessione di plan
che aprirà questo seme decide anche se farle, e in che ordine.

1. **Chat e log come voci della barra di attività.** In VS Code stanno in fondo alla barra e nel pannello in
   basso. Da noi sono cassetti in `sws-editor/src/App.tsx` e funzionano: al 10-11-2026 la chat dell'assistente
   (`ChatPanel`) è il cassetto a destra dentro `<main>`, il log (`LogPanel`) è il cassetto in basso, righe 1146-1157.
2. **Una barra di stato in basso**, in stile VS Code. Oggi non c'è.
3. **Altre disposizioni oltre a «Classica» e «VS Code».** L'elenco e la scheda sono già pronti ad accoglierne di
   nuove: `DISPOSIZIONI_IDE = ["classica", "vscode"]` in `sws-editor/src/store/index.ts` (riga 295 al 10-11-2026;
   il commento nel codice dice «un elenco e non un interruttore: le prossime ci entrano senza rifare niente»), e la
   scheda Configurazione → IDE (`sws-editor/src/config/schede/IdePreferencesTab.tsx`) disegna un bottone per ogni
   voce dell'elenco.

**CasaDomotica:** la regola del `CLAUDE.md` («quando una funzione visibile entra in `main`, va messa anche in
CasaDomotica», 16-10-2026) non si applica a queste tre cose, perché sono l'IDE e non il progetto. Lo si annota
così com'è, come chiede la regola.
