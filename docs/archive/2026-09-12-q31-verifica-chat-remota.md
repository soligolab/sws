# Q31 — Verificare dal vivo la chat con un runtime remoto collegato

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q31) il 2026-09-12, aperta il 2026-09-01. Non un
> piano di codice: il codice è già scritto e verificato **a lettura**, manca solo la conferma
> a schermo con un runtime remoto vero.

## Cosa è già risolto, verificato nel codice

- Il socket della chat (`/ws/ai`) resta locale: `buildWsUrl` dirotta sul relay solo `tags`,
  `alarms`, `logs` (`sws-editor/src/ws/wsUrl.ts`), e un commento accanto al `matches!` del
  relay (`sws-web/src/remote_relay.rs`) spiega perché `ai` non va aggiunto.
- Il pannello lo dice: `ChatPanel.tsx:196` mostra un avviso quando `remoteConnected`.
- La premessa temuta era sbagliata: con un runtime remoto collegato, l'utente modifica sempre
  il progetto **locale** (`remote_deploy` ne manda una copia al device); l'assistente che legge
  il locale legge quindi il progetto giusto, non uno abbandonato.

## Cosa manca

**Nessuna riga di questo è stata provata dal vivo** con un runtime remoto vero — solo verificata
leggendo il codice. Da fare quando capita un momento con un dispositivo (o una seconda istanza
locale) collegato come remoto:

1. Collegare l'editor a un runtime remoto (`ConfigView → Runtime → Connetti`).
2. Aprire la chat: verificare che l'avviso «stai lavorando sul progetto locale» compaia.
3. Fare una richiesta che tocchi il progetto, verificare che la proposta rifletta il progetto
   locale (non quello del dispositivo remoto).
4. Controllare che il socket della chat non passi dal relay (nessun errore 404, nessuna
   riconnessione perpetua).

## Domanda collegata, non decisa

Se un giorno servisse un assistente che *guarda* il dispositivo (i suoi tag dal vivo, il suo
storico, i suoi log) — diverso da questo, che lavora sul progetto — è un secondo insieme di
strumenti, discusso in `docs/archive/2026-08-31-chat-ai-nelleditor.md`. Non affrontarlo qui.

## Esito — collaudata dal vivo e archiviata il 2026-09-12

Due runtime di prova isolati (porte scratch, nessuna istanza del maintainer toccata): un
"device" no-auth con un progetto `casa-locale` aperto, e un "editor" con l'agente finto
(`SWS_AI_FAKE`) e il progetto `e2e-chat-ai` (demo-items-web) aperto, collegato al device via
`POST /api/remote/connect`. Un browser Chromium vero (Playwright, script usa-e-getta, non
committato) ha percorso i quattro punti sopra:

1. **Avviso presente**: passando prima da ConfigView → Runtime (che sincronizza `remoteConnected`
   da `/api/remote/status` al mount) e poi aprendo la chat, compare "L'assistente lavora sul
   progetto locale — quello che stai modificando — non su quello del dispositivo collegato."
2. **Proposta sul progetto giusto**: la richiesta di prova ha prodotto una proposta che cita
   `tag \`luce.salotto\`` e `button ... in «Indicatori»` — il progetto locale, non
   `casa-locale` (deliberatamente diverso sul device, per accorgersi di uno scambio).
3. **Socket locale**: il WebSocket osservato è stato `ws://.../ws/ai` — mai `/ws/remote/ai`.
4. **Nessun 404, nessun loop**: i soli canali relayati sono stati `remote/tags` e `remote/logs`
   (lo stato del device), tutti con risposta pulita.

Un primo giro aveva dato un falso negativo sul punto 1 perché lo script non era passato da
ConfigView → Runtime prima di aprire la chat — non un difetto, solo che `remoteConnected` nello
store non si auto-inizializza all'avvio dell'app se quel pannello non viene mai montato: un
comportamento noto, fuori scope per questa Q. Scheda archiviata in
`docs/history/OPEN_QUESTIONS-chiuse.md`.

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q31 — La chat non funziona quando l'IDE è collegato a un runtime remoto, e non è chiaro cosa dovrebbe fare

