# La disposizione «Stile VS Code» dell'IDE, le cose lasciate fuori — seme

> **Stato: seme — decisione.** Staccato il 14-11-2026 dal seme dello stile sobrio, quando quello è diventato piano.
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne
> tutti i dettagli.**

## Le cose lasciate fuori (annotate il 10-11-2026 da `Appunti.txt`)

> Punto di `Appunti.txt` del 31-10-2026, spostato qui il 10-11-2026 quando il maintainer ha chiesto di trasformare
> gli appunti in semi e piani e di eliminare il file. Il piano da cui viene è in archivio:
> [`2026-10-31-ide-stile-vscode.md`](../../archive/2026-10-31-ide-stile-vscode.md), sezione «Fuori da questo piano».

La disposizione «Stile VS Code» dell'IDE è entrata il 31-10-2026 e ha lasciato fuori tre cose. Stavano nel seme
dello stile sobrio (`docs/plans/2026-11-14-stile-sobrio.md`), che il 14-11-2026 è diventato piano senza di loro:
il piano rifà i colori e le icone, non la disposizione.

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
