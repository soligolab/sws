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
approfondita che il seme [identità, utenti e istanze](../archive/2026-09-18-identita-utenti-istanze.md)
chiedeva. Quel seme è **in archivio dal 22-10-2026**: le sue decisioni numerate (1-39) sono state
misurate contro il codice e o costruite o superate, Q56 è `sws-identita`, Q44 vive qui, e Q54 —
l'unica rimasta aperta — è diventata il seme [utenti nati sul
dispositivo](2026-10-22-utenti-nati-sul-dispositivo.md). Chiude anche Q60.

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

**Fase 4 — il gateway: fatta, e il piano è in archivio dal 21-10-2026**
([il gateway](../archive/2026-10-09-fase-4-gateway.md)). Il gateway esiste, gira su
`sws.soligo.net`, avvia un container per progetto e lo indirizza `/p/<azienda>/<progetto>/`.
Delle tre code, due sono fatte (il tetto dei progetti aperti visibile in console e la chiusura a
mano, ramo 1 della [chiusura dei residui](../archive/2026-10-19-chiusura-dei-residui.md), squash
`ec6f9d2d`); resta il **branding prima del login**, che è il ramo 2 dello stesso piano. L'unica
domanda senza risposta — cosa ci dice il numero di pannelli — è uscita in un seme suo, qui sotto.
*(Questo paragrafo ha detto «non è approvato, l'immagine amd64 non esiste» fino al 19-10-2026,
dieci giorni dopo che tutt'e due le cose erano diventate false. È la prima cosa che legge chi
riprende il lavoro.)*

