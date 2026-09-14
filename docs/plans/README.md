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
| [2026-09-10-T56-pannelli-editor.md](2026-09-10-T56-pannelli-editor.md) | **REALIZZATO E SU `main`** | tutti e tre i passi, con T-55 che ne era il prerequisito (`bd26c74f`); manca il collaudo a fondo dei due pannelli |
| [2026-09-11-utenti-nel-progetto.md](2026-09-11-utenti-nel-progetto.md) | **REALIZZATO E SU `main`** | i sei passi sono fatti e mergiati (`64c1b0db`); manca il collaudo a fondo — il deploy con e senza la casella, e la conferma 428 che non deve ripartire in ciclo |
| [2026-09-14-revisione-template.md](2026-09-14-revisione-template.md) | **DA FARE** | revisione del parco template proposta dal maintainer: verità dei documenti di licenza, un ruolo dichiarato per ognuno, le funzioni senza vetrina (`recipes:` a zero con `recipe_panel` in vetrina, `min_role` a zero), i sei fermi al 28-08 |
| [2026-09-12-ruolo-minimo-avviso-noauth.md](2026-09-12-ruolo-minimo-avviso-noauth.md) | **DA FARE** | avviso nell'editor quando `min_role` non ha effetto in modalità no-auth (misura e dichiarazione del limite già fatte) |
| [2026-09-12-f7-residui-minori.md](2026-09-12-f7-residui-minori.md) | **PARTE A FATTA E SU `main`** | Parte A: bordo per-cella, confermata dal vivo dal maintainer e mergiata (`bd773d4`). Parte B: ridotta a un rimando all'audit dallo storico allarmi (scelta del maintainer il 13-09-2026, niente migrazione di schema) — non ancora iniziata |
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
| [2026-09-12-q53-misura-rimozione-sdk-qemu.md](2026-09-12-q53-misura-rimozione-sdk-qemu.md) | Q53 | **pronto** — misurare CPU/avvio del cross-build sul TC620 (ora possibile) prima di togliere i percorsi SDK/QEMU |
