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

## Da correggere nello stesso lavoro: la misura delle icone non vale nello stile VS Code

Visto dal maintainer il 05-11-2026, collaudando la 2.25.1: la preferenza «Icon size — Icons in the Tools menu and
symbol previews: larger on high-resolution or touch monitors» (Configurazione → IDE) non cambia le icone della
disposizione «Stile VS Code» (piano archiviato [`2026-10-31-ide-stile-vscode.md`](../archive/2026-10-31-ide-stile-vscode.md)).

Misurato nel codice lo stesso giorno:
- la preferenza è `misuraIcone` nello store (16, 20, 24 o 28 px, predefinita 24; `store/index.ts:266-277`, chiave
  `sws.ide.misuraIcone`), e la leggono **solo** i tre punti della palette in `editor/LeftPanel.tsx` (1023, 1089,
  1121: i gruppi di Strumenti e le anteprime dei simboli di libreria);
- le due barre di attività dello stile VS Code hanno le icone **fisse a 24 px** (`editor/BarraAttivita.tsx:113`) in
  una barra larga 48 (`LARGHEZZA_BARRA`, riga 23), a sinistra e a destra. Su un monitor touch o ad alta risoluzione
  non crescono.

La correzione proposta: le barre seguono `misuraIcone` (icona della misura scelta, barra e voci in proporzione), e la
frase della preferenza dice che vale anche per le barre. Da verificare all'inizio col maintainer quali icone intendeva:
le due barre, le icone dei rami del pannello destro, o anche le voci di Configurazione. Sta qui perché lo stile sobrio
rifà comunque le icone dell'IDE (monocrome al posto delle emoji): conviene che la misura entri nello stesso giro.
