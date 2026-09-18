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
| [2026-09-18-immagine-di-boot.md](2026-09-18-immagine-di-boot.md) | **piano approvato, non iniziato** (sessione di plan del 18-09-2026, da Q13) — l'immagine di boot è un tipo di pagina dell'IDE (`boot/` su disco, invisibile al runtime), una sola «abilitata», progetto vuoto con due pagine, formato predefinito di progetto, PNG dal browser al salvataggio, installazione via D-Bus con canale file e unità dedicate. Sei fasi F1–F6, una sessione ciascuna; F0 (questo testo) fatta. Le note D-Bus del maintainer stanno in Appendice A |
| [2026-09-18-multilingua-chiusura.md](2026-09-18-multilingua-chiusura.md) | **IN CORSO — F0 fatta** | chiudere il capitolo multilingua su tre assi: la guardia `check_i18n_ui.sh` e le ~320 stringhe italiane cablate nell'IDE (F1, F6-F9), i difetti delle notifiche e la lingua per canale (F2), i testi di sistema che seguono la lingua dei contenuti anche sul web (F3), il marchio automatico e le proposte per i segnaposto (F4), la configurazione del fornitore persistita (F5). Quattro decisioni del maintainer dentro. **Un ramo alla volta** anche rispetto al piano dell'immagine di boot |

Due piani d'esecuzione approvati il 18-09-2026, nessuno dei due iniziato: si prendono **uno alla
volta**. Quello che resta da decidere sta nella tabella sotto — **semi**, non piani d'esecuzione.

**Dal 2026-09-12, anche le questioni aperte di `docs/OPEN_QUESTIONS.md` diventano piani singoli**
(istruzione del maintainer, tecnica da riusare in futuro) — non li decide questo passaggio, li
prepara per quando si prendono in mano. Tre categorie, segnate nella colonna «Cosa resta»:
**pronto** (decisa o quasi, resta da costruire/misurare), **decisione** (il piano presenta le
opzioni, aspetta la scelta del maintainer prima di qualunque codice), **verifica** (il codice
c'è già, manca solo la conferma a schermo prima di archiviare la scheda in
`docs/OPEN_QUESTIONS.md`).

| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-09-18-identita-utenti-istanze.md](2026-09-18-identita-utenti-istanze.md) | Q44 + Q54 + Q56 | **seme — decisione, IN CODA** — di chi sono gli account e chi comanda quando due copie non sono d'accordo. È il lavoro più corposo e il maintainer l'ha messo dopo tutto il resto: quando comincerà, prima una sessione di plan che rilegga le tre schede contro il codice di allora |
| [2026-09-18-workspace-dei-progetti.md](2026-09-18-workspace-dei-progetti.md) | Q60 (da Q59) | **seme — decisione, IN CODA** con il precedente — il concetto di workspace. La prima metà (`start_editor.sh` come corsa di produzione) è fatta; deciso già: scelta *proposta*, non bloccante, solo IDE |
| [2026-09-18-post-bloccata-viewer-lvgl.md](2026-09-18-post-bloccata-viewer-lvgl.md) | Q55 | **seme — pronto** — l'unico che è un difetto e non una scelta: una POST che riceve 200 blocca per sempre il viewer via `spawn`. Via d'uscita già in uso (`block_on`), causa non spiegata, sei prove dal vivo da non rifare |
| [2026-09-18-ros2-robot-come-sorgente.md](2026-09-18-ros2-robot-come-sorgente.md) | Q23 | **seme — più avanti** — una superficie dati nuova (DDS); nessun bisogno in corso |
| [2026-09-18-mcp-editing-con-ia.md](2026-09-18-mcp-editing-con-ia.md) | Q26 | **seme — più avanti** — una superficie di editing nuova; da riverificare contro `sws-web/src/ai/`, che nel frattempo è cresciuto |
| [2026-09-12-q16-decoder-raster-image.md](2026-09-12-q16-decoder-raster-image.md) | Q16 | **pronto, tenuto in sospeso** (decisione del maintainer, 18-09-2026) — decoder raster per `image` su LVGL: si costruisce se emerge un bisogno reale, non prima |
