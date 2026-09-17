# SWS — Open Architectural Questions

> Decisions that came up during development but are **not for Claude Code to settle in a vibecode session**. The maintainer reviews and decides these out-of-band.
>
> When Claude Code encounters one of these, it should: pick the documented PoC default, add a `// TODO(open-question):` comment in code referencing the question number here, and continue.
>
> **Dal 2026-09-06 questo file contiene solo le questioni vive.** Quelle decise, realizzate e
> **verificate sul codice** stanno in [`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md),
> indicizzate in coda a questo file. I numeri **non si riusano mai**: una scheda nuova prende il
> numero successivo all'ultimo assegnato, archivio compreso (`check_documenti.sh` fa i conti).
>
> **Dal 2026-09-12, una scheda ancora viva può avere il testo spostato in un piano** sotto
> `docs/plans/` invece di restare qui per intero — non è una chiusura: la domanda resta aperta,
> il numero resta suo, solo il contenuto integrale vive altrove (il piano lo riporta parola per
> parola, sotto «Testo originale della scheda»). Qui resta il titolo, il rimando e lo stato in
> una riga. Non tutte le schede vive sono così: solo quelle per cui è stato preparato un piano.

---

## Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

**Context**: emerso il 2026-08-01 preparando lo scaffold per gli export PNG del brief (6 risoluzioni,
`docs/branding/boot-backgrounds/`). Sono pensati per il boot splash **OS-level** del pannello Pixsys,
ma nessun meccanismo del genere esiste oggi in questo repo — verificato con grep su `docs/`,
`deploy/`, `scripts/`, `sws-editor/src/`: nessun riferimento a psplash o equivalente. Il kiosk SWS
(`sws-kiosk`) apre solo una URL fullscreen dopo che il sistema è già partito; non gestisce lo splash
di boot.

**Options**:
1. Consegna manuale al maintainer, che li carica con lo strumento di configurazione Pixsys — nessuna
   integrazione in questo repo, mai.
2. Se Yocto/Pixsys espone una recipe per il boot splash, documentarla in `docs/YOCTO_CROSSCOMPILE.md`
   e versionare gli asset finali lì invece che in `docs/branding/`.

**Default for PoC**: opzione 1 — richiede la conoscenza del maintainer sul tooling Pixsys reale, non
deducibile dal codice.

**Decided**: not yet — il maintainer ha scelto (2026-08-21) di **rimandare**: la domanda resta
aperta finché non avrà il pannello sotto mano per verificare il meccanismo reale.

---

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

Contenuto spostato in [`docs/plans/2026-09-12-q16-decoder-raster-image.md`](plans/2026-09-12-q16-decoder-raster-image.md) il 2026-09-12. **Decided:** parzialmente decisa (metà SVG fatta, metà raster no).

---

## Q23 — Collegare lo SCADA a un robot ROS 2

**Aperta** — segnalata dal maintainer il 2026-08-26, da analizzare più avanti.

Oggi i dati entrano nello SCADA da Modbus, MQTT, OPC UA e dagli script Python. Un robot basato
su **ROS 2** non parla nessuno di questi: parla DDS, con topic tipizzati, servizi e azioni.

Da decidere, e sono due domande distinte che conviene non impastare:

1. **Il driver.** Un *source* ROS 2 accanto agli altri. Le strade plausibili sono almeno tre e
   costano molto diversamente: linkare `rclrs` (client Rust nativo, ancora giovane), appoggiarsi a
   `rosbridge` via WebSocket/JSON (nessuna dipendenza DDS, ma un processo in più da installare sul
   robot), oppure parlare DDS direttamente con un'implementazione Rust. Va tenuto presente che il
   modello dati qui è **tag piatti con un valore scalare**, mentre ROS 2 pubblica messaggi
   strutturati: la mappatura messaggio → tag non è un dettaglio implementativo, è la domanda vera.
2. **Gli oggetti sinottici.** Un robot non si rappresenta con una `gauge`. Servirebbero oggetti
   propri — posa/giunti, stato della missione, pulsanti che lanciano un'*azione* e ne seguono il
   feedback, e un modo di mostrare l'emergenza. Vale anche la pena chiedersi se il comando di un
   robot debba passare per il normale meccanismo di scrittura tag o richieda una strada a parte:
   un'azione ROS 2 ha un ciclo di vita (accettata, in corso, annullabile, conclusa) che un tag
   scalare non sa rappresentare.

**Precisazione del maintainer (2026-08-26): la portata è molto più piccola di così.**

In questa fase allo SCADA serve dialogare con **dati semplici** del robot, non rappresentarlo. In
concreto: una `gauge` agganciata a velocità, direzione o consumi; `led` e `trend` agganciati a dati
di diagnostica dello stesso genere; qualche `button` che manda avvio e arresto. Tutta roba che gli
oggetti esistenti già sanno fare.

**Non è richiesto** rappresentare il robot (nessuna vista posa/giunti) né emulare servizi di
simulazione.

Questo sposta il peso della domanda: il punto 2 qui sopra — gli oggetti sinottici dedicati —
**decade quasi del tutto**, e resta il punto 1, cioè far arrivare quei valori dentro dei tag. Il
che riduce il problema a un *source* in più, che è un lavoro di tutt'altra taglia rispetto a una
famiglia di oggetti nuovi. Anche la questione "e sul pannello LVGL?" si dissolve da sé: gauge, led,
trend e button il motore LVGL li disegna già.

Restano da decidere solo la strada del driver (`rclrs` / `rosbridge` / DDS nativo) e la mappatura
messaggio strutturato → tag scalare.

Da non affrontare prima che il PoC sia stabile.

---

## Q26 — Un server MCP per far editare il progetto all'IA

*Aperta il 2026-08-31, su richiesta del maintainer. Nessuna decisione presa.*

L'idea: esporre il progetto SWS attraverso un **server MCP**, così che l'utente possa usare un
assistente IA per costruire e modificare sinottici, tag, allarmi e script — invece di disegnare
tutto a mano nell'IDE.

Va segnata e non decisa. Quello che segue è il perimetro delle domande, non una risposta.

### Cosa renderebbe l'idea interessante

Il progetto è **già** in una forma che un modello linguistico maneggia bene: YAML dichiarativo,
uno schema unico e autorevole (`sws-web/src/synoptic.rs`, 238 campi), un parser vero
(`Project::load`) e sette guardie che dicono no a un progetto malformato. Un assistente che
scrive YAML ha quindi un giudice, e non deve indovinare se ha fatto bene.

### Le domande da sciogliere, prima di scrivere una riga

1. **Dove gira, e quindi cosa può toccare.** Sul PC di sviluppo accanto all'IDE, o sul
   dispositivo accanto al runtime? Le due cose hanno superfici di rischio molto diverse: la
   seconda significa un canale che scrive nella configurazione di un impianto in servizio.
2. **Sola lettura o anche scrittura.** Un server che *legge* il progetto e risponde a domande
   («quali tag non sono usati da nessuna pagina?») è quasi tutto guadagno. Uno che *scrive* è un
   secondo autore del progetto, e apre le tre domande sotto.
3. **Chi approva.** Nessuna modifica dovrebbe raggiungere un dispositivo senza che una persona
   l'abbia vista. Il posto naturale è il deploy, che già esiste ed è già un gesto esplicito.
4. **Come si torna indietro.** Il progetto è in git nel repo del maintainer, ma sul dispositivo
   no. Serve almeno un ripristino a colpo sicuro prima di dare a un assistente il permesso di
   scrivere.
5. **Che rapporto ha con `write_min_role` e con Q17.** Un canale che scrive nel *progetto* è
   diverso da uno che scrive nei *tag*, ma il confine va disegnato una volta sola, non due.
6. **Il vincolo che il progetto è dell'utente.** I segreti viaggiano col progetto (decisione del
   2026-08-20): password dei driver e token stanno nello YAML in chiaro. Un server MCP che
   esponesse il progetto esporrebbe anche quelli, e a un servizio esterno. È probabilmente il
   punto più affilato di tutti.

### Rapporto con le altre voci

- **Q17** (`/api/recipes/:id/apply` senza controllo per-tag) è il precedente da non ripetere: un
  canale di scrittura nato senza dire chi può usarlo.
- **Q21** (due superfici Python nel progetto) è lo stesso genere di domanda — quante strade
  diverse possono cambiare la stessa cosa — e conviene rispondere insieme.

### Aggiornamento del 2026-08-31 — esiste una proposta, la domanda resta aperta

Il maintainer ha chiesto un piano per una **chat nell'editor collegata a Claude Code**:
`docs/archive/2026-08-31-chat-ai-nelleditor.md`. Il piano risponde a cinque delle sei domande qui
sopra, e va letto prima di decidere. In sintesi:

- **le modifiche dell'assistente non toccano il disco**: vanno nello store dell'editor, che dà
  l'annullamento con Ctrl+Z e non persiste nulla finché una persona non salva. Questo scioglie da
  solo «dove gira», «chi approva» e «come si torna indietro»;
- **il punto sui segreti era sbagliato**: `GET /api/project` li maschera già
  (`mask_project_secrets`, `router.rs:1905`) e il server li ricompone al salvataggio. Chi legge
  dall'API non li vede. Resta vero per `GET /api/project/export`, che per decisione del 2026-07-29
  li spedisce in chiaro;
- il server MCP autonomo — la forma con cui questa domanda era nata — diventa l'**ultima** fase e
  non la prima: gli strumenti servono comunque, e l'involucro MCP costa poco quando ci sono.

**La domanda resta aperta**: il piano propone, non decide. Le cinque scelte che spettano al
maintainer sono nel §9 del piano.

---


## Q43 — Traduzione automatica dei contenuti di progetto (Google Translate)

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Tradurre automaticamente da una lingua nota a una desiderata, usando le API di
Google Translator.

### Cosa c'è già, verificato sul codice

La richiesta **non** è «aggiungere il multilingua»: c'è. Quello che manca è riempire da soli una
struttura che esiste.

- `LanguageTable` in `sws-core/src/project.rs:966` ha un campo `default` — **il codice della lingua
  sorgente** — e la mappa token → traduzioni per codice lingua.
- L'autore scrive `{{token}}` nei campi testo degli oggetti; il viewer e l'anteprima dell'editor li
  risolvono nella lingua corrente (`sws-editor/src/i18n/projectI18n.ts`, T-40).
- Si scrive con `PUT /api/project/languages` (Admin).
- Sono **due assi indipendenti**: la lingua dell'interfaccia (`i18n/it.json`, `en.json`,
  react-i18next) e la lingua dei **contenuti di progetto**. Questa richiesta riguarda il secondo;
  confonderli produrrebbe un'interfaccia tradotta a metà.

### Opzioni

1. **Nel runtime, con un endpoint dedicato.** L'editor chiede «traduci da `it` a `de`», il runtime
   chiama Google e riempie `languages`. La chiave sta dove stanno già gli altri segreti.
2. **Nell'editor, col runtime come solo tramite.** Stessa cosa ma il controllo dell'operazione (cosa
   tradurre, cosa no) resta nell'IDE. Il browser non vede mai la chiave.
3. **Fuori linea, uno strumento a riga di comando** che prende un progetto e restituisce il progetto
   tradotto. Nessuna chiave nel prodotto, ma nessuna traduzione dall'IDE.

### Le domande da sciogliere

1. **Dove sta la chiave Google.** Stesso nodo di Q26: i segreti viaggiano col progetto in chiaro
   (decisione del 2026-08-20). Una chiave a consumo dentro un progetto che si esporta e si spedisce
   è un problema diverso da una password di driver.
2. **Chi rilegge.** Un allarme tradotto male su un pannello d'impianto non è una questione di stile.
   Serve un passaggio umano prima che una traduzione automatica raggiunga un dispositivo in
   servizio, e va deciso **dove** sta quel passaggio.
3. **Cosa NON si traduce.** I segnaposto di formato (`%.1f`, `{value}`), i nomi di macchina, le
   sigle e i codici di impianto. Tradurre `%.1f bar` in una lingua che sposta l'unità rompe il
   formato, non la frase.
4. **Riproducibilità.** La stessa stringa tradotta due volte può tornare diversa: serve decidere se
   si ritraduce tutto ogni volta o solo ciò che manca, e se una traduzione corretta a mano deve
   essere protetta dalla successiva passata automatica.
5. **Rete.** È un'operazione di **progettazione**, non di runtime: il dispositivo è spesso senza
   Internet. Va escluso che qualcosa la invochi a impianto acceso.
6. **Google o un'astrazione.** Il maintainer ha nominato Google; vincolarsi a un fornitore è una
   scelta legittima ma va detta, perché il costo di cambiarlo dopo non è zero.

### Default per il PoC

Nessuno: oggi le traduzioni si scrivono a mano nella tabella lingue.

### Realizzato in parte il 2026-09-15 (Fase 4 del piano multilingua)

Non chiude la scheda: la realizza dove il maintainer ha deciso, e lascia aperto ciò che resta suo.

**Deciso da lui, e fatto**: i fornitori stanno dietro un'astrazione — come già `enum Fornitore`
per l'assistente IA — e sono quattro, non uno. Due professionali a consumo (**Google Cloud
Translation** e l'**assistente IA già configurato**, Claude/Kimi, che è l'unico a cui si può dare
il *contesto*: «etichetta di un pulsante di un impianto industriale») e due gratuiti, aggiunti su
sua richiesta lo stesso giorno: **MyMemory**, senza nessuna chiave — è il default, perché chi preme
«traduci» deve ottenere una traduzione e non un modulo di configurazione — e **LibreTranslate**,
ospitabile in casa per chi non vuole che le stringhe del proprio impianto escano dal proprio
server.

**Le risposte ai sei nodi della scheda**, per quel che sono state date:

1. *Dove sta la chiave*: fuori dal progetto per l'IA (riusa `ai/client.rs`: 0600, mai in
   `project.yaml`). Per Google la chiave arriva nella richiesta e **non viene persistita** —
   scelta minima, non una risposta: persisterla va fatto dove stanno le altre.
2. *Chi rilegge*: il passaggio umano sta nell'IDE. L'esito lo dice esplicitamente ogni volta.
   **Non è una garanzia tecnica**: niente impedisce di tradurre e deployare senza guardare.
3. *Cosa non si traduce*: risolto, e provato — i segnaposti di formato escono dal testo prima di
   partire e ci rientrano identici; se il fornitore ne perde uno la riga viene **scartata**,
   perché una traduzione mutilata salvata è peggio di una riga non tradotta.
4. *Riproducibilità e protezione del lavoro umano*: risolto con `LangEntry.auto`, che elenca le
   lingue riempite dalla macchina. Una correzione a mano esce da lì e non viene più toccata,
   nemmeno chiedendo «ritraduci tutto».
5. *Rete*: risolto. L'endpoint esiste **solo sull'istanza IDE** e risponde 404 altrove.
6. *Google o un'astrazione*: entrambi, che era la decisione del maintainer.

**Cosa resta davvero aperto**, ed è perché la scheda non si chiude: quale fornitore sia quello
giusto **per un impianto consegnato**, e se una traduzione automatica debba poter raggiungere un
dispositivo in servizio senza che una persona l'abbia riletta. La prima è una scelta di costo e
qualità che dipende dal cliente; la seconda è una decisione di responsabilità, e un allarme
tradotto male su un pannello d'impianto non è una questione di stile.

### Cosa è stato realizzato nella 2.8.0 (16-09-2026), e cosa resta da decidere

Il piano multilingua ha costruito la traduzione automatica: quattro fornitori dietro
un'astrazione (MyMemory senza chiave, LibreTranslate, Google Cloud Translation, l'assistente IA),
endpoint solo-IDE, una traduzione umana mai sovrascritta, e una rilettura umana nell'IDE con
selettore della lingua di anteprima. Dei cinque punti elencati sopra, questo copre il 2 (dove
avviene la rilettura), il 4 (il marchio umano/automatico) e il 5 (mai a runtime).

**Il punto 3 — i segnaposto di formato — è stato risolto in un modo che vale la pena registrare,
perché è la parte che ha richiesto quattro tentativi.** I primi tre mettevano nel testo un
*guardiano* al posto del segnaposto, fidandosi che tornasse indietro intatto: il NUL non arrivava
a destinazione, `⟦0⟧` tornava riordinato («Warm stay: ⟦⟧0°C»), un carattere dell'area privata
veniva cancellato. La conclusione adottata è che **il segnaposto non esce dal nostro processo**:
la frase si spezza, si traduce solo il testo, e segnaposti e spazi di giunzione li rimette il
runtime.

**Resta aperto il prezzo di quella scelta**, ed è una decisione di prodotto, non di codice: il
traduttore vede i pezzi separati e **non può riordinare** il testo attorno al segnaposto. Per
l'italiano e l'inglese non cambia niente; per una lingua che volesse l'unità prima del numero, o
il verbo in fondo, il risultato è grammaticalmente imperfetto — intero, ma imperfetto. Le vie
sarebbero: accettarlo (oggi), mandare la frase intera **solo** al fornitore IA (l'unico a cui si
può spiegare cosa non toccare) e segmentare per gli altri, oppure marcare quelle righe come da
rileggere sempre. Non decisa.

Resta aperto anche il punto 1: quale fornitore è quello *giusto* per un allarme d'impianto.

### Decisa

`not yet`

---

## Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Poter ospitare l'editor su un sito web, con una pagina di configurazione
dell'hosting: utenti, il concetto di **azienda** e dei suoi utenti, il **branding** relativo, e un
minimo di parametrizzazione — numero di progetti e spazio per utente — da estendere in seguito.

### Perché è la questione più grande aperta finora

Non aggiunge una funzione: cambia **cosa è** SWS. Oggi è un programma che si installa accanto a un
impianto; questo lo rende un servizio che ospita gli impianti di più clienti sullo stesso server. Le
cose che oggi funzionano perché c'è un solo cliente smettono di funzionare tutte insieme.

### Cosa il modello attuale dà per scontato, verificato sul codice

| Oggi | Perché non regge in multi-azienda |
|---|---|
| `users.yaml` sta **dentro la directory del progetto** (`sws-auth/src/lib.rs:5`) | Gli utenti appartengono a un progetto. Qui devono stare **sopra** i progetti: un utente dell'azienda A ha più progetti |
| Ruoli `Viewer < Operator < Supervisor < Admin`, per progetto | Manca del tutto il livello «di chi è questo progetto» |
| **Modalità senza utenti**: nessun `users.yaml` ⇒ tutto è Admin senza token (`router.rs:663-673`) | Su un host pubblico è fatale. Va resa impossibile, non solo sconsigliata |
| Un runtime ha **un** progetto attivo (`--projects-root`, `.active-project`) | N aziende × M progetti non entrano in «un progetto attivo» |
| Il branding è **per installazione**: `public/branding/active.json` sceglie un marchio per tutta la SPA servita | La richiesta è branding **per azienda**: la stessa SPA deve mostrarsi diversa a clienti diversi |
| Nessuna nozione di quota | Da costruire: dove si contano i progetti, dove si misura lo spazio, e cosa succede al superamento |
| I segreti viaggiano col progetto in chiaro (decisione 2026-08-20) | Su un disco condiviso fra clienti è una decisione da riesaminare, non da ereditare |

### Opzioni

1. **Un piano di controllo separato**, davanti a N runtime (uno per azienda o per progetto): la
   tenancy, le quote e il branding vivono lì; il runtime resta quello che è. Isolamento forte,
   pezzo nuovo da scrivere e da mantenere.
2. **Estendere il runtime a multi-progetto e multi-utente**: un solo processo che serve tutti.
   Meno parti, ma tocca autenticazione, storage e ogni endpoint, e un difetto di isolamento diventa
   un incidente fra clienti.
3. **Ibrido**: un piano di controllo sottile solo per aziende/utenti/quote/branding, con i runtime
   per progetto avviati su richiesta.

### Le domande da sciogliere

1. **Isolamento**: oggi la separazione fra progetti è il filesystem e un processo. Quale garanzia si
   promette a un cliente sul fatto che un altro non veda i suoi dati?
2. **Dove vive lo stato di tenancy.** Non dentro un progetto — sta sopra. Serve un archivio nuovo.
3. **Le quote dove si fanno rispettare.** Contare i progetti è facile; misurare lo spazio mentre uno
   storico cresce da solo è un'altra cosa. E cosa succede quando si supera: si blocca la scrittura?
   si ferma lo storico? Un impianto che smette di registrare perché è finito lo spazio è un guasto.
4. **Backup e ripristino per azienda**, non per progetto come oggi.
5. **La licenza.** Vedi la sezione dedicata qui sotto: è la parte che il maintainer ha portato
   avanti per prima, e la premessa da cui era partita si è rivelata sbagliata.
6. **Il perimetro del «minimo per iniziare».** Il maintainer ha detto numero di progetti e spazio per
   utente, poi si estende. Vale la pena scrivere quali estensioni si prevedono, perché lo schema dei
   dati si progetta una volta sola.

### La licenza — verificato il 2026-09-07

Il maintainer ha chiesto se esistano licenze che permettano di offrire il servizio **senza obbligo
di rilasciare il sorgente**. Quello che segue sono fatti misurati, non un parere legale: prima di
muoversi serve un avvocato.

#### La premessa della domanda non regge

**L'AGPL vincola chi *riceve* il software, non chi lo possiede.** Il titolare dei diritti non può
violare una licenza che è lui a concedere: Soligonet che ospita codice di Soligonet non deve niente
a nessuno. L'obbligo scatterebbe per *altri* che avessero ricevuto il codice sotto AGPL e lo
ospitassero a loro volta.

Quindi, per il solo scopo «ospitare senza pubblicare», **non serve cambiare licenza**.

#### E il codice è già stato distribuito

Il maintainer riteneva di non aver distribuito nulla. Misurato il 2026-09-07:

| | |
|---|---|
| `github.com/soligolab/sws` | **pubblico** dal 2026-05-10 (`visibility: public`, licenza dichiarata AGPL-3.0) |
| `ghcr.io/soligolab/sws-runtime:latest-arm64` | **scaricabile da chiunque** con un token anonimo (HTTP 200) |
| Fork | **0** — stelle 2, watcher 0 |

Chiunque abbia preso una copia conserva i diritti AGPL **su quelle versioni, in modo
irrevocabile**: non si può richiamare indietro. In pratica però l'esposizione è teorica — nessuno
ha forkato in quattro mesi.

Questo **non** impedisce di cambiare licenza alle versioni **future**: chi è titolare unico può
rilasciare la 2.7.0 sotto qualunque licenza voglia. Il passato resta com'è.

#### Titolarità e dipendenze: nessun ostacolo tecnico

- **Un solo autore umano.** 382 commit `Mauro Soligo <mauro@soligo.net>` più 2 `pixsysedp
  <edp@pixsys.net>`, che sono la stessa persona su due macchine. Nessun contributore esterno.
- **Nessuna dipendenza impone AGPL o GPL.** Scansionati **577 crate** Rust e **319 pacchetti** npm:

  | Licenza | Dove | Effetto |
  |---|---|---|
  | MIT / Apache-2.0 / ISC / BSD | la grande maggioranza | nessun vincolo |
  | MPL-2.0 | `async-opcua*` (9 crate), `serialport` | copyleft **per file**: si pubblicano le modifiche *a quei file*, ma si possono collegare a software proprietario. **Non blocca** |
  | `unescaper` — `GPL-3.0/MIT` | 1 crate | doppia: si sceglie MIT |
  | `r-efi` — `MIT OR Apache-2.0 OR LGPL` | 2 crate | si sceglie MIT |
  | npm | 319 pacchetti | **zero copyleft** |

#### Le opzioni, e cosa comprano davvero

| | Cosa | Cosa ottieni | Cosa perdi |
|---|---|---|---|
| 1 | **Lasciare AGPL** | Ospiti lo stesso: sei il titolare | Chi vuole includere SWS in un prodotto proprietario non può, e molti uffici legali industriali vietano l'AGPL in blocco |
| 2 | **Doppia licenza** (AGPL + commerciale) | Il pubblico resta AGPL; vendi la commerciale a chi la vuole | Richiede di restare titolare unico: servirebbe un CLA al primo contributore esterno |
| 3 | **MIT sulle versioni future** | Chiunque può usarlo e includerlo ovunque, senza attriti legali | **Chiunque può anche ospitarlo come servizio concorrente e non deve niente** |
| 4 | **Proprietaria sulle versioni future** | Controllo massimo | Nessuna adozione esterna; e il fork AGPL pubblico resta comunque disponibile |

#### L'esigenza, precisata dal maintainer (2026-09-07)

> «La mia esigenza è offrire il **servizio**, non offrire i sorgenti: gli utenti useranno il mio
> servizio e stop.»

Con questa precisazione la questione licenza **esce dal percorso critico di Q44**: l'esigenza è già
soddisfatta oggi, senza cambiare niente.

- Gli utenti del servizio **non ricevono codice** — è software come servizio, non distribuzione.
- L'unico appiglio dell'AGPL su questo caso è l'uso in rete (§13), e ricade su **chi opera sotto
  licenza**, cioè su un licenziatario. Il titolare dei diritti non è licenziatario di se stesso.

Quindi Q44 si può progettare e costruire **senza aspettare la decisione sulla licenza**. Restano da
decidere solo cose che riguardano altri scopi:

| Se un domani si vuole… | Serve |
|---|---|
| impedire ad **altri** di ospitare SWS come servizio | non MIT — semmai doppia licenza o proprietaria sulle future |
| togliere attrito ai clienti che vogliono **integrare** il codice | MIT o simile |
| solo ospitare, come oggi | **niente** |

#### Orientamento del maintainer (2026-09-07)

**MIT**, motivato dall'essere unico autore. Registrato come orientamento, non come decisione.

Due cose da pesare prima di renderlo definitivo, dette una volta e senza insistere:

- **MIT concede molto più di quanto lo scopo richiedesse.** L'obiettivo era «ospitare senza
  pubblicare», che la titolarità già garantisce (opzione 1). Con MIT, chiunque — un concorrente,
  un cliente, Pixsys — può prendere SWS, ospitarlo come servizio a pagamento e non restituire
  niente. Se un domani Q44 diventa un prodotto, è la licenza che protegge meno.
- **Ma c'è un argomento pratico forte a favore**, in questo settore: molti reparti acquisti e uffici
  legali industriali **vietano l'AGPL** per contratto. Se l'obiettivo è che i clienti possano
  integrare SWS senza una revisione legale, MIT toglie un attrito reale che l'AGPL crea. Vale la
  pena dire a voce alta se è *questa* la ragione, perché allora MIT è la scelta giusta e non un
  eccesso.

#### Cosa resta da chiedere a un avvocato

1. **Esiste un contratto con Pixsys** che renda parte del lavoro commissionato? La nota di progetto
   dice che Pixsys è cliente e non proprietaria, ma è un fatto contrattuale non verificabile dal
   codice.
2. **I contributi generati dall'IA**: i termini di Anthropic assegnano l'output all'utente, ma lo
   stato del diritto d'autore su output di IA non è uniforme fra giurisdizioni. Tende a *ridurre* la
   protezione, non a creare un terzo che rivendica.
3. **Il cambio di licenza va fatto bene**: `LICENSE`, il campo `license` nei quattro manifesti, le
   intestazioni dei file se ce ne sono, e una nota che dica da quale versione vale.

### Rapporto con le altre voci

- **Q26** (server MCP) e il piano della chat IA: entrambi partono dal presupposto «la chat vive solo
  sul PC di sviluppo». Se l'editor diventa ospitato, quel presupposto cade e va rifatto il ragionamento.
- **Q17**, **Q27**: i confini di scrittura sono stati chiusi assumendo un solo cliente.

### Default per il PoC

Nessuno: oggi l'editor si installa, non si ospita. **La licenza non è un prerequisito**: vedi la
precisazione del 2026-09-07 qui sopra.

### Decisa

`not yet`

---

## Q53 — Due immagini aarch64 (SDK Pixsys e generica): tenerle entrambe, o convergere su una?

Contenuto spostato in [`docs/archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md`](archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md) il 2026-09-12, archiviato il 2026-09-14. **Decided:** decisa e realizzata il 2026-09-10; fase due chiusa il 2026-09-14 — misura sul WP630 confermata e percorsi SDK/QEMU rimossi, alias `-arm64-generic` mantenuti.

---

## Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

*Aperta l'11-09-2026, come conseguenza dichiarata della decisione dello stesso giorno («gli
utenti appartengono al progetto, il deploy li porta»). Il maintainer l'ha nominata lui stesso:
«esiste il caso futuro in cui nel progetto utente sia implementata una vista per
creare/modificare gli utenti, e in quel caso gli utenti del dispositivo potrebbero differire da
quelli del progetto».*

**Context.** Dall'11-09-2026 il deploy sostituisce `users.yaml` sul dispositivo con quello del
progetto, con una casella per saltarlo. Oggi gli account nascono in un solo posto — la tab
Utenti dell'IDE, dentro il progetto — quindi il dispositivo non ha nulla di suo e sostituire non
perde niente. Il giorno in cui esisterà il componente sinottico «gestione utenti», un capo turno
creerà un operatore **sul pannello**: quell'account vive solo lì, e il deploy successivo lo
cancella. La casella «Sostituisci anche gli utenti» copre il caso solo se chi preme il pulsante
**sa** che sul pannello sono nati account — cioè si ricorda di una cosa che non ha fatto lui.

**Options.**

1. **Come oggi: la casella, a mano.** Zero codice in più. Il deploy resta una scelta consapevole,
   ma dipende dalla memoria di chi lo fa; l'errore è silenzioso e irreversibile.
2. **Fusione per username.** Il deploy porta gli utenti del progetto e **tiene** quelli del
   dispositivo che il progetto non nomina. Nessuna perdita accidentale, ma un utente **rimosso**
   dal progetto non sparisce più dal pannello: una revoca non arriva a destinazione, che è il
   caso in cui contare sul deploy serve di più.
3. **Marcatura «utente locale».** `users.yaml` distingue chi è nato dal progetto da chi è nato sul
   dispositivo (un campo, es. `origine: dispositivo`); il deploy sostituisce i primi e non tocca i
   secondi. Copre entrambi i casi — la revoca arriva, l'operatore creato in reparto resta — al
   prezzo di un campo nel formato e della sua migrazione, e della domanda «di chi è la password»
   quando un username esiste da tutt'e due le parti.
4. **Il pannello rifiuta il deploy** finché qualcuno non riconcilia a mano, mostrando le
   differenze. Nessuna perdita, ma un deploy che si blocca su un impianto in servizio è peggio
   del problema.

**Default for PoC.** Opzione 1: la casella esiste, il componente «gestione utenti» no. Finché gli
account nascono solo nel progetto, il caso non si presenta. La scheda serve a non decidere per
inerzia quando quel componente si farà: è **quella** la sessione in cui va scelta la 2 o la 3,
non dopo il primo account perso.

**Decided:** not yet.

---

## Q55 — `reqwest` via `rt_handle.spawn()` si blocca per sempre nel viewer LVGL, solo per una POST che riceve 200

*Aperta il 13-09-2026, scoperta durante il collaudo dal vivo di
[Q36 parte 1](archive/2026-09-12-q36-min-role-lvgl.md) (sessione vera nel client LVGL).*

**Context.** `sws_auth_keyboard_ready_cb` (`lvgl_render.rs`) chiamava `client::login()` — una
POST `reqwest` — via `ctx.rt_handle.spawn(async move { ... })`, lo stesso pattern già in uso da
tempo per `put_tag`/`ack_alarm`/`apply_recipe`. Dal vivo, quella `spawn` non tornava **mai**: nessun
panico, nessun errore, il `.await` semplicemente non si risolveva, anche aspettando 15 secondi
reali — mentre il server emetteva regolarmente `login: session issued` nel proprio log di audit,
cioè la richiesta arrivava e veniva accettata.

Isolato per esclusione, con più prove dal vivo nello stesso processo:
- lo stesso identico login funziona **all'istante** via `curl` verso lo stesso server;
- funziona all'istante anche da un binario Rust a sé stante (niente `lvgl-sys`), stesso
  `tokio`+`reqwest`, stessa richiesta, stesso server;
- funziona all'istante nello **stesso identico callback**, se invece di `spawn` si usa
  `rt_handle.block_on(...)`;
- altre `spawn` nello stesso processo funzionano bene: un `tokio::time::sleep`, una GET che
  riceve 403, una POST che riceve 403, una GET che riceve 200 con corpo JSON.

L'unica combinazione che si blocca è: **dentro `sws-lvgl-viewer`, via `spawn` (non `block_on`),
una POST che riceve 200**. Il sospetto — non verificato, solo un'ipotesi coerente con la storia
di questo motore — è l'override globale di `strncmp`/`strcmp` che `lvgl-sys` installa a livello
di libc, la stessa classe di rischio già vista rompere `libdbus` in SDL2 (Q14/Q22).

**Perché conta**: non è un problema del solo login. Qualunque `spawn` futuro che faccia una POST
destinata a un 200 nello stesso binario rischia lo stesso blocco silenzioso — senza panico, senza
log, un task che semplicemente non finisce mai. `put_tag`/`ack_alarm`/`apply_recipe` oggi vanno
verso 403 (anonimo) o non sono ancora stati provati verso un 200 reale con utente loggato: non è
escluso che li aspetti lo stesso destino il giorno in cui una scrittura autenticata va a buon
fine.

**Options.**

1. **Lasciarlo com'è**: `block_on` per il login (fatto, in Q36 parte 1), `spawn` fire-and-forget
   per le scritture — che oggi funzionano perché ricevono 403 o non sono state esercitate con un
   200. Zero indagine ulteriore, ma il rischio resta silenzioso per il prossimo che aggiunge una
   `spawn` con esito 200.
2. **Indagare la causa vera**: bisect sui simboli sovrascritti da `lvgl-sys` (`strncmp`/`strcmp` e
   vicini), o un repro minimo che aggiunga `lvgl-sys` al binario a sé stante già usato per isolare
   il bug, per vedere se basta linkarlo (senza nemmeno creare un display) a riprodurre il blocco.
   Costa una sessione dedicata, con esito non garantito.
3. **Migrare anche le scritture a `block_on`**, preventivamente, per non lasciare nessuna `spawn`
   che possa ricevere un 200 in questo binario. Costa il render loop bloccato per la durata di una
   scrittura di rete (oggi accettabile per un tocco umano, meno chiaro per scritture frequenti o
   in serie).

**Default for PoC.** Opzione 1: nessuna `spawn` verso un esito 200 conosciuta in produzione dopo
Q36 parte 1 (il login, l'unico caso concretamente esercitato, ora usa `block_on`). Il rischio
resta annotato qui, non indagato oltre.

**Decided:** not yet.

---

## Q56 — Un IDE non si autentica più: `users.yaml` governa il dispositivo, non l'editor

*Aperta il 14-09-2026 come conseguenza dichiarata della correzione dello stesso giorno
(`docs/archive/2026-09-14-primo-utente-non-chiude-fuori.md`). Imparentata con **Q44** (ospitare l'editor come
servizio) e **Q54** (un dispositivo che crea utenti propri).*

**Context.** Il maintainer ha definito il primo utente di un progetto dall'IDE — `user`, ruolo
Operator, pensato per il pannello — e l'IDE si è chiuso fuori dal proprio progetto: scrivere
`users.yaml` accende l'autenticazione **nello stesso runtime** che serve l'editor, il token che
l'editor porta in modalità senza utenti è un sentinella che il server non ha mai emesso, e
l'unico account esistente era un Operator, che l'IDE non ammette (`permissions.ts`). Il progetto
è diventato irraggiungibile senza spostare il file a mano.

La causa non è un difetto isolato: **un elenco di utenti, due consumatori**. Lo stesso
`users.yaml` per-progetto governa il dispositivo (dove è giusto: viaggia col deploy, protegge
l'impianto) e il runtime dell'IDE che tiene quel progetto aperto (dove non serve a niente, perché
l'IDE è il posto da cui quegli utenti si **scrivono**).

**La correzione del 14-09** taglia il nodo dal lato utile subito: su un'istanza IDE
(`AppState.ide_only`, cioè nessun `--viewer-port`) la porta admin resta in modalità senza utenti
comunque, e in `create_user` una guardia impedisce che il primo account di un **dispositivo** sia
non-Admin. Decisione del maintainer, presa esplicitamente quel giorno: *«sarebbe un utente per il
dispositivo target, non per l'IDE»*.

**Cosa resta aperto — il prezzo.** Un IDE **raggiungibile in rete** ora non ha password, e in modo
permanente invece che solo finché non si definiscono utenti. Sul PC di sviluppo è `localhost` e la
cosa non si nota; su un host esposto è esattamente ciò che Q44 chiama «fatale», e quella riga della
tabella di Q44 ora descrive una condizione **più ampia** di prima.

**Options.**

1. **Lasciarlo com'è** — l'IDE è un programma da PC di sviluppo, si protegge col fatto di ascoltare
   dove ascolta. È il default PoC, ed è coerente con «SWS si installa accanto a un impianto».
2. **Un'autenticazione dell'IDE separata da quella del progetto**: un elenco di utenti
   dell'installazione (non del progetto), che governa chi apre l'editor, indipendente dal
   `users.yaml` che viaggia col deploy. È la forma piccola della risposta di Q44 (utenti **sopra**
   i progetti) e si può costruire prima del resto.
3. **Riattivare l'autenticazione dell'IDE quando non è locale** — per esempio quando il listener
   non è su loopback, o dietro una variabile d'ambiente esplicita. Rimette in piedi il guasto di
   oggi se qualcuno definisce un Operator come primo utente su un'istanza così, a meno di
   estendere lì anche la guardia sul primo Admin.

**Default for PoC.** Opzione 1. Il prezzo è scritto qui perché non venga riscoperto per caso, e la
risposta vera è la 2, che nasce dentro Q44 e non prima.

**Decided:** not yet.

---

## Q57 — Una notifica non ha uno schermo: in che lingua parla, e a chi?

*Aperta il 15-09-2026 durante la Fase 2 del piano multilingua. Il piano prende il minimo e
registra qui la parte che è una decisione di prodotto.*

**Context.** Fino a oggi email e messaggi Telegram uscivano con il messaggio d'allarme **grezzo**
— un progetto tradotto bene mandava letteralmente `{{allarme_pressione}}` al telefono di chi era
di turno — dentro un template con le etichette («Allarme:», «Messaggio:», «Severità:») **cablate
in italiano**. Corretto: il messaggio si risolve, e le etichette seguono una lingua.

Ma *quale* lingua? Un viewer ce l'ha: è quella scelta sul vetro, e cambia quando un operatore
tocca il `lang_button`. Una notifica no. Parte verso una casella o una chat mentre nessuno sta
guardando il pannello, e la lingua scelta da un operatore in sala controllo non riguarda chi la
riceve. La Fase 2 ha quindi introdotto `notifications.notify_lang` nel progetto — **una sola per
progetto**, con ripiego sulla lingua principale della tabella.

**Il caso che una lingua sola non copre.** Un impianto venduto a un cliente estero ha spesso
destinatari misti: la manutenzione locale, il costruttore italiano, l'assistenza del fornitore del
PLC. Oggi ricevono tutti la stessa lingua, e almeno uno la riceve sbagliata. Il modello dei
destinatari lo permetterebbe: `notify_email[]` ed `escalate_to[]` sono già elenchi per allarme
(`sws-core/src/alarm.rs:175-181`), e `telegram_chat_ids[]` pure.

**Options.**

1. **Una lingua per progetto**, com'è ora. Semplice, e per un impianto con un solo interlocutore è
   la risposta giusta. Costo: chi ha destinatari misti non ha nessuna via d'uscita.
2. **Una lingua per destinatario**: `notify_email` diventa una lista di `{indirizzo, lingua}` e
   altrettanto per le chat. Il corpo si compone una volta per lingua distinta invece che una volta
   sola. Costo: cambia la forma del progetto in un punto che oggi è un semplice elenco di stringhe,
   e moltiplica i messaggi in uscita.
3. **Una lingua per canale** — email in una lingua, Telegram in un'altra. Costa poco ma copre un
   caso che non è quello vero: la lingua dipende da *chi legge*, non da *come* legge.

**Default per il PoC.** Opzione 1, realizzata. Il prezzo è scritto qui.

**Decided:** not yet.

---

## Q58 — Un template porta gli indirizzi e le credenziali dell'impianto in cui è nato

*Aperta il 2026-09-16, emersa realizzando il piano multilingua. Nessuna decisione presa.*

**Come si è vista.** Il maintainer ha creato un progetto da un template e si è ritrovato 1950
righe su 2000 di `connection refused` nel log in pochi minuti. Il template
`nebulizzatore-sandokan` dichiara `host: 192.168.1.6` — il broker MQTT **di casa sua**. Chiunque
crei un progetto da quel template si porta dietro un indirizzo che sulla sua rete non esiste, e
il runtime ci si ostina contro per sempre.

Il rumore è stato mitigato (backoff 5→60s, motivo scritto una volta su dieci: commit
`413fb8eb`), ma quello era il sintomo. Il problema è che **un template è un esempio, e un
esempio non dovrebbe contenere un pezzo di rete vera**.

E non si ferma agli indirizzi: un template può portare, con la stessa naturalezza, un token
Telegram, una password MQTT o le credenziali di un dispositivo — perché *«i segreti viaggiano col
progetto»* è una decisione presa e giusta per un progetto, ma un template non è un progetto: è
qualcosa che si distribuisce a chi non c'entra niente con l'impianto originale.

### Le vie possibili

1. **Una regola scritta e una guardia** — nessun template dichiara host/porta di una rete reale;
   si usano segnaposto (`mqtt.example.invalid`) o un `kind: simulato`. La guardia
   (`check_templates.sh` esiste già) lo verifica a ogni giro. Costa poco; non impedisce di
   sbagliare, lo **fa notare**.
2. **Le sorgenti non viaggiano nei template** — un template porta sinottici, allarmi e tag, e le
   sorgenti si configurano all'apertura, con una schermata che le chiede. È la via pulita, ed è
   anche quella che fa più lavoro: molti template oggi *sono* il loro impianto.
3. **Sorgenti disarmate all'apertura da template** — il progetto nasce con le sorgenti presenti
   ma disabilitate, e l'autore le accende dopo averle riviste. Più economica della 2 e copre sia
   il rumore sia le credenziali, ma lascia i valori scritti dentro il file.

### Cosa è stato fatto, e cosa resta da timbrare (17-09-2026)

**La via 1 è realizzata**: la regola **R5** del parco template
(`examples/templates/README.md`) vieta indirizzi di reti reali e credenziali, nel `project.yaml`
e nei `.md` che lo accompagnano, ed è verificata da `check_templates.sh`. I quattro template che
portavano la rete di casa dell'autore sono stati corretti.

**La via 3 è realizzata in una forma più economica di quella immaginata qui.** Il maintainer ha
scelto il flag **per progetto** invece che per sorgente: `Project::sorgenti_da_rivedere`, acceso
dalla creazione da template e spento dal salvataggio della scheda Sorgenti. Finché è acceso
`apply_loaded_project` non avvia le sorgenti e scrive nel log perché.

La granularità per-sorgente (un `enabled` in ognuna delle otto strutture di configurazione) è
stata scartata con la ragione già scritta nel commit `413fb8eb`: «otto punti sono otto occasioni
di dimenticarne uno il giorno che se ne aggiunge un nono». E la granularità che conta non è la
singola sorgente: è «questo progetto viene da un template e nessuno ha ancora guardato gli
indirizzi».

**La via 2** — le sorgenti non viaggiano affatto nei template — resta scartata: romperebbe i
quattro banchi di prova di protocollo, il cui senso è avere una sorgente già pronta da puntare al
proprio PLC.

**Resta da timbrare.** Non tocco io il campo `Decided` (regola 3 di `CLAUDE.md`): la decisione è
del maintainer ed è stata presa, il codice c'è e i test ci sono, ma il collaudo dal vivo — creare
un progetto da un template e verificare che il runtime *non* si colleghi, poi confermare dalla
scheda e vedere che si collega — non è ancora stato fatto.

**Nota di contesto.** Il maintainer ha già detto (16-09) che vuole **definire delle regole prima**
di rimettere mano ai template: rapporto 16:10 a 1280×800, almeno tre lingue (it/en/es), template
semplici, un tipo di risorsa più casi d'uso realistici. Questa sarebbe la quinta regola, ed è
l'unica delle cinque che ha a che fare con la sicurezza invece che con la forma — per questo è
qui e non solo in `STATUS.md`.

**Decided:** not yet.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.

## Archivio — decise, realizzate e verificate

Le schede qui sotto sono state **spostate intere** in
[`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md) il 2026-09-06, dopo
una verifica sul codice di ciò che ognuna dichiara. I numeri **non si riusano**: una scheda nuova
prende il numero successivo all'ultimo mai assegnato, archivio compreso.