### ⚠ Riverificata il 2026-09-05: **il codice è cambiato e la scheda è invecchiata**

Rileggendo il codice di `main`, due delle tre cose descritte qui sotto non sono più vere, e la
terza — la più preoccupante — **partiva da una premessa sbagliata**. Chi legge questa scheda per
decidere deve saperlo prima di leggerla.

1. **Il 404 non c'è più.** `buildWsUrl` ora dirotta sul relay **solo** i tre canali dello stato del
   dispositivo (`CANALI_DEL_DISPOSITIVO = ["tags", "alarms", "logs"]`); `/ws/ai` resta locale, e il
   commento accanto spiega perché non deve entrare in quell'elenco, citando questa Q. La whitelist
   del client e quella del relay ora coincidono di proposito.
2. **Il pannello lo dice.** `ChatPanel.tsx:196` mostra un avviso quando `remoteConnected`: il
   progetto che si sta modificando è quello locale, e l'assistente legge e propone su quello.
3. **La premessa del rischio peggiore era sbagliata.** La scheda diceva che «l'umano modifica il
   progetto del dispositivo e l'agente leggerebbe quello locale». Non è così: con un runtime remoto
   collegato **l'umano modifica comunque il progetto locale** — `remote_deploy` ne manda una copia
   al device, il pull fa il verso opposto, e le chiamate HTTP di progetto non sanno nemmeno che
   esista un remoto. Quindi l'agente che legge il locale sta leggendo **il progetto giusto**, e
   sarebbe dirottarlo sul dispositivo a fargli leggere una copia che nessuno sta editando.

