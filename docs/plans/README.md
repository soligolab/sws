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
> Il 10-11-2026 i 22 semi sono passati in [`semi/`](semi/README.md): 40 file con i rimandi riscritti, più sette
> link dell'archivio che erano già rotti.

## ▶ La serie coordinata del 04-11-2026 — l'ordine delle sessioni

> Richiesta del maintainer, 04-11-2026: «unificare o coordinare i plan in modo da avviare una serie di sessioni di
> sviluppo coordinate che portino a concludere il lavoro senza aprire altri plan». Le anomalie che trova collaudando la
> 2.25.0 entrano qui, non in piani nuovi. Misure in `tmp/piani-misure/` (solo su theobroma); le decisioni prese il
> 04-11 stanno nei piani. **Una sessione = un ramo = 3-4 ore.** Se il maintainer non ha ancora collaudato la sessione
> precedente, la successiva si **annida** sul suo ramo (regola «un ramo alla volta», opzione 2) e la catena si mergia
> in ordine dopo il collaudo.

| # | Ramo | Piano | Cosa si prova alla fine | Immagine |
|---|---|---|---|---|
| C0 | `fix/collaudo-2-25-0` | questa tabella, §Collaudo | chat e registro staccati nel cloud parlano col progetto; i menù di pagina mostrano i nomi; «Montagna» leggera sul WP630 — **fatta il 04-11, mergiata il 05-11 nella 2.25.1, collaudo sull'immagine** | **2.25.1** |
| T1 | `feat/template-regole` | questa tabella, §Regole dei template | il lucchetto «🔒 Supervisor» sui comandi che il ruolo non può usare (web e LVGL); R6–R8 nella guardia; i primi sei template a posto — **fatta il 04-11, mergiata il 05-11 nella 2.25.1, collaudo sull'immagine** | — |
| T2 | `feat/template-regole-2` | idem | gli altri dieci template; la guardia a zero — **fatta il 04-11, mergiata il 05-11 nella 2.25.1, collaudo sull'immagine** | sì |
| F1 | `feat/finestra-avviso` | [Finestra di avviso](../archive/2026-11-04-finestra-di-avviso.md) | il componente; Backup, configurazione, menu ☰ senza pop-up del browser — **il componente in `main` dal 05-11** (`b24193d7`, collaudato con la finestra delle impostazioni del progetto); le 40 chiamate convertite e la guardia `check_finestra_avviso.sh` (65 restano) — **fatta e collaudata il 05-11, in `main`** (`eaef15c3`) | — |
| L0 | `fix/sandbox-python` | [Logica unificata](2026-11-04-logica-unificata.md) | `print`, `for`, `+=` negli script; i default dei parametri applicati — **in `main` dal 06-11 (`630a0f30`), nella 2.26.0-rc.2; L0.1–3 passate sull'IDE, il pannello domani sul TC620** | sì |
| M1 | `feat/manuale-sito` | [Manuale pubblico](2026-11-03-manuale-pubblico.md) | il sito generato in `sws/tmp/manuale-sito/`, nessun link rotto | — |
| M2 | `feat/manuale-vps` | idem | `sws.soligo.net/manuale/` online, i crawler IA respinti | — |
| F2 | `feat/finestra-avviso-2` | Finestra di avviso | deploy ed editor senza pop-up del browser — **in `main` dal 06-11, collaudata sull'IDE (F2.6–8); restano F2.4–5 sul WP630** | — |
| F3 | `feat/finestra-avviso-3` | idem | viewer e console; le finestre fatte a mano sulla stessa cornice; guardia a zero; **piano archiviato** — **in `main` dal 06-11, nella 2.26.0-rc.2; il viewer si collauda domani sul TC620, poi il piano si archivia** | sì |
| I1 | `feat/impostazione-iniziale` | [Impostazione iniziale](../archive/2026-11-04-impostazione-iniziale-del-progetto.md) | progetto vuoto → la finestra → pagine nate giuste — **in `main` dall'08-11 (`00c0e06c`), nella 2.26.0-rc.5; n1–n2 passate nel cloud l'08-11** | — |
| I2 | `feat/impostazioni-progetto` | idem | il pannello Proprietà con la sola pagina; «Impostazioni progetto…» riapre la finestra; **piano archiviato** — **in `main` dall'08-11 (`adab8a65`), nella rc.5; n3 passata, piano archiviato l'08-11** | — |
| L1 | `feat/logica-un-ramo` | Logica unificata | il ramo Logica (funzioni, script, ricette) nei due stili, niente scheda «Python» — **in `main` dall'08-11 (`29912c02`), nella rc.5; n4–n8 passate, Ctrl+Z della rinomina corretto nella rc.6 e verificato: **L1 collaudata** | — |
| D1 | `feat/mqtt-dispositivi` | [MQTT: dispositivi in una sorgente](../archive/2026-11-08-mqtt-dispositivi.md) | la disponibilità per dispositivo dentro una sorgente MQTT (parte A); poi CasaDomotica con una sola sorgente MQTT per tutta casa (parte B) — **fatto: parte A in `main` (`6b66e9d7`, `8872a435`), parte B sul TC620, allarme corretto nella rc.9 (`ce5c6b91`), collaudo passato il 09-11; piano archiviato** | sì |
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
(F5–F7) e [lo stile sobrio](semi/2026-11-04-stile-sobrio.md) (se arriva prima di M5, le schermate aspettano lui). Il [manuale rifatto](../archive/2026-10-19-manuale-rifatto.md) è
archiviato dal 05-11-2026: T12–T14 e le schermate sono passati in M5.

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
  pagina normale la usa (escluse le pagine-finestra e quelle di boot). La cornice si disegna **sotto** la pagina e non
  sposta niente (`componi` in `sws-web/src/cornici.rs`): un oggetto della pagina dentro una fascia è lecito nello spazio
  libero e sbagliato se copre un oggetto della cornice (la stessa regola di `oggetti_nelle_fasce`). Aggiungere la
  cornice vuol dire quindi **riposizionare** quello che oggi sta nelle fasce. Misura del 04-11: **3 template su 16** hanno
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
1. *La regola R8 vale anche per l'assistente IA?* Misurato all'inizio di T1: **non è una riga di prompt**. Oggi
   `proponi_modifica` non porta faceplate (né `ai/tools.rs` né `applyAiProposal` li conoscono), quindi l'assistente non
   potrebbe seguirla. Proposta: dopo la serie; dal 10-11-2026 è nel piano
   [dell'assistente](2026-11-03-assistente-genera-simboli-e-sinottici.md), sezione «Code annotate il 10-11-2026».
2. *La cornice dei template*: una sola uguale per tutti (testata con titolo, data e ora; piede con la navigazione,
   come `openplc-laboratorio`) o una per stile di template? **Usata la proposta**: il modello di
   `openplc-laboratorio`, coi colori del template; senza piede per i template di una pagina. Le tre cornici che
   c'erano restano.
3. *Il lucchetto*: dove sta e cosa dice. **Deciso dal maintainer il 04-11**: forma A (pastiglia nell'angolo in alto a
   destra, «🔒 <ruolo>»), anche quando è la variabile a chiedere il ruolo (lì l'oggetto resta pieno); in
   `openplc-laboratorio` la soglia chiede Supervisor anche sulla variabile; in `homeassistant-pro` via le scritte
   «Serve il ruolo…».
4. *Trovato in T1*: il viewer web non leggeva la soglia di scrittura **del membro** di un tipo, che il server invece
   rispetta (`build_tag_write_roles`): un membro aperto a Viewer apriva lo stesso il login. Corretto in
   `auth/permessoScrittura.ts`, perché R7 mette la soglia sui membri.

**Il tronco cloud è in archivio dal 05-11-2026** ([il tronco cloud](../archive/2026-10-05-cloud-utenti-aziende-spazi.md)):
fasi 0, 1, 2, 3 (3a, 3b, 3c), 4 e 6 fatte e in archivio, ognuna col suo piano; la Fase 5 è il piano vivo
[aprire sws.soligo.net](2026-10-26-aprire-sws-soligo-net.md); la 2FA è la voce P6 della
[prima fascia e CRA](2026-10-15-piano-prima-fascia-e-cra.md); la guardia del self-host e i backup per azienda sono nel piano
[aprire sws.soligo.net](2026-10-26-aprire-sws-soligo-net.md), sezione «Dal tronco cloud, due code».

(Questa riga diceva «nessun piano d'esecuzione in corso» dal 26-09.)

**Chiuso il 25-10-2026**: [gestione dei tag come oggetto unico](../archive/2026-09-21-gestione-tag-oggetto-unico.md) — Fase 3 (Modbus) il 04-10, Fase 4 (OPC-UA) il 25-10; le code sugli altri protocolli sono il seme [strutture sugli altri protocolli](semi/2026-10-25-strutture-sugli-altri-protocolli.md). *(Fino al 29-10-2026 questa riga diceva ancora «restano Fase 3 e Fase 4».)*

## I piani vivi, uno per file

Qui stanno solo i **piani**: lavoro definito, pronto o in corso. Le domande ancora da decidere — i **semi** — dal
10-11-2026 stanno in [`semi/`](semi/README.md), con il loro indice: richiesta del maintainer, «così da avere anche io il
colpo d'occhio su cosa sia poco più di una idea e cosa è attività in corso». Quando un seme diventa un piano, il file
passa da `semi/` a questa cartella (con `git mv` e i rimandi riscritti) e la riga passa a questa tabella.

Tre stati, nella colonna «Cosa resta»: **pronto** (decisa o quasi, resta da costruire/misurare), **in corso** (c'è un
ramo o una serie di sessioni), **verifica** (il codice c'è già, manca la conferma a schermo).

> **Decisioni dell'11-11-2026 sera:**
> - la **2.26.0 vera** esce dopo CasaDomotica aggiornata e il manuale pubblico (M1–M5), non appena il collaudo
>   della rc.15 è pulito;
> - dopo la 2.26.0 il primo seme da pianificare è [LVGL 9.3](semi/2026-11-03-lvgl-9-3.md).

<!-- RIGHE-NUOVI-PIANI -->
| Piano | Origine | Cosa resta |
|---|---|---|
| [2026-11-13-qr-di-abbinamento.md](2026-11-13-qr-di-abbinamento.md) | due semi del 12-11-2026 (il QR e l'abbinamento dall'account), sessione di plan del 13-11 col maintainer | **fatto il 13-11-2026 — in collaudo (rc.17)**: la cornice uguale allo sfondo; `SWS_CLOUD_URL` e il `cloud_link` nel runtime; il QR su LVGL (`lv_qrcode`) e nel browser; il gateway che lascia abbinare ogni membro a una sua azienda; «Abbina un pannello» dal link `#pair=` e dal menu utente, senza progetto |
| [2026-11-13-aggiornamento-timeout-avvio.md](2026-11-13-aggiornamento-timeout-avvio.md) | «perché il TC620 non si aggiorna», 13-11-2026: rc.15 sana in 1 s, ma 63 s di podman più 30 s del primo controllo di salute superano i 90 s di systemd | **in corso** — ramo `fix/aggiornamento-timeout-avvio`, annidato su `feat/tiny-ty-armv7`: quadlet 8 con `TimeoutStartSec=600`; il TC620 passa a mano con un drop-in, una volta |
| [2026-11-11-selezione-e-gruppi.md](2026-11-11-selezione-e-gruppi.md) | collaudo dell'11-11-2026 su Montagna: il riquadro prende lo sfondo, «Raggruppa» senza effetto sul canvas, la chat ferma mentre il modello ragiona | **in corso** — ramo `feat/selezione-e-gruppi`, annidato su `fix/collaudo-rc12` |
| [2026-11-10-manutenzione-e-verifiche-rimandate.md](2026-11-10-manutenzione-e-verifiche-rimandate.md) | Appunti.txt, punti del 23-10, 28-10, 04-11 e 05-11-2026: dipendenze e audit, etichette dell'immagine, un test instabile, due difetti piccoli e tre verifiche rimaste dai piani archiviati (multilingua, fiducia del browser, Twilio) | **piano — pronto, lavori piccoli e indipendenti** — cinque cose da fare: `zip` 2.4 → 9.x nei due crate e le quattro righe RUSTSEC-2026-0367/0368/0369/0429 via da `audit.toml`; le etichette `changelog`/`compat` duplicate (1 767 byte su 5 710) via dall'immagine quando nessun pannello gira più le rc.3–rc.8 della 2.12.0; il test `abbinaPannelloCloud` che fallisce una volta su sei, da vedere fallire prima di toccarlo; il template che rinomina `Impianto.yaml` in `{{t0001}}.yaml`; «Disabilita TLS» che riparte in HTTPS per via del marcatore `fiducia-browser`. Tre verifiche: email e Telegram in `es` e la chiave Google dopo un ricaricamento; la CI di GitHub (toolchain già fissata a 1.94, i controlli locali verdi il 10-11); la prova vera di Twilio appena l'account è a pagamento |
| [2026-11-10-oggetti-e-template-parita-lvgl.md](2026-11-10-oggetti-e-template-parita-lvgl.md) | Appunti.txt, punti del 30-10, 04-11 (sessioni T1 e T2 dei template), 05-11 (F3), 08-11 (L1) e 09-11-2026 (revisione del ramo A del viewer leggero), dalle istantanee web/LVGL dei template e dalle revisioni dei rami | **piano — pronto, scelte prese l'11-11-2026** — il pannello LVGL allineato al web: il testo senza riquadro (`y` linea di base sul web, bordo alto su LVGL, ~22 px per un titolo a 22: la correzione sposta ogni testo libero dei progetti LVGL), griglia che non centra, `faceplate_scale`, `kpi_tile`/`led`/`gauge`/`recipe_panel` scuri o tagliati, faceplate di sistema in inglese; i comportamenti che LVGL non ha (`on_press_fn` via `POST /api/script/run/<nome>`, la password sui comandi critici, il momentaneo critico); mini tendenza ferma in basso sul web e a metà su LVGL, sparkline senza riempimento, il velo «Dati in ritardo» che non entra nelle finestre (`LV_EVENT_DELETE`); la «Finestra pompa» coi segnaposto `{{t0105}}`; i dubbi di `homeassistant-demo`/`-pro`, `demo-slider`, `nebulizzatore-sandokan`; lo slider a intervallo escluso il 30-10 |
| [2026-11-10-casadomotica-col-maintainer.md](2026-11-10-casadomotica-col-maintainer.md) | Appunti.txt, punti del 30-10, 03-11, 04-11 e 06-11-2026: i residui «da fare col maintainer» dei piani archiviati sulle planimetrie, sullo slider e sui modelli IA, più i due errori della validazione visti al collaudo del 06-11 sul TC620 | **piano — da fare insieme al maintainer, nel progetto sul VPS** — le quattro cose che CasaDomotica aspetta perché il progetto di riferimento resti al passo con `main`: `report_1` che nomina `core2.cpu0`/`core2.cpu1` (due errori di `rilievi_report`, da sostituire o togliere); il blocco `ai:` con impianto, generali e traduzione (proposta del 04-11: casa unifamiliare con fotovoltaico, pompa di calore e Home Assistant; stanze come in casa; tapparella = shutter); luci e tapparelle in «piastra» e un termostato con PV (fase 7 dello slider, fasi 1-6 in main dalla 2.23.8); la planimetria vera della casa o del garage come sfondo di pagina, poi la prova su un pannello LVGL (strada raster confermata dalla 2.23.3, mai vista con un PNG di planimetria) |
| [2026-11-09-viewer-leggero.md](2026-11-09-viewer-leggero.md) | WP630, 09-11-2026: il login per l'aggiornamento fermo su «Logging in…»; era Montagna che saturava il browser del pannello | **fatto il 09-11-2026 — in collaudo (rc.10)**: rami A e B in `main` con `791a3ed8` (mini tendenze a secchielli, un aggiornamento per fotogramma, la pagina ascolta solo i suoi tag, la fascia «Dati in ritardo», le attese del login); le code in [semi/](semi/2026-11-10-viewer-prestazioni-e-protocollo.md) |
| [2026-11-10-assistente-secondo-giro.md](2026-11-10-assistente-secondo-giro.md) | chiudendo il piano dell'assistente che disegna simboli e sinottici, 10-11-2026 | **piano — pronto, dopo il collaudo del primo giro** — G1 il banco fisso dei tubi e il giudizio del maintainer; G2 la planimetria della casa (`pianta`, tapparella `prj:`); G3 l'SVG libero con le bocche; G4 un secondo protocollo (OpenAI, un fornitore europeo); G5 altri fornitori di immagini e la storia della spesa |
| [2026-11-03-manuale-pubblico.md](2026-11-03-manuale-pubblico.md) | richiesta del maintainer, 03-11-2026 | **piano d'esecuzione — sessioni M1–M5 della serie coordinata del 04-11** — il manuale per chi usa SWS su `sws.soligo.net/manuale/` (sito statico a parte dietro Traefik, aggiornato a ogni release), crawler IA bloccati e limite di richieste, letture contate dal gateway e viste in console senza cookie, link prima del login e menù Aiuto nell'IDE |
| [2026-10-30-sws-lvgl-sul-tiny-ty.md](2026-10-30-sws-lvgl-sul-tiny-ty.md) | richiesta del maintainer, 30-10-2026, con le misure su un TY570 in ufficio | **in corso** — passi 1-2 sul ramo `feat/tiny-ty-armv7`, passo 3 (pacchetto, systemd, utente `sws`, il PLC che vince) su `feat/tiny-ty-systemd`, da provare sul TY570 — SWS solo LVGL sui Tiny TY (RV1106, un Cortex-A7, 256 MB, Ubuntu 22.04 armhf, niente podman). La RAM basta, la CPU no: la copia dello schermo intero a ogni giro costa 10-12 ms su 16. Build armv7 su sysroot 22.04, copia sullo schermo rifatta, systemd con il PLC che vince; aggiornamenti senza registry e possesso dello schermo con Pixsys sono decisioni |
| [2026-10-15-piano-prima-fascia-e-cra.md](2026-10-15-piano-prima-fascia-e-cra.md) | richiesta del maintainer, 15-10-2026: prima fascia SCADA e punti CRA scoperti, in parallelo | **piano d'azione — decisione**: due binari (P: popup, template d'oggetto, report, notifiche SMS/voce, prestazioni, 2FA/LDAP; C: contatti e art. 14, default sicuri, TLS sul pannello, reset di fabbrica, header e limiti, firma/SBOM/scansione, fascicolo) in cinque onde, un ramo alla volta. Le voci [plan] partono da una sessione di plan |
