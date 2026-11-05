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

## ▶ La serie coordinata del 04-11-2026 — l'ordine delle sessioni

> Richiesta del maintainer, 04-11-2026: «unificare o coordinare i plan in modo da avviare una serie di sessioni di
> sviluppo coordinate che portino a concludere il lavoro senza aprire altri plan». Le anomalie che trova collaudando la
> 2.25.0 entrano qui, non in piani nuovi. Misure in `tmp/piani-misure/` (solo su theobroma); le decisioni prese il
> 04-11 stanno nei piani. **Una sessione = un ramo = 3-4 ore.** Se il maintainer non ha ancora collaudato la sessione
> precedente, la successiva si **annida** sul suo ramo (regola «un ramo alla volta», opzione 2) e la catena si mergia
> in ordine dopo il collaudo.

| # | Ramo | Piano | Cosa si prova alla fine | Immagine |
|---|---|---|---|---|
| C0 | `fix/collaudo-2-25-0` | questa tabella, §Collaudo | chat e registro staccati nel cloud parlano col progetto; i menù di pagina mostrano i nomi; «Montagna» leggera sul WP630 | **2.25.1** |
| T1 | `feat/template-regole` | questa tabella, §Regole dei template | il lucchetto «serve Supervisor» sui comandi che il ruolo non può usare (web e LVGL); R6–R8 nella guardia; i primi sei template a posto | — |
| T2 | `feat/template-regole-2` | idem | gli altri dieci template; la guardia a zero | sì |
| F1 | `feat/finestra-avviso` | [Finestra di avviso](2026-11-04-finestra-di-avviso.md) | il componente; Backup, configurazione, menu ☰ senza pop-up del browser | — |
| L0 | `fix/sandbox-python` | [Logica unificata](2026-11-04-logica-unificata.md) | `print`, `for`, `+=` negli script; i default dei parametri applicati | sì |
| M1 | `feat/manuale-sito` | [Manuale pubblico](2026-11-03-manuale-pubblico.md) | il sito generato in `sws/tmp/manuale-sito/`, nessun link rotto | — |
| M2 | `feat/manuale-vps` | idem | `sws.soligo.net/manuale/` online, i crawler IA respinti | — |
| F2 | `feat/finestra-avviso-2` | Finestra di avviso | deploy ed editor senza pop-up del browser | — |
| F3 | `feat/finestra-avviso-3` | idem | viewer e console; le finestre fatte a mano sulla stessa cornice; guardia a zero; **piano archiviato** | sì |
| I1 | `feat/impostazione-iniziale` | [Impostazione iniziale](2026-11-04-impostazione-iniziale-del-progetto.md) | progetto vuoto → la finestra → pagine nate giuste | — |
| I2 | `feat/impostazioni-progetto` | idem | il pannello Proprietà con la sola pagina; «Impostazioni progetto…» riapre la finestra; **piano archiviato** | — |
| L1 | `feat/logica-un-ramo` | Logica unificata | il ramo Logica (funzioni, script, ricette) nei due stili, niente scheda «Python» | — |
| L2 | `feat/logica-completamento` | idem | `tags.read("` propone i tag; gli avvisi della sandbox mentre si scrive | — |
| L3 | `feat/logica-modelli` | idem | «Nuovo da modello» coi tag del progetto; tre modelli in CasaDomotica; **piano archiviato** | sì |
| M3 | `feat/manuale-letture` | Manuale pubblico | le letture per capitolo nella console | sì (gateway) |
| M4 | `feat/manuale-aiuto` | idem | il link nel login, il menu Aiuto nei due stili | sì |
| M5 | `docs/manuale-giro-finale` | idem | i capitoli e le schermate rifatti con uno script nel repo; **piano archiviato** | — |

**Perché quest'ordine.** Prima le anomalie (C0) e le regole dei template (T1–T2), che il maintainer ha visto
collaudando. La Finestra di avviso apre la serie dell'interfaccia perché è il mattone dell'impostazione iniziale (il
`modulo`) e della logica (le conferme sulle cancellazioni, il «nuovo da modello»). La sandbox (L0) non dipende da niente
e corregge un difetto vivo (`NameError: _print_`, STATUS 17/18-10). Sito e VPS del manuale (M1–M2) presto, per scelta
del maintainer: non toccano i file degli altri piani. Testi e schermate del manuale (M5) per ultimi, quando menu,
finestre e Logica sono definitivi.