**Cosa resta davvero aperto**, e vale la pena riformularlo così: non «la chat è rotta col remoto»,
ma **«quando l'IDE è collegato a un impianto, l'assistente deve poter guardare l'impianto?»**. Oggi
no, e per una ragione buona (la chiave API e la sessione dell'agente restano sul PC). L'opzione 2
qui sotto — far leggere gli strumenti attraverso l'API del runtime remoto col token dell'umano —
resta la via a regime per quando servirà, per esempio per far diagnosticare all'assistente un
allarme che sta suonando adesso sul pannello.

Resta anche il pezzo che la scheda già dichiarava: **nessuna di queste righe è stata provata dal
vivo** con un runtime remoto vero. La verifica nel codice non sostituisce quella a schermo.



*Aperta il 2026-09-01 rileggendo `feat/T-50-chat-ai` su frodo. **Verificata nel codice**, non
provata dal vivo: manca la conferma a schermo.*

`buildWsUrl` (`sws-editor/src/ws/wsUrl.ts:27-35`) instrada **ogni** WebSocket attraverso il
relay quando l'IDE è collegato a un runtime remoto: `/ws/ai` diventa `/ws/remote/ai`. Il relay
però ammette tre soli sottocanali — `if !matches!(sub.as_str(), "tags" | "alarms" | "logs")`
(`sws-web/src/remote_relay.rs:97`) — e risponde **404** a tutto il resto. Il commento in testa a
`buildWsUrl` lo dice senza saperlo: *«`path` here is expected to be one of: /ws/tags,
/ws/alarms, /ws/logs»*.

Nessun controllo su `remoteConnected` esiste in `ChatPanel.tsx` né in `aiStream.ts`: il pannello
resta apribile, e il socket entra in riconnessione perpetua contro un 404.

Non si è visto durante lo sviluppo perché la prova è stata fatta con un progetto **locale**
all'istanza dell'editor, non con la connessione a un runtime remoto — che è però il flusso
descritto in `docs/CONTEXT.md` §3 per il PC di sviluppo.

### Perché non è solo un sottocanale da aggiungere all'elenco

Aggiungere `"ai"` al `matches!` farebbe collegare la chat **al runtime del dispositivo**: la
sessione dell'agente girerebbe là, con la chiave API là. È esattamente ciò che il piano esclude
(`docs/archive/2026-08-31-chat-ai-nelleditor.md` §2: *«Mai sul pannello»*).

Tenerla locale non è gratis: gli strumenti dell'agente leggono il progetto dall'`AppState` del
runtime che regge il WebSocket (`carica_progetto` in `ai/tools.rs:145` → `Project::load(&dir)`
sulla directory attiva **locale**). Con l'IDE collegato a un remoto, l'umano modifica il
progetto del dispositivo e l'agente leggerebbe quello dell'istanza locale: proporrebbe modifiche
su un progetto che non è quello aperto. Peggio del 404, perché sembrerebbe funzionare.

### Le tre vie, e cosa ognuna implica

1. **Disabilitare la chat quando `remoteConnected`**, dicendolo in chiaro nel pannello. È la
   sola opzione che non mente, e costa poche righe. La chat resta uno strumento per progetti
   locali all'IDE, coerente col piano.
2. **Far leggere gli strumenti attraverso l'API del runtime remoto**, col token dell'umano (che
   il piano già prevede per la lettura). L'agente resta sul PC, il progetto arriva dal
   dispositivo. È la via giusta a regime, e vuole che `carica_progetto` diventi un client HTTP
   invece di un `Project::load`.
3. **Relayare `/ws/ai` come gli altri**: la più semplice da scrivere e la sola che contraddice
   il piano. Andrebbe scelta solo decidendo *anche* che l'agente può girare sul dispositivo.

**Da decidere prima del merge di T-50**, perché la 1 è una riga di guardia mentre la 2 cambia
la forma degli strumenti — e scoprirlo dopo il merge significa averla scelta per inerzia.

### Aggiornamento 2026-09-01 — la premessa era sbagliata, e la cura è più piccola

*Non chiude Q31: la chiusura è del maintainer. Registra però che la via decisa non va
implementata, e perché.*

La domanda era stata posta con due metà: (a) il socket della chat finisce sul relay e prende 404;
(b) gli strumenti leggerebbero il progetto locale mentre l'umano modifica quello remoto, quindi
proporrebbero modifiche «su un progetto diverso da quello aperto». Sulla (b) il maintainer aveva
scelto la via 2 — far leggere gli strumenti dal runtime remoto.

**La metà (b) non esiste.** Verificato il 2026-09-01:

- `remote_deploy` **esporta il progetto locale attivo** e lo carica sul device
  (`sws-web/src/remote.rs`, il commento in testa lo dice: *«export the active local project as a
  ZIP and upload it to the connected remote runtime»*); il «pull» fa il verso opposto, importando
  il bundle del device **come progetto locale**.
- Il client HTTP non sa nemmeno che esista un remoto: nessun riferimento a `remoteConnected` in
  `sws-editor/src/api/client.ts`. Solo sette endpoint `/api/remote/*` parlano col dispositivo, e
  li proxa il server.

Quindi, con un runtime remoto collegato, **il progetto che l'utente modifica è sempre quello
locale**; il device ne ha una copia, aggiornata dai deploy. Gli strumenti dell'assistente che
leggono il progetto locale stanno leggendo quello giusto.

Implementare la via 2 avrebbe fatto leggere all'agente la copia sul dispositivo — che nessuno sta
editando — e avrebbe girato l'agente dentro il runtime di un impianto in servizio, cosa che il
piano di T-50 §2 esclude. Sarebbe stato un difetto introdotto per scelta, e peggiore del 404
perché sembrerebbe funzionare.

**Cosa è stato fatto invece**: `buildWsUrl` (`sws-editor/src/ws/wsUrl.ts`) dirotta sul relay solo i
tre canali che mostrano lo stato *del dispositivo* — `tags`, `alarms`, `logs` — invece di ogni
canale. `/ws/ai` resta locale, la chat aggancia, e legge il progetto che si sta modificando. La
whitelist del relay lato server **non** è stata toccata: `ai` non c'è e non va aggiunto, con la
ragione scritta accanto al `matches!` così nessuno la «corregga» in futuro. Il pannello dice in
una riga che l'assistente lavora sul progetto locale, perché con un device collegato è naturale
credere il contrario.

Resta legittimo, ma è un'altra domanda: se un giorno si volesse un assistente che *guarda* il
dispositivo — i suoi tag dal vivo, il suo storico, i suoi log — quello è il secondo insieme di
strumenti di cui si parla in `docs/archive/2026-08-31-chat-ai-nelleditor.md`, non questo.
