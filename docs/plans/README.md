# I piani vivi — indice e stato

> Qui stanno i piani **ancora in gioco**: non finiti, o finiti a metà, o che sono vincoli
> riusabili invece che lavoro da fare. Quelli conclusi o superati sono stati spostati in
> [`docs/archive/`](../archive/README.md) l'11-09-2026, che ne tiene l'indice e l'evidenza.
>
> Un piano finito non si cancella: resta come **referto** — dice perché le cose sono fatte come
> sono fatte. C'è un precedente di cancellazione (`CHANGELOG` §2026.7.0: piani di lavoro già
> implementato, «recuperabili da git history»): vale solo per i piani mai iniziati e ormai falsi.
>
> **Nota sui percorsi**: fino all'11-09-2026 la regola era «i file di questa cartella non si
> spostano», perché citati da altri documenti e dal codice. Lo spostamento in archivio ha
> riscritto tutti e 33 i riferimenti; un `git log --follow` continua a seguirli.

| Piano | Stato | Cosa resta |
|---|---|---|
| [2026-09-17-workspace-cartella-progetti.md](2026-09-17-workspace-cartella-progetti.md) | **SEME — decisione** | due cose distinte: `start_editor.sh` è uno script di **produzione** e non deve imporre una radice dentro il checkout (si duplica in `start_editor_develop.sh`), e il concetto di **workspace** non esiste e va progettato. Quattro decisioni (D1-D4) prima di qualunque codice; una delle vie riapre Q46, che è una decisione di sicurezza già collaudata |
| [2026-09-12-casamauro-arricchimento-demo.md](2026-09-12-casamauro-arricchimento-demo.md) | **DA FARE** | arricchire il progetto personale CasaMauro con le feature F2-F6 non esercitate — contenuto, non codice, nessun branch |

**Dal 2026-09-12, anche le questioni aperte di `docs/OPEN_QUESTIONS.md` diventano piani singoli**
(istruzione del maintainer, tecnica da riusare in futuro) — non li decide questo passaggio, li
prepara per quando si prendono in mano. Tre categorie, segnate nella colonna «Cosa resta»:
**pronto** (decisa o quasi, resta da costruire/misurare), **decisione** (il piano presenta le
opzioni, aspetta la scelta del maintainer prima di qualunque codice), **verifica** (il codice
c'è già, manca solo la conferma a schermo prima di archiviare la scheda in
`docs/OPEN_QUESTIONS.md`).

| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-09-12-q16-decoder-raster-image.md](2026-09-12-q16-decoder-raster-image.md) | Q16 | **pronto** — decoder raster per `image` su LVGL, se emerge un bisogno reale |
