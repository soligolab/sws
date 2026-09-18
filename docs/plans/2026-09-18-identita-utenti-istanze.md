# Identità, utenti e istanze: di chi sono gli account, e chi comanda quando due copie non sono d'accordo

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.


## Perché queste tre stanno insieme

Non le ho raggruppate io: **Q56 dichiara da sé** di essere imparentata con Q44 e Q54. Sono la
stessa domanda vista da tre punti diversi:

| | La domanda vista da… |
|---|---|
| **Q44** | …chi ospita l'editor per più aziende: utenti, quote, branding, e progetti che non sono uno solo |
| **Q54** | …un dispositivo che si crea account propri: al deploy successivo chi vince? |
| **Q56** | …un IDE che non si autentica più, perché `users.yaml` governa il dispositivo e non l'editor |

Sotto tutte e tre c'è una cosa sola: **di chi sono gli account, e cosa succede quando due copie
dello stesso progetto non sono d'accordo su chi può entrare.** Decidere Q44 decide di fatto le
altre due; deciderle separatamente significa quasi certamente doverle rifare.

## Cosa NON fare adesso

Il maintainer è stato esplicito il 18-09-2026: **questo è il lavoro più corposo e va in coda**,
dopo gli altri. Questo file esiste per tenere insieme il materiale, non per cominciare.

> «Ora non ha senso, possono cambiare troppe cose. Ora facciamo un mini-plan per rivedere le 3
> questioni e accorparle in un plan coerente.»

Quindi: quando si comincerà, **prima una sessione di plan dedicata** che rilegga le tre schede
contro il codice di allora e ne faccia un piano unico. Le misure qui sotto hanno la data che
hanno.

## Da tenere d'occhio nel frattempo

- **Q60 (workspace)** sta nella stessa coda: se l'editor diventa un servizio multi-azienda,
  «dove vivono i progetti» cambia natura, e le due decisioni si condizionano.
- **Q46** (il selettore di cartelle confinato nella radice) è una decisione di sicurezza già
  collaudata: qualunque cosa si decida qui, non la si tocca di straforo.
- Ogni correzione che sposta il confine fra «utenti del progetto» e «utenti del dispositivo» va
  annotata qui sotto man mano, o quando si aprirà questo lavoro le schede saranno vecchie senza
  che nessuno lo sappia.



---

## Dalla scheda Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

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

## Dalla scheda Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

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

## Dalla scheda Q56 — Un IDE non si autentica più: `users.yaml` governa il dispositivo, non l'editor

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
