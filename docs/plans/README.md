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

**Piano d'esecuzione in corso dal 05-10-2026**: [il tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md)
— utenti, aziende, spazi di lavoro, e la catena fino al pannello. Nato dalla sessione di plan
approfondita che il seme [identità, utenti e istanze](2026-09-18-identita-utenti-istanze.md)
chiedeva; quel seme **resta** e non si archivia, perché tiene le decisioni numerate (1-39) e il
testo integrale di Q44, Q54 e Q56. Chiude anche Q60.

**Fasi 1, 2, 3a e 3b chiuse.** 1 e 2 il 06-10-2026 (squash `9591acaf`): l'IDE ha i suoi utenti e le
rotte aperte sono una lista dichiarata. **3a e 3b** l'08-10-2026 (squash `59eb0ed6`), con un piano
ciascuna, ora in archivio: [aziende e console](../archive/2026-10-06-aziende-e-console.md) e
[i progetti nell'azienda](../archive/2026-10-07-progetti-per-azienda-fase-3b.md). Le aziende
esistono (l'implicita non si mostra), la console di amministrazione è un'applicazione a sé, e i
progetti si indirizzano `/<azienda>/<nome>` passando da un risolutore che verifica l'appartenenza.

**Fase 3 chiusa per intero** il 09-10-2026: 3a, 3b e
[3c](../archive/2026-10-08-fase-3c-ruoli-confinati-e-quote.md) sono in archivio. Le aziende
esistono, la console è confinata, i progetti si indirizzano per azienda e le quote di spazio
fermano davvero. Resta dichiaratamente al gateway il tetto sui **progetti aperti**: è un limite su
ciò che gira, non un conteggio in un database.

**Prossima: la Fase 4 — il gateway**, che ha il suo piano —
[il gateway](2026-10-09-fase-4-gateway.md), scritto il 09-10-2026 con le misure di quel giorno.
**Non è approvato**: porta cinque domande per la sessione di plan, una **contraddizione da
sciogliere** (la decisione 23 dice che «progetti aperti insieme» non è una quota, il maintainer
l'08-10 ha detto il contrario e la 3c ha seguito lui), e un prerequisito che **non è soddisfatto**
— l'immagine amd64 non è mai stata pubblicata su ghcr.

(Questa riga diceva «nessun piano d'esecuzione in corso» dal 26-09.)

**Ancora aperto, a fasi**: [gestione dei tag come oggetto unico](2026-09-21-gestione-tag-oggetto-unico.md) — Fasi 0-2 chiuse, restano **Fase 3 (Modbus)** e **Fase 4 (OPC-UA)**, più il collaudo a schermo della Fase 2. La riga in tabella lo dice già; la testa di questo indice diceva «nessun piano in corso» ed era imprecisa.

Il resto sono **semi**, non piani d'esecuzione: ognuno va aperto con una sessione di plan approfondita prima di scrivere codice.

**Dal 2026-09-12, anche le questioni aperte di `docs/OPEN_QUESTIONS.md` diventano piani singoli**
(istruzione del maintainer, tecnica da riusare in futuro) — non li decide questo passaggio, li
prepara per quando si prendono in mano. Tre categorie, segnate nella colonna «Cosa resta»:
**pronto** (decisa o quasi, resta da costruire/misurare), **decisione** (il piano presenta le
opzioni, aspetta la scelta del maintainer prima di qualunque codice), **verifica** (il codice
c'è già, manca solo la conferma a schermo prima di archiviare la scheda in
`docs/OPEN_QUESTIONS.md`).

| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-09-30-predefiniti-espliciti.md](2026-09-30-predefiniti-espliciti.md) | difetto del `data_log` bianco sul TC620, 30-09-2026 | **piano a fasi, in corso** — Fase 1 (tabella unica dei predefiniti, pannello che mostra valori veri e stati «auto»/«vuoto» espliciti, riempimento all'apertura), poi Fase 2 (colori e sfondi ignorati da LVGL) e Fase 3 (campi non-colore ignorati da LVGL) |
| [2026-09-22-riorganizzare-i-file-dell-editor.md](2026-09-22-riorganizzare-i-file-dell-editor.md) | idea del maintainer, 22-09-2026 | **seme — decisione** — la parte su `ConfigView.tsx` è passata al [piano del 24-09](../archive/2026-09-24-configurazione-ad-albero-piano.md) (passo 1); qui restano `EditorShell`, `SvgCanvas`, lo store e i quattordici colori nelle righe di elenco. riorganizzare i `.tsx` dell'editor: 52 789 righe in 144 file, ma **cinque file ne fanno metà** (ConfigView 11 629, SvgCanvas 6 312, EditorShell 5 695, store 2 627, LeftPanel 2 023). Costa già: helper gemelli corretti una volta sola, `ConfigTab` dichiarato due volte. Da decidere **insieme** al seme dell'albero di configurazione, che tocca la stessa superficie |
| [2026-10-03-log-del-device-nell-ide.md](2026-10-03-log-del-device-nell-ide.md) | richiesta del maintainer al collaudo, 03-10-2026 | **seme — decisione** — con l'IDE collegato a un pannello, il log dell'IDE mostra anche le righe del runtime del pannello con un'etichetta del dispositivo. Visto al collaudo: la riga dell'istantanea (presa dal pannello) non c'era nel log esportato dall'IDE, è servito l'SSH |
| [2026-09-24-lvgl-ignora-size-mode.md](2026-09-24-lvgl-ignora-size-mode.md) | misurato sul WP630, 24-09-2026 | **seme — decisione** — il viewer LVGL non legge `size_mode`: zero occorrenze nel crate. In `fixed` web e LVGL coincidono (cap a 1 voluto, letterbox Q37), ma in `ratio` il web scala a riempire e LVGL resta 1:1 — l'ultima parità web/LVGL scoperta. Non è una riga: i font LVGL non scalano (una face per taglia) e il touch va scalato all'inverso |
| [2026-09-25-scorciatoie-da-tastiera.md](2026-09-25-scorciatoie-da-tastiera.md) | idea del maintainer, 25-09-2026 | **seme — decisione** — un pannello di configurazione per le scorciatoie da tastiera. Misurato: dieci ascoltatori `keydown` scritti a mano, e la guida `?` (`ShortcutHelp`) è un secondo elenco che nessuno tiene allineato. Da decidere: solo vederle o anche cambiarle (serve un registro unico delle azioni), dove si salvano, contesti e conflitti, scorciatoie nuove per l'albero unico |
| [2026-09-18-identita-utenti-istanze.md](2026-09-18-identita-utenti-istanze.md) | Q44 + Q54 + Q56 | **seme — decisione, IN CODA; prima sessione di plan il 27-09** (29 decisioni, prerequisito l'aggiornamento del runtime: IDE su VPS, un container per progetto aperto, OpenVPN per azienda, abbinamento col codice, aziende e sviluppatori, quote; **dal 05-10-2026 anche i vincoli del CRA**: pannello aperto senza utenti, IDE senza password, rotte pre-auth — primo pezzo proposto il primo accesso del pannello + lista bianca) — di chi sono gli account e chi comanda quando due copie non sono d'accordo. È il lavoro più corposo e il maintainer l'ha messo dopo tutto il resto: quando comincerà, prima una sessione di plan che rilegga le tre schede contro il codice di allora |
| [2026-09-18-workspace-dei-progetti.md](2026-09-18-workspace-dei-progetti.md) | Q60 (da Q59) | **seme — decisione, IN CODA** con il precedente — il concetto di workspace. La prima metà (`start_editor.sh` come corsa di produzione) è fatta; deciso già: scelta *proposta*, non bloccante, solo IDE |
| [2026-09-18-post-bloccata-viewer-lvgl.md](2026-09-18-post-bloccata-viewer-lvgl.md) | Q55 | **seme — pronto** — l'unico che è un difetto e non una scelta: una POST che riceve 200 blocca per sempre il viewer via `spawn`. Via d'uscita già in uso (`block_on`), causa non spiegata, sei prove dal vivo da non rifare |
| [2026-09-18-ros2-robot-come-sorgente.md](2026-09-18-ros2-robot-come-sorgente.md) | Q23 | **seme — più avanti** — una superficie dati nuova (DDS); nessun bisogno in corso |
| [2026-09-18-mcp-editing-con-ia.md](2026-09-18-mcp-editing-con-ia.md) | Q26 | **seme — più avanti** — una superficie di editing nuova; da riverificare contro `sws-web/src/ai/`, che nel frattempo è cresciuto |
| [2026-09-12-q16-decoder-raster-image.md](2026-09-12-q16-decoder-raster-image.md) | Q16 | **pronto, tenuto in sospeso** (decisione del maintainer, 18-09-2026) — decoder raster per `image` su LVGL: si costruisce se emerge un bisogno reale, non prima |
| [2026-09-19-screenshot-del-manuale.md](2026-09-19-screenshot-del-manuale.md) | T-72 (F6) | **seme — rimandato a progetto stabilizzato** (decisione del maintainer, 20-09-2026) — il manuale va aggiornato **per intero**, testo e schermate: negli ultimi mesi il progetto è cambiato troppo. Fatto solo il tampone: le 10 schermate rigenerate e una nuova; il testo non è stato riverificato |
| [2026-09-19-boot-image-widget-congelati.md](2026-09-19-boot-image-widget-congelati.md) | T-72 | **seme — decisione** — oggetti non statici (trend, tabelle) «congelati» sulla pagina di boot: metà della palette è `foreignObject`/`canvas` e il rasterizzatore attuale non li rende |
| [2026-09-19-splash-os-psplash.md](2026-09-19-splash-os-psplash.md) | ex Q13 | **seme — decisione** — lo splash del sistema operativo, prima del launcher: fuori dal perimetro software del repo, domanda originale invariata |
| [2026-09-19-traduzioni-inglesi-revisione.md](2026-09-19-traduzioni-inglesi-revisione.md) | multilingua F6-F9 | **seme — verifica** — ~400 voci inglesi scritte da Claude e mai riviste, IDE in inglese mai collaudato a occhio, e il limite dichiarato della guardia |
| [2026-09-21-gestione-tag-oggetto-unico.md](2026-09-21-gestione-tag-oggetto-unico.md) | richiesta del maintainer, rivisto 22-09-2026 dopo sessione di plan approfondita | **piano a fasi (in corso)** — tag come oggetto unico. **Fasi 0, 1 e 2 chiuse e su `main`** il 22-09-2026 (0a-0d registro/creazione/rinomina/server; 1a-1e tipi scalari ricchi, modello composito, formati di durata e data, scrittura per percorso e filo a foglie, storico e Python; Fase 2 l'editor: scheda «Tipi» dentro «Variabili», completamento del percorso, rinomina che segue la radice, parametro di faceplate `istanza(Tipo)`, IA con i percorsi, CSV globale). Lo squash finale è `a76e6889`. **Restano le Fasi 3-4 (Modbus, OPC-UA)**, S7/EtherNet-IP/MQTT/HA/Host in coda, e il **collaudo a schermo della Fase 2**, mai fatto |
| [2026-10-04-trend-lvgl-come-il-web.md](2026-10-04-trend-lvgl-come-il-web.md) | collaudo sul TC620, 04-10-2026 | **seme — decisione** — al trend LVGL mancano espandi, preset di tempo e CSV del web; e mostra un tratto «mediato» e uno che oscilla (ipotesi: medie dei secchi oltre 15 min accanto a campioni grezzi) |
| [2026-10-08-marchi-visibili-prima-del-login.md](2026-10-08-marchi-visibili-prima-del-login.md) | chiusura della prima metà della Fase 3c, 08-10-2026 | **seme — decisione** — i file di un marchio (`/branding/:marchio/:file`) sono pre-auth e lo devono restare: la schermata di accesso ha bisogno di un logo prima che esista una sessione. Ma nel cloud un marchio è di un **cliente**, e `brand.json` porta il suo catalogo di dispositivi: chi indovina l'identificativo se lo scarica. L'**elenco** è già confinato dall'08-10, gli identificativi no. Porta con sé una seconda domanda: a chi sta in due aziende con marchi diversi, quale si mostra |
| [2026-10-06-modbus-tcp-senza-bus-e-trasporto-nel-catalogo.md](2026-10-06-modbus-tcp-senza-bus-e-trasporto-nel-catalogo.md) | osservazione del maintainer, 06-10-2026 | **seme — decisione, non urgente** — due cose: (a) su Modbus TCP il bus è cerimonia quando il dispositivo è uno, ma **serve** al gateway TCP→RTU (`project.rs:578`), quindi si corregge l'interfaccia e non il modello; (b) il catalogo non dichiara il trasporto — lo si deduce dalla presenza di `modbus.seriale`, e nulla impedisce un MCM280X su un bus RTU. Il campo `trasporto` col filtro e la guardia è piccolo e indipendente |
| [2026-10-04-configuratore-moduli.md](2026-10-04-configuratore-moduli.md) | collaudo MCM260X sul TC620, 04-10-2026 | **seme — decisione** — il progetto dice com'è configurato ogni dispositivo (sonde, unità, uscite) e il runtime lo applica al collegamento: leggi-confronta-scrivi per non usurare la memoria (MCM: 2001-2100 salva a ogni scrittura, 4001-4100 dopo 10 s), enumerazioni nel catalogo |
| [2026-10-05-cra-gap-analysis.md](2026-10-05-cra-gap-analysis.md) | richiesta del maintainer, 05-10-2026 | **analisi — decisione** — gap analysis rispetto al Cyber Resilience Act (Reg. UE 2024/2847): buona base di processo (SECURITY.md, cargo audit, SBOM, audit firmato), lacune su «sicuro per default» (pannello aperto senza utenti, HTTP in chiaro, TLS di campo non verificato), firma degli aggiornamenti, procedura art. 14 (già in vigore dall'11-09-2026). Roadmap P0/P1/P2 e 5 decisioni |