| # | Questione | Decisa |
|---|---|---|
| Q1 | Python embedding strategy | bootstrap |
| Q2 | Sparkplug B implementation | T-08 |
| Q3 | Plugin ABI strategy | bootstrap |
| Q4 | Frontend state management | 2026-05 (ADR 0001) |
| Q5 | i18n scaffolding | bootstrap |
| Q6 | Symbol library packaging | 2026-08-11 |
| Q7 | LICENSE file content | 2026-05-12 |
| Q8 | Isolamento runtime ↔ IDE | 2026-07-26 e 2026-09-02 |
| Q9 | Le `PUT /api/project/*` accettano e scartano in silenzio i campi sconosciuti | 2026-08-21 |
| Q10 | Una sorgente non parsabile viene scartata in silenzio, e il salvataggio successivo la cancella | 2026-08-21 |
| Q11 | Estendere `BrandColors` con `secondary`/`accent`, o tenerli solo nell'artwork? | 2026-08-21 |
| Q12 | I neutri di `theme.ts` restano condivisi fra tutti i brand, o diventano override per-brand? | 2026-08-21 |
| Q14 | Binding Rust↔LVGL e sequenza dei backend di output | 2026-08 (15 seguiti) |
| Q15 | Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile | 2026-08-11 |
| Q17 | `apply_recipe` scrive i tag senza contesto utente | 2026-09-06 |
| Q18 | Colori del testo dai token di tema su pagine con sfondo scelto a mano | 2026-08-25 |
| Q19 | Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd` | 2026-08-25 |
| Q20 | Il viewer LVGL non si accorge che il progetto è cambiato | 2026-08-25 |
| Q21 | Due superfici Python nel progetto, in due punti lontani dell'interfaccia | 2026-08-25 |
| Q22 | La `sparkline` fa crashare il viewer LVGL quando la pagina ha altri widget | 2026-08-25 |
| Q24 | Il font del viewer LVGL non ha le lettere accentate | 2026-08-27 |
| Q25 | Installare web e LVGL insieme, e far scegliere al sistema quale mostrare | 2026-08-27 |
| Q27 | Il server non fa rispettare il `data_type` dei tag in scrittura | 2026-09-06 |
| Q30 | `patch_project` è un leggi-modifica-scrivi senza lock | 2026-09-03/04 |
| Q32 | Dove deve vivere il progetto che si sta modificando? | 2026-09-12 |
| Q33 | `POST /api/system/stop` viene annullato in silenzio dal salvataggio delle Sorgenti | 2026-09-04 |
| Q34 | Il cron degli script globali non capisce `*/5`, e non parte in silenzio | 2026-09-03/04 |
| Q35 | «fuori pagina» implicito nelle coordinate o campo esplicito? | 2026-09-06 |
| Q37 | Cosa c'è attorno alla pagina sul pannello, e se il foglio non ci sta | 2026-09-06 |
| Q38 | `size_mode: ratio` senza dimensioni esplicite: il bordo non arriva al canvas | 2026-09-06 |
| Q39 | Il validatore deve aprire la famiglia dei rilievi geometrici? | 2026-09-12 |
| Q41 | La chat IA deve mostrare consumo di token e credito residuo? | 2026-09-06 |
| Q42 | Gli script Python scrivono i tag senza lo scaling inverso | 2026-09-06 |
| Q47 | `/api/script/exec` esegue codice arbitrario e nessuno lo chiama più | 2026-09-09 |
| Q48 | `/api/deploy/remote` scarica un binario che non esiste, e duplica il deploy | 2026-09-09 |
| Q50 | I dispositivi registrati: dal browser al server, e popolati dal discovery mDNS | 2026-09-10 |
| Q51 | «Pacchetto runtime» e il deploy binario sono strumenti di sviluppo: nascosti quando il repo non c'è | 2026-09-09 |
| Q52 | «Installa su dispositivo»: container per primo, campi dal dispositivo connesso, e un discovery che trova **qualunque** macchina in rete | 2026-09-09 |
