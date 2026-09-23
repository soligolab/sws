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

**In corso, implementato e da collaudare** (20-09-2026): [albero delle pagine e navigatore](2026-09-20-albero-pagine-navigatore.md) —
F1 (albero + pannello sinistro sempre visibile) e F2 (oggetto `page_navigator`, web + LVGL) sono su `feat/page-navigator`; restano il collaudo
del maintainer e la prova sul pannello vero (container nuovo). Il resto sta nella tabella sotto — **semi**, non piani d'esecuzione.

**Dal 2026-09-12, anche le questioni aperte di `docs/OPEN_QUESTIONS.md` diventano piani singoli**
(istruzione del maintainer, tecnica da riusare in futuro) — non li decide questo passaggio, li
prepara per quando si prendono in mano. Tre categorie, segnate nella colonna «Cosa resta»:
**pronto** (decisa o quasi, resta da costruire/misurare), **decisione** (il piano presenta le
opzioni, aspetta la scelta del maintainer prima di qualunque codice), **verifica** (il codice
c'è già, manca solo la conferma a schermo prima di archiviare la scheda in
`docs/OPEN_QUESTIONS.md`).

| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-09-21-sessione-stabilizzazione.md](2026-09-21-sessione-stabilizzazione.md) | blocchi A-C del 21-09-2026 | **piano a passi (da approvare)** — pulizia e bug piccoli, guardie con stack, segreti di progetto (token Telegram), viewer LVGL sull'albero, albero nella cronologia, rifiniture, collaudo TC620: un passo alla volta, un ramo alla volta |
| [2026-09-22-configurazione-ad-albero.md](2026-09-22-configurazione-ad-albero.md) | idea del maintainer, 22-09-2026 | **seme — decisione** — il menù di Configurazione diventa un albero laterale (le schede larghe restano nell'area dell'IDE), per arrivare più in fretta a tutte le opzioni. Misurato: sedici schede in tre elenchi paralleli, `ConfigView.tsx` da 11629 righe, il Salva unico che vuole le bozze montate. **Dopo** la Fase 2 dei tag, che introduce la scheda «Tipi» e cambia le Variabili: stessa superficie |
| [2026-09-22-riorganizzare-i-file-dell-editor.md](2026-09-22-riorganizzare-i-file-dell-editor.md) | idea del maintainer, 22-09-2026 | **seme — decisione** — riorganizzare i `.tsx` dell'editor: 52 789 righe in 144 file, ma **cinque file ne fanno metà** (ConfigView 11 629, SvgCanvas 6 312, EditorShell 5 695, store 2 627, LeftPanel 2 023). Costa già: helper gemelli corretti una volta sola, `ConfigTab` dichiarato due volte. Da decidere **insieme** al seme dell'albero di configurazione, che tocca la stessa superficie |
| [2026-09-23-storico-allarmi-eventi-persi.md](2026-09-23-storico-allarmi-eventi-persi.md) | difetto misurato, 23-09-2026 | **seme — pronto** (è un difetto, non una scelta) — un allarme che scatta, notifica e rientra **senza essere confermato** non entra mai nello storico: il registro scrive solo a ciclo ISA completo. Provato: tre allarmi scattati, uno confermato, un solo evento registrato. La direzione è del maintainer, «l'allarme avvisa quando scatta»: la riga nasce allo scatto e si completa dopo. Da vedere insieme al seme qui sopra |
| [2026-09-18-identita-utenti-istanze.md](2026-09-18-identita-utenti-istanze.md) | Q44 + Q54 + Q56 | **seme — decisione, IN CODA** — di chi sono gli account e chi comanda quando due copie non sono d'accordo. È il lavoro più corposo e il maintainer l'ha messo dopo tutto il resto: quando comincerà, prima una sessione di plan che rilegga le tre schede contro il codice di allora |
| [2026-09-18-workspace-dei-progetti.md](2026-09-18-workspace-dei-progetti.md) | Q60 (da Q59) | **seme — decisione, IN CODA** con il precedente — il concetto di workspace. La prima metà (`start_editor.sh` come corsa di produzione) è fatta; deciso già: scelta *proposta*, non bloccante, solo IDE |
| [2026-09-18-post-bloccata-viewer-lvgl.md](2026-09-18-post-bloccata-viewer-lvgl.md) | Q55 | **seme — pronto** — l'unico che è un difetto e non una scelta: una POST che riceve 200 blocca per sempre il viewer via `spawn`. Via d'uscita già in uso (`block_on`), causa non spiegata, sei prove dal vivo da non rifare |
| [2026-09-18-ros2-robot-come-sorgente.md](2026-09-18-ros2-robot-come-sorgente.md) | Q23 | **seme — più avanti** — una superficie dati nuova (DDS); nessun bisogno in corso |
| [2026-09-18-mcp-editing-con-ia.md](2026-09-18-mcp-editing-con-ia.md) | Q26 | **seme — più avanti** — una superficie di editing nuova; da riverificare contro `sws-web/src/ai/`, che nel frattempo è cresciuto |
| [2026-09-12-q16-decoder-raster-image.md](2026-09-12-q16-decoder-raster-image.md) | Q16 | **pronto, tenuto in sospeso** (decisione del maintainer, 18-09-2026) — decoder raster per `image` su LVGL: si costruisce se emerge un bisogno reale, non prima |
| [2026-09-19-screenshot-del-manuale.md](2026-09-19-screenshot-del-manuale.md) | T-72 (F6) | **seme — rimandato a progetto stabilizzato** (decisione del maintainer, 20-09-2026) — il manuale va aggiornato **per intero**, testo e schermate: negli ultimi mesi il progetto è cambiato troppo. Fatto solo il tampone: le 10 schermate rigenerate e una nuova; il testo non è stato riverificato |
| [2026-09-19-boot-image-collaudo-container.md](2026-09-19-boot-image-collaudo-container.md) | T-72 (F5) | **seme — verifica** — la metà host è provata sul TC620 vero; il runtime nel container non è mai girato sul dispositivo (immagine non ricostruita), e i permessi fra container e host non sono stati guardati |
| [2026-09-19-preset-pixsys-catalogo.md](2026-09-19-preset-pixsys-catalogo.md) | T-72 (F6) | **seme — decisione** — 480×272, 1280×768 e 1366×768 «da confermare» in `BRAND_SWS.md`: servono i nomi dei modelli, che nel repo non ci sono (aggiunto solo il TD710 800×480) |
| [2026-09-19-boot-image-ripristino-di-fabbrica.md](2026-09-19-boot-image-ripristino-di-fabbrica.md) | T-72 | **seme — decisione** — tornare all'immagine di fabbrica dall'IDE (`ResetBackgroundImage` funziona come `user`); oggi solo a mano, `HOWTO` §17 |
| [2026-09-19-boot-image-widget-congelati.md](2026-09-19-boot-image-widget-congelati.md) | T-72 | **seme — decisione** — oggetti non statici (trend, tabelle) «congelati» sulla pagina di boot: metà della palette è `foreignObject`/`canvas` e il rasterizzatore attuale non li rende |
| [2026-09-19-splash-os-psplash.md](2026-09-19-splash-os-psplash.md) | ex Q13 | **seme — decisione** — lo splash del sistema operativo, prima del launcher: fuori dal perimetro software del repo, domanda originale invariata |
| [2026-09-19-traduzioni-inglesi-revisione.md](2026-09-19-traduzioni-inglesi-revisione.md) | multilingua F6-F9 | **seme — verifica** — ~400 voci inglesi scritte da Claude e mai riviste, IDE in inglese mai collaudato a occhio, e il limite dichiarato della guardia |
| [2026-09-21-gestione-tag-oggetto-unico.md](2026-09-21-gestione-tag-oggetto-unico.md) | richiesta del maintainer, rivisto 22-09-2026 dopo sessione di plan approfondita | **piano a fasi (in corso)** — tag come oggetto unico. **Fasi 0, 1 e 2 chiuse e su `main`** il 22-09-2026 (0a-0d registro/creazione/rinomina/server; 1a-1e tipi scalari ricchi, modello composito, formati di durata e data, scrittura per percorso e filo a foglie, storico e Python; Fase 2 l'editor: scheda «Tipi» dentro «Variabili», completamento del percorso, rinomina che segue la radice, parametro di faceplate `istanza(Tipo)`, IA con i percorsi, CSV globale). Lo squash finale è `a76e6889`. **Restano le Fasi 3-4 (Modbus, OPC-UA)**, S7/EtherNet-IP/MQTT/HA/Host in coda, e il **collaudo a schermo della Fase 2**, mai fatto |