(Questa riga diceva «nessun piano d'esecuzione in corso» dal 26-09.)

**Chiuso il 25-10-2026**: [gestione dei tag come oggetto unico](../archive/2026-09-21-gestione-tag-oggetto-unico.md) — Fase 3 (Modbus) il 04-10, Fase 4 (OPC-UA) il 25-10; le code sugli altri protocolli sono il seme [strutture sugli altri protocolli](2026-10-25-strutture-sugli-altri-protocolli.md). *(Fino al 29-10-2026 questa riga diceva ancora «restano Fase 3 e Fase 4».)*

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
| [2026-10-29-schermo-su-un-origine-sua.md](2026-10-29-schermo-su-un-origine-sua.md) | chiudendo il piano dello schermo remoto, validato il 29-10-2026 | **seme — decisione** — la pagina del pannello gira sull'origine `sws.soligo.net`: un pannello manomesso potrebbe leggere dal `localStorage` il gettone cloud di chi apre il suo schermo. Un nome per tutti gli schermi (HTTP-01, come oggi), uno per pannello (certificato jolly con DNS-01), o lasciare com'è finché i pannelli sono di prova. Da decidere prima che lo schermo esca dalla prova |
| [2026-10-29-licenza-del-software.md](2026-10-29-licenza-del-software.md) | risposta del maintainer alle domande per le condizioni d'uso, 29-10-2026 | **seme — decisione** — la licenza va cambiata: oggi AGPL-3.0-only, che col cloud aperto obbliga a offrire il sorgente a chi usa il servizio. Quale licenza, per runtime e IDE, chi deve acconsentire, le dipendenze, le versioni già pubblicate. Le condizioni d'uso hanno un segnaposto al punto 11 |
| [2026-10-26-progetto-letto-da-un-anonimo.md](2026-10-26-progetto-letto-da-un-anonimo.md) | la guardia delle rotte pre-auth corretta, 26-10-2026 | **seme — decisione** — `GET /api/project` sulla porta del viewer (7443) dà a un anonimo il progetto intero coi segreti mascherati, compresi destinatari email e numeri dei reperibili: vista ridotta, togliere i dati personali, o dichiararlo |
| [2026-10-26-fiducia-nel-browser-del-pannello.md](2026-10-26-fiducia-nel-browser-del-pannello.md) | risposta di chi sviluppa PixsysOS e prova sul WP630, 26-10-2026 | **seme — decisione** — la chiave del dispositivo in `/mnt/protected/ssl` è un errore di PixsysOS e potrebbe sparire: il TLS del pannello passa al **nostro certificato reso fidato** nell'archivio NSS di `user` (`certutil`, senza root), che sopravvive agli aggiornamenti. **Provato sul WP630**: sinottico senza avviso dopo il riavvio. Rivede la regola del 25-10 di C4 (TLS di default solo col certificato del dispositivo) e ritira `certificato-dispositivo.sh` |
| [2026-10-26-aprire-sws-soligo-net.md](2026-10-26-aprire-sws-soligo-net.md) | richiesta del maintainer, 26-10-2026: far provare SWS a persone esterne su `sws.soligo.net` | **piano d'esecuzione — da fare**, è il dettaglio della **Fase 5** del tronco cloud. Quattro rami: **A** un'azienda a testa per chi si registra, quota di tre progetti, il buco di `create_project` chiuso e i tetti sui container; **B** le due schermate (accesso e scelta progetto) responsive, con icone vere e il marchio al posto dello «SWS» cablato; **C** registrazione con verifica, PIN monouso via e-mail **in aggiunta** alla password, sessione di 30 giorni, SMTP per azienda su Infomaniak; **D** anteprima della prima pagina. Il cardine: marchio, isolamento, abbinamento pannello e console confinata **esistono già** e passano tutti dall'azienda — basta che chi si registra ne abbia una sua. **Non più bloccato dal 28-10-2026** (il ramo `feat/accesso-lvgl-due-campi` non esiste più); il ramo **B** ha preso la versione del runtime visibile **dopo** il login, e il perché non prima |
| [2026-10-25-corpi-e-parita-lvgl.md](2026-10-25-corpi-e-parita-lvgl.md) | ramo 5 dei residui, rimisurato il 25-10-2026 | **FATTO il 25-10-2026, da collaudare sul pannello** — il corpo del testo vivo sui 14 tipi rimasti (gauge, kpi, registro, allarmi, ricette…) con `unit_font_size` nuovo, e i testi che LVGL non disegna (etichetta dei simboli, ultimo valore della sparkline, pillola e ACK del banner, pagine dello storico e del registro, esito delle ricette). Deciso: tutto insieme |
| [2026-10-25-impianto-dal-dispositivo.md](2026-10-25-impianto-dal-dispositivo.md) | il maintainer lavora solo dal cloud, 25-10-2026 | **FATTO, uscito nella 2.21.0, da collaudare** — strada 3: nel cloud le sorgenti d'impianto non partono; scoperte, prove e valori vivi passano dal pannello collegato, che si ricollega da solo |
| [2026-10-23-server-modbus.md](2026-10-23-server-modbus.md) | nato decidendo OpenPLC, 23-10-2026 | **seme — decisione** — SWS parla Modbus **solo da client**: un PLC o uno SCADA che voglia venire a prendersi i dati non ha come farlo. Delle quattro combinazioni «chi legge chi» fra SWS e OpenPLC due funzionano e due no, e di quelle due **una sola è nostra**: l'altra vuole un client OPC-UA che OpenPLC non ha. Il mattone c'è già — `tokio-modbus` ha la feature `server`, e i test di Fase 3 la usano. Il solo precedente di «SWS che serve dati» è il server OPC-UA, ed è lì che stanno le scelte da riusare |
| [2026-10-25-strutture-sugli-altri-protocolli.md](2026-10-25-strutture-sugli-altri-protocolli.md) | chiudendo il piano dei tag, 25-10-2026 | **seme — decisione** — tipi compositi e array su S7, EtherNet/IP, MQTT, Home Assistant e Host: le code «non pianificate» del piano dei tag, ora che Modbus e OPC-UA sono fatti |
| [2026-10-25-planimetrie-3d.md](2026-10-25-planimetrie-3d.md) | idea del maintainer, 25-10-2026 | **piano d'esecuzione — da fare** — sessione di plan del 28-10-2026, decisioni prese: pianta 2D disegnata nell'IDE (muri/porte/finestre, più aree e blocchi per l'industriale), resa 3D con three.js solo nell'IDE (chunk lazy) **generata una volta** in un PNG di `images/` usato come `sfondo_immagine`; gli oggetti del sinottico restano 2D sopra; web e LVGL consumano solo l'immagine. Tre rami |
| [2026-10-24-il-gateway-non-dice-chi-bussa.md](2026-10-24-il-gateway-non-dice-chi-bussa.md) | trovato misurando la stabilità del tunnel sul VPS, 23-10-2026 | **seme — decisione**: il gateway logga solo `tunnel aperto` e `tunnel chiuso`, quindi un pannello spento e uno che bussa senza entrare danno lo **stesso** log, cioè nessuno. Ha reso non concludibile metà di una prova di stabilità. Due trappole da sciogliere prima di scrivere: il rumore (migliaia di righe) e il token dentro un tentativo fallito |
| [2026-10-22-utenti-nati-sul-dispositivo.md](2026-10-22-utenti-nati-sul-dispositivo.md) | estratto dal piano identità, archiviato il 22-10-2026 | **seme — decisione** — se un domani il pannello sapesse creare account da solo, al deploy successivo chi vince? Mezzo passo è fatto (l'Admin dell'abbinamento vive fuori dal progetto, in `utenti_dispositivo.yaml`), ma la marcatura `origine: dispositivo` della decisione 21 non esiste nel codice. Il caso non è ancora materialmente possibile — sul pannello non c'è un componente «gestione utenti» — ed è questo che lo rende rimandabile senza rischio |
| [2026-10-19-manuale-rifatto.md](2026-10-19-manuale-rifatto.md) | avvio del lavoro sulla documentazione, 19-10-2026 | **rami 1 e 2 fatti; il 25-10-2026 il maintainer ha chiesto tutti e 14 i tutorial** (ramo 3: laboratorio OpenPLC v4 + Mosquitto, ogni passo eseguito e fotografato), poi il ramo 4 delle schermate |
| [2026-10-20-openplc-sul-dispositivo.md](2026-10-20-openplc-sul-dispositivo.md) | il maintainer, preparando il laboratorio del tutorial, 20-10-2026 | **TUTTI E CINQUE I RAMI FATTI il 23-10-2026, da collaudare** — resta in `plans/` finché il maintainer non conferma sul pannello, poi va in archivio. Governo ibrido (quadlet nostro, aggiornamento suo), opzionale, porte alte perché in rootless sotto la 1024 non si pubblica, logica in `<progetto>/openplc/` che viaggia con backup, export, deploy e impronta — ma **non** con l'istantanea, che disegna una pagina e con la logica non c'entra. Due rotte per l'IDE nel cloud. **Fuori**: il server Modbus (seme suo) e il tempo reale, che in rootless non si ha. **Domanda aperta**: se le cinque liste scritte a mano vadano unificate |
| [2026-10-21-quando-si-libera-una-licenza.md](2026-10-21-quando-si-libera-una-licenza.md) | la domanda rimasta aperta chiudendo il piano sulle licenze, 21-10-2026 | **seme — decisione** — `max_pannelli` si mostra ma non ferma: per farlo valere serve sapere quando una licenza si consuma e **quando si libera**. Un tetto che nessuno libera prima o poi blocca un cliente che non ha fatto niente. `abbinato_ms` e `ultimo_ms` ci sono già; manca uno stato «dismesso», distinto da sospeso e da bandito |
| [2026-10-21-casadomotica-versionata-e-separata.md](2026-10-21-casadomotica-versionata-e-separata.md) | le due domande che il piano di CasaDomotica lasciava aperte, 21-10-2026 | **seme — decisione** — il progetto di riferimento vive solo sul VPS (540 MB di storico, ma il disegno sono poche centinaia di kB) ed è anche l'impianto di casa del maintainer. Versionarlo e separarlo dall'impianto vero vanno decisi insieme: se il disegno finisce nel git di progetto, la copia di lavoro è un clone e l'allineamento è un `pull`. La **pratica** è diventata una regola di `CLAUDE.md` |
| [2026-10-21-due-editor-sullo-stesso-progetto.md](2026-10-21-due-editor-sullo-stesso-progetto.md) | prova del maintainer, 21-10-2026: stesso progetto aperto da due browser in due sedi | **seme — decisione** — non c'è nessun lock: i tre `Mutex` del runtime sono interni a un processo e servono a non corrompere un file, non a dire «c'è già qualcuno». L'unico accorgimento è l'avviso «il progetto è cambiato», che ha una finestra di 20 s in cui attribuisce a sé **qualunque** cambio: due salvataggi ravvicinati si sovrascrivono in silenzio. Il dato per una presenza esiste già (`Aperto.collegati`) |
| [2026-10-18-indirizzo-vero-dietro-traefik.md](2026-10-18-indirizzo-vero-dietro-traefik.md) | limiti per indirizzo dell'onda 2, 18-10-2026 | **seme — decisione** — Traefik rootless vede ogni visitatore come `10.89.0.89` (rootlessport): il gateway non conta gli indirizzi privati e oggi il cloud non ha limiti. Strade: pasta, port handler, Traefik di sistema, PROXY protocol |
| [2026-10-17-tag-uguali-ritrasmessi.md](2026-10-17-tag-uguali-ritrasmessi.md) | trovato col banco di prestazioni, 17-10-2026 | **seme — decisione** — `TagDb::set` ritrasmette anche i valori invariati, e i generatori (ricalcolo a 100 ms) fanno 10 aggiornamenti/s per tag verso ogni client |
| [2026-10-23-rinnovo-del-certificato-firmato.md](2026-10-23-rinnovo-del-certificato-firmato.md) | decisione del maintainer, 23-10-2026 (decisione 6 del piano dei certificati) | **seme — decisione**: due anni di scadenza con **rinnovo automatico**, cioè il pannello annuncia l'impronta nuova firmandola con la vecchia. Il punto duro misurato: l'archivio tiene solo `sha256:<hex>`, e **da un'impronta non si verifica una firma** — cambia il formato per tre consumatori. Serve una sessione di plan dedicata, e viene dopo la prova sul TC620 |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **piano d'azione — decisione**: due binari (P: popup, template d'oggetto, report, notifiche SMS/voce, prestazioni, 2FA/LDAP; C: contatti e art. 14, default sicuri, TLS sul pannello, reset di fabbrica, header e limiti, firma/SBOM/scansione, fascicolo) in cinque onde, un ramo alla volta. Le voci [plan] partono da una sessione di plan |
| [2026-09-22-riorganizzare-i-file-dell-editor.md](2026-09-22-riorganizzare-i-file-dell-editor.md) | idea del maintainer, 22-09-2026 | **seme — decisione** — la parte su `ConfigView.tsx` è passata al [piano del 24-09](../archive/2026-09-24-configurazione-ad-albero-piano.md) (passo 1); qui restano `EditorShell`, `SvgCanvas`, lo store e i quattordici colori nelle righe di elenco. riorganizzare i `.tsx` dell'editor: 52 789 righe in 144 file, ma **cinque file ne fanno metà** (ConfigView 11 629, SvgCanvas 6 312, EditorShell 5 695, store 2 627, LeftPanel 2 023). Costa già: helper gemelli corretti una volta sola, `ConfigTab` dichiarato due volte. Da decidere **insieme** al seme dell'albero di configurazione, che tocca la stessa superficie |
