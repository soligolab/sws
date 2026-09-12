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
| [2026-08-21-scada-widgets.md](2026-08-21-scada-widgets.md) | **PARZIALE** | F0-F8 in 2.1.0; il residuo (F5.3x + verifica parità LVGL) è ora dettagliato in `2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md` |
| [2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md](2026-09-12-F5.3x-xy-plot-e-verifica-lvgl.md) | **PARZIALE** | Parte A (T-70, XY plot multi-coppia) **fatta, su `main` e confermata sul TC620** (release 2.7.3); Parte B (verifica dal vivo della parità LVGL) resta da fare — il blocco è risolto, il dispositivo ha ora il binario aggiornato |
| [2026-09-10-T56-pannelli-editor.md](2026-09-10-T56-pannelli-editor.md) | **REALIZZATO E SU `main`** | tutti e tre i passi, con T-55 che ne era il prerequisito (`bd26c74f`); manca il collaudo a fondo dei due pannelli |
| [2026-09-11-utenti-nel-progetto.md](2026-09-11-utenti-nel-progetto.md) | **REALIZZATO E SU `main`** | i sei passi sono fatti e mergiati (`64c1b0db`); manca il collaudo a fondo — il deploy con e senza la casella, e la conferma 428 che non deve ripartire in ciclo |
| [2026-09-12-ruolo-minimo-avviso-noauth.md](2026-09-12-ruolo-minimo-avviso-noauth.md) | **DA FARE** | avviso nell'editor quando `min_role` non ha effetto in modalità no-auth (misura e dichiarazione del limite già fatte) |
| [2026-09-12-f7-residui-minori.md](2026-09-12-f7-residui-minori.md) | **DA FARE** | Parte A: bordo per-cella nella griglia. Parte B: motivo dell'ACK nello storico allarmi — ha una domanda per il maintainer prima di partire |
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
| [2026-09-12-q45-linger-permesso-produzione.md](2026-09-12-q45-linger-permesso-produzione.md) | Q45 | **pronto** — misurare il linger di fabbrica sul TC620, poi scegliere fra 4 opzioni |
| [2026-09-12-q49-tls-pinning-lvgl-mqtt.md](2026-09-12-q49-tls-pinning-lvgl-mqtt.md) | Q49 | **pronto** — estendere il pinning TLS (già fatto editor↔dispositivo) al viewer LVGL e al plugin MQTT |
| [2026-09-12-q53-misura-rimozione-sdk-qemu.md](2026-09-12-q53-misura-rimozione-sdk-qemu.md) | Q53 | **pronto** — misurare CPU/avvio del cross-build sul TC620 (ora possibile) prima di togliere i percorsi SDK/QEMU |
| [2026-09-12-q28-scala-bar-chart.md](2026-09-12-q28-scala-bar-chart.md) | Q28 | **pronto** — decisa (scala per serie, `stacked` resta condiviso), da costruire: web non legge ancora `bar_series[].min/max`, l'editor non li espone |
| [2026-09-12-q29-tag-due-tipi.md](2026-09-12-q29-tag-due-tipi.md) | Q29 | **pronto** — decisa (`write_data_type` accanto a `publish_topic`), da costruire su `TagDef`/`validate.rs`/le dodici eccezioni di `casa-locale` |
| [2026-09-12-q36-min-role-lvgl.md](2026-09-12-q36-min-role-lvgl.md) | Q36 | **pronto** — decisa (sessione vera nel client LVGL: login su richiesta, token su disco, logout esplicito), da costruire: schermata di login, tre funzioni di rete da autenticare, gate `min_role` in `lvgl_render.rs` — il lotto più grande fra i «pronti» di questa sessione |
| [2026-09-12-q31-verifica-chat-remota.md](2026-09-12-q31-verifica-chat-remota.md) | Q31 | **verifica** — provare la chat con un runtime remoto vero collegato |
| [2026-09-12-q46-verifica-projects-root.md](2026-09-12-q46-verifica-projects-root.md) | Q46 | **verifica** — confermare che `browse-dirs`/`mkdir` restino dentro `projects_root` |