**Fuori dalla serie, e restano vivi**: [l'assistente che disegna i simboli](2026-11-03-assistente-genera-simboli-e-sinottici.md)
(F5–F7), [il manuale rifatto](2026-10-19-manuale-rifatto.md) (T12–T14 e il ramo 4 delle schermate: si decide in M5 se
entrano lì), [lo stile sobrio](2026-11-04-stile-sobrio.md) (se arriva prima di M5, le schermate aspettano lui).

### §Collaudo — le anomalie della 2.25.0 (sessione C0)

1. **Chat e registro in una finestra, nel cloud, parlavano col gateway.** Si aprivano a `/index-chat.html` e
   `/index-log.html` alla radice del sito: la chat diceva «nessuna chiave» (le chiavi sono nel container del progetto),
   il registro mostrava i log del gateway. **Fatto** su `fix/collaudo-2-25-0` (`percorsoFinestra`, `8a8b79cd`).
2. **Il WP630 lentissimo con «Montagna».** Misurato il 04-11: CPU a 63 °C e alla frequenza massima, runtime all'1 %,
   **Chromium a ~1,2 core**: la luce si aggiornava 10 volte al secondo (generatore a 100 ms) e a ogni volta cambiava
   l'opacità di tre foto a tutta pagina. Decisione del maintainer: **solo il template**. **Fatto**: ora e luce le scrive
   lo script una volta al secondo (`8a8b79cd`). Da rimisurare sul WP630 dopo il deploy.
3. **I template senza cornice, i comandi a ruolo Operator, gli aggregati non in faceplate** → sessioni T1 e T2.
4. **«Home page», la pagina da aprire come finestra e la destinazione di un navbutton mostravano `{{t0001}}`.**
   **Fatto** (`useNomePagina` in tre menù di `EditorShell.tsx`, `8a8b79cd`).

Le anomalie nuove si aggiungono qui, con il numero dopo l'ultimo, e vanno nella sessione aperta in quel momento se ci
stanno, altrimenti nella prima che tocca gli stessi file.

### §Regole dei template — R6, R7, R8 (sessioni T1 e T2)

Decise dal maintainer il 04-11-2026, «trasformale in una condizione per tutti i template creati e aggiornali tutti».
Si scrivono in `examples/templates/README.md` accanto a R1–R5 e le controlla `scripts/check_templates.sh`.

- **R6 — ogni template usa una cornice.** `page_layout.cornice_predefinita` dichiarata e il file in `cornici/`; ogni
  pagina normale la usa (escluse le pagine-finestra e quelle di boot). Il contenuto delle pagine sta nell'area attiva,
  fra testata e piede: aggiungere la cornice vuol dire **riposizionare** gli oggetti che oggi stanno nelle fasce (la
  cornice si disegna sopra, non sposta niente — `sws-web/src/cornici.rs`). Misura del 04-11: **3 template su 16** hanno
  una cornice (`openplc-laboratorio`, `homeassistant-pro`, `tc620-sistema`). Per «Montagna» la cornice la fa la
  sessione, come le altre (decisione del maintainer: non quella fatta a mano nell'IDE).
- **R7 — nei template ogni comando si può usare col ruolo Viewer.** Le variabili scritte da bottoni, interruttori,
  cursori e setpoint (anche i membri di un tipo) hanno `write_min_role: Viewer`. Fanno eccezione **solo
  `openplc-laboratorio` e `homeassistant-pro`**, che mostrano la gestione dei permessi: lì qualche comando resta più
  alto. La «scritta» la mette **il prodotto**, non il template (decisione del maintainer): un comando che chi guarda non
  può usare mostra **un lucchetto con il ruolo che serve** («serve Supervisor»), sul web e su LVGL. Chiude anche la
  domanda aperta del 03-11 sul lucchetto (oggi il comando è solo attenuato a 0,45). Misura del 04-11: ~52 variabili
  comandate, quasi tutte al ruolo predefinito Operator.
- **R8 — gli aggregati di oggetti si fanno con un faceplate** (regola del maintainer, 04-11-2026: «quando puoi gli
  aggregati di oggetti falli in un faceplates»). Un gruppo che si ripete — un riquadro con titolo e valori di una
  macchina, una pompa col suo stato e il suo comando — è un faceplate con i suoi parametri, e la pagina ne ha le
  istanze. I faceplate legano i tag per radice comune (`motore1.velocita`, `motore1.marcia`: vedi
  `editor/faceplateDaSelezione.ts`), quindi un template con variabili piatte (`s.fv_potenza`, `s.inverter_potenza`
  in «Montagna») va prima portato a **tipi e istanze**. La guardia non può riconoscere «un aggregato»: controlla che un
  template con gruppi ripetuti dichiari i suoi faceplate, e il resto lo giudica chi rivede.

**T1** (`feat/template-regole`): il lucchetto nel prodotto (web: `SvgCanvas.tsx`, dove oggi l'opacità 0,45; LVGL:
`lvgl_render.rs`, la stessa regola del ruolo); R6–R8 nel README e nella guardia, con il debito dichiarato dei template
non ancora fatti (un tetto che scende); i primi sei: `montagna-rinnovabile` (cornice, tipi e istanze, faceplate dei
riquadri di valori, comandi Viewer), `demo-slider`, `grid-playground`, `homeassistant-demo`, `homeassistant-pro`
(permessi: un comando elevato), `openplc-laboratorio` (permessi: la finestra Parametri resta Supervisor).
**T2** (`feat/template-regole-2`): gli altri dieci, la guardia senza debito. Dove spostare gli oggetti per far posto alla
cornice si controlla con le istantanee LVGL e il viewer web (come per la pagina *Lago*: `tests_lago` in
`sws-web/src/istantanea.rs`).

**Da decidere all'inizio di T1** (con la proposta che vale se il maintainer non dice altro):
1. *La regola R8 vale anche per l'assistente IA?* Proposta: sì — il prompt del sinottico intero dice di fare un
   faceplate per i riquadri che si ripetono.
2. *La cornice dei template*: una sola uguale per tutti (testata con titolo, data e ora; piede con la navigazione,
   come `openplc-laboratorio`) o una per stile di template? Proposta: una sola, coi colori del template.

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
| [2026-11-03-assistente-genera-simboli-e-sinottici.md](2026-11-03-assistente-genera-simboli-e-sinottici.md) | richiesta del maintainer, 03-11-2026 | **piano d'esecuzione — in corso** sul ramo `feat/assistente-sinottici` — l'assistente disegna i simboli del progetto (`prj:`, una descrizione compilata in Rust nello stesso SVG di `genera.py`, più l'SVG libero), propone tipi e istanze e compone la pagina intera, con tetto di spesa; due banchi: tubi d'acciaio e planimetria di casa. Fasi F0–F7 |
| [2026-11-03-libreria-simboli-piu-ricca.md](2026-11-03-libreria-simboli-piu-ricca.md) | dalle prime bozze dell'assistente, 03-11-2026 | **seme — decisione** — la libreria dei 195 simboli (mediana 16 operazioni) va resa più ricca di dettaglio, e l'assistente la segue; da misurare il costo su LVGL e la leggibilità a volume 0 |
| [2026-11-03-manuale-pubblico.md](2026-11-03-manuale-pubblico.md) | richiesta del maintainer, 03-11-2026 | **piano d'esecuzione — sessioni M1–M5 della serie coordinata del 04-11** — il manuale per chi usa SWS su `sws.soligo.net/manuale/` (sito statico a parte dietro Traefik, aggiornato a ogni release), crawler IA bloccati e limite di richieste, letture contate dal gateway e viste in console senza cookie, link prima del login e menù Aiuto nell'IDE |
| [2026-10-30-sws-lvgl-sul-tiny-ty.md](2026-10-30-sws-lvgl-sul-tiny-ty.md) | richiesta del maintainer, 30-10-2026, con le misure su un TY570 in ufficio | **piano d'analisi — da iniziare dopo il 04-11-2026** — SWS solo LVGL sui Tiny TY (RV1106, un Cortex-A7, 256 MB, Ubuntu 22.04 armhf, niente podman). La RAM basta, la CPU no: la copia dello schermo intero a ogni giro costa 10-12 ms su 16. Build armv7 su sysroot 22.04, copia sullo schermo rifatta, systemd con il PLC che vince; aggiornamenti senza registry e possesso dello schermo con Pixsys sono decisioni |
| [2026-11-03-runtime-eseguibile-unico.md](2026-11-03-runtime-eseguibile-unico.md) | richiesta del maintainer per la famiglia TY, 03-11-2026 | **seme — decisione** — SWS senza container come un eseguibile solo: asset (SPA 8,2 MB, template, catalogo, simboli) dentro il binario, la scelta su Python (libpython di sistema, statico, o senza script), runtime e viewer in un processo o in un file con due sottocomandi, glibc 2.35 o musl, aggiornamenti senza registry |
| [2026-11-04-logica-unificata.md](2026-11-04-logica-unificata.md) | richiesta del maintainer, 04-11-2026 | **piano d'esecuzione — sessioni L0–L3 della serie coordinata del 04-11** — prima la sandbox (`print`, `for`, `+=`) e i default dei parametri; poi funzioni, script e ricette in un solo ramo Logica (solo l'interfaccia, il modello resta), il completamento del codice e dieci modelli coi tag del progetto |
| [2026-11-04-stile-sobrio.md](2026-11-04-stile-sobrio.md) | richiesta del maintainer, 04-11-2026 («la grafica è troppo colorata e giocosa») | **seme — decisione** — uno stile in più, sobrio, dove il colore serve solo a evidenziare: l'IDE (590 colori scritti a mano, 300 emoji) e i sinottici (vicino al seme dello stile di progetto del 30-10) |
| [2026-11-04-finestra-di-avviso.md](2026-11-04-finestra-di-avviso.md) | richiesta del maintainer, 04-11-2026 | **piano d'esecuzione — sessioni F1–F3 della serie coordinata del 04-11** — una finestra al centro della pagina, con lo stile dell'IDE, al posto di `confirm`/`alert`/`prompt` (106 chiamate in 41 file) e delle finestre fatte a mano; una guardia impedisce di rimetterne |
| [2026-11-04-impostazione-iniziale-del-progetto.md](2026-11-04-impostazione-iniziale-del-progetto.md) | richiesta del maintainer, 04-11-2026 | **piano d'esecuzione — sessioni I1–I2 della serie coordinata del 04-11** — dopo «Nuovo progetto» vuoto, una Finestra di avviso con le scelte che valgono per tutte le pagine (dimensione, sfondi, motore, tutto schermo, cornice, lingue, impianto per l'IA), riapribile da Progetto → Impostazioni; dipende dalla Finestra di avviso |
| [2026-11-03-lvgl-9-3.md](2026-11-03-lvgl-9-3.md) | richiesta del maintainer, 03-11-2026 | **seme — decisione** — portare il viewer da LVGL 8.3.5 (lvgl-sys 0.6.2 vendorizzato, 187 funzioni usate) a LVGL 9.3: display e buffer nuovi, nomi cambiati, binding Rust da rifare con bindgen; parità web/LVGL e prestazioni sui pannelli da rimisurare |
| [2026-11-02-inverter-sunspec.md](2026-11-02-inverter-sunspec.md) | chiudendo il piano inverter Solarman, 02-11-2026 | **seme — decisione** — inverter SunSpec: la mappa letta dalla catena dei modelli del dispositivo e tradotta nel vocabolario canonico; fattori di scala da registro; e la scrittura (lista bianca, conferma, audit) |
| [2026-10-30-stile-grafico-di-progetto.md](2026-10-30-stile-grafico-di-progetto.md) | dalla revisione dello slider, 30-10-2026 | **seme — decisione** — uno stile di progetto (per esempio «ISA-101 ovunque») che dia il default a tutti i tipi, come `symbol_style` fa per i simboli |
| [2026-10-30-in-attesa-per-tutte-le-scritture.md](2026-10-30-in-attesa-per-tutte-le-scritture.md) | dalla revisione dello slider, 30-10-2026 | **seme — decisione** — fra il comando e il ritorno del tag nessun oggetto dice che sta aspettando; lo slider lo avrà suo, gli altri no. Effetto generico o per tipo, e su LVGL una risposta per scrittura |
| [2026-10-29-schermo-su-un-origine-sua.md](2026-10-29-schermo-su-un-origine-sua.md) | chiudendo il piano dello schermo remoto, validato il 29-10-2026 | **seme — decisione** — la pagina del pannello gira sull'origine `sws.soligo.net`: un pannello manomesso potrebbe leggere dal `localStorage` il gettone cloud di chi apre il suo schermo. Un nome per tutti gli schermi (HTTP-01, come oggi), uno per pannello (certificato jolly con DNS-01), o lasciare com'è finché i pannelli sono di prova. Da decidere prima che lo schermo esca dalla prova |
| [2026-10-29-licenza-del-software.md](2026-10-29-licenza-del-software.md) | risposta del maintainer alle domande per le condizioni d'uso, 29-10-2026 | **seme — decisione** — la licenza va cambiata: oggi AGPL-3.0-only, che col cloud aperto obbliga a offrire il sorgente a chi usa il servizio. Quale licenza, per runtime e IDE, chi deve acconsentire, le dipendenze, le versioni già pubblicate. Le condizioni d'uso hanno un segnaposto al punto 11 |
| [2026-10-26-progetto-letto-da-un-anonimo.md](2026-10-26-progetto-letto-da-un-anonimo.md) | la guardia delle rotte pre-auth corretta, 26-10-2026 | **seme — decisione** — `GET /api/project` sulla porta del viewer (7443) dà a un anonimo il progetto intero coi segreti mascherati, compresi destinatari email e numeri dei reperibili: vista ridotta, togliere i dati personali, o dichiararlo |
| [2026-10-26-fiducia-nel-browser-del-pannello.md](2026-10-26-fiducia-nel-browser-del-pannello.md) | risposta di chi sviluppa PixsysOS e prova sul WP630, 26-10-2026 | **seme — decisione** — la chiave del dispositivo in `/mnt/protected/ssl` è un errore di PixsysOS e potrebbe sparire: il TLS del pannello passa al **nostro certificato reso fidato** nell'archivio NSS di `user` (`certutil`, senza root), che sopravvive agli aggiornamenti. **Provato sul WP630**: sinottico senza avviso dopo il riavvio. Rivede la regola del 25-10 di C4 (TLS di default solo col certificato del dispositivo) e ritira `certificato-dispositivo.sh` |
| [2026-10-26-aprire-sws-soligo-net.md](2026-10-26-aprire-sws-soligo-net.md) | richiesta del maintainer, 26-10-2026: far provare SWS a persone esterne su `sws.soligo.net` | **piano d'esecuzione — PARZIALE**: **A**, **B** e **D** fatti (28-29-10), **C** fatto nei punti 1-3 con le schermate (30-10, registrazione spenta di default dietro `--gateway-registrazione`); restano l'SMTP per azienda, inattività e chiusura dell'account, e — fuori dal codice — revisione dei testi e prova di consegna. È il dettaglio della **Fase 5** del tronco cloud. Quattro rami: **A** un'azienda a testa per chi si registra, quota di tre progetti, il buco di `create_project` chiuso e i tetti sui container; **B** le due schermate (accesso e scelta progetto) responsive, con icone vere e il marchio al posto dello «SWS» cablato; **C** registrazione con verifica, PIN monouso via e-mail **in aggiunta** alla password, sessione di 30 giorni, SMTP per azienda su Infomaniak; **D** anteprima della prima pagina. Il cardine: marchio, isolamento, abbinamento pannello e console confinata **esistono già** e passano tutti dall'azienda — basta che chi si registra ne abbia una sua. **Non più bloccato dal 28-10-2026** (il ramo `feat/accesso-lvgl-due-campi` non esiste più); il ramo **B** ha preso la versione del runtime visibile **dopo** il login, e il perché non prima |
| [2026-10-23-server-modbus.md](2026-10-23-server-modbus.md) | nato decidendo OpenPLC, 23-10-2026 | **seme — decisione** — SWS parla Modbus **solo da client**: un PLC o uno SCADA che voglia venire a prendersi i dati non ha come farlo. Delle quattro combinazioni «chi legge chi» fra SWS e OpenPLC due funzionano e due no, e di quelle due **una sola è nostra**: l'altra vuole un client OPC-UA che OpenPLC non ha. Il mattone c'è già — `tokio-modbus` ha la feature `server`, e i test di Fase 3 la usano. Il solo precedente di «SWS che serve dati» è il server OPC-UA, ed è lì che stanno le scelte da riusare |
| [2026-10-25-strutture-sugli-altri-protocolli.md](2026-10-25-strutture-sugli-altri-protocolli.md) | chiudendo il piano dei tag, 25-10-2026 | **seme — decisione** — tipi compositi e array su S7, EtherNet/IP, MQTT, Home Assistant e Host: le code «non pianificate» del piano dei tag, ora che Modbus e OPC-UA sono fatti |
| [2026-10-24-il-gateway-non-dice-chi-bussa.md](2026-10-24-il-gateway-non-dice-chi-bussa.md) | trovato misurando la stabilità del tunnel sul VPS, 23-10-2026 | **seme — decisione**: il gateway logga solo `tunnel aperto` e `tunnel chiuso`, quindi un pannello spento e uno che bussa senza entrare danno lo **stesso** log, cioè nessuno. Ha reso non concludibile metà di una prova di stabilità. Due trappole da sciogliere prima di scrivere: il rumore (migliaia di righe) e il token dentro un tentativo fallito |
| [2026-10-22-utenti-nati-sul-dispositivo.md](2026-10-22-utenti-nati-sul-dispositivo.md) | estratto dal piano identità, archiviato il 22-10-2026 | **seme — decisione** — se un domani il pannello sapesse creare account da solo, al deploy successivo chi vince? Mezzo passo è fatto (l'Admin dell'abbinamento vive fuori dal progetto, in `utenti_dispositivo.yaml`), ma la marcatura `origine: dispositivo` della decisione 21 non esiste nel codice. Il caso non è ancora materialmente possibile — sul pannello non c'è un componente «gestione utenti» — ed è questo che lo rende rimandabile senza rischio |
| [2026-10-19-manuale-rifatto.md](2026-10-19-manuale-rifatto.md) | avvio del lavoro sulla documentazione, 19-10-2026 | **rami 1 e 2 fatti; il 25-10-2026 il maintainer ha chiesto tutti e 14 i tutorial** (ramo 3: laboratorio OpenPLC v4 + Mosquitto, ogni passo eseguito e fotografato), poi il ramo 4 delle schermate |
| [2026-11-01-gestione-energia.md](2026-11-01-gestione-energia.md) | idea del maintainer, 01-11-2026, dalla domotica di CasaDomotica | **seme — decisione** (con analisi e specifica proposta) — contatori di energia su un numero libero di tag (potenza integrata nel tempo o contatore cumulativo), quarti d'ora salvati nel fuso locale, gruppi ad albero con «non attribuito», tag esposti (oggi, mese, costo), poi barre per periodo, tariffe F1/F2/F3, fotovoltaico, limite di potenza e distacco carichi, cicli degli elettrodomestici. Sei domande aperte in fondo |
| [2026-11-01-hmify.md](2026-11-01-hmify.md) | scelta del nome del maintainer, 01-11-2026: domini hmify .com/.net/.eu/.cloud registrati | **seme — decisione** — tutto su hmify: nome e slogan «hmify your data», domini e account (GitHub `hmify` libero), il marchio da verificare (vicino: Homify), la vetrina Bootstrap su `hmify.com` da un repository git (proposta: GitHub Pages), il bottone «hmify login» (proposta: `app.hmify.com`, con `sws.soligo.net` che resta per i pannelli già collegati), il perimetro del rinomino |
| [2026-10-21-quando-si-libera-una-licenza.md](2026-10-21-quando-si-libera-una-licenza.md) | la domanda rimasta aperta chiudendo il piano sulle licenze, 21-10-2026 | **seme — decisione** — `max_pannelli` si mostra ma non ferma: per farlo valere serve sapere quando una licenza si consuma e **quando si libera**. Un tetto che nessuno libera prima o poi blocca un cliente che non ha fatto niente. `abbinato_ms` e `ultimo_ms` ci sono già; manca uno stato «dismesso», distinto da sospeso e da bandito |
| [2026-10-21-casadomotica-versionata-e-separata.md](2026-10-21-casadomotica-versionata-e-separata.md) | le due domande che il piano di CasaDomotica lasciava aperte, 21-10-2026 | **seme — decisione** — il progetto di riferimento vive solo sul VPS (540 MB di storico, ma il disegno sono poche centinaia di kB) ed è anche l'impianto di casa del maintainer. Versionarlo e separarlo dall'impianto vero vanno decisi insieme: se il disegno finisce nel git di progetto, la copia di lavoro è un clone e l'allineamento è un `pull`. La **pratica** è diventata una regola di `CLAUDE.md` |
| [2026-10-21-due-editor-sullo-stesso-progetto.md](2026-10-21-due-editor-sullo-stesso-progetto.md) | prova del maintainer, 21-10-2026: stesso progetto aperto da due browser in due sedi | **seme — decisione** — non c'è nessun lock: i tre `Mutex` del runtime sono interni a un processo e servono a non corrompere un file, non a dire «c'è già qualcuno». L'unico accorgimento è l'avviso «il progetto è cambiato», che ha una finestra di 20 s in cui attribuisce a sé **qualunque** cambio: due salvataggi ravvicinati si sovrascrivono in silenzio. Il dato per una presenza esiste già (`Aperto.collegati`) |
| [2026-10-18-indirizzo-vero-dietro-traefik.md](2026-10-18-indirizzo-vero-dietro-traefik.md) | limiti per indirizzo dell'onda 2, 18-10-2026 | **seme — decisione** — Traefik rootless vede ogni visitatore come `10.89.0.89` (rootlessport): il gateway non conta gli indirizzi privati e oggi il cloud non ha limiti. Strade: pasta, port handler, Traefik di sistema, PROXY protocol |
| [2026-10-17-tag-uguali-ritrasmessi.md](2026-10-17-tag-uguali-ritrasmessi.md) | trovato col banco di prestazioni, 17-10-2026 | **seme — decisione** — `TagDb::set` ritrasmette anche i valori invariati, e i generatori (ricalcolo a 100 ms) fanno 10 aggiornamenti/s per tag verso ogni client |
| [2026-10-23-rinnovo-del-certificato-firmato.md](2026-10-23-rinnovo-del-certificato-firmato.md) | decisione del maintainer, 23-10-2026 (decisione 6 del piano dei certificati) | **seme — decisione**: due anni di scadenza con **rinnovo automatico**, cioè il pannello annuncia l'impronta nuova firmandola con la vecchia. Il punto duro misurato: l'archivio tiene solo `sha256:<hex>`, e **da un'impronta non si verifica una firma** — cambia il formato per tre consumatori. Serve una sessione di plan dedicata, e viene dopo la prova sul TC620 |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **piano d'azione — decisione**: due binari (P: popup, template d'oggetto, report, notifiche SMS/voce, prestazioni, 2FA/LDAP; C: contatti e art. 14, default sicuri, TLS sul pannello, reset di fabbrica, header e limiti, firma/SBOM/scansione, fascicolo) in cinque onde, un ramo alla volta. Le voci [plan] partono da una sessione di plan |
| [2026-09-22-riorganizzare-i-file-dell-editor.md](2026-09-22-riorganizzare-i-file-dell-editor.md) | idea del maintainer, 22-09-2026 | **seme — decisione** — la parte su `ConfigView.tsx` è passata al [piano del 24-09](../archive/2026-09-24-configurazione-ad-albero-piano.md) (passo 1); qui restano `EditorShell`, `SvgCanvas`, lo store e i quattordici colori nelle righe di elenco. riorganizzare i `.tsx` dell'editor: 52 789 righe in 144 file, ma **cinque file ne fanno metà** (ConfigView 11 629, SvgCanvas 6 312, EditorShell 5 695, store 2 627, LeftPanel 2 023). Costa già: helper gemelli corretti una volta sola, `ConfigTab` dichiarato due volte. Da decidere **insieme** al seme dell'albero di configurazione, che tocca la stessa superficie |
